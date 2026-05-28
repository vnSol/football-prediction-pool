function doPost(event) {
  var update = JSON.parse((event && event.postData && event.postData.contents) || "{}");
  try {
    withScriptLock(function () {
      if (isDuplicateTelegramUpdate(update)) return;
      markTelegramUpdateProcessed(update);
      if (update.callback_query) handleCallbackQuery(update.callback_query);
      if (update.message) handleMessage(update.message);
    });
  } catch (error) {
    console.error(error && error.stack ? error.stack : error);
  }
  return HtmlService.createHtmlOutput("ok");
}

function isDuplicateTelegramUpdate(update) {
  var key = getTelegramUpdateDedupeKey(update);
  if (!key) return false;
  var cache = CacheService.getScriptCache();
  if (cache.get(key)) return true;
  if (update.update_id == null) return false;
  var lastProcessed = Number(PropertiesService.getScriptProperties().getProperty("LAST_TELEGRAM_UPDATE_ID") || -1);
  return Number(update.update_id) <= lastProcessed;
}

function markTelegramUpdateProcessed(update) {
  var key = getTelegramUpdateDedupeKey(update);
  if (!key) return;
  CacheService.getScriptCache().put(key, "1", 21600);
  if (update.update_id != null) {
    var properties = PropertiesService.getScriptProperties();
    var lastProcessed = Number(properties.getProperty("LAST_TELEGRAM_UPDATE_ID") || -1);
    if (Number(update.update_id) > lastProcessed) {
      properties.setProperty("LAST_TELEGRAM_UPDATE_ID", String(update.update_id));
    }
  }
}

function setup() {
  setupWorkbook();
  installTriggers();
}

function installTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    var fn = trigger.getHandlerFunction();
    if (fn === "runScheduler" || fn === "dailySync") ScriptApp.deleteTrigger(trigger);
  });
  ScriptApp.newTrigger("runScheduler").timeBased().everyMinutes(5).create();
  ScriptApp.newTrigger("dailySync").timeBased().everyDays(1).atHour(8).create();
}

function dailySync() {
  var upcoming = getMatches().filter(function (match) {
    var hours = hoursUntil(match, new Date());
    return hours >= 0 && hours <= 48;
  });
  if (upcoming.length === 0) {
    sendToAdmins("📅 Daily sync: chưa thấy trận nào trong 48h tới. Nếu lịch chưa nhập, cập nhật Sheet từ Google Search.");
  }
}

function runScheduler() {
  withScriptLock(function () {
    processSchedulerActions(new Date());
  });
}

function processSchedulerActions(now) {
  var matches = getMatches();
  var picks = getPicks();
  getSchedulerActions(matches, picks, now).forEach(function (action) {
    var match = getMatchById(action.matchId);
    if (!match) return;
    if (action.type === ACTIONS.OPEN_PICK) openMatch(match.matchId, "scheduler");
    if (action.type === ACTIONS.ODDS_ALERT) alertMissingOdds(match);
    if (action.type === ACTIONS.REMIND_MISSING) remindMissing(match);
    if (action.type === ACTIONS.LOCK_MATCH) lockMatch(match.matchId, "scheduler");
    if (action.type === ACTIONS.PROMPT_RESULT) promptResult(match);
  });
}

function handleMessage(message) {
  var chatId = message.chat && message.chat.id;
  var text = message.text || "";
  var command = parseTelegramCommand(text);
  if (!command) return;

  var player = getPlayerByTelegramId(message.from.id);
  var admin = isAdminChatId(chatId) || isAdminChatId(message.from.id);

  if (command.name === "start") {
    sendTelegramMessage(chatId, "Bot World Cup Prediction Pool đã sẵn sàng. Dùng /commands để xem danh sách lệnh.");
    return;
  }
  if (command.name === "commands") return sendTelegramMessage(chatId, formatCommands(admin));
  if (command.name === "matches") return sendOpenMatches(chatId);
  if (command.name === "leaderboard") return sendTelegramMessage(chatId, formatLeaderboard(getLeaderboard(), 20));
  if (command.name === "mypick") return sendMyPick(chatId, player, command.args[0]);

  if (!admin) {
    sendTelegramMessage(chatId, "Lệnh này chỉ dành cho admin.");
    return;
  }

  if (command.name === "set_odds") return adminSetOdds(chatId, message.from.id, command.args);
  if (command.name === "add_player") return adminAddPlayer(chatId, message.from.id, command.args);
  if (command.name === "set_player_active") return adminSetPlayerActive(chatId, message.from.id, command.args);
  if (command.name === "add_match") return adminAddMatch(chatId, message.from.id, command.args);
  if (command.name === "set_match_time") return adminSetMatchTime(chatId, message.from.id, command.args);
  if (command.name === "reset_sheet") return adminResetSheet(chatId);
  if (command.name === "dryrun") return adminDryRun(chatId, message.from.id, command.args);
  if (command.name === "dryrun_finish") return adminDryRunFinish(chatId, message.from.id);
  if (command.name === "open") return openMatch(command.args[0], message.from.id, chatId);
  if (command.name === "lock") return lockMatch(command.args[0], message.from.id, chatId);
  if (command.name === "result") return adminSetResult(chatId, message.from.id, command.args);
  if (command.name === "settle") return settleMatch(command.args[0], message.from.id, chatId);
  if (command.name === "recap") return resendRecap(command.args[0], chatId);
}

function adminAddPlayer(chatId, actor, args) {
  var player = parseAddPlayerArgs(args);
  if (!player) {
    sendTelegramMessage(chatId, "Cú pháp: /add_player <telegramUserId> <display name>");
    return;
  }
  var result = addPlayer(player, actor);
  if (!result.ok) {
    sendTelegramMessage(chatId, "Player đã tồn tại: " + result.player.displayName + " (" + result.player.telegramUserId + ").");
    return;
  }
  sendTelegramMessage(chatId, "Đã thêm player: " + player.displayName + " (" + player.telegramUserId + ").");
}

function adminSetPlayerActive(chatId, actor, args) {
  var telegramUserId = args[0];
  var activeText = String(args[1] || "").toLowerCase();
  if (!telegramUserId || (activeText !== "true" && activeText !== "false")) {
    sendTelegramMessage(chatId, "Cú pháp: /set_player_active <telegramUserId> <true|false>");
    return;
  }
  var result = setPlayerActive(telegramUserId, activeText === "true", actor);
  if (!result) {
    sendTelegramMessage(chatId, "Không tìm thấy player " + telegramUserId + ".");
    return;
  }
  sendTelegramMessage(chatId, "Đã cập nhật active=" + activeText + " cho " + result.after.displayName + ".");
}

function adminAddMatch(chatId, actor, args) {
  var match = parseAddMatchArgs(args);
  if (!match) {
    sendTelegramMessage(chatId, "Cú pháp: /add_match <matchId> <kickoffUtc> <GROUP|KNOCKOUT> <home team> vs <away team>. Dùng dấu _ nếu tên đội có khoảng trắng.");
    return;
  }
  var result = addMatch(match, actor);
  if (!result.ok) {
    sendTelegramMessage(chatId, "Trận đã tồn tại: " + result.match.matchId + " " + result.match.homeTeam + " vs " + result.match.awayTeam + ".");
    return;
  }
  sendTelegramMessage(chatId, "Đã thêm trận " + match.matchId + ": " + match.homeTeam + " vs " + match.awayTeam + " lúc " + formatKickoffTime(match.kickoffUtc) + ".");
}

function adminSetMatchTime(chatId, actor, args) {
  var matchId = args[0];
  var kickoffUtc = args[1];
  var match = getMatchById(matchId);
  if (!match || !kickoffUtc || Number.isNaN(toDate(kickoffUtc).getTime())) {
    sendTelegramMessage(chatId, "Cú pháp: /set_match_time <matchId> <kickoffUtc>");
    return;
  }
  if (match.status !== STATUSES.SCHEDULED && match.status !== STATUSES.OPEN) {
    sendTelegramMessage(chatId, "Chỉ sửa giờ khi trận còn SCHEDULED hoặc OPEN.");
    return;
  }
  updateMatch(matchId, { kickoffUtc: toDate(kickoffUtc).toISOString() }, actor, "SET_MATCH_TIME");
  sendTelegramMessage(chatId, "Đã cập nhật giờ đá " + matchId + ": " + formatKickoffTime(kickoffUtc) + ".");
}

function handleCallbackQuery(callbackQuery) {
  var chatId = callbackQuery.message.chat.id;
  var telegramUserId = String(callbackQuery.from.id);
  var data = parseCallbackData(callbackQuery.data);
  var admin = isAdminChatId(chatId) || isAdminChatId(telegramUserId);

  if (data.action === "reset_select" || data.action === "reset_confirm" || data.action === "reset_cancel") {
    handleResetSheetCallback(callbackQuery, data, admin);
    return;
  }

  var player = getPlayerByTelegramId(telegramUserId);
  if (!player || player.active === false || String(player.active).toLowerCase() === "false") {
    answerCallbackQuery(callbackQuery.id, "Bạn chưa có trong danh sách người chơi.");
    return;
  }

  var match = getMatchById(data.matchId);
  if (!match) {
    answerCallbackQuery(callbackQuery.id, "Không tìm thấy trận.");
    return;
  }
  if (!canChangePick(match, new Date())) {
    answerCallbackQuery(callbackQuery.id, "Trận đã bắt đầu hoặc đã khóa, không đổi pick được.");
    return;
  }

  if (data.action === "pick" && isValidSelection(data.value)) {
    var previous = getPick(match.matchId, telegramUserId);
    var pick = upsertPick(match, player, data.value, previous ? previous.star : false, SOURCE.TELEGRAM, telegramUserId);
    answerCallbackQuery(callbackQuery.id, "Đã chọn: " + sideName(match, pick.selection));
    sendTelegramMessage(chatId, "✅ Pick hiện tại của bạn: " + sideName(match, pick.selection) + (pick.star ? " ⭐" : ""));
    return;
  }

  if (data.action === "star") {
    if (!isKnockout(match)) {
      answerCallbackQuery(callbackQuery.id, "Ngôi sao chỉ dùng cho vòng loại.");
      return;
    }
    var existing = getPick(match.matchId, telegramUserId);
    if (!existing) {
      answerCallbackQuery(callbackQuery.id, "Chọn đội trước rồi bật ngôi sao.");
      return;
    }
    var updated = upsertPick(match, player, existing.selection, !parseBoolean(existing.star), SOURCE.TELEGRAM, telegramUserId);
    answerCallbackQuery(callbackQuery.id, updated.star ? "Đã bật ngôi sao." : "Đã tắt ngôi sao.");
    sendTelegramMessage(chatId, "✅ Pick hiện tại của bạn: " + sideName(match, updated.selection) + (updated.star ? " ⭐" : ""));
  }
}

function adminResetSheet(chatId) {
  sendTelegramMessage(chatId, "Chọn sheet cần reset. Bot sẽ hỏi xác nhận trước khi xóa dữ liệu.", buildResetSheetKeyboard(getSheetNames()));
}

function handleResetSheetCallback(callbackQuery, data, admin) {
  var chatId = callbackQuery.message.chat.id;
  var sheetName = data.matchId;
  if (!admin) {
    answerCallbackQuery(callbackQuery.id, "Chỉ admin được reset sheet.");
    return;
  }
  if (getSheetNames().indexOf(sheetName) === -1) {
    answerCallbackQuery(callbackQuery.id, "Sheet không hợp lệ.");
    return;
  }
  if (data.action === "reset_select") {
    answerCallbackQuery(callbackQuery.id, "Xác nhận reset " + sheetName);
    sendTelegramMessage(chatId, "Xác nhận reset sheet `" + sheetName + "`? Dữ liệu dưới header sẽ bị xóa.", buildResetSheetConfirmKeyboard(sheetName));
    return;
  }
  if (data.action === "reset_cancel") {
    answerCallbackQuery(callbackQuery.id, "Đã hủy.");
    sendTelegramMessage(chatId, "Đã hủy reset sheet " + sheetName + ".");
    return;
  }
  if (data.action === "reset_confirm") {
    var result = resetSheetData(sheetName, callbackQuery.from.id);
    answerCallbackQuery(callbackQuery.id, result.ok ? "Đã reset." : "Reset thất bại.");
    sendTelegramMessage(chatId, result.ok ? "Đã reset sheet " + sheetName + " (" + result.clearedRows + " rows)." : "Không reset được sheet " + sheetName + ".");
  }
}

function adminDryRun(chatId, actor, args) {
  var baseTimeUtc = args[0] || new Date().toISOString();
  if (Number.isNaN(toDate(baseTimeUtc).getTime())) {
    sendTelegramMessage(chatId, "Cú pháp: /dryrun [baseTimeUtc]. Ví dụ: /dryrun 2026-06-12T00:00:00.000Z");
    return;
  }
  var matches;
  var source = "AI";
  try {
    matches = generateAiDryRunMatches(baseTimeUtc);
  } catch (error) {
    console.error(error && error.stack ? error.stack : error);
    matches = buildDryRunMatches(baseTimeUtc);
    source = "fallback";
  }
  var result = appendMatches(matches, actor);
  processSchedulerActions(toDate(baseTimeUtc));
  sendTelegramMessage(
    chatId,
    [
      "Đã tạo dry-run data bằng " + source + ".",
      "Created: " + (result.created.length ? result.created.join(", ") : "none"),
      "Skipped existing: " + (result.skipped.length ? result.skipped.join(", ") : "none"),
      "Đã chạy scheduler một lượt; dùng /matches để xem các trận đã mở pick.",
    ].join("\n")
  );
}

function adminDryRunFinish(chatId, actor) {
  var matches = getDryRunMatchesToFinish(getMatches());
  if (matches.length === 0) {
    sendTelegramMessage(chatId, "Không có trận dry-run nào cần finish.");
    return;
  }

  var finishAt = getDryRunFinishTime(matches);
  matches.forEach(function (match) {
    if (match.status !== STATUSES.LOCKED && hasLockedOdds(match)) {
      lockMatch(match.matchId, actor);
    }
  });

  var aiResults = 0;
  var fallbackResults = 0;
  var settled = [];
  var failed = [];

  getDryRunMatchesToFinish(getMatches()).forEach(function (match) {
    try {
      if (match.finalHomeScore === "" || match.finalHomeScore == null || match.finalAwayScore === "" || match.finalAwayScore == null) {
        var result;
        try {
          result = generateAiDryRunResult(match);
          aiResults += 1;
        } catch (error) {
          console.error(error && error.stack ? error.stack : error);
          result = buildFallbackDryRunResult(match);
          fallbackResults += 1;
        }
        updateMatch(
          match.matchId,
          {
            finalHomeScore: result.homeScore,
            finalAwayScore: result.awayScore,
            finalSummary: result.summary,
          },
          actor,
          "DRYRUN_SET_RESULT"
        );
      }

      settleMatch(match.matchId, actor);
      var after = getMatchById(match.matchId);
      if (after && after.status === STATUSES.SETTLED) {
        settled.push(match.matchId);
      } else {
        failed.push(match.matchId);
      }
    } catch (error) {
      console.error(error && error.stack ? error.stack : error);
      failed.push(match.matchId);
    }
  });

  sendTelegramMessage(
    chatId,
    [
      "Đã finish dry-run tại mốc " + finishAt.toISOString() + ".",
      "AI results: " + aiResults + " | fallback: " + fallbackResults,
      "Settled: " + (settled.length ? settled.join(", ") : "none"),
      "Failed: " + (failed.length ? failed.join(", ") : "none"),
    ].join("\n")
  );
}

function sendOpenMatches(chatId) {
  var now = new Date();
  var matches = getMatches().filter(function (match) {
    return match.status === STATUSES.OPEN;
  });
  if (matches.length === 0) {
    sendTelegramMessage(chatId, "Hiện chưa có trận nào đang mở pick.");
    return;
  }
  matches.forEach(function (match) {
    sendTelegramMessage(
      chatId,
      formatOpenMatchMessage(match, now),
      buildPickKeyboard(match)
    );
  });
}

function sendMyPick(chatId, player, matchId) {
  if (!player) {
    sendTelegramMessage(chatId, "Bạn chưa có trong danh sách người chơi.");
    return;
  }
  if (!matchId) {
    var playerPicks = getPicks().filter(function (pick) {
      return String(pick.telegramUserId) === String(player.telegramUserId);
    });
    sendTelegramMessage(
      chatId,
      formatMyUpcomingPicks({
        now: new Date(),
        matches: getMatches(),
        picks: playerPicks,
      })
    );
    return;
  }
  var targetMatchId = matchId || (getMatches().find(function (match) { return match.status === STATUSES.OPEN; }) || {}).matchId;
  if (!targetMatchId) {
    sendTelegramMessage(chatId, "Không có trận đang mở. Dùng /mypick <matchId> nếu muốn xem trận cụ thể.");
    return;
  }
  var match = getMatchById(targetMatchId);
  var pick = getPick(targetMatchId, player.telegramUserId);
  if (!match || !pick) {
    sendTelegramMessage(chatId, "Bạn chưa pick trận " + targetMatchId + ".");
    return;
  }
  sendTelegramMessage(chatId, "Pick của bạn: " + sideName(match, pick.selection) + (parseBoolean(pick.star) ? " ⭐" : ""));
}

function adminSetOdds(chatId, actor, args) {
  var matchId = args[0];
  var favoriteSide = String(args[1] || "").toUpperCase();
  var handicapGoals = Number(args[2]);
  var match = getMatchById(matchId);
  var now = new Date();
  if (!match || !isValidSelection(favoriteSide) || !isFinite(handicapGoals)) {
    sendTelegramMessage(chatId, "Cú pháp: /set_odds <matchId> <HOME|AWAY> <-0.5>");
    return;
  }
  if (toDate(match.kickoffUtc).getTime() <= now.getTime()) {
    sendTelegramMessage(chatId, "Trận đã bắt đầu, không sửa kèo.");
    return;
  }
  updateMatch(
    matchId,
    {
      favoriteSide: favoriteSide,
      handicapSide: favoriteSide,
      handicapGoals: handicapGoals,
      oddsLockedAt: now.toISOString(),
    },
    actor,
    "SET_ODDS"
  );
  var updatedMatch = getMatchById(matchId);
  if (shouldAutoOpenAfterOdds(updatedMatch, now)) {
    sendTelegramMessage(chatId, "Đã ghi kèo cho " + matchId + ": " + formatHandicap(updatedMatch) + ". Trận trong T-6h nên bot mở pick ngay.");
    openMatch(matchId, actor, chatId);
    return;
  }
  sendTelegramMessage(chatId, "Đã ghi kèo cho " + matchId + ": " + formatHandicap(updatedMatch));
}

function openMatch(matchId, actor, replyChatId) {
  var match = getMatchById(matchId);
  if (!match || !hasLockedOdds(match)) {
    if (replyChatId) sendTelegramMessage(replyChatId, "Không mở được: thiếu trận hoặc thiếu kèo.");
    return;
  }
  if (toDate(match.kickoffUtc).getTime() <= Date.now()) {
    if (replyChatId) sendTelegramMessage(replyChatId, "Trận đã bắt đầu, không mở pick.");
    return;
  }
  updateMatch(matchId, { status: STATUSES.OPEN, openedAt: new Date().toISOString() }, actor, "OPEN_MATCH");
  sendPickOpenMessage(getMatchById(matchId));
  if (replyChatId) sendTelegramMessage(replyChatId, "Đã mở pick cho " + matchId + ".");
}

function alertMissingOdds(match) {
  if (match.oddsAlertedAt) return;
  updateMatch(match.matchId, { oddsAlertedAt: new Date().toISOString() }, "scheduler", "ODDS_ALERT");
  sendToAdmins("⚠️ Còn dưới 6h tới " + match.homeTeam + " vs " + match.awayTeam + " nhưng chưa có kèo. Dùng /set_odds " + match.matchId + " <HOME|AWAY> <-0.5>.");
}

function remindMissing(match) {
  sendMissingPickReminders(match);
  updateMatch(match.matchId, { reminded30At: new Date().toISOString() }, "scheduler", "REMIND_MISSING");
}

function lockMatch(matchId, actor, replyChatId) {
  var match = getMatchById(matchId);
  if (!match) return;
  var defaults = createDefaultPicks(match, getActivePlayers(), getPicks(), new Date());
  defaults.forEach(function (pick) {
    var player = getPlayerByTelegramId(pick.telegramUserId);
    upsertPick(match, player, pick.selection, false, SOURCE.AUTO_DEFAULT, actor);
  });
  updateMatch(matchId, { status: STATUSES.LOCKED, lockedAt: new Date().toISOString() }, actor, "LOCK_MATCH");
  sendLockMessage(matchId);
  if (replyChatId) sendTelegramMessage(replyChatId, "Đã khóa trận " + matchId + ".");
}

function sendLockMessage(matchId) {
  var match = getMatchById(matchId);
  var picks = getPicks().filter(function (pick) {
    return String(pick.matchId) === String(matchId);
  });
  var text;
  try {
    text = generateAiLockMessage(match, picks);
  } catch (error) {
    console.error(error && error.stack ? error.stack : error);
    text = buildFallbackLockMessage(match, picks);
  }
  sendRecapToConfiguredChats(text);
}

function buildFallbackLockMessage(match, picks) {
  var facts = buildLockedBettingFacts({ match: match, picks: picks });
  return [
    "🎲 Chốt sổ: " + facts.title,
    "Giờ đá: " + facts.kickoff,
    "Kèo: " + facts.handicap,
    "Tổng pick: " + facts.totalPicks + " | Nhà: " + facts.homePicks + " | Khách: " + facts.awayPicks + (facts.drawWasOpen ? " | Hòa: " + facts.drawPicks : ""),
    "Ngôi sao hi vọng: " + facts.starPicks,
    "Cửa đã đóng, hồi hộp bắt đầu. Ai đọc kèo chuẩn thì lát nữa lên hương.",
  ].join("\n");
}

function promptResult(match) {
  updateMatch(match.matchId, { adminResultPromptedAt: new Date().toISOString() }, "scheduler", "PROMPT_RESULT");
  sendToAdmins("🔎 Cần xác nhận kết quả " + match.homeTeam + " vs " + match.awayTeam + ". Dùng /result " + match.matchId + " <home-away> <diễn biến; cách nhau bằng dấu ;> rồi /settle " + match.matchId + ".");
}

function adminSetResult(chatId, actor, args) {
  var matchId = args[0];
  var scoreParts = String(args[1] || "").split("-");
  var homeScore = Number(scoreParts[0]);
  var awayScore = Number(scoreParts[1]);
  if (!matchId || scoreParts.length !== 2 || !isFinite(homeScore) || !isFinite(awayScore)) {
    sendTelegramMessage(chatId, "Cú pháp: /result <matchId> <home-away> <diễn biến; cách nhau bằng dấu ;>");
    return;
  }
  updateMatch(
    matchId,
    {
      finalHomeScore: homeScore,
      finalAwayScore: awayScore,
      finalSummary: args.slice(2).join(" "),
    },
    actor,
    "SET_RESULT"
  );
  sendTelegramMessage(chatId, "Đã ghi kết quả " + matchId + ": " + homeScore + "-" + awayScore + ".");
}

function settleMatch(matchId, actor, replyChatId) {
  var match = getMatchById(matchId);
  if (!match || match.status === STATUSES.SETTLED) {
    if (replyChatId) sendTelegramMessage(replyChatId, "Không settle được: thiếu trận hoặc trận đã settle.");
    return;
  }
  if (match.finalHomeScore === "" || match.finalAwayScore === "") {
    if (replyChatId) sendTelegramMessage(replyChatId, "Chưa có kết quả final.");
    return;
  }

  var score = { homeScore: Number(match.finalHomeScore), awayScore: Number(match.finalAwayScore) };
  var now = new Date().toISOString();
  var rows = getPicks()
    .filter(function (pick) {
      return String(pick.matchId) === String(matchId);
    })
    .map(function (pick) {
      var result = scorePick(match, pick, score);
      return {
        matchId: matchId,
        telegramUserId: pick.telegramUserId,
        displayName: pick.displayName,
        selection: pick.selection,
        star: parseBoolean(pick.star),
        correct: result.correct,
        points: result.points,
        outcome: result.outcome,
        settledAt: now,
      };
    });

  appendScoreRows(rows);
  var outcome = rows.length ? rows[0].outcome : getHandicapOutcome(match, score);
  updateMatch(matchId, { status: STATUSES.SETTLED, handicapOutcome: outcome, settledAt: now }, actor, "SETTLE_MATCH");

  var recap = buildAiRecapOrFallback(matchId);
  sendRecapToConfiguredChats(recap);
  if (replyChatId) sendTelegramMessage(replyChatId, "Đã settle và gửi recap cho " + matchId + ".");
}

function buildAiRecapOrFallback(matchId) {
  var match = getMatchById(matchId);
  var score = { homeScore: Number(match.finalHomeScore), awayScore: Number(match.finalAwayScore) };
  var scoreChanges = getScoreChangesForMatch(matchId);
  try {
    return generateAiMatchRecap(match, score, scoreChanges, getLeaderboard());
  } catch (error) {
    console.error(error && error.stack ? error.stack : error);
    return buildRecap(matchId);
  }
}

function buildRecap(matchId) {
  var match = getMatchById(matchId);
  var score = { homeScore: Number(match.finalHomeScore), awayScore: Number(match.finalAwayScore) };
  var events = String(match.finalSummary || "")
    .split(";")
    .map(function (event) {
      return event.trim();
    })
    .filter(Boolean);
  var scoreChanges = getScoreChangesForMatch(matchId);
  return formatRecap({
    match: match,
    score: score,
    outcome: match.handicapOutcome || getHandicapOutcome(match, score),
    events: events,
    scoreChanges: scoreChanges,
    leaderboard: getLeaderboard(),
  });
}

function getScoreChangesForMatch(matchId) {
  return readObjects(SHEETS.SCORES)
    .filter(function (scoreRow) {
      return String(scoreRow.matchId) === String(matchId);
    })
    .map(function (scoreRow) {
      return {
        displayName: scoreRow.displayName,
        points: Number(scoreRow.points || 0),
        correct: parseBoolean(scoreRow.correct),
        star: parseBoolean(scoreRow.star),
      };
    });
}

function resendRecap(matchId, chatId) {
  sendTelegramMessage(chatId, buildRecap(matchId));
}

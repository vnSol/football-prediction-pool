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
    if (action.type === ACTIONS.REMIND_MISSING) remindMissing(match, action.reminderMinutes);
    if (action.type === ACTIONS.LOCK_MATCH) lockMatch(match.matchId, "scheduler");
    if (action.type === ACTIONS.PROMPT_RESULT) promptResult(match);
  });
}

function handleMessage(message) {
  var chatId = message.chat && message.chat.id;
  var text = message.text || "";
  var command = parseTelegramCommand(text);
  if (!command) return;
  if (shouldIgnoreDirectOnlyCommandInChat(command.name, message.chat)) return;

  var player = getPlayerByTelegramId(message.from.id);
  var admin = isAdminChatId(chatId) || isAdminChatId(message.from.id);

  if (command.name === "start") {
    sendTelegramMessage(chatId, "Bot World Cup Prediction Pool đã sẵn sàng. Dùng /join để tham gia pool hoặc /commands để xem danh sách lệnh.");
    return;
  }
  if (command.name === "join") return joinPool(chatId, message.from);
  if (command.name === "rules") return sendTelegramMessage(chatId, formatRules());
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
  if (command.name === "ai_matches") return adminAiMatches(chatId, message.from.id, command.args);
  if (command.name === "set_match_time") return adminSetMatchTime(chatId, message.from.id, command.args);
  if (command.name === "fix_match_times") return adminFixMatchTimes(chatId, message.from.id, command.args);
  if (command.name === "reset_sheet") return adminResetSheet(chatId);
  if (command.name === "dryrun") return adminDryRun(chatId, message.from.id, command.args);
  if (command.name === "dryrun_finish") return adminDryRunFinish(chatId, message.from.id);
  if (command.name === "open") return openMatch(command.args[0], message.from.id, chatId);
  if (command.name === "lock") return lockMatch(command.args[0], message.from.id, chatId);
  if (command.name === "lock_summary") return resendLockSummary(command.args[0], chatId);
  if (command.name === "ai_result") return adminAiResult(chatId, message.from.id, command.args);
  if (command.name === "result") return adminSetResult(chatId, message.from.id, command.args);
  if (command.name === "settle") return settleMatch(command.args[0], message.from.id, chatId);
  if (command.name === "reset_latest_settle" || command.name === "reset_settle_latest") return adminResetLatestSettle(chatId, message.from.id);
  if (command.name === "recap") return resendRecap(command.args[0], chatId);
}

function joinPool(chatId, user) {
  if (!user || !user.id) {
    sendTelegramMessage(chatId, "Không đọc được Telegram ID. Hãy thử lại bằng tài khoản Telegram của bạn.");
    return;
  }
  var result = upsertJoinedPlayer(user, user.id);
  sendTelegramMessage(chatId, formatJoinMessage(result.player, result.created));
  if (result.created || result.reactivated) {
    sendToAdmins(formatJoinAdminMessage(result.player, result.created));
  }
  sendTelegramMessage(
    chatId,
    formatMyUpcomingPicks({
      now: new Date(),
      matches: getMatches(),
      picks: getPicks().filter(function (pick) {
        return String(pick.telegramUserId) === String(user.id);
      }),
    })
  );
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
    sendTelegramMessage(chatId, "Trận đã tồn tại: " + result.match.matchId + " " + sideDisplayName(result.match, SELECTIONS.HOME) + " vs " + sideDisplayName(result.match, SELECTIONS.AWAY) + ".");
    return;
  }
  sendTelegramMessage(chatId, "Đã thêm trận " + match.matchId + ": " + sideDisplayName(match, SELECTIONS.HOME) + " vs " + sideDisplayName(match, SELECTIONS.AWAY) + " lúc " + formatKickoffTime(match.kickoffUtc) + ".");
}

function adminAiMatches(chatId, actor, args) {
  var prompt = (args || []).join(" ").trim();
  if (!prompt) {
    sendTelegramMessage(chatId, "Cú pháp: /ai_matches <prompt>");
    return;
  }

  var existingMatches = getMatches();
  var matches;
  try {
    matches = filterNewAiMatchProposals(generateAiMatchProposals(prompt, existingMatches), existingMatches);
  } catch (error) {
    console.error(error && error.stack ? error.stack : error);
    sendTelegramMessage(chatId, "AI/search chưa lấy được danh sách trận phù hợp. Hãy thử lại với prompt cụ thể hơn.");
    return;
  }

  if (!matches.length) {
    sendTelegramMessage(chatId, "AI không tìm được trận nào phù hợp yêu cầu.");
    return;
  }

  var proposal = buildAiMatchProposal(buildAiMatchProposalRequestId(new Date()), prompt, matches, new Date());
  saveAiMatchProposal(proposal);
  sendTelegramMessage(chatId, formatAiMatchProposalMessage(proposal), buildAiMatchProposalKeyboard(proposal));
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

function adminFixMatchTimes(chatId, actor, args) {
  var hours = parseFixMatchTimesArgs(args);
  if (hours === null) {
    sendTelegramMessage(chatId, "Cú pháp: /fix_match_times [hours]. Mặc định +1. Ví dụ: /fix_match_times 1 hoặc /fix_match_times -0.5");
    return;
  }
  var plan = buildMatchTimeFixPlan(getMatches(), hours, new Date());
  if (!plan.length) {
    sendTelegramMessage(chatId, "Không có trận chưa diễn ra (SCHEDULED/OPEN) để dời giờ.");
    return;
  }
  plan.forEach(function (item) {
    updateMatch(item.matchId, { kickoffUtc: item.newKickoffUtc }, actor, "FIX_MATCH_TIME");
  });
  var sign = hours > 0 ? "+" : "";
  var lines = ["Đã dời giờ " + plan.length + " trận chưa diễn ra (" + sign + hours + "h):"];
  plan.forEach(function (item) {
    lines.push("• " + item.matchId + ": " + formatKickoffTime(item.oldKickoffUtc) + " → " + formatKickoffTime(item.newKickoffUtc));
  });
  sendTelegramMessage(chatId, lines.join("\n"));
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

  if (data.action === "match_toggle" || data.action === "match_submit" || data.action === "match_cancel") {
    handleAiMatchProposalCallback(callbackQuery, data, admin);
    return;
  }

  if (data.action === "result_confirm" || data.action === "result_reject") {
    handleResultProposalCallback(callbackQuery, data, admin);
    return;
  }

  if (data.action === "odds_confirm" || data.action === "odds_reject") {
    handleOddsProposalCallback(callbackQuery, data, admin);
    return;
  }

  if (!shouldHandlePickCallbackInChat(data.action, callbackQuery.message.chat)) {
    answerCallbackQuery(callbackQuery.id, "Hãy pick trong direct message với bot để tránh spam group.");
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
    var pick = upsertPick(match, player, data.value, false, SOURCE.TELEGRAM, telegramUserId);
    answerCallbackQuery(callbackQuery.id, "Đã chọn " + match.matchId + ": " + sideDisplayName(match, pick.selection));
    sendTelegramMessage(chatId, formatPickConfirmationMessage(match, pick));
    return;
  }

  if (data.action === "pick_star" && isValidSelection(data.value)) {
    if (!isKnockout(match)) {
      answerCallbackQuery(callbackQuery.id, "Ngôi sao chỉ dùng cho vòng loại.");
      return;
    }
    var starredPick = upsertPick(match, player, data.value, true, SOURCE.TELEGRAM, telegramUserId);
    answerCallbackQuery(callbackQuery.id, "Đã chọn " + match.matchId + ": " + sideDisplayName(match, starredPick.selection) + " ⭐");
    sendTelegramMessage(chatId, formatPickConfirmationMessage(match, starredPick));
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
    sendTelegramMessage(chatId, formatPickConfirmationMessage(match, updated));
  }
}

function adminResetSheet(chatId) {
  sendTelegramMessage(chatId, "Chọn sheet cần reset. Bot sẽ hỏi xác nhận trước khi xóa dữ liệu.", buildResetSheetKeyboard(getSheetNames()));
}

function handleOddsProposalCallback(callbackQuery, data, admin) {
  var chatId = callbackQuery.message.chat.id;
  var actor = callbackQuery.from.id;
  if (!admin) {
    answerCallbackQuery(callbackQuery.id, "Chỉ admin được confirm kèo.");
    return;
  }

  var match = getMatchById(data.matchId);
  if (!match) {
    answerCallbackQuery(callbackQuery.id, "Không tìm thấy trận.");
    return;
  }

  if (data.action === "odds_reject") {
    updateMatch(
      match.matchId,
      {
        oddsProposalDecision: "REJECTED",
        oddsProposalDecidedAt: new Date().toISOString(),
      },
      actor,
      "REJECT_ODDS_PROPOSAL"
    );
    answerCallbackQuery(callbackQuery.id, "Đã reject đề xuất kèo.");
    sendTelegramMessage(chatId, "Đã reject đề xuất kèo cho " + match.matchId + ". Nếu cần, nhập tay bằng /set_odds " + match.matchId + " <HOME|AWAY> <handicap>.");
    return;
  }

  var now = new Date();
  if (!canSetOdds(match, now)) {
    answerCallbackQuery(callbackQuery.id, "Trận đã khóa hoặc đã bắt đầu.");
    sendTelegramMessage(chatId, "Không confirm được kèo cho " + match.matchId + " vì trận đã khóa hoặc đã bắt đầu.");
    return;
  }

  try {
    updateMatch(match.matchId, buildConfirmOddsProposalPatch(match, now), actor, "CONFIRM_ODDS_PROPOSAL");
    var updatedMatch = getMatchById(match.matchId);
    answerCallbackQuery(callbackQuery.id, "Đã confirm kèo.");
    if (shouldAutoOpenAfterOdds(updatedMatch, now)) {
      openMatch(match.matchId, actor, chatId);
      return;
    }
    sendTelegramMessage(chatId, "Đã ghi kèo cho " + match.matchId + ": " + formatHandicap(updatedMatch) + ".");
  } catch (error) {
    console.error(error && error.stack ? error.stack : error);
    answerCallbackQuery(callbackQuery.id, "Không confirm được đề xuất kèo.");
    sendTelegramMessage(chatId, "Không confirm được đề xuất kèo cho " + match.matchId + ". Hãy nhập tay bằng /set_odds " + match.matchId + " <HOME|AWAY> <handicap>.");
  }
}

function handleResultProposalCallback(callbackQuery, data, admin) {
  var chatId = callbackQuery.message.chat.id;
  var actor = callbackQuery.from.id;
  if (!admin) {
    answerCallbackQuery(callbackQuery.id, "Chỉ admin được confirm kết quả.");
    return;
  }

  var match = getMatchById(data.matchId);
  if (!match) {
    answerCallbackQuery(callbackQuery.id, "Không tìm thấy trận.");
    return;
  }
  if (match.status === STATUSES.SETTLED) {
    answerCallbackQuery(callbackQuery.id, "Trận đã settle rồi.");
    return;
  }

  if (data.action === "result_reject") {
    updateMatch(
      match.matchId,
      {
        resultProposalDecision: "REJECTED",
        resultProposalDecidedAt: new Date().toISOString(),
      },
      actor,
      "REJECT_RESULT_PROPOSAL"
    );
    answerCallbackQuery(callbackQuery.id, "Đã reject đề xuất.");
    sendTelegramMessage(chatId, "Đã reject đề xuất cho " + match.matchId + ". Nếu cần, nhập tay bằng /result " + match.matchId + " <home-away sau 90' + bù giờ, không hiệp phụ/luân lưu> <diễn biến>.");
    return;
  }

  try {
    updateMatch(match.matchId, buildConfirmResultProposalPatch(match), actor, "CONFIRM_RESULT_PROPOSAL");
    answerCallbackQuery(callbackQuery.id, "Đã confirm, bot sẽ settle.");
    settleMatch(match.matchId, actor, chatId);
  } catch (error) {
    console.error(error && error.stack ? error.stack : error);
    answerCallbackQuery(callbackQuery.id, "Không confirm được đề xuất.");
    sendTelegramMessage(chatId, "Không confirm được đề xuất cho " + match.matchId + ". Hãy nhập tay bằng /result " + match.matchId + " <home-away sau 90' + bù giờ, không hiệp phụ/luân lưu> <diễn biến>.");
  }
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

function handleAiMatchProposalCallback(callbackQuery, data, admin) {
  var chatId = callbackQuery.message.chat.id;
  var messageId = callbackQuery.message.message_id;
  var actor = callbackQuery.from.id;
  if (!admin) {
    answerCallbackQuery(callbackQuery.id, "Chỉ admin được duyệt lịch trận.");
    return;
  }

  var proposal = getAiMatchProposal(data.matchId);
  if (!proposal) {
    answerCallbackQuery(callbackQuery.id, "Đề xuất đã hết hạn hoặc không tồn tại.");
    sendTelegramMessage(chatId, "Đề xuất lịch trận đã hết hạn. Hãy chạy lại /ai_matches <prompt>.");
    return;
  }

  if (data.action === "match_cancel") {
    deleteAiMatchProposal(proposal.requestId);
    answerCallbackQuery(callbackQuery.id, "Đã hủy đề xuất.");
    editTelegramMessageText(chatId, messageId, "Đã hủy đề xuất lịch trận AI/search.");
    return;
  }

  if (data.action === "match_toggle") {
    var nextProposal = toggleAiMatchProposalSelection(proposal, data.value);
    saveAiMatchProposal(nextProposal);
    answerCallbackQuery(callbackQuery.id, "Đã cập nhật lựa chọn.");
    editTelegramMessageText(chatId, messageId, formatAiMatchProposalMessage(nextProposal), buildAiMatchProposalKeyboard(nextProposal));
    return;
  }

  if (data.action === "match_submit") {
    var selectedMatches = getSelectedAiMatchProposalMatches(proposal);
    if (!selectedMatches.length) {
      answerCallbackQuery(callbackQuery.id, "Chưa chọn trận nào.");
      return;
    }
    var result = appendMatches(selectedMatches, actor);
    deleteAiMatchProposal(proposal.requestId);
    answerCallbackQuery(callbackQuery.id, "Đã ghi trận đã chọn.");
    editTelegramMessageText(chatId, messageId, formatAiMatchSubmitResult(result));
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
  var result = upsertDryRunMatches(matches, actor);
  processSchedulerActions(toDate(baseTimeUtc));
  sendTelegramMessage(
    chatId,
    [
      "Đã tạo dry-run data bằng " + source + ".",
      "Created: " + (result.created.length ? result.created.join(", ") : "none"),
      "Refreshed existing: " + (result.refreshed.length ? result.refreshed.join(", ") : "none"),
      "Skipped existing: " + (result.skipped.length ? result.skipped.join(", ") : "none"),
      "Đã chạy scheduler một lượt; dùng /matches để xem các trận đã mở pick.",
      "Dùng /dryrun_finish để mô phỏng T+135, rồi bấm Y/N trên đề xuất kết quả.",
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
    if (match.status !== STATUSES.LOCKED) {
      lockMatch(match.matchId, actor);
    }
  });

  var proposed = [];
  var failed = [];

  getDryRunMatchesToFinish(getMatches()).forEach(function (match) {
    try {
      var proposal = buildDryRunResultProposal(match);
      updateMatch(
        match.matchId,
        Object.assign({ adminResultPromptedAt: finishAt.toISOString() }, buildResultProposalPatch(proposal, finishAt)),
        actor,
        "DRYRUN_PROMPT_RESULT"
      );
      sendTelegramMessage(chatId, formatAdminResultProposal(match, proposal), buildResultProposalConfirmKeyboard(match.matchId, proposal));
      proposed.push(match.matchId);
    } catch (error) {
      console.error(error && error.stack ? error.stack : error);
      failed.push(match.matchId);
    }
  });

  sendTelegramMessage(
    chatId,
    [
      "Đã finish dry-run tại mốc " + finishAt.toISOString() + ".",
      "Đã gửi đề xuất kết quả: " + (proposed.length ? proposed.join(", ") : "none"),
      "Bấm Y trên đề xuất để bot tự ghi kết quả và settle, hoặc N để reject.",
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
  sendTelegramMessage(chatId, "Pick của bạn: " + sideDisplayName(match, pick.selection) + (parseBoolean(pick.star) ? " ⭐" : ""));
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
  if (!canSetOdds(match, now)) {
    sendTelegramMessage(chatId, "Trận đã khóa bình chọn hoặc đã bắt đầu, không sửa kèo.");
    return;
  }
  var previousHandicap = hasLockedOdds(match) ? formatHandicap(match) : "Chưa có kèo";
  var shouldNotifyPlayers = shouldNotifyOddsUpdate(match, favoriteSide, handicapGoals);
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
    sendTelegramMessage(chatId, "Đã ghi kèo cho " + matchId + ": " + formatHandicap(updatedMatch) + ". Trận trong T-24h nên bot mở pick ngay.");
    openMatch(matchId, actor, chatId);
    return;
  }
  sendTelegramMessage(chatId, "Đã ghi kèo cho " + matchId + ": " + formatHandicap(updatedMatch));
  if (shouldNotifyPlayers) sendOddsUpdateMessage(updatedMatch, previousHandicap);
}

function openMatch(matchId, actor, replyChatId) {
  var match = getMatchById(matchId);
  if (!match) {
    if (replyChatId) sendTelegramMessage(replyChatId, "Không mở được: thiếu trận.");
    return;
  }
  var now = new Date();
  if (toDate(match.kickoffUtc).getTime() <= now.getTime()) {
    if (replyChatId) sendTelegramMessage(replyChatId, "Trận đã bắt đầu, không mở pick.");
    return;
  }
  if (!hasLockedOdds(match)) {
    updateMatch(matchId, buildDefaultOddsPatch(now), actor, "DEFAULT_ODDS");
    match = getMatchById(matchId);
  }
  updateMatch(matchId, { status: STATUSES.OPEN, openedAt: now.toISOString() }, actor, "OPEN_MATCH");
  sendPickOpenMessage(getMatchById(matchId));
  if (replyChatId) sendTelegramMessage(replyChatId, "Đã mở pick cho " + matchId + ".");
}

function alertMissingOdds(match) {
  if (match.oddsAlertedAt) return;
  var now = new Date();
  var adminMessage;
  try {
    var proposal = isDryRunMatch(match) ? buildDryRunOddsProposal(match) : generateAiOddsProposal(match);
    updateMatch(
      match.matchId,
      Object.assign({ oddsAlertedAt: now.toISOString() }, buildAutoApplyOddsProposalPatch(proposal, now)),
      "scheduler",
      "AUTO_APPLY_ODDS_PROPOSAL"
    );
    adminMessage = formatAdminOddsProposal(match, proposal);
  } catch (error) {
    console.error(error && error.stack ? error.stack : error);
    updateMatch(
      match.matchId,
      Object.assign({ oddsAlertedAt: now.toISOString() }, buildDefaultOddsPatch(now), {
        oddsProposalDecision: "DEFAULTED",
        oddsProposalDecidedAt: now.toISOString(),
      }),
      "scheduler",
      "AUTO_DEFAULT_ODDS"
    );
    adminMessage = "⚠️ Còn dưới 24h tới " + sideDisplayName(match, SELECTIONS.HOME) + " vs " + sideDisplayName(match, SELECTIONS.AWAY) + " nhưng bot không lấy được kèo rõ. Bot đã mở pick bằng kèo mặc định: " + sideDisplayName(match, SELECTIONS.HOME) + " chấp " + sideDisplayName(match, SELECTIONS.AWAY) + " 0 Trái. Nếu cần chỉnh, dùng /set_odds " + match.matchId + " <HOME|AWAY> <-0.5>.";
  }
  try {
    openMatch(match.matchId, "scheduler");
  } finally {
    sendToAdmins(adminMessage);
  }
}

function remindMissing(match, reminderMinutes) {
  var field = Number(reminderMinutes) <= 30 ? "reminded30At" : "reminded120At";
  var patch = {};
  patch[field] = new Date().toISOString();
  sendMissingPickReminders(match, reminderMinutes);
  updateMatch(match.matchId, patch, "scheduler", "REMIND_MISSING");
}

function lockMatch(matchId, actor, replyChatId) {
  var match = getMatchById(matchId);
  if (!match) return;
  var now = new Date();
  if (!hasLockedOdds(match)) {
    updateMatch(matchId, buildDefaultOddsPatch(now), actor, "DEFAULT_ODDS");
    match = getMatchById(matchId);
  }
  var defaults = createDefaultPicks(match, getActivePlayers(), getPicks(), now);
  defaults.forEach(function (pick) {
    var player = getPlayerByTelegramId(pick.telegramUserId);
    upsertPick(match, player, pick.selection, false, SOURCE.AUTO_DEFAULT, actor);
  });
  updateMatch(matchId, { status: STATUSES.LOCKED, lockedAt: now.toISOString() }, actor, "LOCK_MATCH");
  sendLockMessage(matchId);
  if (replyChatId) sendTelegramMessage(replyChatId, "Đã khóa trận " + matchId + ".");
}

function sendLockMessage(matchId) {
  return sendRecapToConfiguredChats(buildLockMessageText(matchId));
}

function buildLockMessageText(matchId) {
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
  return [text, formatLockedPickSummary(match, picks)].join("\n\n");
}

function resendLockSummary(matchId, chatId) {
  var match = getMatchById(matchId);
  if (!match) {
    sendTelegramMessage(chatId, "Không tìm thấy trận. Cú pháp: /lock_summary <matchId>");
    return;
  }
  if (!canSendLockSummary(match)) {
    sendTelegramMessage(chatId, "Chỉ gửi lại pick đã chốt khi trận đã LOCKED hoặc SETTLED. Nếu cần khóa ngay, dùng /lock " + matchId + ".");
    return;
  }
  var sentCount = sendLockMessage(matchId);
  if (!sentCount) {
    sendTelegramMessage(chatId, "Chưa gửi được AI pick đã chốt cho " + matchId + " vì chưa cấu hình RECAP_CHAT_ID.");
    return;
  }
  sendTelegramMessage(chatId, "Đã gửi lại AI pick đã chốt cho " + matchId + " vào RECAP_CHAT_ID.");
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

function promptResult(match, replyChatId, actor) {
  var source = actor || "scheduler";
  updateMatch(match.matchId, { adminResultPromptedAt: new Date().toISOString() }, source, "PROMPT_RESULT");
  var text;
  var keyboard;
  if (hasStoredResultProposal(match)) {
    var storedProposal = buildStoredResultProposal(match);
    text = formatAdminResultProposal(match, storedProposal);
    keyboard = buildResultProposalConfirmKeyboard(match.matchId, storedProposal);
    if (replyChatId) sendTelegramMessage(replyChatId, text, keyboard);
    else sendToAdmins(text, keyboard);
    return;
  }
  try {
    var proposal = generateAiResultProposal(match);
    updateMatch(match.matchId, buildResultProposalPatch(proposal), source, "STORE_RESULT_PROPOSAL");
    text = formatAdminResultProposal(match, proposal);
    keyboard = buildResultProposalConfirmKeyboard(match.matchId, proposal);
  } catch (error) {
    console.error(error && error.stack ? error.stack : error);
    text = "🔎 Cần xác nhận tỉ số tính kèo " + sideDisplayName(match, SELECTIONS.HOME) + " vs " + sideDisplayName(match, SELECTIONS.AWAY) + ". Dùng /result " + match.matchId + " <home-away sau 90' + bù giờ, không hiệp phụ/luân lưu> <diễn biến; cách nhau bằng dấu ;> rồi /settle " + match.matchId + ".";
  }
  if (replyChatId) sendTelegramMessage(replyChatId, text, keyboard);
  else sendToAdmins(text, keyboard);
}

function hasStoredResultProposal(match) {
  return Boolean(match && match.resultProposalStatus && String(match.resultProposalDecision || "").toUpperCase() !== "REJECTED");
}

function buildStoredResultProposal(match) {
  return {
    status: match.resultProposalStatus,
    homeScore: match.resultProposalHomeScore,
    awayScore: match.resultProposalAwayScore,
    summary: match.resultProposalSummary,
    sources: String(match.resultProposalSources || "")
      .split(/\n+/)
      .map(function (source) {
        return source.trim();
      })
      .filter(Boolean),
  };
}

function adminAiResult(chatId, actor, args) {
  var matchId = args[0];
  var match = getMatchById(matchId);
  if (!match) {
    sendTelegramMessage(chatId, "Không tìm thấy trận. Cú pháp: /ai_result <matchId>");
    return;
  }
  if (match.status === STATUSES.SETTLED) {
    sendTelegramMessage(chatId, "Trận " + matchId + " đã settle rồi. Nếu cần gửi lại recap, dùng /recap " + matchId + ".");
    return;
  }
  if (match.status !== STATUSES.LOCKED) {
    sendTelegramMessage(chatId, "Chỉ dùng /ai_result khi trận đã LOCKED. Nếu cần khóa trước, dùng /lock " + matchId + ".");
    return;
  }
  promptResult(match, chatId, actor);
}

function adminSetResult(chatId, actor, args) {
  var matchId = args[0];
  var scoreParts = String(args[1] || "").split("-");
  var homeScore = Number(scoreParts[0]);
  var awayScore = Number(scoreParts[1]);
  if (!matchId || scoreParts.length !== 2 || !isFinite(homeScore) || !isFinite(awayScore)) {
    sendTelegramMessage(chatId, "Cú pháp: /result <matchId> <home-away sau 90' + bù giờ, không hiệp phụ/luân lưu> <diễn biến; cách nhau bằng dấu ;>");
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
  sendTelegramMessage(chatId, "Đã ghi tỉ số tính kèo " + matchId + ": " + homeScore + "-" + awayScore + ". Đang settle...");
  settleMatch(matchId, actor, chatId);
}

function settleMatch(matchId, actor, replyChatId) {
  var match = getMatchById(matchId);
  if (!match || match.status === STATUSES.SETTLED) {
    if (replyChatId) sendTelegramMessage(replyChatId, "Không settle được: thiếu trận hoặc trận đã settle.");
    return;
  }
  if (match.finalHomeScore === "" || match.finalAwayScore === "") {
    if (replyChatId) sendTelegramMessage(replyChatId, "Chưa có tỉ số tính kèo.");
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

function adminResetLatestSettle(chatId, actor) {
  var match = getLatestSettledMatch(getMatches());
  if (!match) {
    sendTelegramMessage(chatId, "Không tìm thấy trận đã settle để reset.");
    return;
  }

  var removedRows = removeScoreRowsForMatch(match.matchId, actor);
  updateMatch(match.matchId, buildResetSettlementPatch(), actor, "RESET_LATEST_SETTLE");
  sendTelegramMessage(
    chatId,
    "Đã reset settle trận " + match.matchId + ": xóa " + removedRows + " score rows, đưa trận về LOCKED. Leaderboard đã tính lại từ Scores còn lại."
  );
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

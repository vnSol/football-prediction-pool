var SELECTIONS = Object.freeze({
  HOME: "HOME",
  DRAW: "DRAW",
  AWAY: "AWAY",
});

var STATUSES = Object.freeze({
  SCHEDULED: "SCHEDULED",
  OPEN: "OPEN",
  LOCKED: "LOCKED",
  SETTLED: "SETTLED",
  CANCELLED: "CANCELLED",
});

var ACTIONS = Object.freeze({
  OPEN_PICK: "OPEN_PICK",
  ODDS_ALERT: "ODDS_ALERT",
  REMIND_MISSING: "REMIND_MISSING",
  LOCK_MATCH: "LOCK_MATCH",
  PROMPT_RESULT: "PROMPT_RESULT",
});

var SOURCE = Object.freeze({
  TELEGRAM: "telegram",
  AUTO_DEFAULT: "auto_default",
  ADMIN: "admin",
});

function toDate(value) {
  return value instanceof Date ? value : new Date(value);
}

function toIso(value) {
  return toDate(value).toISOString();
}

function isValidSelection(selection) {
  return selection === SELECTIONS.HOME || selection === SELECTIONS.DRAW || selection === SELECTIONS.AWAY;
}

function sideName(match, side) {
  if (side === SELECTIONS.HOME) return match.homeTeam || "Đội nhà";
  if (side === SELECTIONS.AWAY) return match.awayTeam || "Đội khách";
  return "Hòa";
}

function isKnockout(match) {
  return String(match.stage || "").toUpperCase() !== "GROUP";
}

function hasLockedOdds(match) {
  return isValidSelection(match.favoriteSide) && isFinite(Number(match.handicapGoals));
}

function canChangePick(match, now) {
  if (!match || match.status !== STATUSES.OPEN) return false;
  return toDate(now).getTime() < toDate(match.kickoffUtc).getTime();
}

function shouldAutoOpenAfterOdds(match, now) {
  if (!match || match.status !== STATUSES.SCHEDULED || !hasLockedOdds(match)) return false;
  var minutes = minutesUntil(match, now);
  return minutes > 0 && minutes <= 360;
}

function getHandicapOutcome(match, score) {
  var homeAdjusted = Number(score.homeScore);
  var awayAdjusted = Number(score.awayScore);
  var handicap = Number(match.handicapGoals || 0);
  var handicapSide = match.handicapSide || match.favoriteSide;

  if (handicapSide === SELECTIONS.HOME) homeAdjusted += handicap;
  if (handicapSide === SELECTIONS.AWAY) awayAdjusted += handicap;

  if (Math.abs(homeAdjusted - awayAdjusted) < 0.000001) return SELECTIONS.DRAW;
  return homeAdjusted > awayAdjusted ? SELECTIONS.HOME : SELECTIONS.AWAY;
}

function scorePick(match, pick, score) {
  var outcome = getHandicapOutcome(match, score);
  var correct = pick.selection === outcome;
  var star = Boolean(pick.star) && isKnockout(match);
  var points = correct ? (star ? 2 : 1) : star ? -1 : 0;

  return {
    correct: correct,
    points: points,
    outcome: outcome,
  };
}

function createDefaultPicks(match, players, existingPicks, now) {
  var existing = {};
  existingPicks
    .filter(function (pick) {
      return pick.matchId === match.matchId;
    })
    .forEach(function (pick) {
      existing[String(pick.telegramUserId)] = true;
    });

  return players
    .filter(function (player) {
      return player.active !== false && !existing[String(player.telegramUserId)];
    })
    .map(function (player) {
      return {
        matchId: match.matchId,
        telegramUserId: String(player.telegramUserId),
        selection: match.favoriteSide,
        star: false,
        source: SOURCE.AUTO_DEFAULT,
        createdAt: toIso(now),
        updatedAt: toIso(now),
      };
    });
}

function minutesUntil(match, now) {
  return (toDate(match.kickoffUtc).getTime() - toDate(now).getTime()) / 60000;
}

function hoursUntil(match, now) {
  return minutesUntil(match, now) / 60;
}

function getSchedulerActions(matches, picks, now) {
  var actions = [];

  matches.forEach(function (match) {
    if (match.status === STATUSES.CANCELLED || match.status === STATUSES.SETTLED) return;

    var untilMinutes = minutesUntil(match, now);
    var untilHours = hoursUntil(match, now);

    if (match.status === STATUSES.SCHEDULED && untilHours <= 6 && untilMinutes > 0) {
      actions.push({
        type: hasLockedOdds(match) ? ACTIONS.OPEN_PICK : ACTIONS.ODDS_ALERT,
        matchId: match.matchId,
      });
      return;
    }

    if (match.status === STATUSES.OPEN && untilMinutes <= 0) {
      actions.push({
        type: ACTIONS.LOCK_MATCH,
        matchId: match.matchId,
      });
      return;
    }

    if (match.status === STATUSES.OPEN && untilMinutes <= 30 && untilMinutes > 0 && !match.reminded30At) {
      actions.push({
        type: ACTIONS.REMIND_MISSING,
        matchId: match.matchId,
      });
      return;
    }

    if (
      match.status === STATUSES.LOCKED &&
      untilMinutes <= -120 &&
      !match.adminResultPromptedAt &&
      (match.finalHomeScore === "" || match.finalHomeScore == null || match.finalAwayScore === "" || match.finalAwayScore == null)
    ) {
      actions.push({
        type: ACTIONS.PROMPT_RESULT,
        matchId: match.matchId,
      });
    }
  });

  return actions;
}

function sortLeaderboard(rows) {
  return rows.slice().sort(function (a, b) {
    if (Number(b.points) !== Number(a.points)) return Number(b.points) - Number(a.points);
    return String(a.displayName).localeCompare(String(b.displayName));
  });
}

function formatLeaderboard(rows, limit) {
  var topRows = sortLeaderboard(rows).slice(0, limit || rows.length);
  if (topRows.length === 0) return "🏆 Leaderboard\nChưa có điểm nào.";
  return (
    "🏆 Leaderboard\n" +
    topRows
      .map(function (row, index) {
        return index + 1 + ". " + row.displayName + " - " + Number(row.points) + " điểm";
      })
      .join("\n")
  );
}

function formatCommands(isAdmin) {
  var lines = [
    "📋 Commands khả dụng",
    "",
    "Player:",
    "/commands - Xem danh sách lệnh",
    "/matches - Xem các trận đang mở pick",
    "/mypick - Xem pick của bạn trong 6 giờ tới",
    "/mypick <matchId> - Xem pick của một trận",
    "/leaderboard - Xem bảng xếp hạng",
  ];

  if (isAdmin) {
    lines = lines.concat([
      "",
      "Admin:",
      "/add_player <telegramUserId> <display name> - Thêm người chơi",
      "/set_player_active <telegramUserId> <true|false> - Bật/tắt người chơi",
      "/add_match <matchId> <kickoffUtc> <GROUP|KNOCKOUT> <home team> vs <away team> - Thêm trận",
      "/set_match_time <matchId> <kickoffUtc> - Sửa giờ đá",
      "/set_odds <matchId> <HOME|AWAY> <handicap> - Nhập kèo",
      "/open <matchId> - Mở pick thủ công",
      "/lock <matchId> - Khóa pick thủ công",
      "/result <matchId> <home-away> <diễn biến> - Nhập kết quả",
      "/settle <matchId> - Chốt điểm",
      "/recap <matchId> - Gửi lại recap",
      "/reset_sheet - Reset dữ liệu sheet",
      "/dryrun [baseTimeUtc ISO UTC] - Tạo dữ liệu mô phỏng",
    ]);
  }

  return lines.join("\n");
}

function formatMyUpcomingPicks(input) {
  var now = toDate(input.now || new Date());
  var picksByMatchId = {};
  (input.picks || []).forEach(function (pick) {
    picksByMatchId[String(pick.matchId)] = pick;
  });

  var upcoming = (input.matches || [])
    .filter(function (match) {
      var minutes = minutesUntil(match, now);
      return minutes > 0 && minutes <= 360;
    })
    .sort(function (a, b) {
      return toDate(a.kickoffUtc).getTime() - toDate(b.kickoffUtc).getTime();
    });

  if (upcoming.length === 0) return "Không có trận nào trong 6 giờ tới.";

  return (
    "📌 Pick các trận trong 6 giờ tới\n" +
    upcoming
      .map(function (match) {
        var pick = picksByMatchId[String(match.matchId)];
        return [
          match.matchId + ": " + sideName(match, SELECTIONS.HOME) + " vs " + sideName(match, SELECTIONS.AWAY),
          "Giờ đá: " + formatKickoffTime(match.kickoffUtc),
          "Kèo: " + formatHandicap(match),
          "Pick: " + (pick ? sideName(match, pick.selection) + (parseBoolean(pick.star) ? " ⭐" : "") : "Chưa pick"),
        ].join("\n");
      })
      .join("\n\n")
  );
}

function formatPoints(points) {
  return Number(points) > 0 ? "+" + Number(points) : String(Number(points));
}

function buildLockedBettingFacts(input) {
  var match = input.match;
  var picks = input.picks || [];
  return {
    matchId: match.matchId,
    title: sideName(match, SELECTIONS.HOME) + " vs " + sideName(match, SELECTIONS.AWAY),
    kickoff: formatKickoffTime(match.kickoffUtc),
    handicap: formatHandicap(match),
    totalPicks: picks.length,
    homePicks: picks.filter(function (pick) { return pick.selection === SELECTIONS.HOME; }).length,
    drawPicks: picks.filter(function (pick) { return pick.selection === SELECTIONS.DRAW; }).length,
    awayPicks: picks.filter(function (pick) { return pick.selection === SELECTIONS.AWAY; }).length,
    starPicks: picks.filter(function (pick) { return parseBoolean(pick.star); }).length,
    drawWasOpen: shouldShowDrawOption(match),
  };
}

function buildLockDramaPrompt(input) {
  var facts = input.facts;
  return [
    "Bạn là người dẫn chương trình cho một game dự đoán World Cup nội bộ.",
    "Hãy viết một tin nhắn Telegram bằng tiếng Việt sau khi trận đã khóa pick.",
    "Giọng điệu: ly kì, hồi hộp, vui vẻ, cà khịa thân thiện, không công kích cá nhân.",
    "Chỉ dùng các facts dưới đây, không bịa thêm cầu thủ, bàn thắng hoặc diễn biến trận.",
    "Độ dài: 5-8 dòng, dễ đọc trong Telegram.",
    "",
    "Facts:",
    "- Trận: " + facts.title,
    "- Giờ đá: " + facts.kickoff,
    "- Kèo: " + facts.handicap,
    "- Tổng pick: " + facts.totalPicks,
    "- Pick đội nhà: " + facts.homePicks,
    "- Pick hòa: " + facts.drawPicks + (facts.drawWasOpen ? "" : " (cửa hòa không mở vì kèo không tròn)"),
    "- Pick đội khách: " + facts.awayPicks,
    "- Ngôi sao hi vọng: " + facts.starPicks,
  ].join("\n");
}

function buildAiRecapPrompt(input) {
  var match = input.match;
  var score = input.score;
  var scoreChanges = input.scoreChanges || [];
  var leaderboard = input.leaderboard || [];
  return [
    "Bạn là biên tập viên thể thao cho một game dự đoán World Cup nội bộ.",
    "Hãy đọc tối đa 2 nguồn public về diễn biến trận đấu này bằng web search, rồi viết recap tiếng Việt khi trận vừa kết thúc.",
    "Ưu tiên nguồn chính thống/có uy tín như FIFA, ESPN, BBC, Reuters, AP hoặc trang giải đấu.",
    "Nếu không tìm thấy nguồn đủ rõ, không bịa diễn biến; hãy tóm tắt ngắn dựa trên facts đã cung cấp.",
    "Tập trung vào tóm tắt diễn biến chính và bình luận ngắn gọn, vui vẻ.",
    "Không đề xuất hành động tiếp theo. Không nhắc lại luật chơi. Không giải thích cách tính điểm.",
    "Đúng 3 dòng Telegram, không thêm tiêu đề, không thêm bullet.",
    "Dòng 1: bình luận vui vẻ về trận đấu, có thể nhắc tỉ số hoặc diễn biến chính.",
    "Dòng 2: bình luận vui vẻ về bảng xếp hạng sau trận, dựa trên leaderboard và điểm betting; ví dụ: A vượt qua B trong cuộc đua về vị trí chót bảng, X một mình lạnh lẽo trên đỉnh khi cách nhóm sau N điểm, Y có vẻ đang chấp phần còn lại một đoạn trước khi quyết định tăng tốc.",
    "Dòng 3: dẫn nguồn được dùng để tổng hợp; nếu có nguồn thì chỉ liệt kê URL, nếu không có nguồn thì ghi: Nguồn: chưa có link public đủ rõ.",
    "",
    "Facts đã xác nhận:",
    "- Trận: " + sideName(match, SELECTIONS.HOME) + " vs " + sideName(match, SELECTIONS.AWAY),
    "- Giờ đá: " + formatKickoffTime(match.kickoffUtc),
    "- Tỉ số final: " + sideName(match, SELECTIONS.HOME) + " " + Number(score.homeScore) + "-" + Number(score.awayScore) + " " + sideName(match, SELECTIONS.AWAY),
    "- Kèo: " + formatHandicap(match),
    "",
    "Điểm betting:",
    scoreChanges.length
      ? scoreChanges.map(function (change) {
          return "- " + change.displayName + " " + formatPoints(change.points) + (change.star ? " ⭐" : "");
        }).join("\n")
      : "- Không có thay đổi điểm.",
    "",
    "Leaderboard hiện tại:",
    leaderboard.length
      ? leaderboard.slice(0, 10).map(function (row, index) {
          return index + 1 + ". " + row.displayName + " - " + Number(row.points) + " điểm";
        }).join("\n")
      : "Chưa có điểm nào.",
  ].join("\n");
}

function formatHandicap(match) {
  var handicap = Number(match.handicapGoals || 0);
  var handicapSide = match.handicapSide || match.favoriteSide;
  var givingSide = handicap >= 0 ? handicapSide : oppositeSide(handicapSide);
  var receivingSide = oppositeSide(givingSide);
  return sideName(match, givingSide) + " chấp " + sideName(match, receivingSide) + " " + Math.abs(handicap) + " Trái";
}

function oppositeSide(side) {
  if (side === SELECTIONS.HOME) return SELECTIONS.AWAY;
  if (side === SELECTIONS.AWAY) return SELECTIONS.HOME;
  return SELECTIONS.DRAW;
}

function formatRecap(input) {
  var match = input.match;
  var score = input.score;
  var events = input.events || [];
  var scoreChanges = input.scoreChanges || [];
  var leaderboard = input.leaderboard || [];
  var outcome = input.outcome || getHandicapOutcome(match, score);

  var eventText =
    events.length > 0
      ? events.map(function (event) { return "- " + event; }).join("\n")
      : "- Chưa có diễn biến chi tiết, nhưng bảng điểm thì đã kịp nóng lên.";

  var changeText =
    scoreChanges.length > 0
      ? scoreChanges
          .map(function (change) {
            var starText = change.star ? " ⭐" : "";
            return "- " + change.displayName + " " + formatPoints(change.points) + " điểm" + starText;
          })
          .join("\n")
      : "- Không có thay đổi điểm.";

  return [
    "🎉 Recap trận đấu",
    match.homeTeam + " " + Number(score.homeScore) + "-" + Number(score.awayScore) + " " + match.awayTeam,
    "Kèo: " + formatHandicap(match),
    "Đội thắng kèo: " + sideName(match, outcome),
    "",
    "Diễn biến chính:",
    eventText,
    "",
    "Điểm trận này:",
    changeText,
    "",
    formatLeaderboard(leaderboard, 10),
    "",
    "Bảng điểm đang xáo trộn nhẹ, không khí bắt đầu nóng rồi đấy.",
  ].join("\n");
}

function parseBoolean(value) {
  if (value === true || value === false) return value;
  return String(value || "").toLowerCase() === "true";
}

function parseTelegramCommand(text) {
  var parts = String(text || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0 || parts[0].charAt(0) !== "/") return null;

  return {
    name: parts[0].slice(1).split("@")[0].toLowerCase(),
    args: parts.slice(1),
  };
}

function parseCallbackData(value) {
  var parts = String(value || "").split("|");
  return {
    action: parts[0] || "",
    matchId: parts[1] || "",
    value: parts[2] || "",
  };
}

function buildPickKeyboard(match) {
  var pickRow = [
    { text: sideName(match, SELECTIONS.HOME), callback_data: "pick|" + match.matchId + "|" + SELECTIONS.HOME },
  ];

  if (shouldShowDrawOption(match)) {
    pickRow.push({ text: "Hòa", callback_data: "pick|" + match.matchId + "|" + SELECTIONS.DRAW });
  }

  pickRow.push({ text: sideName(match, SELECTIONS.AWAY), callback_data: "pick|" + match.matchId + "|" + SELECTIONS.AWAY });

  var keyboard = [pickRow];

  if (isKnockout(match)) {
    keyboard.push([{ text: "⭐ Ngôi sao hi vọng", callback_data: "star|" + match.matchId + "|toggle" }]);
  }

  return { inline_keyboard: keyboard };
}

function buildResetSheetKeyboard(sheetNames) {
  return {
    inline_keyboard: sheetNames.map(function (sheetName) {
      return [{ text: sheetName, callback_data: "reset_select|" + sheetName + "|" }];
    }),
  };
}

function buildResetSheetConfirmKeyboard(sheetName) {
  return {
    inline_keyboard: [
      [
        { text: "Confirm reset " + sheetName, callback_data: "reset_confirm|" + sheetName + "|" },
        { text: "Cancel", callback_data: "reset_cancel|" + sheetName + "|" },
      ],
    ],
  };
}

function buildDryRunMatches(baseTimeUtc) {
  return normalizeDryRunMatchesForOrchestration(
    [
      { matchId: "DRY-GROUP-HALF", homeTeam: "Argentina", awayTeam: "Germany" },
      { matchId: "DRY-GROUP-INTEGER", homeTeam: "Brazil", awayTeam: "Japan" },
      { matchId: "DRY-KO-HALF", homeTeam: "France", awayTeam: "Spain" },
      { matchId: "DRY-KO-INTEGER", homeTeam: "Netherlands", awayTeam: "Portugal" },
      { matchId: "DRY-MISSING-ODDS", homeTeam: "England", awayTeam: "USA" },
    ],
    baseTimeUtc
  );
}

function normalizeDryRunMatchesForOrchestration(matches, baseTimeUtc) {
  var base = toDate(baseTimeUtc);
  var cases = [
    ["GROUP", SELECTIONS.HOME, 0.5, 330],
    ["GROUP", SELECTIONS.AWAY, 1, 345],
    ["KNOCKOUT", SELECTIONS.HOME, 0.5, 350],
    ["KNOCKOUT", SELECTIONS.AWAY, 0, 355],
    ["GROUP", "", "", 340],
  ];

  return matches.slice(0, 5).map(function (match, index) {
    var scenario = cases[index] || cases[cases.length - 1];
    var favoriteSide = scenario[1];
    return {
      matchId: String(match.matchId || "DRY-" + (index + 1)),
      homeTeam: String(match.homeTeam || "Home " + (index + 1)),
      awayTeam: String(match.awayTeam || "Away " + (index + 1)),
      kickoffUtc: new Date(base.getTime() + scenario[3] * 60000).toISOString(),
      stage: scenario[0],
      status: STATUSES.SCHEDULED,
      favoriteSide: favoriteSide,
      handicapSide: favoriteSide,
      handicapGoals: scenario[2],
    };
  });
}

function buildDryRunPrompt(baseTimeUtc) {
  return [
    "Create synthetic World Cup prediction-pool test data as JSON only.",
    "Return exactly 5 matches covering: group half handicap, group integer handicap, knockout half handicap, knockout integer/zero handicap, and one missing-odds scheduled match.",
    "Use kickoffUtc values after this UTC base time: " + toDate(baseTimeUtc).toISOString(),
    "Fields per item: matchId, homeTeam, awayTeam, kickoffUtc, stage, status, favoriteSide, handicapSide, handicapGoals.",
    "stage must be GROUP or KNOCKOUT. status must be SCHEDULED. favoriteSide/handicapSide must be HOME or AWAY, except missing-odds match uses empty strings and empty handicapGoals.",
    "Use realistic but clearly synthetic teams. Do not include Markdown.",
  ].join("\n");
}

function shouldShowDrawOption(match) {
  return Number.isInteger(Math.abs(Number(match.handicapGoals || 0)));
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function formatKickoffTime(value) {
  var date = toDate(value);
  var gmt7 = new Date(date.getTime() + 7 * 60 * 60 * 1000);
  return [
    gmt7.getUTCFullYear(),
    "-",
    pad2(gmt7.getUTCMonth() + 1),
    "-",
    pad2(gmt7.getUTCDate()),
    " ",
    pad2(gmt7.getUTCHours()),
    ":",
    pad2(gmt7.getUTCMinutes()),
    " GMT+7",
  ].join("");
}

function formatTimeUntilKickoff(value, now) {
  var remainingMinutes = Math.ceil((toDate(value).getTime() - toDate(now || new Date()).getTime()) / 60000);
  if (remainingMinutes <= 0) return "Đã bắt đầu";
  var hours = Math.floor(remainingMinutes / 60);
  var minutes = remainingMinutes % 60;
  if (hours === 0) return minutes + " phút";
  if (minutes === 0) return hours + " giờ";
  return hours + " giờ " + minutes + " phút";
}

function formatOpenMatchMessage(match, now) {
  return [
    match.matchId + ": " + match.homeTeam + " vs " + match.awayTeam,
    "Kèo: " + formatHandicap(match),
    "Còn lại: " + formatTimeUntilKickoff(match.kickoffUtc, now || new Date()),
  ].join("\n");
}

function getTelegramUpdateDedupeKey(update) {
  if (!update) return "";
  if (update.update_id != null) return "update:" + String(update.update_id);
  if (update.callback_query && update.callback_query.id) return "callback:" + String(update.callback_query.id);
  if (update.message && update.message.chat && update.message.message_id != null) {
    return "message:" + String(update.message.chat.id) + ":" + String(update.message.message_id);
  }
  return "";
}

function normalizeTeamName(value) {
  return String(value || "").replace(/_/g, " ").trim();
}

function parseAddPlayerArgs(args) {
  if (!args || args.length < 2) return null;
  var telegramUserId = String(args[0] || "").trim();
  var displayName = args.slice(1).join(" ").trim();
  if (!telegramUserId || !displayName) return null;
  return {
    telegramUserId: telegramUserId,
    displayName: displayName,
    active: true,
    isAdmin: false,
  };
}

function parseAddMatchArgs(args) {
  if (!args || args.length < 6) return null;
  var matchId = String(args[0] || "").trim();
  var kickoffUtc = String(args[1] || "").trim();
  var stage = String(args[2] || "").trim().toUpperCase();
  var separatorIndex = args
    .map(function (arg) {
      return String(arg).toLowerCase();
    })
    .indexOf("vs");

  if (!matchId || !kickoffUtc || (stage !== "GROUP" && stage !== "KNOCKOUT")) return null;
  if (separatorIndex < 4 || separatorIndex === args.length - 1) return null;
  if (Number.isNaN(toDate(kickoffUtc).getTime())) return null;

  var homeTeam = normalizeTeamName(args.slice(3, separatorIndex).join(" "));
  var awayTeam = normalizeTeamName(args.slice(separatorIndex + 1).join(" "));
  if (!homeTeam || !awayTeam) return null;

  return {
    matchId: matchId,
    kickoffUtc: toDate(kickoffUtc).toISOString(),
    stage: stage,
    homeTeam: homeTeam,
    awayTeam: awayTeam,
    status: STATUSES.SCHEDULED,
  };
}

if (typeof module !== "undefined") {
  module.exports = {
    ACTIONS: ACTIONS,
    SELECTIONS: SELECTIONS,
    SOURCE: SOURCE,
    STATUSES: STATUSES,
    canChangePick: canChangePick,
    buildPickKeyboard: buildPickKeyboard,
    buildAiRecapPrompt: buildAiRecapPrompt,
    buildLockDramaPrompt: buildLockDramaPrompt,
    buildLockedBettingFacts: buildLockedBettingFacts,
    createDefaultPicks: createDefaultPicks,
    buildDryRunMatches: buildDryRunMatches,
    buildDryRunPrompt: buildDryRunPrompt,
    normalizeDryRunMatchesForOrchestration: normalizeDryRunMatchesForOrchestration,
    formatHandicap: formatHandicap,
    formatCommands: formatCommands,
    formatKickoffTime: formatKickoffTime,
    formatLeaderboard: formatLeaderboard,
    formatMyUpcomingPicks: formatMyUpcomingPicks,
    formatOpenMatchMessage: formatOpenMatchMessage,
    formatRecap: formatRecap,
    formatTimeUntilKickoff: formatTimeUntilKickoff,
    getHandicapOutcome: getHandicapOutcome,
    getSchedulerActions: getSchedulerActions,
    getTelegramUpdateDedupeKey: getTelegramUpdateDedupeKey,
    buildResetSheetConfirmKeyboard: buildResetSheetConfirmKeyboard,
    buildResetSheetKeyboard: buildResetSheetKeyboard,
    hasLockedOdds: hasLockedOdds,
    isKnockout: isKnockout,
    isValidSelection: isValidSelection,
    parseAddMatchArgs: parseAddMatchArgs,
    parseAddPlayerArgs: parseAddPlayerArgs,
    parseCallbackData: parseCallbackData,
    parseBoolean: parseBoolean,
    parseTelegramCommand: parseTelegramCommand,
    scorePick: scorePick,
    shouldAutoOpenAfterOdds: shouldAutoOpenAfterOdds,
    shouldShowDrawOption: shouldShowDrawOption,
    sideName: sideName,
    sortLeaderboard: sortLeaderboard,
  };
}

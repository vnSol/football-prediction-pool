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

var TEAM_FLAG_CODES = Object.freeze({
  algeria: "DZ",
  angola: "AO",
  argentina: "AR",
  australia: "AU",
  austria: "AT",
  bahrain: "BH",
  belgium: "BE",
  benin: "BJ",
  bolivia: "BO",
  brazil: "BR",
  "burkina faso": "BF",
  cameroon: "CM",
  canada: "CA",
  "cape verde": "CV",
  chile: "CL",
  china: "CN",
  colombia: "CO",
  "costa rica": "CR",
  "cote d ivoire": "CI",
  croatia: "HR",
  curacao: "CW",
  "czech republic": "CZ",
  czechia: "CZ",
  denmark: "DK",
  "dominican republic": "DO",
  "dr congo": "CD",
  ecuador: "EC",
  egypt: "EG",
  "el salvador": "SV",
  england: "GB-ENG",
  france: "FR",
  gabon: "GA",
  germany: "DE",
  ghana: "GH",
  greece: "GR",
  guatemala: "GT",
  guinea: "GN",
  haiti: "HT",
  honduras: "HN",
  hungary: "HU",
  indonesia: "ID",
  iran: "IR",
  iraq: "IQ",
  italy: "IT",
  "ivory coast": "CI",
  jamaica: "JM",
  japan: "JP",
  jordan: "JO",
  "korea republic": "KR",
  malaysia: "MY",
  mali: "ML",
  mexico: "MX",
  morocco: "MA",
  namibia: "NA",
  netherlands: "NL",
  "new zealand": "NZ",
  nigeria: "NG",
  "north korea": "KP",
  "northern ireland": "GB",
  norway: "NO",
  oman: "OM",
  palestine: "PS",
  panama: "PA",
  paraguay: "PY",
  peru: "PE",
  poland: "PL",
  portugal: "PT",
  qatar: "QA",
  "republic of korea": "KR",
  romania: "RO",
  "saudi arabia": "SA",
  scotland: "GB-SCT",
  senegal: "SN",
  serbia: "RS",
  slovakia: "SK",
  slovenia: "SI",
  "south africa": "ZA",
  "south korea": "KR",
  spain: "ES",
  suriname: "SR",
  sweden: "SE",
  switzerland: "CH",
  syria: "SY",
  thailand: "TH",
  "trinidad and tobago": "TT",
  tunisia: "TN",
  turkey: "TR",
  turkiye: "TR",
  ukraine: "UA",
  "united arab emirates": "AE",
  "united states": "US",
  "united states of america": "US",
  uruguay: "UY",
  us: "US",
  usa: "US",
  uzbekistan: "UZ",
  venezuela: "VE",
  vietnam: "VN",
  wales: "GB-WLS",
  zambia: "ZM",
  zimbabwe: "ZW",
});

function sideName(match, side) {
  if (side === SELECTIONS.HOME) return match.homeTeam || "Đội nhà";
  if (side === SELECTIONS.AWAY) return match.awayTeam || "Đội khách";
  return "Hòa";
}

function normalizeTeamFlagKey(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function subdivisionFlagEmoji(tag) {
  var codePoints = [0x1f3f4];
  String(tag || "").split("").forEach(function (char) {
    codePoints.push(0xe0000 + char.charCodeAt(0));
  });
  codePoints.push(0xe007f);
  return String.fromCodePoint.apply(String, codePoints);
}

function flagEmojiFromCode(code) {
  var normalized = String(code || "").toUpperCase();
  if (normalized === "GB-ENG") return subdivisionFlagEmoji("gbeng");
  if (normalized === "GB-SCT") return subdivisionFlagEmoji("gbsct");
  if (normalized === "GB-WLS") return subdivisionFlagEmoji("gbwls");
  if (!/^[A-Z]{2}$/.test(normalized)) return "";
  return normalized
    .split("")
    .map(function (char) {
      return String.fromCodePoint(0x1f1e6 + char.charCodeAt(0) - 65);
    })
    .join("");
}

function teamFlagEmoji(teamName) {
  return flagEmojiFromCode(TEAM_FLAG_CODES[normalizeTeamFlagKey(teamName)]);
}

function teamDisplayName(teamName) {
  var name = String(teamName || "").trim();
  var flag = teamFlagEmoji(name);
  return flag ? flag + " " + name : name;
}

function sideDisplayName(match, side) {
  if (side === SELECTIONS.DRAW) return "Hòa";
  return teamDisplayName(sideName(match, side));
}

function isKnockout(match) {
  return String(match.stage || "").toUpperCase() !== "GROUP";
}

function hasLockedOdds(match) {
  return (
    match &&
    isValidSelection(match.favoriteSide) &&
    match.handicapGoals !== "" &&
    match.handicapGoals != null &&
    isFinite(Number(match.handicapGoals))
  );
}

function buildDefaultOddsPatch(now) {
  return {
    favoriteSide: SELECTIONS.HOME,
    handicapSide: SELECTIONS.HOME,
    handicapGoals: 0,
    oddsLockedAt: toIso(now || new Date()),
  };
}

function buildDryRunMatchRefreshPatch(match) {
  return {
    homeTeam: match.homeTeam,
    awayTeam: match.awayTeam,
    kickoffUtc: match.kickoffUtc,
    stage: match.stage,
    status: match.status,
    favoriteSide: match.favoriteSide,
    handicapSide: match.handicapSide,
    handicapGoals: match.handicapGoals,
    oddsLockedAt: "",
    oddsAlertedAt: "",
    oddsProposalFavoriteSide: "",
    oddsProposalHandicapGoals: "",
    oddsProposalSummary: "",
    oddsProposalSources: "",
    oddsProposalAt: "",
    oddsProposalDecision: "",
    oddsProposalDecidedAt: "",
    openedAt: "",
    reminded30At: "",
    lockedAt: "",
    adminResultPromptedAt: "",
    resultProposalStatus: "",
    resultProposalHomeScore: "",
    resultProposalAwayScore: "",
    resultProposalSummary: "",
    resultProposalSources: "",
    resultProposalAt: "",
    resultProposalDecision: "",
    resultProposalDecidedAt: "",
    finalHomeScore: "",
    finalAwayScore: "",
    finalSummary: "",
    handicapOutcome: "",
    settledAt: "",
  };
}

function getDefaultPickSelection(match) {
  return isValidSelection(match && match.favoriteSide) ? match.favoriteSide : SELECTIONS.HOME;
}

function canSetOdds(match, now) {
  if (!match) return false;
  if (match.status !== STATUSES.SCHEDULED && match.status !== STATUSES.OPEN) return false;
  return toDate(match.kickoffUtc).getTime() > toDate(now || new Date()).getTime();
}

function oddsValuesChanged(match, favoriteSide, handicapGoals) {
  var nextSide = String(favoriteSide || "").toUpperCase();
  var currentHandicapSide = String(match.handicapSide || match.favoriteSide || "").toUpperCase();
  return (
    String(match.favoriteSide || "").toUpperCase() !== nextSide ||
    currentHandicapSide !== nextSide ||
    Number(match.handicapGoals) !== Number(handicapGoals)
  );
}

function shouldNotifyOddsUpdate(match, favoriteSide, handicapGoals) {
  return Boolean(match && match.status === STATUSES.OPEN && (!hasLockedOdds(match) || oddsValuesChanged(match, favoriteSide, handicapGoals)));
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
        selection: getDefaultPickSelection(match),
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
      if (!hasLockedOdds(match)) {
        if (!match.oddsAlertedAt) {
          actions.push({
            type: ACTIONS.ODDS_ALERT,
            matchId: match.matchId,
          });
        }
        return;
      }
      actions.push({
        type: ACTIONS.OPEN_PICK,
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
    "/join - Tham gia pool và tự kích hoạt tài khoản",
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
      "/dryrun_finish - Mô phỏng T+120 và gửi đề xuất kết quả để admin confirm",
    ]);
  }

  return lines.join("\n");
}

function formatTelegramDisplayName(user) {
  var firstName = String((user && user.first_name) || "").trim();
  var lastName = String((user && user.last_name) || "").trim();
  var fullName = [firstName, lastName].filter(Boolean).join(" ").trim();
  if (fullName) return fullName;
  var username = String((user && user.username) || "").trim();
  if (username) return "@" + username;
  return String((user && user.id) || "").trim();
}

function formatJoinMessage(player, created) {
  var name = (player && player.displayName) || "Bạn";
  return created
    ? "✅ Đã tham gia pool: " + name + ". Dùng /matches để xem các trận đang mở pick."
    : "✅ " + name + " đã active lại. Dùng /matches để xem các trận đang mở pick.";
}

function formatJoinAdminMessage(player, created) {
  var name = (player && player.displayName) || "Unknown";
  var telegramUserId = (player && player.telegramUserId) || "";
  return created
    ? "👤 Có người chơi mới /join: " + name + " (" + telegramUserId + "), active=true."
    : "👤 Người chơi /join đã được bật lại active=true: " + name + " (" + telegramUserId + ").";
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
          match.matchId + ": " + sideDisplayName(match, SELECTIONS.HOME) + " vs " + sideDisplayName(match, SELECTIONS.AWAY),
          "Giờ đá: " + formatKickoffTime(match.kickoffUtc),
          "Kèo: " + formatHandicap(match),
          "Pick: " + (pick ? sideDisplayName(match, pick.selection) + (parseBoolean(pick.star) ? " ⭐" : "") : "Chưa pick"),
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
    title: sideDisplayName(match, SELECTIONS.HOME) + " vs " + sideDisplayName(match, SELECTIONS.AWAY),
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
    "Dòng 1: bình luận vui vẻ về trận đấu, có thể nhắc tỉ số và diễn biến chính.",
    "Dòng 2: bình luận vui vẻ về bảng xếp hạng sau trận, dựa trên leaderboard và điểm betting; ví dụ: A vượt qua B trong cuộc đua về vị trí chót bảng, X một mình lạnh lẽo trên đỉnh khi cách nhóm sau N điểm, Y có vẻ đang chấp phần còn lại một đoạn trước khi quyết định tăng tốc.",
    "Dòng 3: dẫn nguồn được dùng để tổng hợp; nếu có nguồn thì chỉ liệt kê URL, nếu không có nguồn thì ghi: Nguồn: chưa có link public đủ rõ.",
    "",
    "Facts đã xác nhận:",
    "- Trận: " + sideDisplayName(match, SELECTIONS.HOME) + " vs " + sideDisplayName(match, SELECTIONS.AWAY),
    "- Giờ đá: " + formatKickoffTime(match.kickoffUtc),
    "- Tỉ số final: " + sideDisplayName(match, SELECTIONS.HOME) + " " + Number(score.homeScore) + "-" + Number(score.awayScore) + " " + sideDisplayName(match, SELECTIONS.AWAY),
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

function buildAiResultProposalPrompt(match) {
  return [
    "Bạn là trợ lý vận hành cho game dự đoán World Cup nội bộ.",
    "Sau T+120 phút, hãy dùng web search như Google để đọc 1-2 nguồn public và đề xuất kết quả cho admin confirm.",
    "Ưu tiên nguồn chính thống/có uy tín như FIFA, trang giải đấu, ESPN, BBC, Reuters hoặc AP.",
    "Chỉ đề xuất khi nguồn public đủ rõ; nếu chưa rõ thì status UNKNOWN và homeScore/awayScore là null.",
    "Không bịa tỉ số, trạng thái, diễn biến hoặc nguồn.",
    "Trả về JSON duy nhất, không markdown, không giải thích thêm.",
    "",
    "Schema:",
    '{ "status": "FINISHED|LIVE|NOT_STARTED|POSTPONED|CANCELLED|UNKNOWN", "homeScore": number|null, "awayScore": number|null, "summary": "ngắn gọn", "sources": ["https://...", "https://..."] }',
    "",
    "Match facts:",
    "- matchId: " + match.matchId,
    "- homeTeam: " + sideName(match, SELECTIONS.HOME),
    "- awayTeam: " + sideName(match, SELECTIONS.AWAY),
    "- kickoff: " + formatKickoffTime(match.kickoffUtc),
  ].join("\n");
}

function normalizeAiResultProposal(result) {
  var rawStatus = String(result && result.status ? result.status : "UNKNOWN").toUpperCase().replace(/[\s-]+/g, "_");
  var statusMap = {
    FT: "FINISHED",
    FINAL: "FINISHED",
    FULL_TIME: "FINISHED",
    FULLTIME: "FINISHED",
    FINISHED: "FINISHED",
    LIVE: "LIVE",
    IN_PROGRESS: "LIVE",
    ONGOING: "LIVE",
    NOT_STARTED: "NOT_STARTED",
    SCHEDULED: "NOT_STARTED",
    POSTPONED: "POSTPONED",
    CANCELLED: "CANCELLED",
    CANCELED: "CANCELLED",
    UNKNOWN: "UNKNOWN",
  };
  var status = statusMap[rawStatus] || "UNKNOWN";
  var homeScore = normalizeProposalScore(result && result.homeScore);
  var awayScore = normalizeProposalScore(result && result.awayScore);

  if ((homeScore == null) !== (awayScore == null)) throw new Error("AI result proposal has partial score");
  if (status === "FINISHED" && (homeScore == null || awayScore == null)) throw new Error("AI result proposal missing final score");

  return {
    status: status,
    homeScore: homeScore,
    awayScore: awayScore,
    summary: sanitizeProposalText(result && result.summary) || "Chưa có diễn biến đủ rõ từ nguồn public.",
    sources: normalizeProposalSources(result && (result.sources || result.sourceUrls || result.links)),
  };
}

function normalizeProposalScore(value) {
  if (value === "" || value == null) return null;
  var score = Number(value);
  if (!isFinite(score) || score < 0 || Math.floor(score) !== score) throw new Error("AI result proposal invalid score");
  return score;
}

function normalizeProposalSources(sources) {
  if (!Array.isArray(sources)) return [];
  var urls = [];
  sources.forEach(function (source) {
    var url = typeof source === "string" ? source : source && source.url;
    url = String(url || "").trim();
    if (/^https?:\/\/\S+$/i.test(url) && urls.indexOf(url) === -1) urls.push(url);
  });
  return urls.slice(0, 2);
}

function sanitizeProposalText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function hasProposalScore(proposal) {
  return proposal && proposal.homeScore != null && proposal.awayScore != null;
}

function formatResultProposalStatus(status) {
  var labels = {
    FINISHED: "đã kết thúc",
    LIVE: "đang diễn ra",
    NOT_STARTED: "chưa bắt đầu",
    POSTPONED: "bị hoãn",
    CANCELLED: "bị hủy",
    UNKNOWN: "chưa rõ",
  };
  return labels[status] || "chưa rõ";
}

function formatAdminResultProposal(match, proposal) {
  var normalized = normalizeAiResultProposal(proposal || {});
  var scoreText = hasProposalScore(normalized)
    ? sideName(match, SELECTIONS.HOME) + " " + normalized.homeScore + "-" + normalized.awayScore + " " + sideName(match, SELECTIONS.AWAY)
    : "chưa có tỉ số final đủ rõ";
  var sourceLines = normalized.sources.length
    ? normalized.sources.map(function (source) { return "- " + source; })
    : ["- Chưa có link public đủ rõ."];
  var actionLine = hasProposalScore(normalized)
    ? "Bấm Y để ghi kết quả này và settle tự động."
    : "Không có tỉ số đủ rõ để confirm; bấm N rồi nhập tay bằng /result " + match.matchId + " <home-away> <diễn biến; cách nhau bằng dấu ;>";
  var instructionLine = hasProposalScore(normalized)
    ? "Admin verify link nguồn rồi bấm Y để confirm và tự settle, hoặc N để bỏ qua."
    : "Admin verify link nguồn; đề xuất chưa có tỉ số đủ rõ nên bấm N rồi nhập tay nếu cần.";

  return [
    "🔎 Đề xuất AI/search cho " + sideDisplayName(match, SELECTIONS.HOME) + " vs " + sideDisplayName(match, SELECTIONS.AWAY),
    "Trạng thái: " + formatResultProposalStatus(normalized.status),
    "Tỉ số: " + scoreText,
    "Tóm tắt: " + normalized.summary,
    "Nguồn để verify:",
    sourceLines.join("\n"),
    "",
    instructionLine,
    actionLine,
  ].join("\n");
}

function buildResultProposalPatch(proposal, now) {
  var normalized = normalizeAiResultProposal(proposal || {});
  return {
    resultProposalStatus: normalized.status,
    resultProposalHomeScore: normalized.homeScore == null ? "" : normalized.homeScore,
    resultProposalAwayScore: normalized.awayScore == null ? "" : normalized.awayScore,
    resultProposalSummary: normalized.summary,
    resultProposalSources: normalized.sources.join("\n"),
    resultProposalAt: toIso(now || new Date()),
    resultProposalDecision: "",
    resultProposalDecidedAt: "",
  };
}

function buildResultProposalConfirmKeyboard(matchId, proposal) {
  var normalized = normalizeAiResultProposal(proposal || {});
  if (!hasProposalScore(normalized)) {
    return {
      inline_keyboard: [[{ text: "N - Reject", callback_data: "result_reject|" + matchId + "|" }]],
    };
  }
  return {
    inline_keyboard: [
      [
        { text: "Y - Confirm & settle", callback_data: "result_confirm|" + matchId + "|" },
        { text: "N - Reject", callback_data: "result_reject|" + matchId + "|" },
      ],
    ],
  };
}

function buildConfirmResultProposalPatch(match, now) {
  var homeScore = normalizeProposalScore(match && match.resultProposalHomeScore);
  var awayScore = normalizeProposalScore(match && match.resultProposalAwayScore);
  if (homeScore == null || awayScore == null) throw new Error("Result proposal missing score");
  return {
    finalHomeScore: homeScore,
    finalAwayScore: awayScore,
    finalSummary: sanitizeProposalText(match && match.resultProposalSummary),
    resultProposalDecision: "CONFIRMED",
    resultProposalDecidedAt: toIso(now || new Date()),
  };
}

function buildAiOddsProposalPrompt(match) {
  return [
    "Bạn là trợ lý vận hành cho game dự đoán bóng đá nội bộ.",
    "Trước T-6h, hãy dùng web search để đọc 1-2 nguồn public về Asian handicap/handicap line cho trận này và đề xuất kèo để admin confirm.",
    "Ưu tiên nguồn odds/handicap public có ghi rõ line chấp, ví dụ odds aggregator, bookmaker page public, preview có kèo châu Á, hoặc trang thống kê odds.",
    "Chỉ đề xuất khi nguồn public đủ rõ; nếu chưa rõ thì favoriteSide và handicapGoals là null.",
    "Không bịa kèo, nguồn hoặc diễn giải. Nếu nhiều nguồn lệch nhau, chọn line phổ biến nhất và ghi rõ trong summary.",
    "Trả về JSON duy nhất, không markdown, không giải thích thêm.",
    "",
    "Schema:",
    '{ "favoriteSide": "HOME|AWAY|null", "handicapGoals": number|null, "summary": "ngắn gọn", "sources": ["https://...", "https://..."] }',
    "",
    "Quy ước:",
    "- favoriteSide là đội chấp theo line đề xuất.",
    "- handicapGoals là số trái chấp không âm, ví dụ 0, 0.25, 0.5, 0.75, 1.",
    "",
    "Match facts:",
    "- matchId: " + match.matchId,
    "- homeTeam: " + sideName(match, SELECTIONS.HOME),
    "- awayTeam: " + sideName(match, SELECTIONS.AWAY),
    "- kickoff: " + formatKickoffTime(match.kickoffUtc),
  ].join("\n");
}

function normalizeAiOddsProposal(result) {
  var favoriteSide = normalizeProposalSelection(result && result.favoriteSide);
  var handicapGoals = normalizeProposalHandicap(result && result.handicapGoals);
  if ((favoriteSide == null) !== (handicapGoals == null)) throw new Error("AI odds proposal has partial handicap");
  return {
    favoriteSide: favoriteSide,
    handicapGoals: handicapGoals,
    summary: sanitizeProposalText(result && result.summary) || "Chưa có kèo public đủ rõ.",
    sources: normalizeProposalSources(result && (result.sources || result.sourceUrls || result.links)),
  };
}

function normalizeProposalSelection(value) {
  if (value === "" || value == null || String(value).toLowerCase() === "null") return null;
  var side = String(value).toUpperCase();
  if (side === "HOME" || side === "H") return SELECTIONS.HOME;
  if (side === "AWAY" || side === "A") return SELECTIONS.AWAY;
  throw new Error("AI odds proposal invalid favoriteSide");
}

function normalizeProposalHandicap(value) {
  if (value === "" || value == null || String(value).toLowerCase() === "null") return null;
  var handicap = Number(value);
  if (!isFinite(handicap) || handicap < 0 || handicap > 6) throw new Error("AI odds proposal invalid handicap");
  return handicap;
}

function hasProposalOdds(proposal) {
  return proposal && proposal.favoriteSide && proposal.handicapGoals != null;
}

function formatAdminOddsProposal(match, proposal) {
  var normalized = normalizeAiOddsProposal(proposal || {});
  var oddsText = hasProposalOdds(normalized)
    ? formatHandicap({
        homeTeam: match.homeTeam,
        awayTeam: match.awayTeam,
        favoriteSide: normalized.favoriteSide,
        handicapSide: normalized.favoriteSide,
        handicapGoals: normalized.handicapGoals,
      })
    : "chưa có kèo đủ rõ";
  var sourceLines = normalized.sources.length
    ? normalized.sources.map(function (source) { return "- " + source; })
    : ["- Chưa có link public đủ rõ."];
  var instructionLine = hasProposalOdds(normalized)
    ? "Admin verify link nguồn rồi bấm Y để ghi kèo và mở pick, hoặc N để reject."
    : "Admin verify link nguồn; đề xuất chưa có kèo đủ rõ nên bấm N rồi nhập tay nếu cần.";
  var actionLine = hasProposalOdds(normalized)
    ? "Bấm Y để ghi kèo và mở pick tự động."
    : "Không có kèo đủ rõ để confirm; bấm N rồi nhập tay bằng /set_odds " + match.matchId + " <HOME|AWAY> <handicap>.";

  return [
    "⚖️ Đề xuất kèo AI/search cho " + sideDisplayName(match, SELECTIONS.HOME) + " vs " + sideDisplayName(match, SELECTIONS.AWAY),
    "Kèo đề xuất: " + oddsText,
    "Tóm tắt: " + normalized.summary,
    "Nguồn để verify:",
    sourceLines.join("\n"),
    "",
    instructionLine,
    actionLine,
  ].join("\n");
}

function buildOddsProposalPatch(proposal, now) {
  var normalized = normalizeAiOddsProposal(proposal || {});
  return {
    oddsProposalFavoriteSide: normalized.favoriteSide || "",
    oddsProposalHandicapGoals: normalized.handicapGoals == null ? "" : normalized.handicapGoals,
    oddsProposalSummary: normalized.summary,
    oddsProposalSources: normalized.sources.join("\n"),
    oddsProposalAt: toIso(now || new Date()),
    oddsProposalDecision: "",
    oddsProposalDecidedAt: "",
  };
}

function buildOddsProposalConfirmKeyboard(matchId, proposal) {
  var normalized = normalizeAiOddsProposal(proposal || {});
  if (!hasProposalOdds(normalized)) {
    return {
      inline_keyboard: [[{ text: "N - Reject", callback_data: "odds_reject|" + matchId + "|" }]],
    };
  }
  return {
    inline_keyboard: [
      [
        { text: "Y - Confirm & open", callback_data: "odds_confirm|" + matchId + "|" },
        { text: "N - Reject", callback_data: "odds_reject|" + matchId + "|" },
      ],
    ],
  };
}

function buildConfirmOddsProposalPatch(match, now) {
  var favoriteSide = normalizeProposalSelection(match && match.oddsProposalFavoriteSide);
  var handicapGoals = normalizeProposalHandicap(match && match.oddsProposalHandicapGoals);
  if (!favoriteSide || handicapGoals == null) throw new Error("Odds proposal missing handicap");
  var iso = toIso(now || new Date());
  return {
    favoriteSide: favoriteSide,
    handicapSide: favoriteSide,
    handicapGoals: handicapGoals,
    oddsLockedAt: iso,
    oddsProposalDecision: "CONFIRMED",
    oddsProposalDecidedAt: iso,
  };
}

function formatHandicap(match) {
  var handicap = Number(match.handicapGoals || 0);
  var handicapSide = match.handicapSide || match.favoriteSide;
  var givingSide = handicap >= 0 ? handicapSide : oppositeSide(handicapSide);
  var receivingSide = oppositeSide(givingSide);
  return sideDisplayName(match, givingSide) + " chấp " + sideDisplayName(match, receivingSide) + " " + Math.abs(handicap) + " Trái";
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
    sideDisplayName(match, SELECTIONS.HOME) + " " + Number(score.homeScore) + "-" + Number(score.awayScore) + " " + sideDisplayName(match, SELECTIONS.AWAY),
    "Kèo: " + formatHandicap(match),
    "Đội thắng kèo: " + sideDisplayName(match, outcome),
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
    { text: sideDisplayName(match, SELECTIONS.HOME), callback_data: "pick|" + match.matchId + "|" + SELECTIONS.HOME },
  ];

  if (shouldShowDrawOption(match)) {
    pickRow.push({ text: "Hòa", callback_data: "pick|" + match.matchId + "|" + SELECTIONS.DRAW });
  }

  pickRow.push({ text: sideDisplayName(match, SELECTIONS.AWAY), callback_data: "pick|" + match.matchId + "|" + SELECTIONS.AWAY });

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
      matchId: normalizeDryRunMatchId(match.matchId, index),
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

function normalizeDryRunMatchId(matchId, index) {
  var raw = String(matchId || index + 1)
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!raw) raw = String(index + 1);
  return raw.indexOf("DRY-") === 0 ? raw : "DRY-" + raw;
}

function buildDryRunPrompt(baseTimeUtc) {
  return [
    "Create World Cup prediction-pool dry-run test data as JSON only.",
    "Return exactly 5 matches covering: group half handicap, group integer handicap, knockout half handicap, knockout integer/zero handicap, and one missing-odds scheduled match.",
    "Use kickoffUtc values after this UTC base time: " + toDate(baseTimeUtc).toISOString(),
    "Fields per item: matchId, homeTeam, awayTeam, kickoffUtc, stage, status, favoriteSide, handicapSide, handicapGoals.",
    "Every matchId must start with DRY-.",
    "stage must be GROUP or KNOCKOUT. status must be SCHEDULED. favoriteSide/handicapSide must be HOME or AWAY, except missing-odds match uses empty strings and empty handicapGoals.",
    "Use only real national teams so Telegram flag display can be tested; good examples: Argentina, Germany, Brazil, Japan, France, Spain, Netherlands, Portugal, England, USA.",
    "The schedule, odds, and matchups may be invented for dry-run coverage. Do not include Markdown.",
  ].join("\n");
}

function isDryRunMatch(match) {
  return String((match && match.matchId) || "").toUpperCase().indexOf("DRY-") === 0;
}

function getDryRunMatchesToFinish(matches) {
  return (matches || []).filter(function (match) {
    return isDryRunMatch(match) && match.status !== STATUSES.SETTLED && match.status !== STATUSES.CANCELLED;
  });
}

function getDryRunFinishTime(matches) {
  var latestKickoff = getDryRunMatchesToFinish(matches).reduce(function (latest, match) {
    var time = toDate(match.kickoffUtc).getTime();
    return Number.isNaN(time) ? latest : Math.max(latest, time);
  }, 0);
  return new Date(latestKickoff + 120 * 60000);
}

function buildDryRunResultPrompt(match) {
  return [
    "Create a synthetic final result for this dry-run World Cup prediction-pool match as JSON only.",
    "JSON only. No Markdown.",
    "Fields: homeScore, awayScore, events.",
    "homeScore and awayScore must be integers from 0 to 6.",
    "events must be an array of 3-5 short Vietnamese match events.",
    "Match ID: " + match.matchId,
    "Home: " + sideDisplayName(match, SELECTIONS.HOME),
    "Away: " + sideDisplayName(match, SELECTIONS.AWAY),
    "Stage: " + match.stage,
    "Handicap: " + formatHandicap(match),
  ].join("\n");
}

function normalizeDryRunResult(result) {
  var homeScore = Number(result && result.homeScore);
  var awayScore = Number(result && result.awayScore);
  if (!Number.isInteger(homeScore) || !Number.isInteger(awayScore) || homeScore < 0 || awayScore < 0 || homeScore > 6 || awayScore > 6) {
    throw new Error("AI dry-run result invalid score");
  }

  var events = Array.isArray(result.events)
    ? result.events
    : String((result && (result.summary || result.events)) || "").split(";");
  var summary = events
    .map(function (event) {
      return String(event || "").trim();
    })
    .filter(Boolean)
    .join("; ");
  if (!summary) throw new Error("AI dry-run result missing events");

  return {
    homeScore: homeScore,
    awayScore: awayScore,
    summary: summary,
  };
}

function buildFallbackDryRunResult(match) {
  var homeScore = match.favoriteSide === SELECTIONS.AWAY ? 1 : 2;
  var awayScore = match.favoriteSide === SELECTIONS.AWAY ? 2 : 1;
  if (!match.favoriteSide) {
    homeScore = 1;
    awayScore = 1;
  }
  return {
    homeScore: homeScore,
    awayScore: awayScore,
    summary: [
      sideDisplayName(match, SELECTIONS.HOME) + " nhập cuộc chủ động",
      sideDisplayName(match, SELECTIONS.AWAY) + " đáp trả bằng vài pha phản công",
      "Trận đấu mô phỏng khép lại với tỉ số " + homeScore + "-" + awayScore,
    ].join("; "),
  };
}

function buildDryRunResultProposal(match) {
  var result = buildFallbackDryRunResult(match);
  return {
    status: "FINISHED",
    homeScore: result.homeScore,
    awayScore: result.awayScore,
    summary: result.summary,
    sources: [],
  };
}

function buildDryRunOddsProposal(match) {
  return {
    favoriteSide: isValidSelection(match.favoriteSide) ? match.favoriteSide : SELECTIONS.HOME,
    handicapGoals: 0.5,
    summary: "Kèo mô phỏng để test luồng AI/search đề xuất handicap và admin confirm.",
    sources: [],
  };
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
    match.matchId + ": " + sideDisplayName(match, SELECTIONS.HOME) + " vs " + sideDisplayName(match, SELECTIONS.AWAY),
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
    buildDefaultOddsPatch: buildDefaultOddsPatch,
    canChangePick: canChangePick,
    canSetOdds: canSetOdds,
    buildPickKeyboard: buildPickKeyboard,
    buildAiOddsProposalPrompt: buildAiOddsProposalPrompt,
    buildAiRecapPrompt: buildAiRecapPrompt,
    buildAiResultProposalPrompt: buildAiResultProposalPrompt,
    buildLockDramaPrompt: buildLockDramaPrompt,
    buildLockedBettingFacts: buildLockedBettingFacts,
    createDefaultPicks: createDefaultPicks,
    buildDryRunMatches: buildDryRunMatches,
    buildDryRunMatchRefreshPatch: buildDryRunMatchRefreshPatch,
    buildDryRunPrompt: buildDryRunPrompt,
    buildDryRunResultPrompt: buildDryRunResultPrompt,
    buildDryRunResultProposal: buildDryRunResultProposal,
    buildDryRunOddsProposal: buildDryRunOddsProposal,
    buildOddsProposalConfirmKeyboard: buildOddsProposalConfirmKeyboard,
    buildOddsProposalPatch: buildOddsProposalPatch,
    buildResultProposalConfirmKeyboard: buildResultProposalConfirmKeyboard,
    buildResultProposalPatch: buildResultProposalPatch,
    buildConfirmOddsProposalPatch: buildConfirmOddsProposalPatch,
    buildConfirmResultProposalPatch: buildConfirmResultProposalPatch,
    buildFallbackDryRunResult: buildFallbackDryRunResult,
    normalizeDryRunMatchesForOrchestration: normalizeDryRunMatchesForOrchestration,
    normalizeDryRunResult: normalizeDryRunResult,
    normalizeAiOddsProposal: normalizeAiOddsProposal,
    normalizeAiResultProposal: normalizeAiResultProposal,
    formatHandicap: formatHandicap,
    formatCommands: formatCommands,
    formatAdminOddsProposal: formatAdminOddsProposal,
    formatAdminResultProposal: formatAdminResultProposal,
    formatKickoffTime: formatKickoffTime,
    formatLeaderboard: formatLeaderboard,
    formatMyUpcomingPicks: formatMyUpcomingPicks,
    formatJoinAdminMessage: formatJoinAdminMessage,
    formatJoinMessage: formatJoinMessage,
    formatTelegramDisplayName: formatTelegramDisplayName,
    formatOpenMatchMessage: formatOpenMatchMessage,
    formatRecap: formatRecap,
    formatTimeUntilKickoff: formatTimeUntilKickoff,
    getDryRunFinishTime: getDryRunFinishTime,
    getDryRunMatchesToFinish: getDryRunMatchesToFinish,
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
    shouldNotifyOddsUpdate: shouldNotifyOddsUpdate,
    shouldShowDrawOption: shouldShowDrawOption,
    sideDisplayName: sideDisplayName,
    sideName: sideName,
    sortLeaderboard: sortLeaderboard,
    teamDisplayName: teamDisplayName,
    teamFlagEmoji: teamFlagEmoji,
  };
}

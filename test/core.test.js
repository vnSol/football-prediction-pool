const test = require("node:test");
const assert = require("node:assert/strict");

const {
  ACTIONS,
  SELECTIONS,
  STATUSES,
  canChangePick,
  createDefaultPicks,
  buildPickKeyboard,
  formatKickoffTime,
  formatLeaderboard,
  formatHandicap,
  formatCommands,
  formatOpenMatchMessage,
  formatRecap,
  formatMyUpcomingPicks,
  getSchedulerActions,
  getTelegramUpdateDedupeKey,
  parseAddMatchArgs,
  parseAddPlayerArgs,
  buildAiRecapPrompt,
  buildLockDramaPrompt,
  buildLockedBettingFacts,
  buildResetSheetKeyboard,
  buildResetSheetConfirmKeyboard,
  buildDryRunMatches,
  normalizeDryRunMatchesForOrchestration,
  parseCallbackData,
  parseTelegramCommand,
  scorePick,
  shouldAutoOpenAfterOdds,
} = require("../src/core");

function date(value) {
  return new Date(value);
}

const players = [
  { telegramUserId: "101", displayName: "An", active: true },
  { telegramUserId: "102", displayName: "Binh", active: true },
  { telegramUserId: "103", displayName: "Chi", active: false },
];

test("allows pick changes before kickoff and rejects them at kickoff", () => {
  const match = {
    matchId: "M001",
    status: STATUSES.OPEN,
    kickoffUtc: "2026-06-12T19:00:00.000Z",
  };

  assert.equal(canChangePick(match, date("2026-06-12T18:59:59.000Z")), true);
  assert.equal(canChangePick(match, date("2026-06-12T19:00:00.000Z")), false);
  assert.equal(
    canChangePick({ ...match, status: STATUSES.LOCKED }, date("2026-06-12T18:00:00.000Z")),
    false
  );
});

test("scores group-stage picks after applying handicap", () => {
  const match = {
    matchId: "M001",
    stage: "GROUP",
    homeTeam: "Brazil",
    awayTeam: "Japan",
    handicapSide: SELECTIONS.HOME,
    handicapGoals: -0.5,
  };
  const score = { homeScore: 1, awayScore: 1 };

  assert.deepEqual(scorePick(match, { selection: SELECTIONS.AWAY, star: false }, score), {
    correct: true,
    points: 1,
    outcome: SELECTIONS.AWAY,
  });
  assert.deepEqual(scorePick(match, { selection: SELECTIONS.HOME, star: false }, score), {
    correct: false,
    points: 0,
    outcome: SELECTIONS.AWAY,
  });
});

test("scores knockout star picks with bonus and penalty", () => {
  const match = {
    matchId: "R16-01",
    stage: "KNOCKOUT",
    homeTeam: "France",
    awayTeam: "Spain",
    handicapSide: SELECTIONS.AWAY,
    handicapGoals: -0.25,
  };
  const score = { homeScore: 2, awayScore: 1 };

  assert.deepEqual(scorePick(match, { selection: SELECTIONS.HOME, star: true }, score), {
    correct: true,
    points: 2,
    outcome: SELECTIONS.HOME,
  });
  assert.deepEqual(scorePick(match, { selection: SELECTIONS.AWAY, star: true }, score), {
    correct: false,
    points: -1,
    outcome: SELECTIONS.HOME,
  });
  assert.deepEqual(scorePick(match, { selection: SELECTIONS.AWAY, star: false }, score), {
    correct: false,
    points: 0,
    outcome: SELECTIONS.HOME,
  });
});

test("creates default picks for active players who missed kickoff", () => {
  const match = {
    matchId: "M002",
    favoriteSide: SELECTIONS.AWAY,
  };
  const existingPicks = [
    { matchId: "M002", telegramUserId: "101", selection: SELECTIONS.DRAW },
  ];

  assert.deepEqual(createDefaultPicks(match, players, existingPicks, date("2026-06-12T19:00:00.000Z")), [
    {
      matchId: "M002",
      telegramUserId: "102",
      selection: SELECTIONS.AWAY,
      star: false,
      source: "auto_default",
      createdAt: "2026-06-12T19:00:00.000Z",
      updatedAt: "2026-06-12T19:00:00.000Z",
    },
  ]);
});

test("scheduler opens, alerts, reminds, locks, and prompts for result", () => {
  const now = date("2026-06-12T13:00:00.000Z");
  const matches = [
    {
      matchId: "OPEN-ME",
      status: STATUSES.SCHEDULED,
      kickoffUtc: "2026-06-12T19:00:00.000Z",
      handicapGoals: -0.5,
      favoriteSide: SELECTIONS.HOME,
    },
    {
      matchId: "NEEDS-ODDS",
      status: STATUSES.SCHEDULED,
      kickoffUtc: "2026-06-12T18:30:00.000Z",
    },
    {
      matchId: "REMIND-ME",
      status: STATUSES.OPEN,
      kickoffUtc: "2026-06-12T13:30:00.000Z",
    },
    {
      matchId: "LOCK-ME",
      status: STATUSES.OPEN,
      kickoffUtc: "2026-06-12T12:59:59.000Z",
      favoriteSide: SELECTIONS.AWAY,
    },
    {
      matchId: "RESULT-ME",
      status: STATUSES.LOCKED,
      kickoffUtc: "2026-06-12T10:30:00.000Z",
    },
  ];

  const actions = getSchedulerActions(matches, [], now);

  assert.deepEqual(
    actions.map((action) => [action.type, action.matchId]),
    [
      [ACTIONS.OPEN_PICK, "OPEN-ME"],
      [ACTIONS.ODDS_ALERT, "NEEDS-ODDS"],
      [ACTIONS.REMIND_MISSING, "REMIND-ME"],
      [ACTIONS.LOCK_MATCH, "LOCK-ME"],
      [ACTIONS.PROMPT_RESULT, "RESULT-ME"],
    ]
  );
});

test("auto-opens a scheduled match after odds are set inside the T-6h window", () => {
  const now = date("2026-06-12T13:00:00.000Z");

  assert.equal(
    shouldAutoOpenAfterOdds(
      {
        matchId: "G1003",
        status: STATUSES.SCHEDULED,
        kickoffUtc: "2026-06-12T18:30:00.000Z",
        favoriteSide: SELECTIONS.HOME,
        handicapGoals: 0.5,
      },
      now
    ),
    true
  );

  assert.equal(
    shouldAutoOpenAfterOdds(
      {
        matchId: "FUTURE",
        status: STATUSES.SCHEDULED,
        kickoffUtc: "2026-06-12T19:30:01.000Z",
        favoriteSide: SELECTIONS.HOME,
        handicapGoals: 0.5,
      },
      now
    ),
    false
  );
});

test("formats cheerful recap with match events, scoring changes, and leaderboard", () => {
  const recap = formatRecap({
    match: {
      homeTeam: "Argentina",
      awayTeam: "Germany",
      handicapSide: SELECTIONS.HOME,
      handicapGoals: -0.5,
    },
    score: { homeScore: 2, awayScore: 1 },
    outcome: SELECTIONS.HOME,
    events: ["Messi mở tỉ số phút 18", "Germany gỡ hòa trước giờ nghỉ", "Argentina kết liễu ở phút 88"],
    scoreChanges: [
      { displayName: "An", points: 2, correct: true, star: true },
      { displayName: "Binh", points: -1, correct: false, star: true },
    ],
    leaderboard: [
      { displayName: "An", points: 5 },
      { displayName: "Binh", points: 2 },
    ],
  });

  assert.match(recap, /Argentina 2-1 Germany/);
  assert.match(recap, /Đội thắng kèo: Argentina/);
  assert.match(recap, /Messi mở tỉ số/);
  assert.match(recap, /An \+2/);
  assert.match(recap, /Binh -1/);
  assert.match(recap, /1\. An - 5 điểm/);
  assert.match(recap, /không khí bắt đầu nóng/);
});

test("formats leaderboard in rank order", () => {
  assert.equal(
    formatLeaderboard([
      { displayName: "An", points: 4 },
      { displayName: "Binh", points: 3 },
    ]),
    "🏆 Leaderboard\n1. An - 4 điểm\n2. Binh - 3 điểm"
  );
});

test("formats commands by account role", () => {
  var playerCommands = formatCommands(false);
  var adminCommands = formatCommands(true);

  assert.match(playerCommands, /\/matches/);
  assert.match(playerCommands, /\/mypick/);
  assert.doesNotMatch(playerCommands, /\/set_odds/);

  assert.match(adminCommands, /\/matches/);
  assert.match(adminCommands, /\/set_odds/);
  assert.match(adminCommands, /\/dryrun/);
});

test("formats all picks in the next six hours for a player", () => {
  assert.equal(
    formatMyUpcomingPicks({
      now: date("2026-06-12T00:00:00.000Z"),
      matches: [
        {
          matchId: "M1",
          homeTeam: "Argentina",
          awayTeam: "Germany",
          kickoffUtc: "2026-06-12T05:30:00.000Z",
          favoriteSide: SELECTIONS.HOME,
          handicapGoals: 0.5,
        },
        {
          matchId: "M2",
          homeTeam: "Brazil",
          awayTeam: "Japan",
          kickoffUtc: "2026-06-12T07:00:00.000Z",
          favoriteSide: SELECTIONS.AWAY,
          handicapGoals: 1,
        },
        {
          matchId: "OLD",
          homeTeam: "France",
          awayTeam: "Spain",
          kickoffUtc: "2026-06-11T20:00:00.000Z",
          favoriteSide: SELECTIONS.HOME,
          handicapGoals: 0.5,
        },
      ],
      picks: [
        { matchId: "M1", selection: SELECTIONS.HOME, star: true },
        { matchId: "OLD", selection: SELECTIONS.AWAY, star: false },
      ],
    }),
    [
      "📌 Pick các trận trong 6 giờ tới",
      "M1: Argentina vs Germany",
      "Giờ đá: 2026-06-12 12:30 GMT+7",
      "Kèo: Argentina chấp Germany 0.5 Trái",
      "Pick: Argentina ⭐",
    ].join("\n")
  );
});

test("formats handicap as positive odds with favorite first", () => {
  assert.equal(
    formatHandicap({
      homeTeam: "Argentina",
      awayTeam: "Germany",
      favoriteSide: SELECTIONS.HOME,
      handicapGoals: 0.5,
    }),
    "Argentina chấp Germany 0.5 Trái"
  );
});

test("formats open match message with time remaining", () => {
  assert.equal(
    formatOpenMatchMessage(
      {
        matchId: "G1003",
        homeTeam: "Northern Isles",
        awayTeam: "Kazan Federation",
        kickoffUtc: "2026-06-12T18:30:00.000Z",
        favoriteSide: SELECTIONS.HOME,
        handicapGoals: 0.5,
      },
      date("2026-06-12T13:00:00.000Z")
    ),
    [
      "G1003: Northern Isles vs Kazan Federation",
      "Kèo: Northern Isles chấp Kazan Federation 0.5 Trái",
      "Còn lại: 5 giờ 30 phút",
    ].join("\n")
  );
});

test("formats negative handicap by reversing the favorite side", () => {
  assert.equal(
    formatHandicap({
      homeTeam: "Argentina",
      awayTeam: "Germany",
      favoriteSide: SELECTIONS.HOME,
      handicapSide: SELECTIONS.HOME,
      handicapGoals: -0.5,
    }),
    "Germany chấp Argentina 0.5 Trái"
  );
});

test("parses Telegram slash commands", () => {
  assert.deepEqual(parseTelegramCommand("/set_odds M001 HOME -0.5"), {
    name: "set_odds",
    args: ["M001", "HOME", "-0.5"],
  });
  assert.deepEqual(parseTelegramCommand("/leaderboard"), {
    name: "leaderboard",
    args: [],
  });
});

test("parses callback data and builds pick keyboard", () => {
  assert.deepEqual(parseCallbackData("pick|M001|DRAW"), {
    action: "pick",
    matchId: "M001",
    value: "DRAW",
  });

  const keyboard = buildPickKeyboard({
    matchId: "M001",
    stage: "KNOCKOUT",
    homeTeam: "Brazil",
    awayTeam: "Japan",
  });

  assert.deepEqual(keyboard.inline_keyboard[0], [
    { text: "Brazil", callback_data: "pick|M001|HOME" },
    { text: "Hòa", callback_data: "pick|M001|DRAW" },
    { text: "Japan", callback_data: "pick|M001|AWAY" },
  ]);
  assert.deepEqual(keyboard.inline_keyboard[1], [
    { text: "⭐ Ngôi sao hi vọng", callback_data: "star|M001|toggle" },
  ]);
});

test("builds reset sheet selection and confirmation keyboards", () => {
  assert.deepEqual(buildResetSheetKeyboard(["Players", "Matches"]), {
    inline_keyboard: [
      [{ text: "Players", callback_data: "reset_select|Players|" }],
      [{ text: "Matches", callback_data: "reset_select|Matches|" }],
    ],
  });

  assert.deepEqual(buildResetSheetConfirmKeyboard("Matches"), {
    inline_keyboard: [
      [
        { text: "Confirm reset Matches", callback_data: "reset_confirm|Matches|" },
        { text: "Cancel", callback_data: "reset_cancel|Matches|" },
      ],
    ],
  });
});

test("builds dry-run matches covering orchestration cases", () => {
  const matches = buildDryRunMatches("2026-06-12T00:00:00.000Z");

  assert.equal(matches.length, 5);
  assert.deepEqual(
    matches.map((match) => [match.matchId, match.stage, match.status, match.favoriteSide, match.handicapGoals]),
    [
      ["DRY-GROUP-HALF", "GROUP", STATUSES.SCHEDULED, SELECTIONS.HOME, 0.5],
      ["DRY-GROUP-INTEGER", "GROUP", STATUSES.SCHEDULED, SELECTIONS.AWAY, 1],
      ["DRY-KO-HALF", "KNOCKOUT", STATUSES.SCHEDULED, SELECTIONS.HOME, 0.5],
      ["DRY-KO-INTEGER", "KNOCKOUT", STATUSES.SCHEDULED, SELECTIONS.AWAY, 0],
      ["DRY-MISSING-ODDS", "GROUP", STATUSES.SCHEDULED, "", ""],
    ]
  );
  assert.equal(matches[0].kickoffUtc, "2026-06-12T05:30:00.000Z");
});

test("normalizes AI dry-run matches into orchestration-ready cases", () => {
  const normalized = normalizeDryRunMatchesForOrchestration(
    [
      { matchId: "AI1", homeTeam: "Team A", awayTeam: "Team B" },
      { matchId: "AI2", homeTeam: "Team C", awayTeam: "Team D" },
      { matchId: "AI3", homeTeam: "Team E", awayTeam: "Team F" },
      { matchId: "AI4", homeTeam: "Team G", awayTeam: "Team H" },
      { matchId: "AI5", homeTeam: "Team I", awayTeam: "Team J" },
    ],
    "2026-06-12T00:00:00.000Z"
  );

  assert.deepEqual(
    normalized.map((match) => [match.matchId, match.stage, match.status, match.favoriteSide, match.handicapGoals, match.kickoffUtc]),
    [
      ["AI1", "GROUP", STATUSES.SCHEDULED, SELECTIONS.HOME, 0.5, "2026-06-12T05:30:00.000Z"],
      ["AI2", "GROUP", STATUSES.SCHEDULED, SELECTIONS.AWAY, 1, "2026-06-12T05:45:00.000Z"],
      ["AI3", "KNOCKOUT", STATUSES.SCHEDULED, SELECTIONS.HOME, 0.5, "2026-06-12T05:50:00.000Z"],
      ["AI4", "KNOCKOUT", STATUSES.SCHEDULED, SELECTIONS.AWAY, 0, "2026-06-12T05:55:00.000Z"],
      ["AI5", "GROUP", STATUSES.SCHEDULED, "", "", "2026-06-12T05:40:00.000Z"],
    ]
  );
});

test("omits draw button when handicap is not a whole number", () => {
  const keyboard = buildPickKeyboard({
    matchId: "M001",
    stage: "GROUP",
    homeTeam: "Brazil",
    awayTeam: "Japan",
    handicapGoals: 0.5,
  });

  assert.deepEqual(keyboard.inline_keyboard[0], [
    { text: "Brazil", callback_data: "pick|M001|HOME" },
    { text: "Japan", callback_data: "pick|M001|AWAY" },
  ]);
});

test("keeps draw button when handicap is a whole number", () => {
  const keyboard = buildPickKeyboard({
    matchId: "M001",
    stage: "GROUP",
    homeTeam: "Brazil",
    awayTeam: "Japan",
    handicapGoals: 1,
  });

  assert.deepEqual(keyboard.inline_keyboard[0], [
    { text: "Brazil", callback_data: "pick|M001|HOME" },
    { text: "Hòa", callback_data: "pick|M001|DRAW" },
    { text: "Japan", callback_data: "pick|M001|AWAY" },
  ]);
});

test("formats kickoff time in GMT+7", () => {
  assert.equal(formatKickoffTime("2026-06-12T20:00:00.000Z"), "2026-06-13 03:00 GMT+7");
});

test("builds locked betting facts for AI lock message", () => {
  assert.deepEqual(
    buildLockedBettingFacts({
      match: {
        matchId: "T001",
        homeTeam: "Argentina",
        awayTeam: "Germany",
        favoriteSide: SELECTIONS.HOME,
        handicapGoals: 0.5,
        kickoffUtc: "2026-06-12T20:00:00.000Z",
      },
      picks: [
        { selection: SELECTIONS.HOME, star: false },
        { selection: SELECTIONS.HOME, star: true },
        { selection: SELECTIONS.AWAY, star: false },
      ],
    }),
    {
      matchId: "T001",
      title: "Argentina vs Germany",
      kickoff: "2026-06-13 03:00 GMT+7",
      handicap: "Argentina chấp Germany 0.5 Trái",
      totalPicks: 3,
      homePicks: 2,
      drawPicks: 0,
      awayPicks: 1,
      starPicks: 1,
      drawWasOpen: false,
    }
  );
});

test("builds AI prompts with facts-first constraints", () => {
  const lockPrompt = buildLockDramaPrompt({
    facts: {
      title: "Argentina vs Germany",
      kickoff: "2026-06-13 03:00 GMT+7",
      handicap: "Argentina chấp Germany 0.5 Trái",
      totalPicks: 3,
      homePicks: 2,
      drawPicks: 0,
      awayPicks: 1,
      starPicks: 1,
      drawWasOpen: false,
    },
  });

  assert.match(lockPrompt, /không bịa/);
  assert.match(lockPrompt, /ly kì/);
  assert.match(lockPrompt, /Argentina vs Germany/);

  const recapPrompt = buildAiRecapPrompt({
    match: {
      homeTeam: "Argentina",
      awayTeam: "Germany",
      favoriteSide: SELECTIONS.HOME,
      handicapGoals: 0.5,
      kickoffUtc: "2026-06-12T20:00:00.000Z",
    },
    score: { homeScore: 2, awayScore: 1 },
    scoreChanges: [{ displayName: "An", points: 1, correct: true, star: false }],
    leaderboard: [{ displayName: "An", points: 3 }],
  });

  assert.match(recapPrompt, /tối đa 2 nguồn public/);
  assert.match(recapPrompt, /tiếng Việt/);
  assert.match(recapPrompt, /An \+1/);
});

test("derives stable Telegram update dedupe keys", () => {
  assert.equal(
    getTelegramUpdateDedupeKey({
      update_id: 123,
      message: { message_id: 99, chat: { id: -1001 }, text: "/matches" },
    }),
    "update:123"
  );
  assert.equal(
    getTelegramUpdateDedupeKey({
      callback_query: { id: "abc123", data: "pick|M001|HOME" },
    }),
    "callback:abc123"
  );
  assert.equal(getTelegramUpdateDedupeKey({}), "");
});

test("parses admin add player arguments", () => {
  assert.deepEqual(parseAddPlayerArgs(["12345", "Viet", "Mai", "Hoang"]), {
    telegramUserId: "12345",
    displayName: "Viet Mai Hoang",
    active: true,
    isAdmin: false,
  });
  assert.equal(parseAddPlayerArgs(["12345"]), null);
});

test("parses admin add match arguments with vs separator", () => {
  assert.deepEqual(
    parseAddMatchArgs([
      "T001",
      "2026-06-12T19:00:00.000Z",
      "GROUP",
      "Argentina",
      "vs",
      "Germany",
    ]),
    {
      matchId: "T001",
      kickoffUtc: "2026-06-12T19:00:00.000Z",
      stage: "GROUP",
      homeTeam: "Argentina",
      awayTeam: "Germany",
      status: STATUSES.SCHEDULED,
    }
  );
  assert.deepEqual(
    parseAddMatchArgs([
      "T002",
      "2026-06-13T02:00:00.000Z",
      "KNOCKOUT",
      "United_States",
      "vs",
      "South_Korea",
    ]),
    {
      matchId: "T002",
      kickoffUtc: "2026-06-13T02:00:00.000Z",
      stage: "KNOCKOUT",
      homeTeam: "United States",
      awayTeam: "South Korea",
      status: STATUSES.SCHEDULED,
    }
  );
  assert.equal(parseAddMatchArgs(["T001", "not-a-date", "GROUP", "A", "vs", "B"]), null);
  assert.equal(parseAddMatchArgs(["T001", "2026-06-12T19:00:00.000Z", "GROUP", "A"]), null);
});

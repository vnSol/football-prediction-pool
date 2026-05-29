const test = require("node:test");
const assert = require("node:assert/strict");

const {
  ACTIONS,
  SELECTIONS,
  STATUSES,
  buildDefaultOddsPatch,
  buildDryRunMatchRefreshPatch,
  canChangePick,
  canSetOdds,
  createDefaultPicks,
  buildPickKeyboard,
  buildAiResultProposalPrompt,
  buildAiOddsProposalPrompt,
  formatKickoffTime,
  formatLeaderboard,
  formatHandicap,
  formatCommands,
  formatAdminResultProposal,
  formatAdminOddsProposal,
  formatOpenMatchMessage,
  formatRecap,
  formatMyUpcomingPicks,
  formatMissingPickReminderMessage,
  formatJoinAdminMessage,
  formatJoinMessage,
  formatTelegramDisplayName,
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
  buildDryRunPrompt,
  buildDryRunResultPrompt,
  buildDryRunResultProposal,
  buildDryRunOddsProposal,
  buildOddsProposalConfirmKeyboard,
  buildOddsProposalPatch,
  buildResultProposalConfirmKeyboard,
  buildResultProposalPatch,
  buildConfirmOddsProposalPatch,
  buildConfirmResultProposalPatch,
  normalizeDryRunMatchesForOrchestration,
  normalizeDryRunResult,
  normalizeAiResultProposal,
  normalizeAiOddsProposal,
  parseCallbackData,
  parseTelegramCommand,
  getDryRunFinishTime,
  getDryRunMatchesToFinish,
  scorePick,
  shouldAutoOpenAfterOdds,
  shouldNotifyOddsUpdate,
  teamDisplayName,
  teamFlagEmoji,
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

test("scheduler opens picks at T-24, prompts missing odds, and sends missing-pick reminders", () => {
  const now = date("2026-06-12T13:00:00.000Z");
  const matches = [
    {
      matchId: "OPEN-ME",
      status: STATUSES.SCHEDULED,
      kickoffUtc: "2026-06-13T12:30:00.000Z",
      handicapGoals: -0.5,
      favoriteSide: SELECTIONS.HOME,
    },
    {
      matchId: "NEEDS-ODDS",
      status: STATUSES.SCHEDULED,
      kickoffUtc: "2026-06-13T12:45:00.000Z",
    },
    {
      matchId: "ODDS-PROMPTED",
      status: STATUSES.SCHEDULED,
      kickoffUtc: "2026-06-13T12:45:00.000Z",
      oddsAlertedAt: "2026-06-12T12:30:00.000Z",
    },
    {
      matchId: "REMIND-2H",
      status: STATUSES.OPEN,
      kickoffUtc: "2026-06-12T15:00:00.000Z",
    },
    {
      matchId: "REMIND-30M",
      status: STATUSES.OPEN,
      kickoffUtc: "2026-06-12T13:30:00.000Z",
      reminded120At: "2026-06-12T12:00:00.000Z",
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
    actions.map((action) => [action.type, action.matchId, action.reminderMinutes].filter((value) => value !== undefined)),
    [
      [ACTIONS.OPEN_PICK, "OPEN-ME"],
      [ACTIONS.ODDS_ALERT, "NEEDS-ODDS"],
      [ACTIONS.REMIND_MISSING, "REMIND-2H", 120],
      [ACTIONS.REMIND_MISSING, "REMIND-30M", 30],
      [ACTIONS.LOCK_MATCH, "LOCK-ME"],
      [ACTIONS.PROMPT_RESULT, "RESULT-ME"],
    ]
  );
});

test("uses home zero handicap as the default missing odds patch", () => {
  assert.deepEqual(buildDefaultOddsPatch(date("2026-06-12T13:00:00.000Z")), {
    favoriteSide: SELECTIONS.HOME,
    handicapSide: SELECTIONS.HOME,
    handicapGoals: 0,
    oddsLockedAt: "2026-06-12T13:00:00.000Z",
  });
});

test("builds dry-run refresh patch that clears prior run state", () => {
  assert.deepEqual(
    buildDryRunMatchRefreshPatch({
      matchId: "DRY-001",
      homeTeam: "Argentina",
      awayTeam: "Germany",
      kickoffUtc: "2026-06-12T05:30:00.000Z",
      stage: "GROUP",
      status: STATUSES.SCHEDULED,
      favoriteSide: SELECTIONS.HOME,
      handicapSide: SELECTIONS.HOME,
      handicapGoals: 0.5,
    }),
    {
      homeTeam: "Argentina",
      awayTeam: "Germany",
      kickoffUtc: "2026-06-12T05:30:00.000Z",
      stage: "GROUP",
      status: STATUSES.SCHEDULED,
      favoriteSide: SELECTIONS.HOME,
      handicapSide: SELECTIONS.HOME,
      handicapGoals: 0.5,
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
      reminded120At: "",
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
    }
  );
});

test("creates home default picks when odds are still missing at lock", () => {
  const match = {
    matchId: "M003",
  };

  assert.deepEqual(createDefaultPicks(match, players, [], date("2026-06-12T19:00:00.000Z")), [
    {
      matchId: "M003",
      telegramUserId: "101",
      selection: SELECTIONS.HOME,
      star: false,
      source: "auto_default",
      createdAt: "2026-06-12T19:00:00.000Z",
      updatedAt: "2026-06-12T19:00:00.000Z",
    },
    {
      matchId: "M003",
      telegramUserId: "102",
      selection: SELECTIONS.HOME,
      star: false,
      source: "auto_default",
      createdAt: "2026-06-12T19:00:00.000Z",
      updatedAt: "2026-06-12T19:00:00.000Z",
    },
  ]);
});

test("auto-opens a scheduled match after odds are set inside the T-24 window", () => {
  const now = date("2026-06-12T13:00:00.000Z");

  assert.equal(
    shouldAutoOpenAfterOdds(
      {
        matchId: "G1003",
        status: STATUSES.SCHEDULED,
        kickoffUtc: "2026-06-13T12:30:00.000Z",
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
        kickoffUtc: "2026-06-13T13:00:01.000Z",
        favoriteSide: SELECTIONS.HOME,
        handicapGoals: 0.5,
      },
      now
    ),
    false
  );
});

test("set odds is allowed only before voting lock and kickoff", () => {
  const now = date("2026-06-12T13:00:00.000Z");
  const baseMatch = {
    matchId: "M004",
    status: STATUSES.OPEN,
    kickoffUtc: "2026-06-12T19:00:00.000Z",
  };

  assert.equal(canSetOdds(baseMatch, now), true);
  assert.equal(canSetOdds({ ...baseMatch, status: STATUSES.LOCKED }, now), false);
  assert.equal(canSetOdds({ ...baseMatch, status: STATUSES.SETTLED }, now), false);
  assert.equal(canSetOdds(baseMatch, date("2026-06-12T19:00:00.000Z")), false);
});

test("notifies players only when open match odds change", () => {
  const match = {
    matchId: "M005",
    status: STATUSES.OPEN,
    favoriteSide: SELECTIONS.HOME,
    handicapSide: SELECTIONS.HOME,
    handicapGoals: 0,
  };

  assert.equal(shouldNotifyOddsUpdate(match, SELECTIONS.HOME, 0.5), true);
  assert.equal(shouldNotifyOddsUpdate(match, SELECTIONS.HOME, 0), false);
  assert.equal(shouldNotifyOddsUpdate({ matchId: "M006", status: STATUSES.OPEN }, SELECTIONS.HOME, 0.5), true);
  assert.equal(shouldNotifyOddsUpdate({ ...match, status: STATUSES.SCHEDULED }, SELECTIONS.HOME, 0.5), false);
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

  assert.match(recap, /🇦🇷 Argentina 2-1 🇩🇪 Germany/);
  assert.match(recap, /Đội thắng kèo: 🇦🇷 Argentina/);
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

  assert.match(playerCommands, /\/join/);
  assert.match(playerCommands, /\/matches/);
  assert.match(playerCommands, /\/mypick/);
  assert.doesNotMatch(playerCommands, /\/set_odds/);

  assert.match(adminCommands, /\/matches/);
  assert.match(adminCommands, /\/set_odds/);
  assert.match(adminCommands, /\/dryrun \[baseTimeUtc ISO UTC\]/);
  assert.match(adminCommands, /\/dryrun_finish/);
  assert.match(adminCommands, /đề xuất kết quả/);
});

test("formats Telegram join display names and welcome message", () => {
  assert.equal(
    formatTelegramDisplayName({
      first_name: "Viet",
      last_name: "Mai Hoang",
      username: "vietmh",
    }),
    "Viet Mai Hoang"
  );
  assert.equal(formatTelegramDisplayName({ username: "vietmh" }), "@vietmh");
  assert.equal(formatTelegramDisplayName({ id: 12345 }), "12345");

  assert.match(formatJoinMessage({ displayName: "Viet Mai Hoang" }, true), /Đã tham gia/);
  assert.match(formatJoinMessage({ displayName: "Viet Mai Hoang" }, false), /đã active lại/);
  assert.match(formatJoinAdminMessage({ telegramUserId: "12345", displayName: "Viet Mai Hoang" }, true), /người chơi mới/);
  assert.match(formatJoinAdminMessage({ telegramUserId: "12345", displayName: "Viet Mai Hoang" }, false), /active=true/);
});

test("formats known team names with flags and leaves unknown names unchanged", () => {
  assert.equal(teamDisplayName("Argentina"), "🇦🇷 Argentina");
  assert.equal(teamDisplayName("Côte d'Ivoire"), "🇨🇮 Côte d'Ivoire");
  assert.equal(teamDisplayName("Northern Isles"), "Northern Isles");
  assert.equal(teamFlagEmoji("USA"), "🇺🇸");
});

test("formats all picks in the next 24 hours for a player", () => {
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
        { matchId: "M2", selection: SELECTIONS.AWAY, star: false },
        { matchId: "OLD", selection: SELECTIONS.AWAY, star: false },
      ],
    }),
    [
      "📌 Pick các trận trong 24 giờ tới",
      "M1: 🇦🇷 Argentina vs 🇩🇪 Germany",
      "Giờ đá: 2026-06-12 12:30 GMT+7",
      "Kèo: 🇦🇷 Argentina chấp 🇩🇪 Germany 0.5 Trái",
      "Pick: 🇦🇷 Argentina ⭐",
      "",
      "M2: 🇧🇷 Brazil vs 🇯🇵 Japan",
      "Giờ đá: 2026-06-12 14:00 GMT+7",
      "Kèo: 🇯🇵 Japan chấp 🇧🇷 Brazil 1 Trái",
      "Pick: 🇯🇵 Japan",
    ].join("\n")
  );
});

test("formats missing-pick reminder by reminder threshold", () => {
  const match = {
    homeTeam: "Argentina",
    awayTeam: "Germany",
  };

  assert.match(formatMissingPickReminderMessage(match, 120), /Còn dưới 2 giờ/);
  assert.match(formatMissingPickReminderMessage(match, 30), /Còn dưới 30 phút/);
});

test("formats handicap as positive odds with favorite first", () => {
  assert.equal(
    formatHandicap({
      homeTeam: "Argentina",
      awayTeam: "Germany",
      favoriteSide: SELECTIONS.HOME,
      handicapGoals: 0.5,
    }),
    "🇦🇷 Argentina chấp 🇩🇪 Germany 0.5 Trái"
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
    "🇩🇪 Germany chấp 🇦🇷 Argentina 0.5 Trái"
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
    { text: "🇧🇷 Brazil", callback_data: "pick|M001|HOME" },
    { text: "Hòa", callback_data: "pick|M001|DRAW" },
    { text: "🇯🇵 Japan", callback_data: "pick|M001|AWAY" },
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
  const teams = matches.flatMap((match) => [match.homeTeam, match.awayTeam]);

  assert.equal(matches.length, 5);
  assert.equal(teams.every((team) => teamFlagEmoji(team)), true);
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

test("asks AI dry-run to use real national teams for flag testing", () => {
  const prompt = buildDryRunPrompt("2026-06-12T00:00:00.000Z");

  assert.match(prompt, /real national teams/i);
  assert.match(prompt, /flag display/i);
  assert.doesNotMatch(prompt, /clearly synthetic teams/i);
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
      ["DRY-AI1", "GROUP", STATUSES.SCHEDULED, SELECTIONS.HOME, 0.5, "2026-06-12T05:30:00.000Z"],
      ["DRY-AI2", "GROUP", STATUSES.SCHEDULED, SELECTIONS.AWAY, 1, "2026-06-12T05:45:00.000Z"],
      ["DRY-AI3", "KNOCKOUT", STATUSES.SCHEDULED, SELECTIONS.HOME, 0.5, "2026-06-12T05:50:00.000Z"],
      ["DRY-AI4", "KNOCKOUT", STATUSES.SCHEDULED, SELECTIONS.AWAY, 0, "2026-06-12T05:55:00.000Z"],
      ["DRY-AI5", "GROUP", STATUSES.SCHEDULED, "", "", "2026-06-12T05:40:00.000Z"],
    ]
  );
});

test("selects unfinished dry-run matches and computes finish time", () => {
  const matches = [
    { matchId: "DRY-A", status: STATUSES.OPEN, kickoffUtc: "2026-06-12T05:30:00.000Z" },
    { matchId: "DRY-B", status: STATUSES.LOCKED, kickoffUtc: "2026-06-12T05:55:00.000Z" },
    { matchId: "DRY-C", status: STATUSES.SETTLED, kickoffUtc: "2026-06-12T06:00:00.000Z" },
    { matchId: "REAL-1", status: STATUSES.OPEN, kickoffUtc: "2026-06-12T07:00:00.000Z" },
  ];

  assert.deepEqual(
    getDryRunMatchesToFinish(matches).map((match) => match.matchId),
    ["DRY-A", "DRY-B"]
  );
  assert.equal(getDryRunFinishTime(getDryRunMatchesToFinish(matches)).toISOString(), "2026-06-12T07:55:00.000Z");
});

test("builds and normalizes AI dry-run result payloads", () => {
  const match = {
    matchId: "DRY-A",
    homeTeam: "Argentina",
    awayTeam: "Germany",
    stage: "GROUP",
    handicapSide: SELECTIONS.HOME,
    handicapGoals: -0.5,
  };

  assert.match(buildDryRunResultPrompt(match), /JSON only/);
  assert.match(buildDryRunResultPrompt(match), /DRY-A/);

  assert.deepEqual(
    normalizeDryRunResult({
      homeScore: "2",
      awayScore: 1,
      events: ["Argentina mở tỉ số", "Germany gỡ lại", "Argentina thắng cuối trận"],
    }),
    {
      homeScore: 2,
      awayScore: 1,
      summary: "Argentina mở tỉ số; Germany gỡ lại; Argentina thắng cuối trận",
    }
  );
  assert.throws(() => normalizeDryRunResult({ homeScore: "x", awayScore: 1, summary: "bad" }), /invalid score/);
});

test("builds dry-run result proposal without writing final result", () => {
  const proposal = buildDryRunResultProposal({
    matchId: "DRY-A",
    homeTeam: "Argentina",
    awayTeam: "Germany",
  });

  assert.equal(proposal.status, "FINISHED");
  assert.equal(typeof proposal.homeScore, "number");
  assert.equal(typeof proposal.awayScore, "number");
  assert.match(proposal.summary, /Trận đấu mô phỏng/);
  assert.deepEqual(proposal.sources, []);
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
    { text: "🇧🇷 Brazil", callback_data: "pick|M001|HOME" },
    { text: "🇯🇵 Japan", callback_data: "pick|M001|AWAY" },
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
    { text: "🇧🇷 Brazil", callback_data: "pick|M001|HOME" },
    { text: "Hòa", callback_data: "pick|M001|DRAW" },
    { text: "🇯🇵 Japan", callback_data: "pick|M001|AWAY" },
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
      title: "🇦🇷 Argentina vs 🇩🇪 Germany",
      kickoff: "2026-06-13 03:00 GMT+7",
      handicap: "🇦🇷 Argentina chấp 🇩🇪 Germany 0.5 Trái",
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
  assert.match(recapPrompt, /Không đề xuất/);
  assert.match(recapPrompt, /Không nhắc lại luật chơi/);
  assert.match(recapPrompt, /chỉ liệt kê URL/);
  assert.match(recapPrompt, /Đúng 3 dòng/);
  assert.match(recapPrompt, /Dòng 1/);
  assert.match(recapPrompt, /Dòng 2/);
  assert.match(recapPrompt, /Dòng 3/);
  assert.match(recapPrompt, /vị trí chót bảng/);
  assert.match(recapPrompt, /lạnh lẽo trên đỉnh/);
  assert.match(recapPrompt, /tăng tốc/);
  assert.match(recapPrompt, /An \+1/);
});

test("builds AI result proposal prompt for admin confirmation", () => {
  const prompt = buildAiResultProposalPrompt({
    matchId: "M001",
    homeTeam: "Argentina",
    awayTeam: "Germany",
    kickoffUtc: "2026-06-12T20:00:00.000Z",
  });

  assert.match(prompt, /1-2 nguồn public/);
  assert.match(prompt, /web search như Google/);
  assert.match(prompt, /JSON/);
  assert.match(prompt, /không bịa/i);
  assert.match(prompt, /admin confirm/);
  assert.match(prompt, /M001/);
});

test("normalizes and formats AI result proposal for admin verification", () => {
  const match = {
    matchId: "M001",
    homeTeam: "Argentina",
    awayTeam: "Germany",
    kickoffUtc: "2026-06-12T20:00:00.000Z",
  };
  const proposal = normalizeAiResultProposal({
    status: "finished",
    homeScore: "2",
    awayScore: 1,
    summary: "Argentina mở tỉ số; Germany gỡ; Argentina thắng cuối trận",
    sources: ["https://www.fifa.com/match-centre/m001", "https://www.bbc.com/sport/football/m001", "not a url"],
  });

  assert.deepEqual(proposal, {
    status: "FINISHED",
    homeScore: 2,
    awayScore: 1,
    summary: "Argentina mở tỉ số; Germany gỡ; Argentina thắng cuối trận",
    sources: ["https://www.fifa.com/match-centre/m001", "https://www.bbc.com/sport/football/m001"],
  });

  const message = formatAdminResultProposal(match, proposal);

  assert.match(message, /Đề xuất AI\/search/);
  assert.match(message, /Trạng thái: đã kết thúc/);
  assert.match(message, /Argentina 2-1 Germany/);
  assert.match(message, /https:\/\/www\.fifa\.com\/match-centre\/m001/);
  assert.match(message, /https:\/\/www\.bbc\.com\/sport\/football\/m001/);
  assert.match(message, /bấm Y để confirm và tự settle/);
  assert.match(message, /Bấm Y để ghi kết quả này và settle tự động/);
  assert.doesNotMatch(message, /\/result M001 2-1/);
});

test("builds result proposal patch and confirm keyboard", () => {
  const proposal = {
    status: "FINISHED",
    homeScore: 2,
    awayScore: 1,
    summary: "Argentina thắng cuối trận",
    sources: ["https://www.fifa.com/match-centre/m001"],
  };

  assert.deepEqual(buildResultProposalPatch(proposal, date("2026-06-12T22:00:00.000Z")), {
    resultProposalStatus: "FINISHED",
    resultProposalHomeScore: 2,
    resultProposalAwayScore: 1,
    resultProposalSummary: "Argentina thắng cuối trận",
    resultProposalSources: "https://www.fifa.com/match-centre/m001",
    resultProposalAt: "2026-06-12T22:00:00.000Z",
    resultProposalDecision: "",
    resultProposalDecidedAt: "",
  });

  assert.deepEqual(buildResultProposalConfirmKeyboard("M001", proposal), {
    inline_keyboard: [
      [
        { text: "Y - Confirm & settle", callback_data: "result_confirm|M001|" },
        { text: "N - Reject", callback_data: "result_reject|M001|" },
      ],
    ],
  });
});

test("builds final result patch from confirmed proposal", () => {
  assert.deepEqual(
    buildConfirmResultProposalPatch(
      {
        resultProposalHomeScore: "2",
        resultProposalAwayScore: 1,
        resultProposalSummary: "Argentina thắng cuối trận",
      },
      date("2026-06-12T22:05:00.000Z")
    ),
    {
      finalHomeScore: 2,
      finalAwayScore: 1,
      finalSummary: "Argentina thắng cuối trận",
      resultProposalDecision: "CONFIRMED",
      resultProposalDecidedAt: "2026-06-12T22:05:00.000Z",
    }
  );

  assert.throws(() => buildConfirmResultProposalPatch({ resultProposalHomeScore: "", resultProposalAwayScore: "" }), /missing score/);
});

test("builds AI odds proposal prompt for admin confirmation", () => {
  const prompt = buildAiOddsProposalPrompt({
    matchId: "DRY-C1-FINAL-2026",
    homeTeam: "Paris Saint-Germain",
    awayTeam: "Arsenal",
    kickoffUtc: "2026-05-30T16:00:00.000Z",
  });

  assert.match(prompt, /1-2 nguồn public/);
  assert.match(prompt, /Asian handicap/);
  assert.match(prompt, /JSON/);
  assert.match(prompt, /không bịa/i);
  assert.match(prompt, /admin confirm/);
  assert.match(prompt, /DRY-C1-FINAL-2026/);
});

test("normalizes and formats AI odds proposal for admin verification", () => {
  const match = {
    matchId: "DRY-C1-FINAL-2026",
    homeTeam: "Paris Saint-Germain",
    awayTeam: "Arsenal",
    kickoffUtc: "2026-05-30T16:00:00.000Z",
  };
  const proposal = normalizeAiOddsProposal({
    favoriteSide: "home",
    handicapGoals: "0.5",
    summary: "PSG chấp nửa trái theo odds market",
    sources: ["https://example.com/odds", "bad-url"],
  });

  assert.deepEqual(proposal, {
    favoriteSide: SELECTIONS.HOME,
    handicapGoals: 0.5,
    summary: "PSG chấp nửa trái theo odds market",
    sources: ["https://example.com/odds"],
  });

  const message = formatAdminOddsProposal(match, proposal);

  assert.match(message, /Đề xuất kèo AI\/search/);
  assert.match(message, /Paris Saint-Germain chấp Arsenal 0.5 Trái/);
  assert.match(message, /https:\/\/example\.com\/odds/);
  assert.match(message, /bấm Y để ghi kèo và mở pick/);
});

test("builds odds proposal patch, confirm keyboard, and confirmed odds patch", () => {
  const proposal = {
    favoriteSide: SELECTIONS.HOME,
    handicapGoals: 0.5,
    summary: "PSG chấp nửa trái",
    sources: ["https://example.com/odds"],
  };

  assert.deepEqual(buildOddsProposalPatch(proposal, date("2026-05-30T10:00:00.000Z")), {
    oddsProposalFavoriteSide: SELECTIONS.HOME,
    oddsProposalHandicapGoals: 0.5,
    oddsProposalSummary: "PSG chấp nửa trái",
    oddsProposalSources: "https://example.com/odds",
    oddsProposalAt: "2026-05-30T10:00:00.000Z",
    oddsProposalDecision: "",
    oddsProposalDecidedAt: "",
  });

  assert.deepEqual(buildOddsProposalConfirmKeyboard("DRY-C1-FINAL-2026", proposal), {
    inline_keyboard: [
      [
        { text: "Y - Confirm & open", callback_data: "odds_confirm|DRY-C1-FINAL-2026|" },
        { text: "N - Reject", callback_data: "odds_reject|DRY-C1-FINAL-2026|" },
      ],
    ],
  });

  assert.deepEqual(
    buildConfirmOddsProposalPatch(
      {
        oddsProposalFavoriteSide: SELECTIONS.HOME,
        oddsProposalHandicapGoals: "0.5",
      },
      date("2026-05-30T10:05:00.000Z")
    ),
    {
      favoriteSide: SELECTIONS.HOME,
      handicapSide: SELECTIONS.HOME,
      handicapGoals: 0.5,
      oddsLockedAt: "2026-05-30T10:05:00.000Z",
      oddsProposalDecision: "CONFIRMED",
      oddsProposalDecidedAt: "2026-05-30T10:05:00.000Z",
    }
  );
});

test("builds synthetic dry-run odds proposal", () => {
  const proposal = buildDryRunOddsProposal({
    matchId: "DRY-C1-FINAL-2026",
    homeTeam: "Paris Saint-Germain",
    awayTeam: "Arsenal",
  });

  assert.equal(proposal.favoriteSide, SELECTIONS.HOME);
  assert.equal(proposal.handicapGoals, 0.5);
  assert.match(proposal.summary, /Kèo mô phỏng/);
  assert.deepEqual(proposal.sources, []);
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

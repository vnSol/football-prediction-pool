const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadMainContext(overrides) {
  const sentMessages = [];
  const recapMessages = [];
  const context = Object.assign(
    {
      console,
      STATUSES: { LOCKED: "LOCKED", SETTLED: "SETTLED" },
      canSendLockSummary: (match) => Boolean(match && match.status === "LOCKED"),
      getMatches: () => [],
      getMatchById: (matchId) => ({ matchId, status: "LOCKED" }),
      getPicks: () => [{ matchId: "M001", displayName: "An", selection: "HOME" }],
      generateAiLockMessage: () => "AI tổng hợp pick",
      generateAiResultProposal: () => ({ status: "FINISHED", homeScore: 2, awayScore: 1 }),
      formatLockedPickSummary: () => "📋 Pick đã chốt\n- Argentina: An",
      formatAdminResultProposal: () => "AI đề xuất kết quả",
      formatAiMatchSubmitResult: (result) => [
        "Đã ghi các trận được chọn vào Matches.",
        "Created: " + (result.created.length ? result.created.join(", ") : "none"),
        "Skipped existing: " + (result.skipped.length ? result.skipped.join(", ") : "none"),
      ].join("\n"),
      filterNewAiMatchProposals: (matches) => matches,
      buildFallbackLockMessage: () => "Fallback tổng hợp pick",
      buildResultProposalPatch: () => ({ resultProposalStatus: "FINISHED" }),
      buildResultProposalConfirmKeyboard: () => ({ inline_keyboard: [[{ text: "Y", callback_data: "result_confirm|M001|" }]] }),
      updateMatch: () => {},
      editTelegramMessageText: (chatId, messageId, text, replyMarkup) => {
        const message = { chatId, messageId, text };
        if (replyMarkup) message.replyMarkup = replyMarkup;
        sentMessages.push(message);
      },
      sendRecapToConfiguredChats: (text) => recapMessages.push(text),
      sendTelegramMessage: (chatId, text, replyMarkup) => {
        const message = { chatId, text };
        if (replyMarkup) message.replyMarkup = replyMarkup;
        sentMessages.push(message);
      },
    },
    overrides || {}
  );
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../src/main.js"), "utf8"), context);
  return { context, sentMessages, recapMessages };
}

test("lock_summary sends the generated summary to the configured recap chat", () => {
  const { context, sentMessages, recapMessages } = loadMainContext();

  context.resendLockSummary("M001", "-100123");

  assert.deepEqual(recapMessages, ["AI tổng hợp pick\n\n📋 Pick đã chốt\n- Argentina: An"]);
  assert.deepEqual(JSON.parse(JSON.stringify(sentMessages)), [
    { chatId: "-100123", text: "Đã gửi lại AI pick đã chốt cho M001 vào RECAP_CHAT_ID." },
  ]);
});

test("ai_matches sends AI match proposals for admin selection", () => {
  const saved = [];
  const candidate = {
    matchId: "WCQ-20260611-VIETNAM-INDONESIA",
    homeTeam: "Vietnam",
    awayTeam: "Indonesia",
    kickoffUtc: "2026-06-11T05:00:00.000Z",
    stage: "GROUP",
    status: "SCHEDULED",
    sources: ["https://www.fifa.com/example"],
  };
  const proposal = {
    requestId: "REQ1",
    prompt: "lấy các trận đấu vòng loại World cup 2026",
    matches: [candidate],
    selected: [true],
  };
  const { context, sentMessages } = loadMainContext({
    getMatchById: () => null,
    generateAiMatchProposals: () => [candidate],
    buildAiMatchProposalRequestId: () => "REQ1",
    buildAiMatchProposal: () => proposal,
    saveAiMatchProposal: (value) => saved.push(value),
    formatAiMatchProposalMessage: () => "AI đề xuất lịch trận",
    buildAiMatchProposalKeyboard: () => ({ inline_keyboard: [[{ text: "[x] WCQ", callback_data: "match_toggle|REQ1|0" }]] }),
  });

  context.adminAiMatches("-100123", "42", ["lấy", "các", "trận", "đấu", "vòng", "loại", "World", "cup", "2026"]);

  assert.deepEqual(saved, [proposal]);
  assert.deepEqual(JSON.parse(JSON.stringify(sentMessages)), [
    {
      chatId: "-100123",
      text: "AI đề xuất lịch trận",
      replyMarkup: { inline_keyboard: [[{ text: "[x] WCQ", callback_data: "match_toggle|REQ1|0" }]] },
    },
  ]);
});

test("ai_matches reports when AI finds no suitable matches", () => {
  const { context, sentMessages } = loadMainContext({
    generateAiMatchProposals: () => [],
  });

  context.adminAiMatches("-100123", "42", ["không", "có"]);

  assert.deepEqual(sentMessages, [
    {
      chatId: "-100123",
      text: "AI không tìm được trận nào phù hợp yêu cầu.",
    },
  ]);
});

test("AI match proposal callback toggles selection and edits the proposal message", () => {
  const saved = [];
  const proposal = { requestId: "REQ1", matches: [{ matchId: "M001" }], selected: [true] };
  const nextProposal = { requestId: "REQ1", matches: [{ matchId: "M001" }], selected: [false] };
  const { context, sentMessages } = loadMainContext({
    getAiMatchProposal: () => proposal,
    toggleAiMatchProposalSelection: () => nextProposal,
    saveAiMatchProposal: (value) => saved.push(value),
    formatAiMatchProposalMessage: () => "updated proposal",
    buildAiMatchProposalKeyboard: () => ({ inline_keyboard: [[{ text: "[ ] M001", callback_data: "match_toggle|REQ1|0" }]] }),
    answerCallbackQuery: (id, text) => sentMessages.push({ callbackId: id, text }),
  });

  context.handleAiMatchProposalCallback(
    { id: "cb1", from: { id: "42" }, message: { chat: { id: "-100123" }, message_id: 7 } },
    { action: "match_toggle", matchId: "REQ1", value: "0" },
    true
  );

  assert.deepEqual(saved, [nextProposal]);
  assert.deepEqual(JSON.parse(JSON.stringify(sentMessages)), [
    { callbackId: "cb1", text: "Đã cập nhật lựa chọn." },
    {
      chatId: "-100123",
      messageId: 7,
      text: "updated proposal",
      replyMarkup: { inline_keyboard: [[{ text: "[ ] M001", callback_data: "match_toggle|REQ1|0" }]] },
    },
  ]);
});

test("AI match proposal callback submits selected matches to sheet", () => {
  const appended = [];
  const deleted = [];
  const selected = [{ matchId: "M001", homeTeam: "Vietnam", awayTeam: "Indonesia", kickoffUtc: "2026-06-11T05:00:00.000Z", stage: "GROUP", status: "SCHEDULED" }];
  const { context, sentMessages } = loadMainContext({
    getAiMatchProposal: () => ({ requestId: "REQ1", matches: selected, selected: [true] }),
    getSelectedAiMatchProposalMatches: () => selected,
    appendMatches: (matches, actor) => {
      appended.push({ matches, actor });
      return { created: ["M001"], skipped: [] };
    },
    deleteAiMatchProposal: (requestId) => deleted.push(requestId),
    answerCallbackQuery: (id, text) => sentMessages.push({ callbackId: id, text }),
  });

  context.handleAiMatchProposalCallback(
    { id: "cb1", from: { id: "42" }, message: { chat: { id: "-100123" }, message_id: 7 } },
    { action: "match_submit", matchId: "REQ1", value: "" },
    true
  );

  assert.deepEqual(appended, [{ matches: selected, actor: "42" }]);
  assert.deepEqual(deleted, ["REQ1"]);
  assert.deepEqual(JSON.parse(JSON.stringify(sentMessages)), [
    { callbackId: "cb1", text: "Đã ghi trận đã chọn." },
    {
      chatId: "-100123",
      messageId: 7,
      text: "Đã ghi các trận được chọn vào Matches.\nCreated: M001\nSkipped existing: none",
    },
  ]);
});

test("ai_result sends an AI result proposal to the command chat", () => {
  const updates = [];
  const { context, sentMessages } = loadMainContext({
    updateMatch: (matchId, patch, actor, action) => updates.push({ matchId, patch, actor, action }),
  });

  context.adminAiResult("-100123", "42", ["M001"]);

  assert.match(updates[0].patch.adminResultPromptedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(JSON.parse(JSON.stringify(updates)), [
    { matchId: "M001", patch: { adminResultPromptedAt: updates[0].patch.adminResultPromptedAt }, actor: "42", action: "PROMPT_RESULT" },
    { matchId: "M001", patch: { resultProposalStatus: "FINISHED" }, actor: "42", action: "STORE_RESULT_PROPOSAL" },
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(sentMessages)), [
    {
      chatId: "-100123",
      text: "AI đề xuất kết quả",
      replyMarkup: { inline_keyboard: [[{ text: "Y", callback_data: "result_confirm|M001|" }]] },
    },
  ]);
});

test("ai_result resends stored result proposal before calling AI again", () => {
  let aiCalled = false;
  const updates = [];
  const { context, sentMessages } = loadMainContext({
    getMatchById: () => ({
      matchId: "M001",
      status: "LOCKED",
      resultProposalStatus: "FINISHED",
      resultProposalHomeScore: "1",
      resultProposalAwayScore: "1",
      resultProposalSummary: "Hòa sau 90 phút",
      resultProposalSources: "https://www.uefa.com/m001\nhttps://apnews.com/m001",
      resultProposalDecision: "",
    }),
    generateAiResultProposal: () => {
      aiCalled = true;
      throw new Error("AI should not be called");
    },
    formatAdminResultProposal: (match, proposal) => "stored " + match.matchId + " " + proposal.homeScore + "-" + proposal.awayScore,
    buildResultProposalConfirmKeyboard: (matchId, proposal) => ({
      inline_keyboard: [[{ text: "Y", callback_data: "result_confirm|" + matchId + "|" }]],
      proposal,
    }),
    updateMatch: (matchId, patch, actor, action) => updates.push({ matchId, patch, actor, action }),
  });

  context.adminAiResult("-100123", "42", ["M001"]);

  assert.equal(aiCalled, false);
  assert.match(updates[0].patch.adminResultPromptedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(updates.map((update) => update.action), ["PROMPT_RESULT"]);
  assert.deepEqual(JSON.parse(JSON.stringify(sentMessages)), [
    {
      chatId: "-100123",
      text: "stored M001 1-1",
      replyMarkup: {
        inline_keyboard: [[{ text: "Y", callback_data: "result_confirm|M001|" }]],
        proposal: {
          status: "FINISHED",
          homeScore: "1",
          awayScore: "1",
          summary: "Hòa sau 90 phút",
          sources: ["https://www.uefa.com/m001", "https://apnews.com/m001"],
        },
      },
    },
  ]);
});

test("reset_latest_settle clears score rows and unlocks latest settled match", () => {
  const updates = [];
  const removals = [];
  const { context, sentMessages } = loadMainContext({
    getMatches: () => [
      {
        matchId: "OLD",
        status: "SETTLED",
        settledAt: "2026-06-12T21:00:00.000Z",
      },
      {
        matchId: "NEW",
        status: "SETTLED",
        settledAt: "2026-06-14T21:00:00.000Z",
      },
    ],
    getLatestSettledMatch: (matches) => matches[1],
    buildResetSettlementPatch: () => ({ status: "LOCKED", handicapOutcome: "", settledAt: "" }),
    removeScoreRowsForMatch: (matchId, actor) => {
      removals.push({ matchId, actor });
      return 7;
    },
    updateMatch: (matchId, patch, actor, action) => updates.push({ matchId, patch, actor, action }),
  });

  context.adminResetLatestSettle("-100123", "42");

  assert.deepEqual(removals, [{ matchId: "NEW", actor: "42" }]);
  assert.deepEqual(updates, [
    {
      matchId: "NEW",
      patch: { status: "LOCKED", handicapOutcome: "", settledAt: "" },
      actor: "42",
      action: "RESET_LATEST_SETTLE",
    },
  ]);
  assert.deepEqual(sentMessages, [
    {
      chatId: "-100123",
      text: "Đã reset settle trận NEW: xóa 7 score rows, đưa trận về LOCKED. Leaderboard đã tính lại từ Scores còn lại.",
    },
  ]);
});

test("resettle flips wrong auto_default picks and re-settles a negative-handicap match without recap", () => {
  const upserts = [];
  const removals = [];
  const appended = [];
  const audits = [];
  const match = {
    matchId: "NEG",
    status: "SETTLED",
    finalHomeScore: 0,
    finalAwayScore: 3,
    handicapGoals: -2.5,
    favoriteSide: "HOME",
    handicapSide: "HOME",
  };
  const { context, sentMessages, recapMessages } = loadMainContext({
    getMatchById: () => match,
    getPicks: () => [
      { matchId: "NEG", telegramUserId: "101", selection: "HOME", source: "auto_default" },
      { matchId: "NEG", telegramUserId: "102", selection: "AWAY", source: "manual" },
    ],
    SOURCE: { AUTO_DEFAULT: "auto_default" },
    getDefaultPickSelection: () => "AWAY",
    getPlayerByTelegramId: (id) => ({ telegramUserId: id }),
    upsertPick: (m, player, selection, star, source, actor) =>
      upserts.push({ matchId: m.matchId, telegramUserId: player.telegramUserId, selection, star, source, actor }),
    buildResetSettlementPatch: () => ({ status: "LOCKED", handicapOutcome: "", settledAt: "" }),
    removeScoreRowsForMatch: (matchId, actor) => {
      removals.push({ matchId, actor });
      return 2;
    },
    appendScoreRows: (rows) => appended.push(rows),
    scorePick: () => ({ correct: true, points: 1, outcome: "AWAY" }),
    getHandicapOutcome: () => "AWAY",
    parseBoolean: (value) => Boolean(value),
    updateMatch: () => {},
    audit: (action, entityType, entityId, actor, before, after) =>
      audits.push({ action, entityType, entityId, actor, before, after }),
  });

  context.adminResettle("-100123", "42", ["NEG"]);

  assert.deepEqual(removals, [{ matchId: "NEG", actor: "42" }]);
  assert.deepEqual(upserts, [
    { matchId: "NEG", telegramUserId: "101", selection: "AWAY", star: false, source: "auto_default", actor: "42" },
  ]);
  assert.equal(appended.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(audits)), [
    {
      action: "RESETTLE_MATCH",
      entityType: "Match",
      entityId: "NEG",
      actor: "42",
      before: { handicapGoals: -2.5, removedScoreRows: 2 },
      after: { flippedCount: 1, flippedPicks: [{ telegramUserId: "101", from: "HOME", to: "AWAY" }] },
    },
  ]);
  assert.deepEqual(recapMessages, []);
  assert.deepEqual(sentMessages, [
    { chatId: "-100123", text: "Đã resettle NEG: sửa 1 pick mặc định, tính lại điểm. Leaderboard đã đồng bộ." },
  ]);
});

test("resettle refuses matches with non-negative handicap", () => {
  const removals = [];
  const { context, sentMessages } = loadMainContext({
    getMatchById: () => ({
      matchId: "POS",
      status: "SETTLED",
      finalHomeScore: 2,
      finalAwayScore: 0,
      handicapGoals: 0.5,
    }),
    removeScoreRowsForMatch: (matchId, actor) => {
      removals.push({ matchId, actor });
      return 0;
    },
  });

  context.adminResettle("-100123", "42", ["POS"]);

  assert.deepEqual(removals, []);
  assert.deepEqual(sentMessages, [
    {
      chatId: "-100123",
      text: "/resettle chỉ dùng cho trận có handicapGoals < 0 (sửa pick mặc định kèo trên bị sai).",
    },
  ]);
});

test("set_pick records an admin pick for a specific side", () => {
  const upserts = [];
  const match = { matchId: "M001", status: "LOCKED", favoriteSide: "HOME", handicapSide: "HOME", handicapGoals: -0.5 };
  const { context, sentMessages } = loadMainContext({
    STATUSES: { LOCKED: "LOCKED", SETTLED: "SETTLED" },
    SOURCE: { TELEGRAM: "telegram", AUTO_DEFAULT: "auto_default", ADMIN: "admin" },
    getMatchById: () => match,
    getPlayerByTelegramId: (id) => ({ telegramUserId: id, displayName: "Yen" }),
    isValidSelection: (value) => value === "HOME" || value === "AWAY",
    getDefaultPickSelection: () => "AWAY",
    sideDisplayName: (m, side) => side,
    upsertPick: (m, player, selection, star, source, actor) => {
      upserts.push({ matchId: m.matchId, telegramUserId: player.telegramUserId, selection, star, source, actor });
      return { selection };
    },
  });

  context.adminSetPick("-100123", "42", ["M001", "7924581715", "away"]);

  assert.deepEqual(upserts, [
    { matchId: "M001", telegramUserId: "7924581715", selection: "AWAY", star: false, source: "admin", actor: "42" },
  ]);
  assert.deepEqual(sentMessages, [
    { chatId: "-100123", text: "Đã đặt pick cho Yen ở M001: AWAY." },
  ]);
});

test("set_pick with DEFAULT applies the auto-default selection", () => {
  const upserts = [];
  const match = { matchId: "M001", status: "LOCKED", favoriteSide: "HOME", handicapSide: "HOME", handicapGoals: 0 };
  const { context, sentMessages } = loadMainContext({
    STATUSES: { LOCKED: "LOCKED", SETTLED: "SETTLED" },
    SOURCE: { TELEGRAM: "telegram", AUTO_DEFAULT: "auto_default", ADMIN: "admin" },
    getMatchById: () => match,
    getPlayerByTelegramId: (id) => ({ telegramUserId: id, displayName: "Yen" }),
    isValidSelection: (value) => value === "HOME" || value === "AWAY",
    getDefaultPickSelection: () => "HOME",
    sideDisplayName: (m, side) => side,
    upsertPick: (m, player, selection, star, source, actor) => {
      upserts.push({ matchId: m.matchId, telegramUserId: player.telegramUserId, selection, star, source, actor });
      return { selection };
    },
  });

  context.adminSetPick("-100123", "42", ["M001", "7924581715", "default"]);

  assert.deepEqual(upserts, [
    { matchId: "M001", telegramUserId: "7924581715", selection: "HOME", star: false, source: "auto_default", actor: "42" },
  ]);
  assert.deepEqual(sentMessages, [
    { chatId: "-100123", text: "Đã đặt pick cho Yen ở M001: HOME (mặc định)." },
  ]);
});

test("set_pick refuses a settled match", () => {
  const upserts = [];
  const { context, sentMessages } = loadMainContext({
    STATUSES: { LOCKED: "LOCKED", SETTLED: "SETTLED" },
    SOURCE: { TELEGRAM: "telegram", AUTO_DEFAULT: "auto_default", ADMIN: "admin" },
    getMatchById: () => ({ matchId: "M001", status: "SETTLED" }),
    getPlayerByTelegramId: (id) => ({ telegramUserId: id, displayName: "Yen" }),
    isValidSelection: (value) => value === "HOME" || value === "AWAY",
    upsertPick: (...args) => upserts.push(args),
  });

  context.adminSetPick("-100123", "42", ["M001", "7924581715", "HOME"]);

  assert.deepEqual(upserts, []);
  assert.deepEqual(sentMessages, [
    { chatId: "-100123", text: "Trận đã settle. Dùng /resettle hoặc /reset_latest_settle trước khi sửa pick." },
  ]);
});

test("set_pick reports an unknown player", () => {
  const upserts = [];
  const { context, sentMessages } = loadMainContext({
    STATUSES: { LOCKED: "LOCKED", SETTLED: "SETTLED" },
    getMatchById: () => ({ matchId: "M001", status: "LOCKED" }),
    getPlayerByTelegramId: () => null,
    upsertPick: (...args) => upserts.push(args),
  });

  context.adminSetPick("-100123", "42", ["M001", "999", "HOME"]);

  assert.deepEqual(upserts, []);
  assert.deepEqual(sentMessages, [
    { chatId: "-100123", text: "Không tìm thấy player 999." },
  ]);
});

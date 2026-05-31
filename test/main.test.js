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
      getMatchById: (matchId) => ({ matchId, status: "LOCKED" }),
      getPicks: () => [{ matchId: "M001", displayName: "An", selection: "HOME" }],
      generateAiLockMessage: () => "AI tổng hợp pick",
      generateAiResultProposal: () => ({ status: "FINISHED", homeScore: 2, awayScore: 1 }),
      formatLockedPickSummary: () => "📋 Pick đã chốt\n- Argentina: An",
      formatAdminResultProposal: () => "AI đề xuất kết quả",
      buildFallbackLockMessage: () => "Fallback tổng hợp pick",
      buildResultProposalPatch: () => ({ resultProposalStatus: "FINISHED" }),
      buildResultProposalConfirmKeyboard: () => ({ inline_keyboard: [[{ text: "Y", callback_data: "result_confirm|M001|" }]] }),
      updateMatch: () => {},
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

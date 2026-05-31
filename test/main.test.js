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
  assert.deepEqual(sentMessages, [
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
  assert.deepEqual(sentMessages, [
    {
      chatId: "-100123",
      text: "AI đề xuất kết quả",
      replyMarkup: { inline_keyboard: [[{ text: "Y", callback_data: "result_confirm|M001|" }]] },
    },
  ]);
});

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
      formatLockedPickSummary: () => "📋 Pick đã chốt\n- Argentina: An",
      buildFallbackLockMessage: () => "Fallback tổng hợp pick",
      sendRecapToConfiguredChats: (text) => recapMessages.push(text),
      sendTelegramMessage: (chatId, text) => sentMessages.push({ chatId, text }),
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

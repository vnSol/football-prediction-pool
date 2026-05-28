var PROPERTY_KEYS = Object.freeze({
  TELEGRAM_BOT_TOKEN: "TELEGRAM_BOT_TOKEN",
  SPREADSHEET_ID: "SPREADSHEET_ID",
  ADMIN_CHAT_IDS: "ADMIN_CHAT_IDS",
  OPENAI_API_KEY: "OPENAI_API_KEY",
  OPENAI_MODEL: "OPENAI_MODEL",
  RECAP_CHAT_ID: "RECAP_CHAT_ID",
});

function getScriptProperty(key, required) {
  var value = PropertiesService.getScriptProperties().getProperty(key);
  if (required && !value) {
    throw new Error("Missing Script Property: " + key);
  }
  return value || "";
}

function getAdminChatIds() {
  return getScriptProperty(PROPERTY_KEYS.ADMIN_CHAT_IDS, true)
    .split(",")
    .map(function (id) {
      return id.trim();
    })
    .filter(Boolean);
}

function getRecapChatIds(players) {
  var recapChatId = getScriptProperty(PROPERTY_KEYS.RECAP_CHAT_ID, false);
  if (recapChatId) return [recapChatId];
  return [];
}

function isAdminChatId(chatId) {
  var id = String(chatId);
  return getAdminChatIds().indexOf(id) !== -1;
}

function telegramApi(method, payload) {
  var token = getScriptProperty(PROPERTY_KEYS.TELEGRAM_BOT_TOKEN, true);
  var response = UrlFetchApp.fetch("https://api.telegram.org/bot" + token + "/" + method, {
    method: "post",
    contentType: "application/json",
    muteHttpExceptions: true,
    payload: JSON.stringify(payload || {}),
  });
  var body = JSON.parse(response.getContentText() || "{}");
  if (!body.ok) throw new Error("Telegram API error: " + response.getContentText());
  return body.result;
}

function sendTelegramMessage(chatId, text, replyMarkup) {
  var payload = {
    chat_id: String(chatId),
    text: text,
    disable_web_page_preview: true,
  };
  if (replyMarkup) payload.reply_markup = replyMarkup;
  return telegramApi("sendMessage", payload);
}

function answerCallbackQuery(callbackQueryId, text) {
  return telegramApi("answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    text: text || "",
    show_alert: false,
  });
}

function sendToAdmins(text) {
  getAdminChatIds().forEach(function (chatId) {
    sendTelegramMessage(chatId, text);
  });
}

function sendToPlayers(players, text, replyMarkup) {
  players.forEach(function (player) {
    if (player.active !== false) sendTelegramMessage(player.telegramUserId, text, replyMarkup);
  });
}

function sendPickOpenMessage(match) {
  var text = [
    "⚽ Mở pick: " + sideDisplayName(match, SELECTIONS.HOME) + " vs " + sideDisplayName(match, SELECTIONS.AWAY),
    "Giờ đá: " + formatKickoffTime(match.kickoffUtc),
    "Kèo: " + formatHandicap(match),
    "Có thể đổi lựa chọn đến khi trận bắt đầu.",
  ].join("\n");
  sendToPlayers(getActivePlayers(), text, buildPickKeyboard(match));
}

function sendOddsUpdateMessage(match, previousHandicap) {
  var text = [
    "📢 Cập nhật kèo: " + sideDisplayName(match, SELECTIONS.HOME) + " vs " + sideDisplayName(match, SELECTIONS.AWAY),
    "Kèo cũ: " + previousHandicap,
    "Kèo mới: " + formatHandicap(match),
    "Có thể đổi lựa chọn đến khi trận bắt đầu.",
  ].join("\n");
  sendToPlayers(getActivePlayers(), text, buildPickKeyboard(match));
}

function sendMissingPickReminders(match) {
  var pickedIds = {};
  getPicks()
    .filter(function (pick) {
      return String(pick.matchId) === String(match.matchId);
    })
    .forEach(function (pick) {
      pickedIds[String(pick.telegramUserId)] = true;
    });

  getActivePlayers().forEach(function (player) {
    if (!pickedIds[String(player.telegramUserId)]) {
      sendTelegramMessage(
        player.telegramUserId,
        "⏰ Còn khoảng 30 phút: " + sideDisplayName(match, SELECTIONS.HOME) + " vs " + sideDisplayName(match, SELECTIONS.AWAY) + ". Chưa pick thì hệ thống sẽ auto chọn đội kèo trên lúc bóng lăn.",
        buildPickKeyboard(match)
      );
    }
  });
}

function sendRecapToConfiguredChats(text) {
  var chatIds = getRecapChatIds(getActivePlayers());
  if (chatIds.length === 0) {
    console.log("RECAP_CHAT_ID is not set; skipping recap broadcast.");
    return;
  }
  chatIds.forEach(function (chatId) {
    sendTelegramMessage(chatId, text);
  });
}

function setTelegramWebhook(webAppUrl) {
  return telegramApi("setWebhook", {
    url: webAppUrl,
  });
}

function getOpenAiModel() {
  return getScriptProperty(PROPERTY_KEYS.OPENAI_MODEL, false) || "gpt-5-mini";
}

function hasOpenAiConfig() {
  return Boolean(getScriptProperty(PROPERTY_KEYS.OPENAI_API_KEY, false));
}

function generateAiText(prompt, options) {
  if (!hasOpenAiConfig()) throw new Error("Missing OPENAI_API_KEY");

  var payload = {
    model: getOpenAiModel(),
    input: prompt,
  };

  if (options && options.webSearch) {
    payload.tools = [{ type: "web_search", search_context_size: "low" }];
    payload.tool_choice = "auto";
  }

  var response = UrlFetchApp.fetch("https://api.openai.com/v1/responses", {
    method: "post",
    contentType: "application/json",
    headers: {
      Authorization: "Bearer " + getScriptProperty(PROPERTY_KEYS.OPENAI_API_KEY, true),
    },
    muteHttpExceptions: true,
    payload: JSON.stringify(payload),
  });

  var status = response.getResponseCode();
  var text = response.getContentText();
  if (status < 200 || status >= 300) {
    throw new Error("OpenAI API error " + status + ": " + text);
  }

  var body = JSON.parse(text || "{}");
  var outputText = extractOpenAiOutputText(body);
  if (!outputText) throw new Error("OpenAI API returned empty output");
  return outputText.trim();
}

function extractOpenAiOutputText(body) {
  if (body.output_text) return body.output_text;
  var parts = [];
  (body.output || []).forEach(function (item) {
    (item.content || []).forEach(function (content) {
      if (content.type === "output_text" && content.text) parts.push(content.text);
    });
  });
  return parts.join("\n").trim();
}

function generateAiLockMessage(match, picks) {
  var facts = buildLockedBettingFacts({ match: match, picks: picks });
  return generateAiText(buildLockDramaPrompt({ facts: facts }), { webSearch: false });
}

function generateAiMatchRecap(match, score, scoreChanges, leaderboard) {
  return generateAiText(
    buildAiRecapPrompt({
      match: match,
      score: score,
      scoreChanges: scoreChanges,
      leaderboard: leaderboard,
    }),
    { webSearch: true }
  );
}

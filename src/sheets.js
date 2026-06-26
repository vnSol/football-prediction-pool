var SHEETS = Object.freeze({
  PLAYERS: "Players",
  MATCHES: "Matches",
  PICKS: "Picks",
  SCORES: "Scores",
  AUDIT: "AuditLog",
  CONFIG: "Config",
});

var SHEET_HEADERS = {};
var AI_MATCH_PROPOSAL_CACHE_PREFIX = "ai_match_proposal:";

SHEET_HEADERS[SHEETS.PLAYERS] = ["telegramUserId", "displayName", "active", "isAdmin", "remind30Disabled", "remind120Disabled"];
SHEET_HEADERS[SHEETS.MATCHES] = [
  "matchId",
  "homeTeam",
  "awayTeam",
  "kickoffUtc",
  "stage",
  "status",
  "favoriteSide",
  "handicapSide",
  "handicapGoals",
  "oddsLockedAt",
  "oddsAlertedAt",
  "openedAt",
  "reminded30At",
  "lockedAt",
  "adminResultPromptedAt",
  "finalHomeScore",
  "finalAwayScore",
  "finalSummary",
  "handicapOutcome",
  "settledAt",
  "resultProposalStatus",
  "resultProposalHomeScore",
  "resultProposalAwayScore",
  "resultProposalSummary",
  "resultProposalSources",
  "resultProposalAt",
  "resultProposalDecision",
  "resultProposalDecidedAt",
  "oddsProposalFavoriteSide",
  "oddsProposalHandicapGoals",
  "oddsProposalSummary",
  "oddsProposalSources",
  "oddsProposalAt",
  "oddsProposalDecision",
  "oddsProposalDecidedAt",
  "reminded120At",
];
SHEET_HEADERS[SHEETS.PICKS] = [
  "matchId",
  "telegramUserId",
  "displayName",
  "selection",
  "star",
  "source",
  "createdAt",
  "updatedAt",
];
SHEET_HEADERS[SHEETS.SCORES] = [
  "matchId",
  "telegramUserId",
  "displayName",
  "selection",
  "star",
  "correct",
  "points",
  "outcome",
  "settledAt",
];
SHEET_HEADERS[SHEETS.AUDIT] = ["timestamp", "actor", "action", "entityType", "entityId", "beforeJson", "afterJson"];
SHEET_HEADERS[SHEETS.CONFIG] = ["key", "value"];

function getSpreadsheet() {
  var spreadsheetId = getScriptProperty(PROPERTY_KEYS.SPREADSHEET_ID, false);
  if (spreadsheetId) return SpreadsheetApp.openById(spreadsheetId);
  return SpreadsheetApp.getActiveSpreadsheet();
}

function setupWorkbook() {
  Object.keys(SHEET_HEADERS).forEach(function (sheetName) {
    var sheet = ensureSheet(sheetName);
    ensureHeaders(sheet, SHEET_HEADERS[sheetName]);
    protectSheet(sheet);
  });
}

function getSheetNames() {
  return Object.keys(SHEET_HEADERS);
}

function ensureSheet(sheetName) {
  var spreadsheet = getSpreadsheet();
  return spreadsheet.getSheetByName(sheetName) || spreadsheet.insertSheet(sheetName);
}

function ensureHeaders(sheet, headers) {
  var range = sheet.getRange(1, 1, 1, headers.length);
  var existing = range.getValues()[0];
  var needsWrite = headers.some(function (header, index) {
    return existing[index] !== header;
  });
  if (needsWrite) {
    range.setValues([headers]);
    sheet.setFrozenRows(1);
  }
}

function protectSheet(sheet) {
  var protections = sheet.getProtections(SpreadsheetApp.ProtectionType.SHEET);
  var protection = protections.length ? protections[0] : sheet.protect();
  protection.setDescription("Locked for Telegram bot writes only");
  try {
    protection.removeEditors(protection.getEditors());
  } catch (error) {
    // Apps Script owner cannot always remove all inherited editors.
  }
  if (protection.canDomainEdit()) protection.setDomainEdit(false);
}

function readObjects(sheetName) {
  var sheet = ensureSheet(sheetName);
  ensureHeaders(sheet, SHEET_HEADERS[sheetName]);
  var values = sheet.getDataRange().getValues();
  if (values.length <= 1) return [];
  var headers = values[0];
  return values.slice(1).filter(rowHasData).map(function (row) {
    var object = {};
    headers.forEach(function (header, index) {
      object[header] = normalizeCell(row[index]);
    });
    return object;
  });
}

function normalizeCell(value) {
  if (value instanceof Date) return value.toISOString();
  return value;
}

function rowHasData(row) {
  return row.some(function (value) {
    return value !== "" && value !== null;
  });
}

function appendObject(sheetName, object) {
  var sheet = ensureSheet(sheetName);
  var headers = SHEET_HEADERS[sheetName];
  ensureHeaders(sheet, headers);
  sheet.appendRow(headers.map(function (header) {
    return object[header] == null ? "" : object[header];
  }));
}

function appendAuditedObject(sheetName, object, actor, action, entityType, entityId) {
  appendObject(sheetName, object);
  audit(action, entityType, entityId, actor, null, object);
}

function resetSheetData(sheetName, actor) {
  if (!SHEET_HEADERS[sheetName]) return { ok: false, reason: "unknown_sheet" };
  var sheet = ensureSheet(sheetName);
  ensureHeaders(sheet, SHEET_HEADERS[sheetName]);
  var lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    sheet.getRange(2, 1, lastRow - 1, sheet.getMaxColumns()).clearContent();
  }
  protectSheet(sheet);
  audit("RESET_SHEET", "Sheet", sheetName, actor, null, { sheetName: sheetName, clearedRows: Math.max(0, lastRow - 1) });
  return { ok: true, clearedRows: Math.max(0, lastRow - 1) };
}

function appendMatches(matches, actor) {
  var created = [];
  var skipped = [];
  matches.forEach(function (match) {
    var result = addMatch(match, actor);
    if (result.ok) created.push(match.matchId);
    else skipped.push(match.matchId);
  });
  return { created: created, skipped: skipped };
}

function saveAiMatchProposal(proposal) {
  CacheService.getScriptCache().put(AI_MATCH_PROPOSAL_CACHE_PREFIX + proposal.requestId, JSON.stringify(proposal), 21600);
}

function getAiMatchProposal(requestId) {
  var text = CacheService.getScriptCache().get(AI_MATCH_PROPOSAL_CACHE_PREFIX + requestId);
  return text ? JSON.parse(text) : null;
}

function deleteAiMatchProposal(requestId) {
  CacheService.getScriptCache().remove(AI_MATCH_PROPOSAL_CACHE_PREFIX + requestId);
}

function upsertDryRunMatches(matches, actor) {
  var created = [];
  var refreshed = [];
  var skipped = [];
  matches.forEach(function (match) {
    var result = addMatch(match, actor);
    if (result.ok) {
      created.push(match.matchId);
      return;
    }
    if (isDryRunMatch(result.match)) {
      updateMatch(match.matchId, buildDryRunMatchRefreshPatch(match), actor, "REFRESH_DRYRUN_MATCH");
      refreshed.push(match.matchId);
      return;
    }
    skipped.push(match.matchId);
  });
  return { created: created, refreshed: refreshed, skipped: skipped };
}

function updateObject(sheetName, matcher, patch) {
  var sheet = ensureSheet(sheetName);
  var headers = SHEET_HEADERS[sheetName];
  var values = sheet.getDataRange().getValues();
  for (var rowIndex = 1; rowIndex < values.length; rowIndex += 1) {
    var current = rowToObject(headers, values[rowIndex]);
    if (matcher(current)) {
      var next = Object.assign({}, current, patch);
      sheet.getRange(rowIndex + 1, 1, 1, headers.length).setValues([
        headers.map(function (header) {
          return next[header] == null ? "" : next[header];
        }),
      ]);
      return { before: current, after: next };
    }
  }
  return null;
}

function rowToObject(headers, row) {
  var object = {};
  headers.forEach(function (header, index) {
    object[header] = normalizeCell(row[index]);
  });
  return object;
}

function getActivePlayers() {
  return readObjects(SHEETS.PLAYERS).filter(function (player) {
    return player.active !== false && String(player.active).toLowerCase() !== "false";
  });
}

function getPlayerByTelegramId(telegramUserId) {
  return readObjects(SHEETS.PLAYERS).find(function (player) {
    return String(player.telegramUserId) === String(telegramUserId);
  });
}

function addPlayer(player, actor) {
  var existing = getPlayerByTelegramId(player.telegramUserId);
  if (existing) return { ok: false, reason: "exists", player: existing };
  appendAuditedObject(SHEETS.PLAYERS, player, actor, "ADD_PLAYER", "Player", player.telegramUserId);
  return { ok: true, player: player };
}

function upsertJoinedPlayer(user, actor) {
  var player = {
    telegramUserId: String(user.id),
    displayName: formatTelegramDisplayName(user),
    active: true,
    isAdmin: false,
  };
  var existing = getPlayerByTelegramId(player.telegramUserId);
  if (!existing) {
    appendAuditedObject(SHEETS.PLAYERS, player, actor, "JOIN_PLAYER", "Player", player.telegramUserId);
    return { created: true, reactivated: false, player: player };
  }
  if (existing.active === false || String(existing.active).toLowerCase() === "false") {
    var result = setPlayerActive(player.telegramUserId, true, actor);
    return { created: false, reactivated: true, player: result.after };
  }
  return { created: false, reactivated: false, player: existing };
}

function setPlayerActive(telegramUserId, active, actor) {
  var result = updateObject(
    SHEETS.PLAYERS,
    function (player) {
      return String(player.telegramUserId) === String(telegramUserId);
    },
    { active: Boolean(active) }
  );
  if (result) audit("SET_PLAYER_ACTIVE", "Player", telegramUserId, actor, result.before, result.after);
  return result;
}

function setPlayerReminderPrefs(telegramUserId, patch, actor) {
  var result = updateObject(
    SHEETS.PLAYERS,
    function (player) {
      return String(player.telegramUserId) === String(telegramUserId);
    },
    patch
  );
  if (result) audit("SET_PLAYER_REMINDER_PREFS", "Player", telegramUserId, actor, result.before, result.after);
  return result;
}

function getMatches() {
  return readObjects(SHEETS.MATCHES);
}

function getMatchById(matchId) {
  return getMatches().find(function (match) {
    return String(match.matchId) === String(matchId);
  });
}

function addMatch(match, actor) {
  var existing = getMatchById(match.matchId);
  if (existing) return { ok: false, reason: "exists", match: existing };
  appendAuditedObject(SHEETS.MATCHES, match, actor, "ADD_MATCH", "Match", match.matchId);
  return { ok: true, match: match };
}

function updateMatch(matchId, patch, actor, action) {
  var result = updateObject(
    SHEETS.MATCHES,
    function (match) {
      return String(match.matchId) === String(matchId);
    },
    patch
  );
  if (result) audit(action || "UPDATE_MATCH", "Match", matchId, actor || "system", result.before, result.after);
  return result;
}

function getPicks() {
  return readObjects(SHEETS.PICKS).map(function (pick) {
    pick.star = parseBoolean(pick.star);
    return pick;
  });
}

function getPick(matchId, telegramUserId) {
  return getPicks().find(function (pick) {
    return String(pick.matchId) === String(matchId) && String(pick.telegramUserId) === String(telegramUserId);
  });
}

function upsertPick(match, player, selection, star, source, actor) {
  var now = new Date().toISOString();
  var existing = getPick(match.matchId, player.telegramUserId);
  var payload = {
    matchId: match.matchId,
    telegramUserId: String(player.telegramUserId),
    displayName: player.displayName,
    selection: selection,
    star: Boolean(star),
    source: source,
    updatedAt: now,
  };

  if (existing) {
    var result = updateObject(
      SHEETS.PICKS,
      function (pick) {
        return String(pick.matchId) === String(match.matchId) && String(pick.telegramUserId) === String(player.telegramUserId);
      },
      payload
    );
    audit("CHANGE_PICK", "Pick", match.matchId + ":" + player.telegramUserId, actor, result.before, result.after);
    return result.after;
  }

  payload.createdAt = now;
  appendObject(SHEETS.PICKS, payload);
  audit("CREATE_PICK", "Pick", match.matchId + ":" + player.telegramUserId, actor, null, payload);
  return payload;
}

function appendScoreRows(rows) {
  rows.forEach(function (row) {
    appendObject(SHEETS.SCORES, row);
  });
}

function removeScoreRowsForMatch(matchId, actor) {
  var sheet = ensureSheet(SHEETS.SCORES);
  var headers = SHEET_HEADERS[SHEETS.SCORES];
  ensureHeaders(sheet, headers);
  var values = sheet.getDataRange().getValues();
  var matchIdColumn = headers.indexOf("matchId");
  var removed = 0;

  for (var rowIndex = 1; rowIndex < values.length; rowIndex += 1) {
    if (String(values[rowIndex][matchIdColumn]) !== String(matchId)) continue;
    sheet.getRange(rowIndex + 1, 1, 1, sheet.getMaxColumns()).clearContent();
    removed += 1;
  }

  if (removed > 0) {
    audit("REMOVE_SCORE_ROWS_FOR_MATCH", "Match", matchId, actor || "system", { matchId: matchId }, { removedRows: removed });
  }
  return removed;
}

function getLeaderboard() {
  var playersById = {};
  readObjects(SHEETS.PLAYERS).forEach(function (player) {
    playersById[String(player.telegramUserId)] = player;
  });

  var totals = {};
  readObjects(SHEETS.SCORES).forEach(function (score) {
    var id = String(score.telegramUserId);
    if (!totals[id]) {
      totals[id] = {
        telegramUserId: id,
        displayName: score.displayName || (playersById[id] && playersById[id].displayName) || id,
        points: 0,
      };
    }
    totals[id].points += Number(score.points || 0);
  });

  return sortLeaderboard(
    Object.keys(totals).map(function (id) {
      return totals[id];
    })
  );
}

function audit(action, entityType, entityId, actor, before, after) {
  appendObject(SHEETS.AUDIT, {
    timestamp: new Date().toISOString(),
    actor: actor || "system",
    action: action,
    entityType: entityType,
    entityId: entityId,
    beforeJson: before ? JSON.stringify(before) : "",
    afterJson: after ? JSON.stringify(after) : "",
  });
}

function withScriptLock(callback) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    return callback();
  } finally {
    lock.releaseLock();
  }
}

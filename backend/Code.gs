/**
 * Rescue ranking backend for Google Apps Script.
 *
 * Sheet schema ("rankings"):
 *   A: username
 *   B: totalRescued
 *   C: updatedAt
 */

const SHEET_NAME = 'rankings';
const USERNAME_MAX_LEN = 20;
const MAX_RESCUED_PER_SUBMIT = 5;
const MAX_RANK_LIMIT = 50;
const CHALLENGE_TTL_SEC = 300;
const SUBMIT_COOLDOWN_SEC = 15;

function getSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.appendRow(['username', 'totalRescued', 'updatedAt']);
  }
  return sh;
}

function getCache_() {
  return CacheService.getScriptCache();
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function logError_(scope, err) {
  const detail = err && err.stack ? err.stack : String(err);
  console.error(`[${scope}] ${detail}`);
}

function normalizeUsername_(value) {
  return String(value || '')
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, USERNAME_MAX_LEN);
}

function validateUsername_(value) {
  const username = normalizeUsername_(value);
  if (!username) return { ok: false, error: 'username required' };
  if (/^[=+\-@]/.test(username)) {
    return { ok: false, error: 'username has invalid leading character' };
  }
  return { ok: true, username };
}

function parseRankLimit_(value) {
  const parsed = parseInt(value, 10);
  if (!Number.isFinite(parsed)) return 20;
  return Math.max(1, Math.min(MAX_RANK_LIMIT, parsed));
}

function parseRescuedCount_(value) {
  const rescuedCount = parseInt(value, 10);
  if (!Number.isFinite(rescuedCount)) {
    return { ok: false, error: 'rescuedCount must be a number' };
  }
  if (rescuedCount < 1 || rescuedCount > MAX_RESCUED_PER_SUBMIT) {
    return { ok: false, error: `rescuedCount must be between 1 and ${MAX_RESCUED_PER_SUBMIT}` };
  }
  return { ok: true, rescuedCount };
}

function challengeKey_(token) {
  return `submit-token:${token}`;
}

function cooldownKey_(username) {
  return `submit-cooldown:${username}`;
}

function createChallenge_(username) {
  const token = Utilities.getUuid().replace(/-/g, '');
  getCache_().put(challengeKey_(token), username, CHALLENGE_TTL_SEC);
  return { ok: true, token, expiresInSec: CHALLENGE_TTL_SEC };
}

function consumeChallenge_(username, token) {
  const cache = getCache_();
  const key = challengeKey_(token);
  const cachedUsername = cache.get(key);
  if (cachedUsername !== username) return false;
  cache.remove(key);
  return true;
}

function checkAndSetCooldown_(username) {
  const cache = getCache_();
  const key = cooldownKey_(username);
  if (cache.get(key)) return false;
  cache.put(key, '1', SUBMIT_COOLDOWN_SEC);
  return true;
}

/**
 * GET:
 *   ?action=rank&limit=20
 *   ?action=challenge&username=player
 */
function doGet(e) {
  try {
    const params = (e && e.parameter) || {};
    const action = params.action || 'rank';

    if (action === 'rank') {
      return json_(getRank_(parseRankLimit_(params.limit)));
    }

    if (action === 'challenge') {
      const usernameCheck = validateUsername_(params.username);
      if (!usernameCheck.ok) return json_(usernameCheck);
      return json_(createChallenge_(usernameCheck.username));
    }

    return json_({ ok: false, error: 'unknown action' });
  } catch (err) {
    logError_('doGet', err);
    return json_({ ok: false, error: 'request failed' });
  }
}

/**
 * POST body(JSON):
 *   { username: string, rescuedCount: number, token: string }
 */
function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const usernameCheck = validateUsername_(body.username);
    if (!usernameCheck.ok) return json_(usernameCheck);

    const rescuedCheck = parseRescuedCount_(body.rescuedCount);
    if (!rescuedCheck.ok) return json_(rescuedCheck);

    const token = String(body.token || '').trim();
    if (!/^[a-f0-9]{32}$/i.test(token)) {
      return json_({ ok: false, error: 'invalid token' });
    }

    const lock = LockService.getScriptLock();
    lock.waitLock(5000);
    try {
      if (!consumeChallenge_(usernameCheck.username, token)) {
        return json_({ ok: false, error: 'invalid or expired token' });
      }
      if (!checkAndSetCooldown_(usernameCheck.username)) {
        return json_({ ok: false, error: 'too many requests' });
      }

      const result = addRescue_(usernameCheck.username, rescuedCheck.rescuedCount);
      return json_({ ok: true, ...result });
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    logError_('doPost', err);
    return json_({ ok: false, error: 'request failed' });
  }
}

function addRescue_(username, rescuedCount) {
  const sh = getSheet_();
  const last = sh.getLastRow();
  const values = last >= 2 ? sh.getRange(2, 1, last - 1, 2).getValues() : [];
  const now = new Date().toISOString();

  let foundRow = -1;
  for (let i = 0; i < values.length; i++) {
    if (String(values[i][0]) === username) {
      foundRow = i + 2;
      break;
    }
  }

  let totalRescued;
  if (foundRow > 0) {
    const prev = parseInt(sh.getRange(foundRow, 2).getValue(), 10) || 0;
    totalRescued = prev + rescuedCount;
    sh.getRange(foundRow, 2).setValue(totalRescued);
    sh.getRange(foundRow, 3).setValue(now);
  } else {
    totalRescued = rescuedCount;
    sh.appendRow([username, totalRescued, now]);
  }

  return { username, totalRescued };
}

function getRank_(limit) {
  const sh = getSheet_();
  const last = sh.getLastRow();
  if (last < 2) return { ok: true, rank: [] };

  const values = sh.getRange(2, 1, last - 1, 2).getValues();
  const rank = values
    .map(r => ({ username: String(r[0]), totalRescued: parseInt(r[1], 10) || 0 }))
    .filter(r => r.username)
    .sort((a, b) => b.totalRescued - a.totalRescued)
    .slice(0, parseRankLimit_(limit));

  return { ok: true, rank };
}

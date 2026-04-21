/**
 * 늑구를 구조해줘! — 랭킹 백엔드 (Google Apps Script)
 *
 * 배포 방법은 backend/README.md 참고.
 *
 * 시트 구조(시트 이름: "rankings")
 *   A열: username (string)
 *   B열: totalRescued (number)   — 누적 구조한 늑구 수
 *   C열: updatedAt (ISO string)
 */

const SHEET_NAME = 'rankings';

function getSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.appendRow(['username', 'totalRescued', 'updatedAt']);
  }
  return sh;
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * GET: 랭킹 조회
 *   ?action=rank&limit=20
 */
function doGet(e) {
  try {
    const params = (e && e.parameter) || {};
    const action = params.action || 'rank';
    if (action === 'rank') return json_(getRank_(parseInt(params.limit, 10) || 20));
    return json_({ ok: false, error: 'unknown action' });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

/**
 * POST: 구조 기록 추가 (누적 합산)
 *   body(JSON): { username: string, rescuedCount: number }
 */
function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const username = String(body.username || '').trim().slice(0, 20);
    const rescuedCount = Math.max(0, Math.min(999, parseInt(body.rescuedCount, 10) || 0));

    if (!username) return json_({ ok: false, error: 'username required' });
    if (rescuedCount <= 0) return json_({ ok: false, error: 'rescuedCount must be > 0' });

    const result = addRescue_(username, rescuedCount);
    return json_({ ok: true, ...result });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

function addRescue_(username, rescuedCount) {
  const sh = getSheet_();
  const lock = LockService.getScriptLock();
  lock.waitLock(5000);
  try {
    const last = sh.getLastRow();
    const values = last >= 2 ? sh.getRange(2, 1, last - 1, 2).getValues() : [];
    const now = new Date().toISOString();

    let foundRow = -1;
    for (let i = 0; i < values.length; i++) {
      if (String(values[i][0]) === username) { foundRow = i + 2; break; }
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
  } finally {
    lock.releaseLock();
  }
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
    .slice(0, limit);
  return { ok: true, rank };
}

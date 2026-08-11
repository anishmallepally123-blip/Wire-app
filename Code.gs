/**
 * Wire Manifest — Google Sheets backend
 *
 * Setup
 *  1. Open your team's Google Sheet.
 *  2. Extensions ▸ Apps Script. Delete whatever is there and paste this in.
 *  3. Deploy ▸ New deployment ▸ type: Web app.
 *       Execute as: Me
 *       Who has access: Anyone
 *  4. Authorize, then copy the /exec URL.
 *  5. Paste that URL into the app's "Connect a sheet" box.
 *
 * Re-deploy as a NEW version any time you edit this file, or the app keeps
 * hitting the old code.
 */

var SHEET_NAME = 'Wires';
var HEADERS = ['id', 'name', 'type', 'gauge', 'fromDevice', 'fromPort',
               'toDevice', 'toPort', 'notes', 'nameOverride', 'updatedAt'];

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var req = JSON.parse(e.postData.contents);
    if (req.action === 'upsert') upsert(req.wire);
    else if (req.action === 'bulk') (req.wires || []).forEach(upsert);
    else if (req.action === 'delete') remove(req.id);
    else if (req.action !== 'list') throw new Error('Unknown action: ' + req.action);
    return json({ ok: true, wires: readAll() });
  } catch (err) {
    return json({ ok: false, error: String(err.message || err) });
  } finally {
    lock.releaseLock();
  }
}

/* Lets you open the /exec URL in a browser to eyeball the data. */
function doGet() {
  return json({ ok: true, wires: readAll() });
}

/* ------------------------------------------------------------------ */

function sheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS])
      .setFontWeight('bold').setBackground('#161B22').setFontColor('#FFFFFF');
    sh.setFrozenRows(1);
  }
  return sh;
}

function readAll() {
  var sh = sheet();
  var last = sh.getLastRow();
  if (last < 2) return [];
  var rows = sh.getRange(2, 1, last - 1, HEADERS.length).getValues();
  return rows
    .filter(function (r) { return r[0]; })
    .map(function (r) {
      var o = {};
      HEADERS.forEach(function (h, i) { o[h] = r[i] === '' ? '' : String(r[i]); });
      return o;
    });
}

function rowFor(id) {
  var sh = sheet();
  var last = sh.getLastRow();
  if (last < 2) return -1;
  var ids = sh.getRange(2, 1, last - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(id)) return i + 2;
  }
  return -1;
}

function upsert(w) {
  if (!w || !w.id) throw new Error('Wire is missing an id');
  w.updatedAt = new Date().toISOString();
  var values = HEADERS.map(function (h) { return w[h] == null ? '' : w[h]; });
  var sh = sheet();
  var row = rowFor(w.id);
  if (row === -1) row = sh.getLastRow() + 1;
  sh.getRange(row, 1, 1, HEADERS.length).setValues([values]);
}

function remove(id) {
  var row = rowFor(id);
  if (row !== -1) sheet().deleteRow(row);
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

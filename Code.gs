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
var LAYOUT_NAME = 'Layout';
var LAYOUT_HEADERS = ['id', 'kind', 'compId', 'label', 'x', 'y', 'w', 'h', 'updatedAt'];
var HEADERS = ['id', 'name', 'type', 'gauge', 'fromDevice', 'fromPort',
               'toDevice', 'toPort', 'notes', 'nameOverride', 'updatedAt', 'stage'];

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var req = JSON.parse(e.postData.contents);
    if (req.action === 'layout') return json({ ok: true, wires: readAll(), layout: readLayout() });
    if (req.action === 'saveLayout') {
      writeLayout(req.layout);
      return json({ ok: true, wires: readAll(), layout: req.layout });
    }
    if (req.action === 'upsert') upsert(req.wire);
    else if (req.action === 'bulk') (req.wires || []).forEach(upsert);
    else if (req.action === 'delete') remove(req.id);
    else if (req.action === 'layoutUpsert') layoutUpsert(req.item);
    else if (req.action === 'layoutDelete') layoutRemove(req.id);
    else if (req.action !== 'list') throw new Error('Unknown action: ' + req.action);
    return json({ ok: true, wires: readAll(), layout: layoutReadAll() });
  } catch (err) {
    return json({ ok: false, error: String(err.message || err) });
  } finally {
    lock.releaseLock();
  }
}

/* Lets you open the /exec URL in a browser to eyeball the data. */
function doGet() {
  return json({ ok: true, wires: readAll(), layout: layoutReadAll() });
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
  } else {
    ensureHeaders(sh);
  }
  return sh;
}

/* Widens the header row when new columns are added, without touching data. */
function ensureHeaders(sh) {
  var width = sh.getLastColumn();
  if (width >= HEADERS.length) return;
  sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS])
    .setFontWeight('bold').setBackground('#161B22').setFontColor('#FFFFFF');
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
  if (w.stage !== 'schematic') w.stage = 'physical';
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

/* ---- drivetrain layout, parked as JSON in a Layout tab ---- */

function layoutSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName('Layout');
  if (!sh) {
    sh = ss.insertSheet('Layout');
    sh.getRange(1, 1).setValue('Drivetrain layout — edited from the app, do not hand-edit');
    sh.setColumnWidth(1, 520);
  }
  return sh;
}

function readLayout() {
  var raw = layoutSheet().getRange(2, 1).getValue();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (err) {
    return null;
  }
}

function writeLayout(layout) {
  layoutSheet().getRange(2, 1).setValue(JSON.stringify(layout || {}));
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}


/* ---------------------- belly pan layout ----------------------------
   One row per item, so two people dragging different components at the
   same time don't overwrite each other. */

function layoutSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(LAYOUT_NAME);
  if (!sh) {
    sh = ss.insertSheet(LAYOUT_NAME);
    sh.getRange(1, 1, 1, LAYOUT_HEADERS.length).setValues([LAYOUT_HEADERS])
      .setFontWeight('bold').setBackground('#161B22').setFontColor('#FFFFFF');
    sh.setFrozenRows(1);
  }
  return sh;
}

function layoutReadAll() {
  var sh = layoutSheet();
  var last = sh.getLastRow();
  if (last < 2) return [];
  var rows = sh.getRange(2, 1, last - 1, LAYOUT_HEADERS.length).getValues();
  var out = [];
  for (var i = 0; i < rows.length; i++) {
    if (!rows[i][0]) continue;
    out.push({
      id: String(rows[i][0]),
      kind: String(rows[i][1]),
      compId: String(rows[i][2]),
      label: String(rows[i][3]),
      x: Number(rows[i][4]) || 0,
      y: Number(rows[i][5]) || 0,
      w: Number(rows[i][6]) || 1,
      h: Number(rows[i][7]) || 1
    });
  }
  return out;
}

function layoutRowFor(id) {
  var sh = layoutSheet();
  var last = sh.getLastRow();
  if (last < 2) return -1;
  var ids = sh.getRange(2, 1, last - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(id)) return i + 2;
  }
  return -1;
}

function layoutUpsert(it) {
  if (!it || !it.id) throw new Error('Layout item is missing an id');
  it.updatedAt = new Date().toISOString();
  var values = LAYOUT_HEADERS.map(function (h) { return it[h] == null ? '' : it[h]; });
  var sh = layoutSheet();
  var row = layoutRowFor(it.id);
  if (row === -1) row = sh.getLastRow() + 1;
  sh.getRange(row, 1, 1, LAYOUT_HEADERS.length).setValues([values]);
}

function layoutRemove(id) {
  var row = layoutRowFor(id);
  if (row !== -1) layoutSheet().deleteRow(row);
}

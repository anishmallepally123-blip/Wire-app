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
 * After ANY edit here: Deploy ▸ Manage deployments ▸ pencil ▸ Version: New
 * version ▸ Deploy. Saving alone does not change what the /exec URL serves.
 */

var SHEET_NAME = 'Wires';
var HEADERS = ['id', 'name', 'type', 'gauge', 'fromDevice', 'fromPort',
               'toDevice', 'toPort', 'notes', 'nameOverride', 'updatedAt', 'stage'];

var LAYOUT_NAME = 'Layout';
var LAYOUT_HEADERS = ['id', 'kind', 'partId', 'compId', 'label', 'x', 'y', 'w', 'h', 'rot', 'updatedAt'];

/* Bump this whenever you paste in a new copy. Open the /exec URL in a browser
   and check the version number to confirm the deployment actually updated. */
var VERSION = 7;

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var req = JSON.parse(e.postData.contents);
    var action = req.action;

    if (action === 'upsert') upsert(req.wire);
    else if (action === 'bulk') (req.wires || []).forEach(upsert);
    else if (action === 'delete') remove(req.id);
    else if (action === 'layoutSave') layoutReplace(req.layout);
    else if (action === 'layoutUpsert') layoutUpsert(req.item);
    else if (action === 'layoutDelete') layoutRemove(req.id);
    else if (action !== 'list') throw new Error('Unknown action: ' + action);

    return json({ ok: true, version: VERSION, wires: readAll(), layout: layoutReadAll() });
  } catch (err) {
    return json({ ok: false, error: String(err.message || err) });
  } finally {
    lock.releaseLock();
  }
}

/* Open the /exec URL in a browser to see what's actually deployed. */
function doGet() {
  try {
    return json({ ok: true, version: VERSION, wires: readAll(), layout: layoutReadAll() });
  } catch (err) {
    return json({ ok: false, error: String(err.message || err) });
  }
}

/* ------------------------------ wires ------------------------------ */

function sheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    writeHeaders(sh, HEADERS);
  } else if (sh.getLastColumn() < HEADERS.length) {
    writeHeaders(sh, HEADERS);
  }
  return sh;
}

function readAll() {
  return readRows(sheet(), HEADERS, function (r) {
    var o = {};
    for (var i = 0; i < HEADERS.length; i++) {
      o[HEADERS[i]] = r[i] === '' ? '' : String(r[i]);
    }
    return o;
  });
}

function upsert(w) {
  if (!w || !w.id) throw new Error('Wire is missing an id');
  w.updatedAt = new Date().toISOString();
  if (w.stage !== 'schematic') w.stage = 'physical';
  writeRow(sheet(), HEADERS, w);
}

function remove(id) {
  var sh = sheet();
  var row = rowFor(sh, id);
  if (row !== -1) sh.deleteRow(row);
}

/* ------------------------- belly pan layout -------------------------
   One row per item, so two people dragging different components at the
   same time don't overwrite each other. */

function layoutSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(LAYOUT_NAME);
  if (!sh) {
    sh = ss.insertSheet(LAYOUT_NAME);
    writeHeaders(sh, LAYOUT_HEADERS);
  } else if (sh.getLastColumn() < LAYOUT_HEADERS.length) {
    /* Column meanings changed between versions. Rewriting the header over
       existing rows would silently shift every value one column left, so
       clear the data instead and let the pan be re-placed. */
    var last = sh.getLastRow();
    if (last > 1) sh.getRange(2, 1, last - 1, sh.getLastColumn()).clearContent();
    writeHeaders(sh, LAYOUT_HEADERS);
  }
  return sh;
}

function layoutReadAll() {
  return readRows(layoutSheet(), LAYOUT_HEADERS, function (r) {
    return {
      id: String(r[0]),
      kind: String(r[1]),
      partId: String(r[2]),
      compId: String(r[3]),
      label: String(r[4]),
      x: Number(r[5]) || 0,
      y: Number(r[6]) || 0,
      w: Number(r[7]) || 1,
      h: Number(r[8]) || 1,
      rot: Number(r[9]) || 0
    };
  });
}

function layoutUpsert(it) {
  if (!it || !it.id) throw new Error('Layout item is missing an id');
  it.updatedAt = new Date().toISOString();
  writeRow(layoutSheet(), LAYOUT_HEADERS, it);
}

/* Replaces the whole Layout tab in one go — what the app sends when you
   hit Done editing. Rewrites in a single setValues call rather than row by
   row, so a 30-item pan is one write, not thirty. */
function layoutReplace(items) {
  var sh = layoutSheet();
  var last = sh.getLastRow();
  if (last > 1) sh.getRange(2, 1, last - 1, LAYOUT_HEADERS.length).clearContent();
  if (!items || !items.length) return;
  var now = new Date().toISOString();
  var rows = items.map(function (it) {
    it.updatedAt = now;
    return LAYOUT_HEADERS.map(function (h) { return it[h] == null ? '' : it[h]; });
  });
  sh.getRange(2, 1, rows.length, LAYOUT_HEADERS.length).setValues(rows);
}

function layoutRemove(id) {
  var sh = layoutSheet();
  var row = rowFor(sh, id);
  if (row !== -1) sh.deleteRow(row);
}

/* ------------------------- shared helpers -------------------------- */

function writeHeaders(sh, headers) {
  sh.getRange(1, 1, 1, headers.length).setValues([headers])
    .setFontWeight('bold').setBackground('#161B22').setFontColor('#FFFFFF');
  sh.setFrozenRows(1);
}

function readRows(sh, headers, mapper) {
  var last = sh.getLastRow();
  if (last < 2) return [];
  var rows = sh.getRange(2, 1, last - 1, headers.length).getValues();
  var out = [];
  for (var i = 0; i < rows.length; i++) {
    if (rows[i][0] === '' || rows[i][0] == null) continue;
    out.push(mapper(rows[i]));
  }
  return out;
}

function rowFor(sh, id) {
  var last = sh.getLastRow();
  if (last < 2) return -1;
  var ids = sh.getRange(2, 1, last - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(id)) return i + 2;
  }
  return -1;
}

function writeRow(sh, headers, obj) {
  var values = headers.map(function (h) {
    return obj[h] == null ? '' : obj[h];
  });
  var row = rowFor(sh, obj.id);
  if (row === -1) row = Math.max(sh.getLastRow() + 1, 2);
  sh.getRange(row, 1, 1, headers.length).setValues([values]);
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

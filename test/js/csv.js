// Minimalistischer, abhängigkeitsfreier CSV-Parser/-Serializer (RFC4180-artig).
'use strict';

// Trennzeichen aus der Kopfzeile ermitteln, statt Komma UND Semikolon gleichzeitig als
// Trennzeichen zu behandeln. Deutsches Excel exportiert CSVs meist mit Semikolon, weil das
// Komma dort als Dezimaltrennzeichen dient (z. B. "16,50"). Würde man beides gleichzeitig als
// Trennzeichen werten, würden solche Zahlen mitten im Feld zerschnitten und alle Spalten
// dahinter verrutschen.
function detectDelimiter(text) {
  const firstLine = text.split(/\r\n|\n|\r/, 1)[0] || '';
  const semi = (firstLine.match(/;/g) || []).length;
  const comma = (firstLine.match(/,/g) || []).length;
  return semi > comma ? ';' : ',';
}

function parseCSV(text) {
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  const delim = detectDelimiter(text);
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === delim) { row.push(field); field = ''; }
      else if (c === '\r') { /* skip */ }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else field += c;
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter(r => !(r.length === 1 && r[0].trim() === ''));
}

function normHeader(h) {
  return h.trim().toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]/g, '');
}

function rowsToObjects(rows) {
  if (!rows.length) return [];
  const headers = rows[0].map(h => h.trim());
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (r.length === 1 && r[0].trim() === '') continue;
    const obj = {};
    headers.forEach((h, idx) => { obj[h] = (r[idx] !== undefined ? r[idx] : '').trim(); });
    out.push(obj);
  }
  return out;
}

function toCSVField(v) {
  v = (v === undefined || v === null) ? '' : String(v);
  if (/[",\n\r]/.test(v)) return '"' + v.replace(/"/g, '""') + '"';
  return v;
}

function objectsToCSV(objs, headers) {
  const lines = [headers.join(',')];
  for (const o of objs) lines.push(headers.map(h => toCSVField(o[h])).join(','));
  return lines.join('\r\n');
}

'use strict';

/* ------------------------------------------------------------------ *
 *  Speicher-Layer (localStorage -- keine Datenbank, keine Server)     *
 * ------------------------------------------------------------------ */

const LS_KEYS = {
  products: 'ws_products',
  surcharges: 'ws_surcharges',
  overridePct: 'ws_override_pct',
  cart: 'ws_cart',
  catMeta: 'ws_cat_meta',
  buyer: 'ws_buyer',
  dataSource: 'ws_data_source',
  githubConfig: 'ws_github_config'
};

const CATEGORY_LIST = [
  'Trockenware',
  'Drogerie Kosmetik Nonfood',
  'Getränke Alkohol',
  'Getränke Alkoholfrei',
  'Feinkost Veganer Ersatz'
];

const CATEGORY_CSV_HEADERS = ['ArtikelNr', 'Bezeichnung', 'Hersteller', 'Land', 'Qualitaet', 'Gebinde', 'PreisInklMwst', 'EntMwst', 'MwstSatz'];
const SURCHARGE_HEADERS = ['Art', 'Prozentsatz'];

// Diese Pfade liefern die für ALLE Besucher gemeinsame Datenbasis: beim Laden ruft
// die Seite diese Dateien vom Hosting ab (fetch), damit jedes Mitglied auf jedem
// Gerät denselben Katalog sieht -- ohne Datenbank, nur über statische Dateien.
// Um eine Kategorie für alle sichtbar zu aktualisieren: im Admin-Bereich "Exportieren"
// klicken und die heruntergeladene Datei im Hosting unter genau diesem Pfad ersetzen.
const CATEGORY_FILES = {
  'Trockenware': 'data/trockenware.csv',
  'Drogerie Kosmetik Nonfood': 'data/drogerie-kosmetik-nonfood.csv',
  'Getränke Alkohol': 'data/getraenke-alkohol.csv',
  'Getränke Alkoholfrei': 'data/getraenke-alkoholfrei.csv',
  'Feinkost Veganer Ersatz': 'data/feinkost-veganer-ersatz.csv'
};
const SURCHARGE_FILE = 'data/zuschlaege.csv';

const HEADER_MAP = {
  kategorie: 'kat',
  artikelnr: 'art', artnr: 'art',
  bezeichnung: 'bez',
  hersteller: 'hers',
  land: 'land',
  qualitaet: 'qual',
  gebinde: 'geb',
  // "PreisInklMwst"-Format (eigene Vorlage, Original-Bodan-Bestelllisten)
  preisinklmwst: 'preis', preis: 'preis',
  entmwst: 'mwstb', mwstbetrag: 'mwstb',
  mwstsatz: 'mwst', mwst: 'mwst', entspricht: 'mwst', satz: 'mwst',
  // "EK VPE"-Format (Export aus Bodans aktuellem Bestellsystem, "bodan2-*.csv") --
  // EK = Einkaufspreis, laut Konvention netto (exkl. MwSt.); VPE = Preis je Gebinde/Verpackungseinheit.
  ekvpe: 'eknetto', ekladeneinheit: 'ekeinheitnetto', uvp: 'uvp', ean: 'ean'
};

function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch (e) { return fallback; }
}
function saveJSON(key, val) { localStorage.setItem(key, JSON.stringify(val)); }

function slugify(s) {
  return String(s).toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

const state = {
  products: [],
  surcharges: [],
  overridePct: null,
  cart: {},        // { artNr: qty }
  buyer: { name: '', adresse: '', bank: '' },
  catMeta: {},      // { kategorie: { updated, source } }
  dataSource: {},   // { kategorie: 'server' | 'local' | 'default' }
  view: 'auth',     // auth | shop | checkout | admin
  category: '',
  query: '',
  sort: 'name-asc',
  page: 1,
  pageSize: 60,
  cartOpen: false
};

function init() {
  state.products = loadJSON(LS_KEYS.products, null) || (window.DEFAULT_PRODUCTS || []);
  state.surcharges = loadJSON(LS_KEYS.surcharges, null) || (window.DEFAULT_SURCHARGES || []);
  state.overridePct = loadJSON(LS_KEYS.overridePct, null);
  state.cart = loadJSON(LS_KEYS.cart, {});
  state.buyer = loadJSON(LS_KEYS.buyer, { name: '', adresse: '', bank: '' });
  state.catMeta = loadJSON(LS_KEYS.catMeta, {});
  state.dataSource = loadJSON(LS_KEYS.dataSource, {});

  if (!loadJSON(LS_KEYS.products, null)) {
    saveJSON(LS_KEYS.products, state.products);
    saveJSON(LS_KEYS.surcharges, state.surcharges);
  }

  state.view = isLoggedIn() ? 'shop' : 'auth';

  renderCategoryOptions();
  renderAll();
  bindGlobalEvents();

  // Sofortiger Start mit lokalen/eingebetteten Daten (schnell, funktioniert offline);
  // danach im Hintergrund die gemeinsamen Server-Dateien laden, falls online gehostet.
  loadServerCatalog();
}

/* ------------------------------------------------------------------ *
 *  Gemeinsame Datenbasis vom Hosting laden (fetch statt localStorage) *
 * ------------------------------------------------------------------ */

async function fetchCsvFile(url) {
  const res = await fetch(url + '?t=' + Date.now(), { cache: 'no-store' });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.text();
}

function parseCategoryRows(text, kat) {
  const objs = rowsToObjects(parseCSV(text));
  return objs.map(mapCsvRow).map(r => productFromMappedRow(kat, r)).filter(p => p.art && p.bez);
}

function parseSurchargeRows(text) {
  const objs = rowsToObjects(parseCSV(text));
  return objs.map(o => {
    const art = o.Art ?? o.art ?? Object.values(o)[0];
    let pctRaw = o.Prozentsatz ?? o.pct ?? Object.values(o)[1];
    pctRaw = String(pctRaw).replace('%', '').replace(',', '.').trim();
    return { art, pct: parseFloat(pctRaw) || 0 };
  }).filter(s => s.art);
}

// force=false (Normalfall, z. B. beim Seitenaufruf): eine lokale Admin-Vorschau (dataSource
// 'local') bleibt unangetastet, damit ein hochgeladener Entwurf nicht bei jedem Neuladen
// durch die (ältere) Server-Version überschrieben wird.
// force=true (Button "Vom Server neu laden"): holt für ALLE Kategorien den Server-Stand,
// verwirft also auch eine noch nicht veröffentlichte lokale Vorschau bewusst.
async function loadServerCatalog(force) {
  const katsToFetch = CATEGORY_LIST.filter(kat => force || state.dataSource[kat] !== 'local');

  const results = await Promise.allSettled(
    katsToFetch.map(kat => fetchCsvFile(CATEGORY_FILES[kat]).then(text => ({ kat, items: parseCategoryRows(text, kat) })))
  );

  let anyOk = false;
  const byKat = {};
  results.forEach((r, i) => {
    const kat = katsToFetch[i];
    if (r.status === 'fulfilled' && r.value.items.length) {
      byKat[kat] = r.value.items;
      state.dataSource[kat] = 'server';
      anyOk = true;
    } else if (!state.dataSource[kat]) {
      state.dataSource[kat] = 'default';
    }
  });

  if (anyOk) {
    const others = state.products.filter(p => !byKat[p.kat]);
    state.products = Object.values(byKat).flat().concat(others);
    saveJSON(LS_KEYS.products, state.products);
  }

  if (force || state.dataSource.__surcharges !== 'local') {
    try {
      const text = await fetchCsvFile(SURCHARGE_FILE);
      const surcharges = parseSurchargeRows(text);
      if (surcharges.length) {
        state.surcharges = surcharges;
        state.dataSource.__surcharges = 'server';
        saveJSON(LS_KEYS.surcharges, state.surcharges);
      }
    } catch (e) { /* offline oder kein Hosting erreichbar -- lokale/Standard-Zuschläge bleiben aktiv */ }
  }

  saveJSON(LS_KEYS.dataSource, state.dataSource);
  renderCategoryOptions();
  renderAll();
}

/* ------------------------------------------------------------------ *
 *  Preisberechnung: Mehrwertsteuer & Prozentzuschläge                 *
 * ------------------------------------------------------------------ */

function totalSurchargePct() {
  if (state.overridePct !== null && state.overridePct !== undefined && state.overridePct !== '') {
    return Number(state.overridePct);
  }
  // "Gesamt"-Zeilen sind abgeleitete Anzeige-/Altlast-Werte, keine eigenen Zuschlagsposten --
  // nie mitsummieren, sonst würde der Gesamtwert doppelt gezählt.
  return state.surcharges
    .filter(s => !/gesamt/i.test(s.art))
    .reduce((sum, s) => sum + (Number(s.pct) || 0), 0);
}

function verkaufspreis(preisInklMwst, pct) {
  return preisInklMwst * (1 + pct / 100);
}

function money(v) {
  return (Number(v) || 0).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
}
function pctFmt(v) {
  return (Number(v) || 0).toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 2 }) + '%';
}

function parseGrundpreis(geb, verkPreis) {
  if (!geb) return null;
  // Multiplikator ("6x250g") ist optional, damit auch Einzelpackungen ohne "x"
  // (z. B. "480g", "7kg") einen Grundpreis bekommen.
  const m = String(geb).match(/^\s*(?:(\d+)\s*[x×]\s*)?([\d.,]+)\s*(kg|g|l|ml|stk|stück|st)\s*$/i);
  if (!m) return null;
  const stueck = m[1] ? parseInt(m[1], 10) : 1;
  const menge = parseFloat(m[2].replace(',', '.'));
  let einheit = m[3].toLowerCase();
  if (!stueck || !menge) return null;
  let gesamtMenge = stueck * menge;
  // Gramm/Milliliter auf die übliche Grundpreis-Einheit kg/l umrechnen, statt z. B.
  // "0,02 € je g" anzuzeigen, wenn eigentlich "16,62 € je kg" gemeint ist.
  if (einheit === 'g') { gesamtMenge /= 1000; einheit = 'kg'; }
  else if (einheit === 'ml') { gesamtMenge /= 1000; einheit = 'l'; }
  else if (einheit === 'stück' || einheit === 'st') { einheit = 'stk'; }
  const proEinheit = verkPreis / gesamtMenge;
  return { proEinheit, gesamtMenge, einheit };
}

/* ------------------------------------------------------------------ *
 *  Ableitungen: Kategorien, Filter, Sortierung, Paging                *
 * ------------------------------------------------------------------ */

function categories() {
  const set = new Set(state.products.map(p => p.kat).filter(Boolean));
  return Array.from(set).sort((a, b) => a.localeCompare(b, 'de'));
}

function filteredProducts() {
  const q = state.query.trim().toLowerCase();
  let list = state.products;
  if (state.category) list = list.filter(p => p.kat === state.category);
  if (q) {
    list = list.filter(p =>
      (p.bez && p.bez.toLowerCase().includes(q)) ||
      (p.hers && p.hers.toLowerCase().includes(q)) ||
      (p.art && String(p.art).toLowerCase().includes(q))
    );
  }
  const pct = totalSurchargePct();
  const sorted = list.slice().sort((a, b) => {
    switch (state.sort) {
      case 'name-asc': return (a.bez || '').localeCompare(b.bez || '', 'de');
      case 'name-desc': return (b.bez || '').localeCompare(a.bez || '', 'de');
      case 'price-asc': return verkaufspreis(a.preis, pct) - verkaufspreis(b.preis, pct);
      case 'price-desc': return verkaufspreis(b.preis, pct) - verkaufspreis(a.preis, pct);
      default: return 0;
    }
  });
  return sorted;
}

/* ------------------------------------------------------------------ *
 *  Rendering                                                          *
 * ------------------------------------------------------------------ */

function escapeHtml(s) {
  return String(s === undefined || s === null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderCategoryOptions() {
  const sel = document.getElementById('categorySelect');
  const cats = categories();
  sel.innerHTML = '<option value="">Alle Kategorien</option>' +
    cats.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)} (${state.products.filter(p => p.kat === c).length})</option>`).join('');
  sel.value = state.category;
}

function renderAll() {
  const loggedIn = isLoggedIn();

  document.getElementById('view-auth').classList.toggle('hidden', state.view !== 'auth');
  document.getElementById('view-shop').classList.toggle('hidden', state.view !== 'shop');
  document.getElementById('view-checkout').classList.toggle('hidden', state.view !== 'checkout');
  document.getElementById('view-admin').classList.toggle('hidden', state.view !== 'admin');
  document.body.classList.toggle('bg-market', state.view === 'shop');

  document.querySelectorAll('.auth-only').forEach(el => el.classList.toggle('hidden', !loggedIn));
  if (loggedIn) {
    const s = getSession();
    document.getElementById('whoami').textContent = s ? ('👋 ' + s.username) : '';
  }
  updateTopbarHeightVar();

  if (state.view === 'shop') renderShop();
  if (state.view === 'checkout') renderCheckout();
  if (state.view === 'admin') { renderAdminGate(); if (isAdminUnlocked()) renderAdmin(); }

  renderCartBadge();
  renderCartDrawer();
  document.getElementById('cartDrawer').classList.toggle('open', state.cartOpen && loggedIn);
  document.getElementById('cartOverlay').classList.toggle('open', state.cartOpen && loggedIn);
}

function renderShop() {
  const pct = totalSurchargePct();
  const list = filteredProducts();
  const totalPages = Math.max(1, Math.ceil(list.length / state.pageSize));
  if (state.page > totalPages) state.page = totalPages;
  const start = (state.page - 1) * state.pageSize;
  const pageItems = list.slice(start, start + state.pageSize);

  document.getElementById('resultCount').textContent =
    list.length === 0 ? 'Keine Artikel gefunden' : `${list.length} Artikel`;

  const grid = document.getElementById('productGrid');
  grid.innerHTML = pageItems.map(p => productCard(p, pct)).join('');

  const pager = document.getElementById('pager');
  pager.innerHTML = `
    <button ${state.page <= 1 ? 'disabled' : ''} data-page="prev">&larr; Zurück</button>
    <span>Seite ${state.page} / ${totalPages}</span>
    <button ${state.page >= totalPages ? 'disabled' : ''} data-page="next">Weiter &rarr;</button>
  `;
}

function productCard(p, pct) {
  const vk = verkaufspreis(p.preis, pct);
  const qty = state.cart[p.art] || 0;
  const gp = parseGrundpreis(p.geb, vk);
  return `
  <div class="card" data-art="${escapeHtml(p.art)}">
    <div class="card-cat">${escapeHtml(p.kat)}</div>
    <h3 class="card-title">${escapeHtml(p.bez)}</h3>
    <div class="card-artnr">Art.-Nr. ${escapeHtml(p.art)}</div>
    <div class="card-meta">${escapeHtml(p.hers || '')}${p.land ? ' · ' + escapeHtml(p.land) : ''}</div>
    <div class="card-meta">${escapeHtml(p.qual || '')}</div>
    <div class="card-geb">${escapeHtml(p.geb || '')}</div>
    <div class="card-price">
      <span class="vk">${money(vk)}</span>
      <span class="unit">/ Gebinde</span>
    </div>
    ${gp ? `<div class="card-grundpreis">${money(gp.proEinheit)} je ${gp.einheit}</div>` : ''}
    <details class="card-details">
      <summary>Preisdetails</summary>
      <div class="pd-row pd-total"><span>Gesamtpreis</span><span>${money(vk)}</span></div>
      <div class="pd-row pd-sub"><span>davon MwSt. (${pctFmt(p.mwst)})</span><span>${money(p.mwstb)}</span></div>
    </details>
    <div class="card-cart">
      <button class="qty-btn" data-act="dec">−</button>
      <input class="qty-input" type="number" min="0" step="1" value="${qty}" data-act="set">
      <button class="qty-btn" data-act="inc">+</button>
    </div>
  </div>`;
}

function cartEntries() {
  const pct = totalSurchargePct();
  const byArt = new Map(state.products.map(p => [String(p.art), p]));
  const entries = [];
  for (const [art, qty] of Object.entries(state.cart)) {
    if (!qty) continue;
    const p = byArt.get(String(art));
    if (!p) continue;
    const vk = verkaufspreis(p.preis, pct);
    entries.push({ p, qty, vk, sum: vk * qty });
  }
  entries.sort((a, b) => a.p.bez.localeCompare(b.p.bez, 'de'));
  return entries;
}

function renderCartBadge() {
  const count = Object.values(state.cart).reduce((a, b) => a + (Number(b) || 0), 0);
  document.getElementById('cartCount').textContent = count;
}

function renderCartDrawer() {
  const entries = cartEntries();
  const body = document.getElementById('cartItems');
  if (!entries.length) {
    body.innerHTML = '<p class="empty">Warenkorb ist leer.</p>';
  } else {
    body.innerHTML = entries.map(e => `
      <div class="cart-item" data-art="${escapeHtml(e.p.art)}">
        <div class="ci-info">
          <div class="ci-title">${escapeHtml(e.p.bez)}</div>
          <div class="ci-meta">${money(e.vk)} · ${escapeHtml(e.p.geb || '')}</div>
        </div>
        <div class="ci-qty">
          <button class="qty-btn" data-act="dec">−</button>
          <span>${e.qty}</span>
          <button class="qty-btn" data-act="inc">+</button>
        </div>
        <div class="ci-sum">${money(e.sum)}</div>
        <button class="ci-remove" data-act="remove" title="Entfernen">✕</button>
      </div>
    `).join('');
  }
  const totalMwst = entries.reduce((s, e) => s + e.p.mwstb * e.qty, 0);
  const totalVk = entries.reduce((s, e) => s + e.sum, 0);
  document.getElementById('cartSummary').innerHTML = entries.length ? `
    <div class="sum-row"><span>davon MwSt.</span><span>${money(totalMwst)}</span></div>
    <div class="sum-row sum-total"><span>Gesamtsumme</span><span>${money(totalVk)}</span></div>
  ` : '';
}

function renderCheckout() {
  const entries = cartEntries();
  const totalMwst = entries.reduce((s, e) => s + e.p.mwstb * e.qty, 0);
  const totalVk = entries.reduce((s, e) => s + e.sum, 0);

  document.getElementById('checkoutName').value = state.buyer.name || '';
  document.getElementById('checkoutAdresse').value = state.buyer.adresse || '';
  document.getElementById('checkoutBank').value = state.buyer.bank || '';

  const tbody = document.getElementById('checkoutRows');
  if (!entries.length) {
    tbody.innerHTML = `<tr><td colspan="8" class="empty">Warenkorb ist leer.</td></tr>`;
  } else {
    tbody.innerHTML = entries.map((e, i) => `
      <tr>
        <td>${i + 1}</td>
        <td>${escapeHtml(e.p.art)}</td>
        <td>${escapeHtml(e.p.bez)}</td>
        <td>${escapeHtml(e.p.geb || '')}</td>
        <td>${money(e.vk)}</td>
        <td>${pctFmt(e.p.mwst)}</td>
        <td>${e.qty}</td>
        <td>${money(e.sum)}</td>
      </tr>
    `).join('');
  }
  document.getElementById('checkoutTotals').innerHTML = `
    <div class="sum-row"><span>davon MwSt. gesamt</span><span>${money(totalMwst)}</span></div>
    <div class="sum-row sum-total"><span>Gesamt-Bestellbetrag</span><span>${money(totalVk)}</span></div>
  `;
}

/* ---------------------- Admin ---------------------- */

function renderAdminGate() {
  const gate = document.getElementById('adminGate');
  const content = document.getElementById('adminContent');
  const setupBox = document.getElementById('adminSetupBox');
  const loginBox = document.getElementById('adminLoginBox');
  if (isAdminUnlocked()) {
    gate.classList.add('hidden');
    content.classList.remove('hidden');
  } else {
    gate.classList.remove('hidden');
    content.classList.add('hidden');
    if (hasAdminPassword()) {
      setupBox.classList.add('hidden');
      loginBox.classList.remove('hidden');
    } else {
      setupBox.classList.remove('hidden');
      loginBox.classList.add('hidden');
    }
  }
}

function renderAdmin() {
  document.getElementById('statProducts').textContent = state.products.length;
  document.getElementById('statCategories').textContent = categories().length;
  document.getElementById('statUsers').textContent = getUsers().length;
  const times = Object.values(state.catMeta).map(m => m.updated).filter(Boolean);
  document.getElementById('statUpdated').textContent = times.length
    ? new Date(Math.max(...times)).toLocaleString('de-DE') : '–';

  renderGithubSettings();
  renderCategoryCsvList();
  renderSurchargeEditor();
  document.getElementById('overridePctInput').value = state.overridePct === null || state.overridePct === undefined ? '' : state.overridePct;
}

function renderGithubSettings() {
  const cfg = getGithubConfig();
  document.getElementById('ghOwner').value = cfg ? (cfg.owner || '') : '';
  document.getElementById('ghRepo').value = cfg ? (cfg.repo || '') : '';
  document.getElementById('ghBranch').value = cfg ? (cfg.branch || 'main') : '';
  document.getElementById('ghToken').value = '';
  document.getElementById('ghToken').placeholder = cfg && cfg.token ? '•••••••• (gespeichert, zum Ändern neu eingeben)' : 'github_pat_…';
  const status = document.getElementById('githubStatus');
  if (hasGithubConfig()) {
    status.textContent = `✅ Konfiguriert: ${cfg.owner}/${cfg.repo} (Branch ${cfg.branch || 'main'})`;
    status.className = 'cat-csv-source cat-csv-source-server';
  } else {
    status.textContent = 'ℹ️ Noch nicht eingerichtet — „Veröffentlichen"-Buttons sind ausgeblendet.';
    status.className = 'cat-csv-source cat-csv-source-default';
  }
  document.getElementById('publishSurchargesBtn').classList.toggle('hidden', !hasGithubConfig());
}

function renderSurchargeEditor() {
  const src = state.dataSource.__surcharges || 'default';
  document.getElementById('surchargeSource').textContent = DATA_SOURCE_LABEL[src];
  document.getElementById('surchargeSource').className = 'cat-csv-source cat-csv-source-' + src;

  const list = document.getElementById('surchargeList');
  list.innerHTML = state.surcharges.map((s, i) => `
    <div class="sc-edit-row" data-idx="${i}">
      <input type="text" class="sc-name-input" value="${escapeHtml(s.art)}" placeholder="Bezeichnung">
      <div class="sc-pct-wrap"><input type="number" step="0.1" class="sc-pct-input" value="${s.pct}"><span>%</span></div>
      <button class="sc-remove-btn" title="Entfernen">✕</button>
    </div>
  `).join('');
  document.getElementById('computedTotalPct').textContent = pctFmt(totalSurchargePct());
}

const DATA_SOURCE_LABEL = {
  server: '✅ Vom Server geladen',
  local: '⚠️ Nur lokale Vorschau – noch nicht für alle sichtbar!',
  default: 'ℹ️ Bodan-Originaldaten (Server-Datei nicht erreichbar)'
};

function renderCategoryCsvList() {
  const container = document.getElementById('categoryCsvList');
  container.innerHTML = CATEGORY_LIST.map(kat => {
    const count = state.products.filter(p => p.kat === kat).length;
    const meta = state.catMeta[kat];
    const src = state.dataSource[kat] || 'default';
    const updatedStr = meta && meta.updated ? new Date(meta.updated).toLocaleString('de-DE') + ' · ' + escapeHtml(meta.source || '') : '';
    return `
    <div class="cat-csv-row" data-kat="${escapeHtml(kat)}">
      <div class="cat-csv-info">
        <div class="cat-csv-name">${escapeHtml(kat)}</div>
        <div class="cat-csv-meta">${count} Artikel${updatedStr ? ' · ' + updatedStr : ''}</div>
        <div class="cat-csv-source cat-csv-source-${src}">${DATA_SOURCE_LABEL[src]}</div>
        <div class="cat-csv-path">Server-Datei: <code>${escapeHtml(CATEGORY_FILES[kat])}</code></div>
      </div>
      <div class="cat-csv-actions">
        <label class="file-btn btn-small">📤 Hochladen (Vorschau)<input type="file" accept=".csv" class="cat-csv-input" hidden></label>
        <button class="btn-secondary btn-small cat-csv-export">⬇️ Exportieren</button>
        ${hasGithubConfig() ? `<button class="btn-publish btn-small cat-csv-publish">🚀 Veröffentlichen</button>` : ''}
      </div>
    </div>`;
  }).join('');
}

/* ------------------------------------------------------------------ *
 *  CSV Import / Export                                                *
 * ------------------------------------------------------------------ */

function mapCsvRow(o) {
  const rec = {};
  for (const [k, v] of Object.entries(o)) {
    const key = HEADER_MAP[normHeader(k)];
    if (key) rec[key] = v;
  }
  return rec;
}

function hasUsablePrice(r) {
  return (r.preis !== undefined && String(r.preis).trim() !== '') ||
    (r.eknetto !== undefined && String(r.eknetto).trim() !== '');
}

// Baut einen Produkt-Datensatz aus einer gemappten CSV-Zeile. Unterstützt zwei Preisformate:
// "PreisInklMwst" (eigene Vorlage / Original-Bodan-Listen, bereits brutto) und "EK VPE"
// (Bodans aktuelles Bestellsystem, "bodan2-*.csv") -- EK ist laut Konvention netto, MwSt.
// wird dann rechnerisch aufgeschlagen, um auf den Bruttopreis inkl. MwSt. zu kommen.
function productFromMappedRow(kat, r) {
  const mwst = parseFloat(String(r.mwst).replace(',', '.')) || 0;
  let preis, mwstb;
  if (r.preis !== undefined && String(r.preis).trim() !== '') {
    preis = parseFloat(String(r.preis).replace(',', '.')) || 0;
    mwstb = parseFloat(String(r.mwstb).replace(',', '.'));
    if (isNaN(mwstb)) mwstb = preis - preis / (1 + mwst / 100);
  } else if (r.eknetto !== undefined && String(r.eknetto).trim() !== '') {
    const netto = parseFloat(String(r.eknetto).replace(',', '.')) || 0;
    preis = netto * (1 + mwst / 100);
    mwstb = preis - netto;
  } else {
    preis = 0; mwstb = 0;
  }
  return { kat, art: r.art, bez: r.bez, hers: r.hers || '', land: r.land || '', qual: r.qual || '', geb: r.geb || '', preis, mwstb, mwst };
}

function importCategoryCSV(kat, text, filename) {
  const rows = parseCSV(text);
  const objs = rowsToObjects(rows);
  if (!objs.length) throw new Error('CSV enthält keine Datenzeilen.');

  const mapped = objs.map(mapCsvRow);
  const missingBase = ['art', 'bez'].filter(k => !(k in mapped[0]));
  if (missingBase.length || !hasUsablePrice(mapped[0])) {
    throw new Error('CSV-Kopfzeile passt nicht. Erwartet werden entweder die Spalten "' +
      CATEGORY_CSV_HEADERS.join(', ') + '" oder das Bodan-Bestellsystem-Format mit "EK VPE".');
  }

  const newItems = mapped.map(r => productFromMappedRow(kat, r)).filter(p => p.art && p.bez);

  state.products = state.products.filter(p => p.kat !== kat).concat(newItems);
  state.catMeta[kat] = { updated: Date.now(), source: filename };
  state.dataSource[kat] = 'local';
  saveJSON(LS_KEYS.products, state.products);
  saveJSON(LS_KEYS.catMeta, state.catMeta);
  saveJSON(LS_KEYS.dataSource, state.dataSource);
  state.page = 1;
  renderCategoryOptions();
  renderAll();
}

function exportCategoryCSV(kat) {
  const objs = state.products.filter(p => p.kat === kat).map(p => ({
    ArtikelNr: p.art, Bezeichnung: p.bez, Hersteller: p.hers, Land: p.land,
    Qualitaet: p.qual, Gebinde: p.geb, PreisInklMwst: p.preis, EntMwst: p.mwstb, MwstSatz: p.mwst
  }));
  downloadText(slugify(kat) + '.csv', objectsToCSV(objs, CATEGORY_CSV_HEADERS));
}

function importSurchargesCSV(text) {
  const rows = parseCSV(text);
  const objs = rowsToObjects(rows);
  if (!objs.length) throw new Error('CSV enthält keine Datenzeilen.');
  const surcharges = objs.map(o => {
    const art = o.Art ?? o.art ?? Object.values(o)[0];
    let pctRaw = o.Prozentsatz ?? o.pct ?? Object.values(o)[1];
    pctRaw = String(pctRaw).replace('%', '').replace(',', '.').trim();
    return { art, pct: parseFloat(pctRaw) || 0 };
  }).filter(s => s.art);
  state.surcharges = surcharges;
  state.overridePct = null;
  state.dataSource.__surcharges = 'local';
  saveJSON(LS_KEYS.surcharges, state.surcharges);
  saveJSON(LS_KEYS.overridePct, state.overridePct);
  saveJSON(LS_KEYS.dataSource, state.dataSource);
  renderAll();
}

function exportSurchargesCSV() {
  downloadText('zuschlaege.csv', objectsToCSV(state.surcharges.map(s => ({ Art: s.art, Prozentsatz: s.pct })), SURCHARGE_HEADERS));
}

/* ------------------------------------------------------------------ *
 *  Veröffentlichen über die GitHub-API (optional)                     *
 *  Erspart den manuellen Export+Ersetzen+Redeploy-Weg, indem die      *
 *  Datei direkt im Repository aktualisiert wird -- weiterhin ohne     *
 *  eigenen Server, nur ein direkter Browser->GitHub-API-Aufruf.       *
 * ------------------------------------------------------------------ */

function getGithubConfig() { return loadJSON(LS_KEYS.githubConfig, null); }
function hasGithubConfig() {
  const c = getGithubConfig();
  return !!(c && c.owner && c.repo && c.token);
}
function saveGithubConfig(cfg) { saveJSON(LS_KEYS.githubConfig, cfg); }
function clearGithubConfig() { localStorage.removeItem(LS_KEYS.githubConfig); }

function utf8ToBase64(str) {
  return btoa(unescape(encodeURIComponent(str)));
}

async function publishToGitHub(filePath, content, commitMessage) {
  const cfg = getGithubConfig();
  if (!cfg || !cfg.owner || !cfg.repo || !cfg.token) {
    throw new Error('Kein GitHub-Zugang hinterlegt. Bitte zuerst unter „Veröffentlichung" speichern.');
  }
  const branch = cfg.branch || 'main';
  const apiUrl = `https://api.github.com/repos/${cfg.owner}/${cfg.repo}/contents/${filePath}`;
  const headers = {
    Authorization: `Bearer ${cfg.token}`,
    Accept: 'application/vnd.github+json'
  };

  let sha;
  const getRes = await fetch(`${apiUrl}?ref=${encodeURIComponent(branch)}`, { headers });
  if (getRes.status === 200) {
    sha = (await getRes.json()).sha;
  } else if (getRes.status !== 404) {
    throw new Error(githubErrorMessage(getRes.status));
  }

  const putRes = await fetch(apiUrl, {
    method: 'PUT',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: commitMessage,
      content: utf8ToBase64(content),
      branch,
      ...(sha ? { sha } : {})
    })
  });
  if (!putRes.ok) throw new Error(githubErrorMessage(putRes.status));
  return true;
}

function githubErrorMessage(status) {
  if (status === 401) return 'GitHub hat das Token abgelehnt (ungültig oder abgelaufen).';
  if (status === 403) return 'Das Token hat keine Schreibrechte für dieses Repository (Contents: Read and write prüfen).';
  if (status === 404) return 'Repository oder Branch nicht gefunden (Benutzername/Repo-Name/Branch prüfen).';
  if (status === 409) return 'Konflikt beim Schreiben (bitte kurz warten und erneut versuchen).';
  return 'GitHub-Fehler (HTTP ' + status + ').';
}

function exportBestellliste() {
  const entries = cartEntries();
  if (!entries.length) { showToast('Warenkorb ist leer.', true); return; }
  const totalVk = entries.reduce((s, e) => s + e.sum, 0);
  const lines = [];
  if (state.buyer.name) lines.push(['Name', state.buyer.name].map(toCSVField).join(','));
  if (state.buyer.adresse) lines.push(['Adresse', state.buyer.adresse].map(toCSVField).join(','));
  if (state.buyer.bank) lines.push(['Bankverbindung', state.buyer.bank].map(toCSVField).join(','));
  if (lines.length) lines.push('');
  const objs = entries.map(e => ({
    artnr: e.p.art,
    bezeichnung: e.p.bez,
    gebinde: e.p.geb || '',
    menge: e.qty,
    preis: money(e.vk),
    summe: money(e.sum)
  }));
  lines.push(objectsToCSV(objs, ['artnr', 'bezeichnung', 'gebinde', 'menge', 'preis', 'summe']));
  lines.push('');
  lines.push(['Gesamt-Bestellbetrag', money(totalVk)].map(toCSVField).join(','));
  downloadText('bestellliste.csv', lines.join('\r\n'));
}

// Bestellungen laufen über die Koordination, nicht direkt an Bodan -- die Mitglieder schicken
// ihre Einzelbestellung per E-Mail, die Koordination fasst alle zu einer Sammelbestellung
// zusammen. mailto: reicht dafür (kein Server/Backend nötig), kann aber keine Datei anhängen --
// deshalb zusätzlich zum CSV-Download.
const ORDER_EMAIL = 'alteeiche.info@gmail.com';

function buildOrderEmailBody(entries, totalVk) {
  const lines = ['Bestellung FoodCoop Alte Eiche', ''];
  if (state.buyer.name) lines.push('Name: ' + state.buyer.name);
  if (state.buyer.adresse) lines.push('Adresse: ' + state.buyer.adresse);
  if (state.buyer.bank) lines.push('Bankverbindung: ' + state.buyer.bank);
  lines.push('', 'Artikel-Nr. | Bezeichnung | Gebinde | Menge | Preis | Summe');
  entries.forEach(e => {
    lines.push(`${e.p.art} | ${e.p.bez} | ${e.p.geb || ''} | ${e.qty} | ${money(e.vk)} | ${money(e.sum)}`);
  });
  lines.push('', 'Gesamt-Bestellbetrag: ' + money(totalVk));
  return lines.join('\n');
}

function emailBestellung() {
  const entries = cartEntries();
  if (!entries.length) { showToast('Warenkorb ist leer.', true); return; }
  const totalVk = entries.reduce((s, e) => s + e.sum, 0);
  const subject = 'Bestellung FoodCoop Alte Eiche' + (state.buyer.name ? ' – ' + state.buyer.name : '');
  const body = buildOrderEmailBody(entries, totalVk);
  window.location.href = `mailto:${ORDER_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

function downloadText(filename, text) {
  // BOM voranstellen: ohne sie erkennen Excel/Sheets bei lokalen CSV-Dateien die
  // UTF-8-Kodierung nicht zuverlässig und zeigen Sonderzeichen wie "€" als "â¬" an.
  const blob = new Blob(['\uFEFF' + text], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function readFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsText(file, 'utf-8');
  });
}

/* ------------------------------------------------------------------ *
 *  Events                                                             *
 * ------------------------------------------------------------------ */

function setQty(art, qty) {
  qty = Math.max(0, Math.floor(Number(qty) || 0));
  if (qty === 0) delete state.cart[art];
  else state.cart[art] = qty;
  saveJSON(LS_KEYS.cart, state.cart);
  renderAll();
}

function switchAuthTab(which) {
  document.getElementById('tabLogin').classList.toggle('active', which === 'login');
  document.getElementById('tabRegister').classList.toggle('active', which === 'register');
  document.getElementById('loginForm').classList.toggle('hidden', which !== 'login');
  document.getElementById('registerForm').classList.toggle('hidden', which !== 'register');
  document.getElementById('resetPassForm').classList.toggle('hidden', which !== 'reset');
  document.querySelector('.auth-tabs').classList.toggle('hidden', which === 'reset');
}

function onAuthSuccess(msg) {
  state.view = 'shop';
  switchAuthTab('login');
  renderCategoryOptions();
  renderAll();
  showToast(msg || 'Willkommen!');
}

function updateTopbarHeightVar() {
  const h = document.querySelector('.topbar').getBoundingClientRect().height;
  document.documentElement.style.setProperty('--topbar-h', h + 'px');
}

function bindGlobalEvents() {
  updateTopbarHeightVar();
  window.addEventListener('resize', updateTopbarHeightVar);

  /* ---- Auth ---- */
  document.getElementById('tabLogin').addEventListener('click', () => switchAuthTab('login'));
  document.getElementById('tabRegister').addEventListener('click', () => switchAuthTab('register'));

  document.getElementById('loginForm').addEventListener('submit', async e => {
    e.preventDefault();
    const err = document.getElementById('loginError'); err.textContent = '';
    try {
      await loginUser(document.getElementById('loginUser').value, document.getElementById('loginPass').value);
      document.getElementById('loginForm').reset();
      onAuthSuccess('Willkommen zurück!');
    } catch (ex) { err.textContent = ex.message; }
  });

  document.getElementById('registerForm').addEventListener('submit', async e => {
    e.preventDefault();
    const err = document.getElementById('registerError'); err.textContent = '';
    try {
      await registerUser(
        document.getElementById('regUser').value,
        document.getElementById('regEmail').value,
        document.getElementById('regPass').value,
        document.getElementById('regPass2').value
      );
      document.getElementById('registerForm').reset();
      onAuthSuccess('Konto erstellt – willkommen!');
    } catch (ex) { err.textContent = ex.message; }
  });

  document.getElementById('forgotPassLink').addEventListener('click', () => switchAuthTab('reset'));
  document.getElementById('backToLoginLink').addEventListener('click', () => switchAuthTab('login'));

  document.getElementById('resetPassForm').addEventListener('submit', async e => {
    e.preventDefault();
    const err = document.getElementById('resetPassError'); err.textContent = '';
    try {
      await resetPassword(
        document.getElementById('resetUser').value,
        document.getElementById('resetEmail').value,
        document.getElementById('resetPass').value,
        document.getElementById('resetPass2').value
      );
      document.getElementById('resetPassForm').reset();
      onAuthSuccess('Passwort geändert – willkommen zurück!');
    } catch (ex) { err.textContent = ex.message; }
  });

  document.getElementById('logoutBtn').addEventListener('click', () => {
    clearSession();
    state.cartOpen = false;
    state.view = 'auth';
    renderAll();
  });

  /* ---- Shop ---- */
  document.getElementById('searchInput').addEventListener('input', e => {
    state.query = e.target.value; state.page = 1; renderShop();
  });
  document.getElementById('categorySelect').addEventListener('change', e => {
    state.category = e.target.value; state.page = 1; renderShop();
  });
  document.getElementById('sortSelect').addEventListener('change', e => {
    state.sort = e.target.value; renderShop();
  });

  document.getElementById('productGrid').addEventListener('click', e => {
    const card = e.target.closest('.card');
    if (!card) return;
    const art = card.dataset.art;
    const cur = state.cart[art] || 0;
    if (e.target.dataset.act === 'inc') setQty(art, cur + 1);
    if (e.target.dataset.act === 'dec') setQty(art, cur - 1);
  });
  document.getElementById('productGrid').addEventListener('change', e => {
    if (e.target.dataset.act === 'set') {
      const card = e.target.closest('.card');
      setQty(card.dataset.art, e.target.value);
    }
  });

  document.getElementById('pager').addEventListener('click', e => {
    if (e.target.dataset.page === 'prev') { state.page--; renderShop(); window.scrollTo(0, 0); }
    if (e.target.dataset.page === 'next') { state.page++; renderShop(); window.scrollTo(0, 0); }
  });

  document.getElementById('cartItems').addEventListener('click', e => {
    const row = e.target.closest('.cart-item');
    if (!row) return;
    const art = row.dataset.art;
    const cur = state.cart[art] || 0;
    if (e.target.dataset.act === 'inc') setQty(art, cur + 1);
    if (e.target.dataset.act === 'dec') setQty(art, cur - 1);
    if (e.target.dataset.act === 'remove') setQty(art, 0);
  });

  document.getElementById('cartToggle').addEventListener('click', () => {
    state.cartOpen = !state.cartOpen; renderAll();
  });
  document.getElementById('cartOverlay').addEventListener('click', () => {
    state.cartOpen = false; renderAll();
  });
  document.getElementById('cartClose').addEventListener('click', () => {
    state.cartOpen = false; renderAll();
  });
  document.getElementById('cartCheckoutBtn').addEventListener('click', () => {
    state.cartOpen = false; state.view = 'checkout'; renderAll();
  });
  document.getElementById('cartClearBtn').addEventListener('click', () => {
    if (confirm('Warenkorb wirklich leeren?')) { state.cart = {}; saveJSON(LS_KEYS.cart, state.cart); renderAll(); }
  });

  document.querySelectorAll('[data-nav]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!isLoggedIn()) return;
      state.view = btn.dataset.nav; renderAll(); window.scrollTo(0, 0);
    });
  });

  document.getElementById('backToShopBtn').addEventListener('click', () => { state.view = 'shop'; renderAll(); });

  ['checkoutName', 'checkoutAdresse', 'checkoutBank'].forEach(id => {
    document.getElementById(id).addEventListener('input', e => {
      const field = { checkoutName: 'name', checkoutAdresse: 'adresse', checkoutBank: 'bank' }[id];
      state.buyer[field] = e.target.value;
      saveJSON(LS_KEYS.buyer, state.buyer);
    });
  });

  document.getElementById('printBtn').addEventListener('click', () => window.print());
  document.getElementById('exportBestellungBtn').addEventListener('click', exportBestellliste);
  document.getElementById('emailBestellungBtn').addEventListener('click', emailBestellung);

  /* ---- Admin gate ---- */
  document.getElementById('adminSetupForm').addEventListener('submit', async e => {
    e.preventDefault();
    const err = document.getElementById('adminSetupError'); err.textContent = '';
    const p1 = document.getElementById('adminSetupPass').value;
    const p2 = document.getElementById('adminSetupPass2').value;
    if (p1 !== p2) { err.textContent = 'Passwörter stimmen nicht überein.'; return; }
    try {
      await setupAdminPassword(p1);
      document.getElementById('adminSetupForm').reset();
      renderAll();
      showToast('Admin-Passwort eingerichtet.');
    } catch (ex) { err.textContent = ex.message; }
  });

  document.getElementById('adminLoginForm').addEventListener('submit', async e => {
    e.preventDefault();
    const err = document.getElementById('adminLoginError'); err.textContent = '';
    try {
      await verifyAdminPassword(document.getElementById('adminLoginPass').value);
      document.getElementById('adminLoginForm').reset();
      renderAll();
    } catch (ex) { err.textContent = ex.message; }
  });

  document.getElementById('lockAdminBtn').addEventListener('click', () => {
    lockAdmin(); renderAll();
  });

  document.getElementById('changeAdminPassForm').addEventListener('submit', async e => {
    e.preventDefault();
    const err = document.getElementById('changeAdminError'); err.textContent = '';
    const n1 = document.getElementById('changeAdminNew').value;
    const n2 = document.getElementById('changeAdminNew2').value;
    if (n1 !== n2) { err.textContent = 'Neue Passwörter stimmen nicht überein.'; return; }
    try {
      await changeAdminPassword(document.getElementById('changeAdminOld').value, n1);
      document.getElementById('changeAdminPassForm').reset();
      showToast('Admin-Passwort geändert.');
    } catch (ex) { err.textContent = ex.message; }
  });

  /* ---- Admin: Kategorien-CSVs ---- */
  document.getElementById('categoryCsvList').addEventListener('click', async e => {
    if (e.target.classList.contains('cat-csv-export')) {
      const kat = e.target.closest('.cat-csv-row').dataset.kat;
      exportCategoryCSV(kat);
      return;
    }
    if (e.target.classList.contains('cat-csv-publish')) {
      const btn = e.target;
      const kat = btn.closest('.cat-csv-row').dataset.kat;
      const label = btn.textContent;
      btn.disabled = true; btn.textContent = '🚀 Veröffentliche …';
      try {
        const objs = state.products.filter(p => p.kat === kat).map(p => ({
          ArtikelNr: p.art, Bezeichnung: p.bez, Hersteller: p.hers, Land: p.land,
          Qualitaet: p.qual, Gebinde: p.geb, PreisInklMwst: p.preis, EntMwst: p.mwstb, MwstSatz: p.mwst
        }));
        const csv = objectsToCSV(objs, CATEGORY_CSV_HEADERS);
        await publishToGitHub(CATEGORY_FILES[kat], csv, kat + ' aktualisiert (Admin-Panel)');
        state.dataSource[kat] = 'server';
        saveJSON(LS_KEYS.dataSource, state.dataSource);
        showToast(kat + ' veröffentlicht. Auf GitHub Pages kann die Aktualisierung noch bis zu ~1 Minute dauern.');
        renderAdmin();
      } catch (err) {
        showToast('Fehler beim Veröffentlichen: ' + err.message, true);
        btn.disabled = false; btn.textContent = label;
      }
      return;
    }
  });
  document.getElementById('categoryCsvList').addEventListener('change', async e => {
    if (!e.target.classList.contains('cat-csv-input')) return;
    const row = e.target.closest('.cat-csv-row');
    const kat = row.dataset.kat;
    const file = e.target.files[0]; if (!file) return;
    try {
      const text = await readFile(file);
      importCategoryCSV(kat, text, file.name);
      showToast(kat + ': lokale Vorschau aktualisiert (' + state.products.filter(p => p.kat === kat).length + ' Artikel). Zum Veröffentlichen: Exportieren + im Hosting ersetzen.');
    } catch (err) { showToast('Fehler: ' + err.message, true); }
    e.target.value = '';
  });

  document.getElementById('reloadServerBtn').addEventListener('click', async () => {
    if (!confirm('Vom Server neu laden verwirft alle noch nicht veröffentlichten lokalen Vorschauen. Fortfahren?')) return;
    showToast('Lade Kategorien vom Server …');
    await loadServerCatalog(true);
    showToast('Vom Server neu geladen.');
  });

  /* ---- Admin: Zuschläge (einzelne Felder) ---- */
  document.getElementById('surchargeList').addEventListener('input', e => {
    const row = e.target.closest('.sc-edit-row');
    if (!row) return;
    const idx = Number(row.dataset.idx);
    if (e.target.classList.contains('sc-name-input')) {
      state.surcharges[idx].art = e.target.value;
    } else if (e.target.classList.contains('sc-pct-input')) {
      state.surcharges[idx].pct = parseFloat(String(e.target.value).replace(',', '.')) || 0;
    } else {
      return;
    }
    state.dataSource.__surcharges = 'local';
    saveJSON(LS_KEYS.surcharges, state.surcharges);
    saveJSON(LS_KEYS.dataSource, state.dataSource);
    document.getElementById('computedTotalPct').textContent = pctFmt(totalSurchargePct());
    document.getElementById('surchargeSource').textContent = DATA_SOURCE_LABEL.local;
    document.getElementById('surchargeSource').className = 'cat-csv-source cat-csv-source-local';
  });
  document.getElementById('surchargeList').addEventListener('click', e => {
    if (!e.target.classList.contains('sc-remove-btn')) return;
    const row = e.target.closest('.sc-edit-row');
    state.surcharges.splice(Number(row.dataset.idx), 1);
    state.dataSource.__surcharges = 'local';
    saveJSON(LS_KEYS.surcharges, state.surcharges);
    saveJSON(LS_KEYS.dataSource, state.dataSource);
    renderSurchargeEditor();
  });
  document.getElementById('addSurchargeBtn').addEventListener('click', () => {
    state.surcharges.push({ art: 'Neuer Zuschlag', pct: 0 });
    state.dataSource.__surcharges = 'local';
    saveJSON(LS_KEYS.surcharges, state.surcharges);
    saveJSON(LS_KEYS.dataSource, state.dataSource);
    renderSurchargeEditor();
  });

  document.getElementById('surchargeCsvInput').addEventListener('change', async e => {
    const file = e.target.files[0]; if (!file) return;
    try {
      const text = await readFile(file);
      importSurchargesCSV(text);
      showToast('Zuschläge aktualisiert.');
    } catch (err) { showToast('Fehler: ' + err.message, true); }
    e.target.value = '';
  });
  document.getElementById('exportSurchargesBtn').addEventListener('click', exportSurchargesCSV);

  document.getElementById('publishSurchargesBtn').addEventListener('click', async e => {
    const btn = e.target;
    btn.disabled = true; btn.textContent = '🚀 Veröffentliche …';
    try {
      const csv = objectsToCSV(state.surcharges.map(s => ({ Art: s.art, Prozentsatz: s.pct })), SURCHARGE_HEADERS);
      await publishToGitHub(SURCHARGE_FILE, csv, 'Zuschläge aktualisiert (Admin-Panel)');
      state.dataSource.__surcharges = 'server';
      saveJSON(LS_KEYS.dataSource, state.dataSource);
      showToast('Zuschläge veröffentlicht. Auf GitHub Pages kann die Aktualisierung noch bis zu ~1 Minute dauern.');
      renderAdmin();
    } catch (err) {
      showToast('Fehler beim Veröffentlichen: ' + err.message, true);
    } finally {
      btn.disabled = false; btn.textContent = '🚀 Veröffentlichen';
    }
  });

  /* ---- Admin: GitHub-Einstellungen ---- */
  document.getElementById('saveGithubBtn').addEventListener('click', () => {
    const owner = document.getElementById('ghOwner').value.trim();
    const repo = document.getElementById('ghRepo').value.trim();
    const branch = document.getElementById('ghBranch').value.trim() || 'main';
    const tokenInput = document.getElementById('ghToken').value.trim();
    const existing = getGithubConfig();
    const token = tokenInput || (existing && existing.token) || '';
    if (!owner || !repo || !token) {
      showToast('Bitte Benutzername/Organisation, Repository und Token angeben.', true);
      return;
    }
    saveGithubConfig({ owner, repo, branch, token });
    showToast('GitHub-Zugang gespeichert.');
    renderAdmin();
  });
  document.getElementById('clearGithubBtn').addEventListener('click', () => {
    if (!confirm('GitHub-Zugangsdaten (inkl. Token) aus diesem Browser entfernen?')) return;
    clearGithubConfig();
    showToast('GitHub-Zugang entfernt.');
    renderAdmin();
  });

  document.getElementById('overridePctInput').addEventListener('input', e => {
    const v = e.target.value;
    state.overridePct = v === '' ? null : v;
    saveJSON(LS_KEYS.overridePct, state.overridePct);
    renderAll();
  });
  document.getElementById('resetOverrideBtn').addEventListener('click', () => {
    state.overridePct = null;
    saveJSON(LS_KEYS.overridePct, null);
    renderAll();
  });

  /* ---- Admin: Kundenkonten ---- */
  document.getElementById('exportUsersBtn').addEventListener('click', () => {
    downloadText('kundenkonten.csv', exportUsersCSV());
  });
  document.getElementById('usersCsvInput').addEventListener('change', async e => {
    const file = e.target.files[0]; if (!file) return;
    try {
      const text = await readFile(file);
      const n = importUsersCSV(text);
      showToast(n + ' Kundenkonten importiert.');
      renderAdmin();
    } catch (err) { showToast('Fehler: ' + err.message, true); }
    e.target.value = '';
  });

  /* ---- Admin: Reset ---- */
  document.getElementById('resetDataBtn').addEventListener('click', () => {
    if (!confirm('Wirklich auf die Original-Bodan-Daten zurücksetzen? Eigene CSV-Uploads gehen verloren (Kundenkonten bleiben erhalten).')) return;
    state.products = window.DEFAULT_PRODUCTS || [];
    state.surcharges = window.DEFAULT_SURCHARGES || [];
    state.overridePct = null;
    state.catMeta = {};
    state.dataSource = {};
    saveJSON(LS_KEYS.products, state.products);
    saveJSON(LS_KEYS.surcharges, state.surcharges);
    saveJSON(LS_KEYS.overridePct, null);
    saveJSON(LS_KEYS.catMeta, state.catMeta);
    saveJSON(LS_KEYS.dataSource, state.dataSource);
    state.category = ''; state.page = 1;
    renderCategoryOptions();
    renderAll();
    showToast('Originaldaten wiederhergestellt.');
  });
}

let toastTimer = null;
function showToast(msg, isError) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.toggle('error', !!isError);
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3500);
}

document.addEventListener('DOMContentLoaded', init);

'use strict';

/* ------------------------------------------------------------------ *
 *  Speicher-Layer (localStorage -- keine Datenbank, keine Server)     *
 * ------------------------------------------------------------------ */

const LS_KEYS = {
  products: 'ws_products',
  surcharges: 'ws_surcharges',
  cart: 'ws_cart',
  catMeta: 'ws_cat_meta',
  dataSource: 'ws_data_source',
  githubConfig: 'ws_github_config'
};

// Der Warenkorb wird pro Benutzerkonto gespeichert (eigener localStorage-Key je Benutzername),
// nicht mehr unter einem einzigen globalen Schlüssel. Sonst teilen sich mehrere Kundenkonten auf
// demselben Gerät denselben Warenkorb -- und das Löschen irgendeines Kontos hätte (wie
// beobachtet) den Warenkorb aller anderen Konten auf diesem Gerät mitgelöscht.
function cartKeyForUser(username) {
  return 'ws_cart_' + username;
}
function currentCartKey() {
  const s = getSession();
  return s && s.username ? cartKeyForUser(s.username) : LS_KEYS.cart;
}

// Hält fest, zu welchem Preis ein Artikel zuletzt im Warenkorb gesehen/bestätigt wurde --
// getrennt vom flüchtigen state.products-Cache, der bei jedem Seitenaufruf im Hintergrund
// (loadServerCatalog() in init(), unawaited) ohnehin automatisch aktualisiert wird. Ohne diesen
// eigenen, dauerhaften Wert hätte die Preisänderungs-Warnung in der Bestellübersicht praktisch
// nie etwas zu melden: Bis man dort hinklickt, ist der Hintergrund-Refresh in aller Regel längst
// durchgelaufen und hat den "alten" Preis im Cache schon durch den neuen ersetzt -- der Vergleich
// "vorher/nachher" sah dann nur noch zweimal denselben (neuen) Preis.
function cartPriceKeyForUser(username) {
  return 'ws_cart_price_' + username;
}
function currentCartPriceKey() {
  const s = getSession();
  return s && s.username ? cartPriceKeyForUser(s.username) : 'ws_cart_price';
}

// Standardkategorien: Startpunkt für data/categories.json (falls diese Datei einmal nicht
// erreichbar ist, z. B. offline oder ganz frisches Hosting ohne die Datei) sowie die Werte,
// mit denen die Seite sofort rendert, bevor categories.json geladen ist.
const DEFAULT_CATEGORY_CONFIG = [
  { name: 'Trockenware', file: 'data/trockenware.csv' },
  { name: 'Drogerie Kosmetik Nonfood', file: 'data/drogerie-kosmetik-nonfood.csv' },
  { name: 'Getränke Alkohol', file: 'data/getraenke-alkohol.csv' },
  { name: 'Getränke Alkoholfrei', file: 'data/getraenke-alkoholfrei.csv' },
  { name: 'Feinkost Veganer Ersatz', file: 'data/feinkost-veganer-ersatz.csv' }
];

// CATEGORY_LIST/CATEGORY_FILES sind absichtlich "let": Die eigentliche, für ALLE Besucher
// gültige Kategorienliste kommt aus data/categories.json (siehe loadCategoriesConfig) und
// kann sich dadurch zur Laufzeit ändern, wenn im Admin-Bereich Kategorien hinzugefügt oder
// entfernt werden. Bis die Datei geladen ist, gelten die Standardkategorien oben.
let CATEGORY_LIST = DEFAULT_CATEGORY_CONFIG.map(c => c.name);
let CATEGORY_FILES = Object.fromEntries(DEFAULT_CATEGORY_CONFIG.map(c => [c.name, c.file]));

const CATEGORY_CSV_HEADERS = ['ArtikelNr', 'Bezeichnung', 'Hersteller', 'Land', 'Qualitaet', 'Gebinde', 'PreisInklMwst', 'EntMwst', 'MwstSatz'];
const SURCHARGE_HEADERS = ['Art', 'Prozentsatz'];

// Diese Pfade liefern die für ALLE Besucher gemeinsame Datenbasis: beim Laden ruft
// die Seite diese Dateien vom Hosting ab (fetch), damit jedes Mitglied auf jedem
// Gerät denselben Katalog sieht -- ohne Datenbank, nur über statische Dateien.
// Um eine Kategorie für alle sichtbar zu aktualisieren: im Admin-Bereich "Exportieren"
// klicken und die heruntergeladene Datei im Hosting unter genau diesem Pfad ersetzen
// (oder direkt über "🚀 Veröffentlichen", falls ein GitHub-Zugang hinterlegt ist).
const CATEGORIES_FILE = 'data/categories.json';
const SURCHARGE_FILE = 'data/zuschlaege.csv';

function applyCategoryConfig(list) {
  CATEGORY_LIST = list.map(c => c.name);
  CATEGORY_FILES = Object.fromEntries(list.map(c => [c.name, c.file]));
}

function currentCategoryConfig() {
  return CATEGORY_LIST.map(kat => ({ name: kat, file: CATEGORY_FILES[kat] }));
}

// Lädt die gemeinsame Kategorienliste vom Hosting. Existiert die Datei noch nicht (z. B. auf
// einem Hosting-Stand von vor dieser Funktion) oder ist die Seite offline, bleiben die
// Standardkategorien aktiv -- kein Fehler, nur ein stiller Fallback.
async function loadCategoriesConfig() {
  try {
    const text = await fetchCsvFile(CATEGORIES_FILE);
    const list = JSON.parse(text);
    if (Array.isArray(list) && list.length && list.every(c => c && c.name && c.file)) {
      applyCategoryConfig(list);
    }
  } catch (e) { /* Datei fehlt (noch) oder offline -- Standardkategorien bleiben aktiv */ }
}

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
// try/catch, damit ein blockierter/voller Speicher (z. B. strikte Privatsphäre-Einstellungen,
// manche Inapp-Browser) die Seite nicht mitten in init() abbrechen lässt -- die Seite läuft dann
// eben nur ohne dauerhafte Speicherung weiter, statt komplett weiß zu bleiben.
function saveJSON(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* Speicher nicht verfügbar */ }
}

function debounce(fn, delayMs) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delayMs);
  };
}

function slugify(s) {
  return String(s).toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

const state = {
  products: [],
  surcharges: [],
  cart: {},        // { artNr: qty }
  cartPriceSeen: {}, // { artNr: zuletzt angezeigter Verkaufspreis } -- siehe currentCartPriceKey()
  catMeta: {},      // { kategorie: { updated, source } }
  dataSource: {},   // { kategorie: 'server' | 'local' | 'default' }
  view: 'auth',     // auth | shop | checkout | admin
  category: '',
  query: '',
  searchFallback: false,  // true, wenn die Suche auf ODER-Verknuepfung zurueckgefallen ist
  sort: 'name-asc',
  page: 1,
  pageSize: 60,
  cartOpen: false,
  checkoutPrevEntries: null, // Preise/Artikel vor dem letzten Bestellübersicht-Refresh (für Änderungs-Hervorhebung)
  lastCatalogLoadErrors: [], // Kategorien, deren Server-Reload beim letzten loadServerCatalog()-Aufruf fehlschlug
  catalogLastLoadedAt: null  // Zeitstempel (Date.now()) des letzten loadServerCatalog()-Durchlaufs, unabhängig vom Erfolg
};

async function init() {
  state.products = loadJSON(LS_KEYS.products, null) || (window.DEFAULT_PRODUCTS || []);
  state.surcharges = loadJSON(LS_KEYS.surcharges, null) || (window.DEFAULT_SURCHARGES || []);
  state.cart = loadJSON(currentCartKey(), {});
  state.cartPriceSeen = loadJSON(currentCartPriceKey(), {});
  state.catMeta = loadJSON(LS_KEYS.catMeta, {});
  state.dataSource = loadJSON(LS_KEYS.dataSource, {});

  if (!loadJSON(LS_KEYS.products, null)) {
    saveJSON(LS_KEYS.products, state.products);
    saveJSON(LS_KEYS.surcharges, state.surcharges);
  }

  state.view = isLoggedIn() ? 'shop' : 'auth';

  // Kategorienliste zuerst laden, damit Filter/Admin-Bereich gleich mit dem aktuellen
  // Stand rendern (inkl. evtl. im Admin-Bereich hinzugefügter/entfernter Kategorien).
  await loadCategoriesConfig();

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
  const failedKats = [];
  results.forEach((r, i) => {
    const kat = katsToFetch[i];
    if (r.status === 'fulfilled' && r.value.items.length) {
      byKat[kat] = r.value.items;
      state.dataSource[kat] = 'server';
      anyOk = true;
    } else {
      // Reload fehlgeschlagen (Netzwerkfehler oder leere/kaputte Datei) -- alter Stand für
      // diese Kategorie bleibt unverändert aktiv, siehe Merge unten. Damit das nicht
      // unbemerkt bleibt (z. B. in der Bestellübersicht), wird die Kategorie vorgemerkt.
      failedKats.push(kat);
      if (!state.dataSource[kat]) {
        state.dataSource[kat] = 'default';
      }
    }
  });
  state.lastCatalogLoadErrors = failedKats;

  if (anyOk) {
    // "others" sind Artikel aus Kategorien, die in diesem Durchlauf nicht neu abgerufen wurden
    // (z. B. weil gerade eine lokale, noch unveröffentlichte Vorschau existiert). Zusätzlich
    // gegen CATEGORY_LIST filtern, nicht nur gegen byKat: sonst bleiben Artikel einer im
    // Admin-Bereich entfernten Kategorie für immer im lokalen Cache (localStorage) hängen und
    // tauchen im Kategorie-Filter weiter auf, obwohl die Kategorie serverseitig längst weg ist.
    const others = state.products.filter(p => !byKat[p.kat] && CATEGORY_LIST.includes(p.kat));
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
  state.catalogLastLoadedAt = Date.now();
  renderCategoryOptions();
  renderAll();
}

/* ------------------------------------------------------------------ *
 *  Preisberechnung: Mehrwertsteuer & Prozentzuschläge                 *
 * ------------------------------------------------------------------ */

function totalSurchargePct() {
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

// Nur für die Anzeige: Leerzeichen zwischen Anzahl und ausgeschriebener Einheit ergänzen
// ("10Stück" -> "10 Stück", "5Tüten" -> "5 Tüten"). Kurzabkürzungen wie "400g", "7KG" oder
// "10ML" bleiben absichtlich eng dran, das ist übliche Schreibweise. Die Rohdaten in
// state.products bleiben unverändert -- betrifft nur die Textdarstellung.
const GEBINDE_TIGHT_UNITS = new Set(['g', 'kg', 'l', 'ml', 'st']);
function formatGebinde(geb) {
  if (!geb) return '';
  return String(geb).replace(/(\d)([A-Za-zÄÖÜäöüß]+)$/, (match, digit, unit) =>
    GEBINDE_TIGHT_UNITS.has(unit.toLowerCase()) ? match : digit + ' ' + unit
  );
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

function productMatchesTerm(p, term) {
  return (p.bez && p.bez.toLowerCase().includes(term)) ||
    (p.hers && p.hers.toLowerCase().includes(term)) ||
    (p.art && String(p.art).toLowerCase().includes(term));
}

// Mehrere, mit Komma getrennte Suchbegriffe: zuerst UND (alle Begriffe muessen treffen);
// liefert das keine Treffer, wird auf ODER zurueckgefallen (mindestens ein Begriff trifft),
// sortiert nach Anzahl der getroffenen Begriffe. state.searchFallback zeigt an, ob dieser
// Rueckfall gerade aktiv ist (fuer einen Hinweis in der Trefferanzeige).
function filteredProducts() {
  const terms = state.query.split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
  let list = state.products;
  if (state.category) list = list.filter(p => p.kat === state.category);

  state.searchFallback = false;
  let matchCounts = null;

  if (terms.length) {
    const andList = list.filter(p => terms.every(t => productMatchesTerm(p, t)));
    if (andList.length > 0 || terms.length === 1) {
      list = andList;
    } else {
      matchCounts = new Map();
      list.forEach(p => {
        const n = terms.reduce((sum, t) => sum + (productMatchesTerm(p, t) ? 1 : 0), 0);
        if (n > 0) matchCounts.set(p, n);
      });
      list = Array.from(matchCounts.keys());
      state.searchFallback = list.length > 0;
    }
  }

  const pct = totalSurchargePct();
  const sorted = list.slice().sort((a, b) => {
    if (matchCounts) {
      const diff = matchCounts.get(b) - matchCounts.get(a);
      if (diff !== 0) return diff;
    }
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
  document.getElementById('view-profile').classList.toggle('hidden', state.view !== 'profile');
  document.getElementById('view-admin').classList.toggle('hidden', state.view !== 'admin');
  document.getElementById('view-impressum').classList.toggle('hidden', state.view !== 'impressum');
  document.body.classList.toggle('bg-market', state.view === 'shop');

  document.querySelectorAll('.auth-only').forEach(el => el.classList.toggle('hidden', !loggedIn));
  if (loggedIn) {
    const s = getSession();
    document.getElementById('whoami').textContent = s ? ('👋 ' + s.username) : '';
  }
  updateTopbarHeightVar();

  if (state.view === 'shop') renderShop();
  if (state.view === 'checkout') renderCheckout();
  if (state.view === 'profile') renderProfile();
  if (state.view === 'admin') { renderAdminGate(); if (isAdminUnlocked()) renderAdmin(); }

  renderCartBadge();
  renderCartDrawer();
  const cartNowOpen = state.cartOpen && loggedIn;
  document.getElementById('cartDrawer').classList.toggle('open', cartNowOpen);
  document.getElementById('cartOverlay').classList.toggle('open', cartNowOpen);
  updateCartDrawerFocus(cartNowOpen);
}

// Fokus beim Öffnen/Schließen des Warenkorb-Drawers verwalten (Tastatur-/Screenreader-Nutzung):
// beim Öffnen in den Drawer springen, beim Schließen zurück zum auslösenden Element. Reagiert
// nur auf den tatsächlichen Wechsel offen<->geschlossen, nicht auf jedes renderAll() währenddessen
// (sonst würde z. B. jeder Mengenklick bei offenem Drawer den Fokus zurück auf "Schließen" reißen).
let cartDrawerWasOpen = false;
let cartDrawerTriggerEl = null;
function updateCartDrawerFocus(cartNowOpen) {
  if (cartNowOpen && !cartDrawerWasOpen) {
    cartDrawerTriggerEl = document.activeElement;
    const closeBtn = document.getElementById('cartClose');
    if (closeBtn) closeBtn.focus();
  } else if (!cartNowOpen && cartDrawerWasOpen) {
    if (cartDrawerTriggerEl && document.body.contains(cartDrawerTriggerEl) && typeof cartDrawerTriggerEl.focus === 'function') {
      cartDrawerTriggerEl.focus();
    }
    cartDrawerTriggerEl = null;
  }
  cartDrawerWasOpen = cartNowOpen;
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

  const fallbackNotice = document.getElementById('searchFallbackNotice');
  fallbackNotice.textContent = state.searchFallback
    ? 'Keine Artikel mit allen Suchbegriffen gefunden – zeige Treffer für mindestens einen Begriff.'
    : '';
  fallbackNotice.classList.toggle('hidden', !state.searchFallback);

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
    <div class="card-geb">${escapeHtml(formatGebinde(p.geb))}</div>
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
      <button class="qty-btn" data-act="dec" aria-label="Menge verringern für ${escapeHtml(p.bez)}">−</button>
      <input class="qty-input" type="number" min="0" step="1" value="${qty}" data-act="set" aria-label="Menge für ${escapeHtml(p.bez)}">
      <button class="qty-btn" data-act="inc" aria-label="Menge erhöhen für ${escapeHtml(p.bez)}">+</button>
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
  // Nur Artikel zählen, die noch im Katalog existieren -- sonst zeigt der Badge eine Menge an,
  // die im geöffneten Warenkorb gar nicht auftaucht (cartEntries() lässt verschwundene Artikel
  // ja bereits stillschweigend weg), was wie ein Anzeigefehler wirkt.
  const count = cartEntries().reduce((a, e) => a + e.qty, 0);
  document.getElementById('cartCount').textContent = count;
}

function renderCartDrawer() {
  const entries = cartEntries();
  const body = document.getElementById('cartItems');

  // Artikel, die noch mit Menge > 0 im Warenkorb stehen, aber zu keinem cartEntries()-Eintrag
  // mehr aufgelöst werden konnten (z. B. weil ihre Kategorie entfernt wurde oder der Artikel
  // einzeln aus dem Katalog verschwunden ist) -- werden sonst von cartEntries() stillschweigend
  // weggelassen. Ohne Name/Preis lassen sie sich hier nicht mehr anzeigen (die Katalogdaten sind
  // ja weg), daher nur ein Hinweis mit Artikel-Nr., kein eigener Eintrag in der Liste. Die
  // ausführliche Einzelansicht mit durchgestrichenem Artikel gibt es weiterhin erst beim Öffnen
  // der Bestellübersicht (siehe openCheckout/renderCheckout).
  const knownArts = new Set(entries.map(e => String(e.p.art)));
  const staleArts = Object.entries(state.cart)
    .filter(([art, qty]) => qty && !knownArts.has(String(art)))
    .map(([art]) => art);

  let noticeHtml = '';
  if (staleArts.length) {
    const plural = staleArts.length > 1;
    noticeHtml = `<div class="cart-stale-notice">⚠️ ${staleArts.length} Artikel (Artikel-Nr. ${staleArts.map(escapeHtml).join(', ')}) ${plural ? 'sind' : 'ist'} nicht mehr im Katalog und ${plural ? 'werden' : 'wird'} daher hier nicht mehr angezeigt.</div>`;
  }

  if (!entries.length) {
    body.innerHTML = noticeHtml + '<p class="empty">Warenkorb ist leer.</p>';
  } else {
    body.innerHTML = noticeHtml + entries.map(e => `
      <div class="cart-item" data-art="${escapeHtml(e.p.art)}">
        <div class="ci-info">
          <div class="ci-title">${escapeHtml(e.p.bez)}</div>
          <div class="ci-meta">${money(e.vk)} · ${escapeHtml(formatGebinde(e.p.geb))}</div>
        </div>
        <div class="ci-qty">
          <button class="qty-btn" data-act="dec" aria-label="Menge verringern für ${escapeHtml(e.p.bez)}">−</button>
          <span>${e.qty}</span>
          <button class="qty-btn" data-act="inc" aria-label="Menge erhöhen für ${escapeHtml(e.p.bez)}">+</button>
        </div>
        <div class="ci-sum">${money(e.sum)}</div>
        <button class="ci-remove" data-act="remove" aria-label="${escapeHtml(e.p.bez)} entfernen">✕</button>
      </div>
    `).join('');
  }
  renderCartSummary(entries);
}

function renderCartSummary(entries) {
  const totalMwst = entries.reduce((s, e) => s + e.p.mwstb * e.qty, 0);
  const totalVk = entries.reduce((s, e) => s + e.sum, 0);
  document.getElementById('cartSummary').innerHTML = entries.length ? `
    <div class="sum-row"><span>davon MwSt.</span><span>${money(totalMwst)}</span></div>
    <div class="sum-row sum-total"><span>Gesamtsumme</span><span>${money(totalVk)}</span></div>
  ` : '';
}

// Ruft den Warenkorb auf: bevor die Bestellübersicht angezeigt wird, den Katalog frisch vom
// Server laden und mit dem Stand vor dem Refresh vergleichen. So fallen Preisänderungen oder
// inzwischen entfernte Artikel auf, auch wenn der Warenkorb schon länger (über mehrere Besuche)
// im Browser lag, statt sie beim Bestellen stillschweigend zu übernehmen.
// Lädt den Katalog frisch und vergleicht gegen den DAUERHAFT gespeicherten "zuletzt gesehenen"
// Preis (state.cartPriceSeen, siehe currentCartPriceKey()) -- bewusst NICHT gegen den aktuellen
// state.products-Stand im Speicher: der wird schon beim bloßen Seitenaufruf im Hintergrund
// aktualisiert (unawaited loadServerCatalog() in init()), typischerweise lange bevor man
// tatsächlich auf "Bestellübersicht" klickt. Ein Vergleich dagegen hätte so gut wie nie etwas zu
// melden. Aktualisiert anschließend den gesehenen Preis auf den jetzt angezeigten Stand, damit ein
// einmal angezeigter Hinweis nicht bei jedem erneuten Öffnen wiederholt wird. Von openCheckout()
// (erstes Öffnen) und refreshCheckoutBeforeSend() (Export/E-Mail) gemeinsam genutzt.
async function refreshCheckoutAndDetectChanges() {
  // Artikel, die schon vor Einführung von cartPriceSeen (oder seit einer Browser-/Geräte-Migration)
  // im Warenkorb lagen, haben noch keinen gespeicherten "gesehenen" Preis -- dafür gibt es keinen
  // Ersatz, die Seite kennt den damaligen Preis schlicht nicht mehr. Statt das stillschweigend als
  // "unverändert" zu werten (das Problem, das genau zu dem Zimt-Fall geführt hat), wird so ein
  // Artikel als "Preis nicht geprüft" markiert, damit der Kunde bewusst hinschaut.
  const prevByArt = new Map(cartEntries().map(e => {
    const seen = state.cartPriceSeen[e.p.art];
    return [e.p.art, {
      vk: seen !== undefined ? seen : e.vk, unknown: seen === undefined,
      bez: e.p.bez, geb: e.p.geb, mwst: e.p.mwst, art: e.p.art
    }];
  }));
  await loadServerCatalog(true);
  const freshEntries = cartEntries();
  const priceChanged = freshEntries.some(e => {
    const prev = prevByArt.get(e.p.art);
    return prev && !prev.unknown && Math.round(prev.vk * 100) !== Math.round(e.vk * 100);
  });
  const priceUnknown = freshEntries.some(e => {
    const prev = prevByArt.get(e.p.art);
    return prev && prev.unknown;
  });
  const itemRemoved = [...prevByArt.keys()].some(art => !freshEntries.some(e => e.p.art === art));
  state.checkoutPrevEntries = prevByArt;
  freshEntries.forEach(e => { state.cartPriceSeen[e.p.art] = e.vk; });
  saveJSON(currentCartPriceKey(), state.cartPriceSeen);
  return priceChanged || priceUnknown || itemRemoved;
}

async function openCheckout() {
  state.cartOpen = false;
  state.view = 'checkout';
  state.checkoutPrevEntries = null;
  renderAll();
  await refreshCheckoutAndDetectChanges();
  renderAll();
}

function renderProfile() {
  const acc = currentUserAccount();
  if (!acc) return;
  document.getElementById('profileVorname').value = acc.vorname || '';
  document.getElementById('profileNachname').value = acc.nachname || '';
  document.getElementById('profileEmail').value = acc.email || '';
  document.getElementById('profileIban').value = acc.iban || '';
  document.getElementById('profileError').textContent = '';
  document.getElementById('profileSuccess').textContent = '';
}

function renderCheckout() {
  const entries = cartEntries();
  const totalMwst = entries.reduce((s, e) => s + e.p.mwstb * e.qty, 0);
  const totalVk = entries.reduce((s, e) => s + e.sum, 0);
  const prevByArt = state.checkoutPrevEntries;

  const acc = currentUserAccount();
  document.getElementById('checkoutVorname').textContent = acc ? (acc.vorname || '') : '';
  document.getElementById('checkoutNachname').textContent = acc ? (acc.nachname || '') : '';
  document.getElementById('checkoutIban').textContent = acc ? (acc.iban || '') : '';
  document.getElementById('checkoutPaymentReason').textContent = 'Bestellung - ' + currentMonthYear();

  const statusText = document.getElementById('checkoutCatalogStatusText');
  if (statusText) {
    statusText.textContent = state.catalogLastLoadedAt
      ? `Katalogstand: ${new Date(state.catalogLastLoadedAt).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })} Uhr`
      : 'Katalogstand: unbekannt';
  }

  // Artikel, die noch im Warenkorb liegen, aber inzwischen aus dem Katalog verschwunden sind
  // (z. B. nicht mehr im Sortiment) -- werden einmalig durchgestrichen mit angezeigt.
  const removedRows = [];
  if (prevByArt) {
    prevByArt.forEach((prev, art) => {
      if (state.cart[art] && !entries.some(e => e.p.art === art)) {
        removedRows.push(`
          <tr class="row-removed">
            <td>–</td>
            <td>${escapeHtml(prev.art)}</td>
            <td><s>${escapeHtml(prev.bez)}</s></td>
            <td>${escapeHtml(formatGebinde(prev.geb))}</td>
            <td><s>${money(prev.vk)}</s></td>
            <td>${pctFmt(prev.mwst)}</td>
            <td>${state.cart[art]}</td>
            <td>nicht mehr verfügbar</td>
          </tr>
        `);
      }
    });
  }

  const tbody = document.getElementById('checkoutRows');
  if (!entries.length && !removedRows.length) {
    tbody.innerHTML = `<tr><td colspan="8" class="empty">Warenkorb ist leer.</td></tr>`;
  } else {
    tbody.innerHTML = entries.map((e, i) => {
      const prev = prevByArt && prevByArt.get(e.p.art);
      const priceChanged = prev && !prev.unknown && Math.round(prev.vk * 100) !== Math.round(e.vk * 100);
      const priceUnknown = prev && prev.unknown;
      const confirmBtn = `<button class="confirm-price-btn btn-secondary btn-small" data-art="${escapeHtml(e.p.art)}">✓ passt so</button>`;
      const priceCell = priceChanged
        ? `<span class="price-old"><s>${money(prev.vk)}</s></span> <span class="price-new">${money(e.vk)}</span> ${confirmBtn}`
        : priceUnknown
          ? `${money(e.vk)} <span class="price-unknown-badge" title="Dieser Artikel lag schon länger im Warenkorb. Der angezeigte Preis ist der aktuell gültige -- bitte kurz bestätigen, dass er noch passt.">bitte bestätigen</span> ${confirmBtn}`
          : money(e.vk);
      return `
      <tr class="${priceChanged ? 'row-price-changed' : priceUnknown ? 'row-price-unknown' : ''}">
        <td>${i + 1}</td>
        <td>${escapeHtml(e.p.art)}</td>
        <td>${escapeHtml(e.p.bez)}</td>
        <td>${escapeHtml(formatGebinde(e.p.geb))}</td>
        <td>${priceCell}</td>
        <td>${pctFmt(e.p.mwst)}</td>
        <td>${e.qty}</td>
        <td>${money(e.sum)}</td>
      </tr>
    `;
    }).join('') + removedRows.join('');
  }

  const changedCount = prevByArt ? entries.filter(e => {
    const prev = prevByArt.get(e.p.art);
    return prev && !prev.unknown && Math.round(prev.vk * 100) !== Math.round(e.vk * 100);
  }).length : 0;
  const unknownCount = prevByArt ? entries.filter(e => {
    const prev = prevByArt.get(e.p.art);
    return prev && prev.unknown;
  }).length : 0;
  const notice = document.getElementById('checkoutChangesNotice');
  const loadErrorKats = state.lastCatalogLoadErrors || [];
  if (changedCount || unknownCount || removedRows.length || loadErrorKats.length) {
    const parts = [];
    if (changedCount) parts.push(`${changedCount} Preis${changedCount === 1 ? '' : 'e'} wurde${changedCount === 1 ? '' : 'n'} seit deiner Auswahl aktualisiert`);
    if (unknownCount) parts.push(`${unknownCount} Preis${unknownCount === 1 ? '' : 'e'} noch nicht bestätigt (Artikel liegen schon länger im Warenkorb)`);
    if (removedRows.length) parts.push(`${removedRows.length} Artikel ${removedRows.length === 1 ? 'ist' : 'sind'} nicht mehr verfügbar`);
    let html = parts.length
      ? `<div class="checkout-changes-notice">⚠️ ${parts.join(' · ')} — bitte unten in der jeweiligen Zeile mit „✓ passt so" bestätigen.</div>`
      : '';
    if (loadErrorKats.length) {
      html += `<div class="checkout-changes-notice checkout-load-error">⚠️ ${escapeHtml(loadErrorKats.join(', '))} konnte${loadErrorKats.length === 1 ? '' : 'n'} nicht neu geladen werden — angezeigte Preise in ${loadErrorKats.length === 1 ? 'dieser Kategorie' : 'diesen Kategorien'} könnten veraltet sein. Bitte Seite neu laden und erneut prüfen.</div>`;
    }
    notice.innerHTML = html;
  } else {
    notice.innerHTML = '';
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
  renderCategoryPriceConflicts();
  renderCategoryCsvList();
  renderSurchargeEditor();
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
  list.innerHTML = state.surcharges.map((s, i) => {
    // Bei einem frisch mit "+ Zuschlag hinzufügen" angelegten Posten ist s.art noch leer --
    // dann auf die Positionsnummer ausweichen, statt Screenreadern ein leeres Label zu geben.
    const label = s.art || `Zuschlagsposten ${i + 1}`;
    return `
    <div class="sc-edit-row" data-idx="${i}">
      <input type="text" class="sc-name-input" value="${escapeHtml(s.art)}" placeholder="Bezeichnung" aria-label="Bezeichnung für ${escapeHtml(label)}">
      <div class="sc-pct-wrap"><input type="number" step="0.1" class="sc-pct-input" value="${s.pct}" aria-label="Prozentsatz für ${escapeHtml(label)}"><span>%</span></div>
      <button class="sc-remove-btn" aria-label="${escapeHtml(label)} entfernen">✕</button>
    </div>
  `;
  }).join('');
  document.getElementById('computedTotalPct').textContent = pctFmt(totalSurchargePct());
}

const DATA_SOURCE_LABEL = {
  server: '✅ Vom Server geladen',
  local: '⚠️ Nur lokale Vorschau – noch nicht für alle sichtbar!',
  default: 'ℹ️ Bodan-Originaldaten (Server-Datei nicht erreichbar)'
};

// Dieselbe Artikel-Nr. darf absichtlich in mehreren Kategorien auftauchen (z. B. normale
// Kategorie + Monatsaktion). Weicht dabei aber der Preis zwischen den Kategorien voneinander ab
// (z. B. weil nur eine der beiden CSV-Kopien beim letzten Preis-Update aktualisiert wurde), löst
// das keinen Fehler aus -- cartEntries() wählt dann stillschweigend die zuletzt verarbeitete
// Kategorie, je nach Reihenfolge in CATEGORY_LIST. Das kann die Preisänderungs-Warnung in der
// Bestellübersicht unterdrücken, wenn ausgerechnet die "gewinnende" Kopie unverändert blieb.
// Deshalb hier für den Admin-Bereich sichtbar machen, statt es stillschweigend passieren zu lassen.
function findCategoryPriceConflicts() {
  const byArt = new Map();
  for (const p of state.products) {
    if (!byArt.has(p.art)) byArt.set(p.art, []);
    byArt.get(p.art).push(p);
  }
  const conflicts = [];
  byArt.forEach((list, art) => {
    if (list.length < 2) return;
    const cents = new Set(list.map(p => Math.round(p.preis * 100)));
    if (cents.size > 1) {
      conflicts.push({ art, bez: list[0].bez, entries: list.map(p => ({ kat: p.kat, preis: p.preis })) });
    }
  });
  conflicts.sort((a, b) => a.bez.localeCompare(b.bez, 'de'));
  return conflicts;
}

function renderCategoryPriceConflicts() {
  const box = document.getElementById('categoryPriceConflicts');
  if (!box) return;
  const conflicts = findCategoryPriceConflicts();
  if (!conflicts.length) { box.innerHTML = ''; return; }
  box.innerHTML = `
    <div class="price-conflict-notice">
      ⚠️ ${conflicts.length} Artikel ${conflicts.length === 1 ? 'hat' : 'haben'} in mehreren Kategorien unterschiedliche Preise hinterlegt.
      Dadurch kann im Warenkorb/der Bestellübersicht der falsche (alte) Preis angezeigt und eine Preiserhöhung dabei nicht als Warnung auffallen. Bitte angleichen:
      <ul class="price-conflict-list">
        ${conflicts.map(c => `
          <li><strong>${escapeHtml(c.art)}</strong> – ${escapeHtml(c.bez)}: ${c.entries.map(e => `${escapeHtml(e.kat)} ${money(e.preis)}`).join(' · ')}</li>
        `).join('')}
      </ul>
    </div>
  `;
}

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
        <button class="btn-danger btn-small cat-csv-remove">🗑️ Entfernen</button>
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
  let mwst = parseFloat(String(r.mwst).replace(',', '.')) || 0;
  // Ein korrupter MwSt-Wert wie "-100" würde unten eine Division durch 0 auslösen und als
  // "Infinity €"/"NaN €" beim Kunden landen -- auf einen sicheren Standardwert zurückfallen.
  if (!isFinite(mwst) || mwst <= -100) mwst = 0;
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
  state.dataSource.__surcharges = 'local';
  saveJSON(LS_KEYS.surcharges, state.surcharges);
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

async function deleteFromGitHub(filePath, commitMessage) {
  const cfg = getGithubConfig();
  if (!cfg || !cfg.owner || !cfg.repo || !cfg.token) {
    throw new Error('Kein GitHub-Zugang hinterlegt. Bitte zuerst unter „Veröffentlichung" speichern.');
  }
  const branch = cfg.branch || 'main';
  const apiUrl = `https://api.github.com/repos/${cfg.owner}/${cfg.repo}/contents/${filePath}`;
  const headers = { Authorization: `Bearer ${cfg.token}`, Accept: 'application/vnd.github+json' };

  const getRes = await fetch(`${apiUrl}?ref=${encodeURIComponent(branch)}`, { headers });
  if (getRes.status === 404) return; // Datei existiert serverseitig ohnehin nicht (mehr)
  if (getRes.status !== 200) throw new Error(githubErrorMessage(getRes.status));
  const sha = (await getRes.json()).sha;

  const delRes = await fetch(apiUrl, {
    method: 'DELETE',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: commitMessage, sha, branch })
  });
  if (!delRes.ok) throw new Error(githubErrorMessage(delRes.status));
}

/* ------------------------------------------------------------------ *
 *  Kategorien hinzufügen / entfernen                                  *
 *  Ändert, anders als der normale Kategorie-Inhalt-Upload, sofort     *
 *  live für alle Besucher: ohne eine aktuelle categories.json auf dem *
 *  Server würde deren Kategorie-Filter die neue/entfernte Kategorie   *
 *  sonst gar nicht erst sehen bzw. weiter anzeigen. Erfordert daher   *
 *  immer einen hinterlegten GitHub-Zugang (kein reiner Lokal-Modus).  *
 * ------------------------------------------------------------------ */

function uniqueCategoryFilePath(name) {
  const base = slugify(name) || 'kategorie';
  const used = new Set(Object.values(CATEGORY_FILES));
  let path = `data/${base}.csv`;
  let i = 2;
  while (used.has(path)) { path = `data/${base}-${i}.csv`; i++; }
  return path;
}

async function addCategoryFromFile(name, file) {
  name = String(name || '').trim();
  if (!name) throw new Error('Bitte einen Kategorienamen eingeben.');
  if (CATEGORY_LIST.includes(name)) throw new Error('Eine Kategorie mit diesem Namen gibt es bereits.');
  if (!file) throw new Error('Bitte eine CSV-Datei mit dem Inhalt der neuen Kategorie auswählen.');
  if (!hasGithubConfig()) throw new Error('Kein GitHub-Zugang hinterlegt. Bitte zuerst unter „Veröffentlichung" speichern.');

  const text = await readFile(file);
  const objs = rowsToObjects(parseCSV(text));
  if (!objs.length) throw new Error('CSV enthält keine Datenzeilen.');
  const mapped = objs.map(mapCsvRow);
  const missingBase = ['art', 'bez'].filter(k => !(k in mapped[0]));
  if (missingBase.length || !hasUsablePrice(mapped[0])) {
    throw new Error('CSV-Kopfzeile passt nicht. Erwartet werden entweder die Spalten "' +
      CATEGORY_CSV_HEADERS.join(', ') + '" oder das Bodan-Bestellsystem-Format mit "EK VPE".');
  }
  const newItems = mapped.map(r => productFromMappedRow(name, r)).filter(p => p.art && p.bez);
  const filePath = uniqueCategoryFilePath(name);
  const newConfig = currentCategoryConfig().concat([{ name, file: filePath }]);

  // Neue CSV-Datei und die aktualisierte Kategorienliste in einem Zug veröffentlichen --
  // nie nur eine von beiden, sonst stünde kurzzeitig eine Kategorie ohne Datei (oder eine
  // Datei ohne gelistete Kategorie) auf dem Server. CATEGORY_LIST/CATEGORY_FILES erst NACH
  // erfolgreichem Veröffentlichen übernehmen (applyCategoryConfig unten) -- schlägt einer der
  // beiden Publish-Aufrufe fehl (z. B. Netzwerkfehler), bleibt der In-Memory-Zustand sonst mit
  // einer "Phantom-Kategorie" zurück, die serverseitig gar nicht existiert.
  const csv = objectsToCSV(newItems.map(p => ({
    ArtikelNr: p.art, Bezeichnung: p.bez, Hersteller: p.hers, Land: p.land,
    Qualitaet: p.qual, Gebinde: p.geb, PreisInklMwst: p.preis, EntMwst: p.mwstb, MwstSatz: p.mwst
  })), CATEGORY_CSV_HEADERS);
  await publishToGitHub(filePath, csv, 'Neue Kategorie "' + name + '" angelegt (Admin-Panel)');
  await publishToGitHub(CATEGORIES_FILE, JSON.stringify(newConfig, null, 2),
    'Kategorie "' + name + '" zur Kategorienliste hinzugefügt (Admin-Panel)');

  applyCategoryConfig(newConfig);
  state.products = state.products.concat(newItems);
  state.catMeta[name] = { updated: Date.now(), source: file.name };
  state.dataSource[name] = 'server';
  saveJSON(LS_KEYS.products, state.products);
  saveJSON(LS_KEYS.catMeta, state.catMeta);
  saveJSON(LS_KEYS.dataSource, state.dataSource);
  state.page = 1;
  renderCategoryOptions();
  renderAll();
}

async function removeCategory(kat) {
  if (!hasGithubConfig()) throw new Error('Kein GitHub-Zugang hinterlegt. Bitte zuerst unter „Veröffentlichung" speichern.');
  const filePath = CATEGORY_FILES[kat];
  const newConfig = currentCategoryConfig().filter(c => c.name !== kat);

  // Erst die Kategorienliste veröffentlichen: sobald das durch ist, sehen Besucher die
  // Kategorie beim nächsten Laden nicht mehr. CATEGORY_LIST/CATEGORY_FILES erst NACH Erfolg
  // übernehmen (applyCategoryConfig unten), sonst würde ein fehlgeschlagener Publish die
  // Kategorie im Admin-Bereich bereits verschwinden lassen, obwohl sie serverseitig noch da ist.
  await publishToGitHub(CATEGORIES_FILE, JSON.stringify(newConfig, null, 2),
    'Kategorie "' + kat + '" entfernt (Admin-Panel)');
  applyCategoryConfig(newConfig);
  // Das Entfernen der (jetzt verwaisten) CSV-Datei danach ist nur noch Aufräumarbeit und
  // nicht mehr zeitkritisch -- die Kategorie ist für Besucher bereits weg.
  try {
    await deleteFromGitHub(filePath, 'Kategorie-Datei "' + kat + '" entfernt (Admin-Panel)');
  } catch (e) {
    // Die Kategorie ist für alle Besucher bereits weg (categories.json ist aktualisiert);
    // falls nur das Aufräumen der verwaisten CSV-Datei fehlschlägt, ist das unkritisch.
  }

  state.products = state.products.filter(p => p.kat !== kat);
  delete state.catMeta[kat];
  delete state.dataSource[kat];
  saveJSON(LS_KEYS.products, state.products);
  saveJSON(LS_KEYS.catMeta, state.catMeta);
  saveJSON(LS_KEYS.dataSource, state.dataSource);
  if (state.category === kat) state.category = '';
  state.page = 1;
  renderCategoryOptions();
  renderAll();
}

// Liefert "August 2026" (aktueller Bestellmonat) fuer Betreffzeile und Dateiname.
function currentMonthYear() {
  return new Date().toLocaleString('de-DE', { month: 'long', year: 'numeric' });
}

// Macht einen Text sicher fuer die Verwendung in Dateinamen (Umlaute transliteriert,
// alles andere zu "_").
function safeFilenamePart(str) {
  return (str || '')
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/Ä/g, 'Ae').replace(/Ö/g, 'Oe').replace(/Ü/g, 'Ue')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

// Export/E-Mail-Versand liegen auf der bereits geöffneten Bestellübersicht, lesen aber nur den
// gerade im Speicher stehenden Katalogstand (state.products) -- der kann veraltet sein, wenn die
// Bestellübersicht zwar offen blieb (z. B. nach "Exportieren") und der Katalog in der Zwischenzeit
// erneut aktualisiert wurde, bevor tatsächlich "E-Mail senden" geklickt wird. Deshalb hier (wie
// schon beim Öffnen in openCheckout()) noch einmal frisch laden und vergleichen, statt einen
// inzwischen veralteten Preis unbemerkt in Export/E-Mail zu übernehmen.
async function refreshCheckoutBeforeSend() {
  const changed = await refreshCheckoutAndDetectChanges();
  renderAll();
  return changed;
}

async function exportBestellliste() {
  if (await refreshCheckoutBeforeSend()) {
    showToast('Bitte unten die markierten Preise bestätigen und danach erneut exportieren.', true);
    return;
  }
  const entries = cartEntries();
  if (!entries.length) { showToast('Warenkorb ist leer.', true); return; }
  const acc = currentUserAccount();
  const totalVk = entries.reduce((s, e) => s + e.sum, 0);
  const lines = [];
  if (acc) {
    lines.push(['Vorname', acc.vorname || ''].map(toCSVField).join(','));
    lines.push(['Nachname', acc.nachname || ''].map(toCSVField).join(','));
    lines.push(['E-Mail', acc.email || ''].map(toCSVField).join(','));
    lines.push(['IBAN', acc.iban || ''].map(toCSVField).join(','));
  }
  if (lines.length) lines.push('');
  const objs = entries.map(e => ({
    artnr: e.p.art,
    bezeichnung: e.p.bez,
    gebinde: formatGebinde(e.p.geb),
    menge: e.qty,
    preis: money(e.vk),
    summe: money(e.sum)
  }));
  lines.push(objectsToCSV(objs, ['artnr', 'bezeichnung', 'gebinde', 'menge', 'preis', 'summe']));
  lines.push('');
  lines.push(['Gesamt-Bestellbetrag', money(totalVk)].map(toCSVField).join(','));

  const nameParts = acc ? [acc.vorname, acc.nachname].filter(Boolean).map(safeFilenamePart) : [];
  const filename = ['bestellliste', ...nameParts, safeFilenamePart(currentMonthYear())].filter(Boolean).join('_') + '.csv';
  downloadText(filename, lines.join('\r\n'));
}

// Bestellungen laufen über die Koordination, nicht direkt an Bodan -- die Mitglieder schicken
// ihre Einzelbestellung per E-Mail, die Koordination fasst alle zu einer Sammelbestellung
// zusammen. mailto: reicht dafür (kein Server/Backend nötig), kann aber keine Datei anhängen --
// deshalb zusätzlich zum CSV-Download.
const ORDER_EMAIL = 'alteeiche.info@gmail.com';

function buildOrderEmailBody(entries, totalVk) {
  const acc = currentUserAccount();
  const lines = ['Bestellung FoodCoop Alte Eiche', ''];
  if (acc) {
    lines.push('Vorname: ' + (acc.vorname || ''));
    lines.push('Nachname: ' + (acc.nachname || ''));
    lines.push('E-Mail: ' + (acc.email || ''));
    lines.push('IBAN: ' + (acc.iban || ''));
  }
  lines.push('', 'Artikel-Nr. | Bezeichnung | Gebinde | Menge | Preis | Summe');
  entries.forEach(e => {
    lines.push(`${e.p.art} | ${e.p.bez} | ${formatGebinde(e.p.geb)} | ${e.qty} | ${money(e.vk)} | ${money(e.sum)}`);
  });
  lines.push('', 'Gesamt-Bestellbetrag: ' + money(totalVk));
  return lines.join('\n');
}

async function emailBestellung() {
  if (await refreshCheckoutBeforeSend()) {
    showToast('Bitte unten die markierten Preise bestätigen und danach erneut senden.', true);
    return;
  }
  const entries = cartEntries();
  if (!entries.length) { showToast('Warenkorb ist leer.', true); return; }
  const acc = currentUserAccount();
  const totalVk = entries.reduce((s, e) => s + e.sum, 0);
  const nameForSubject = acc ? [acc.vorname, acc.nachname].filter(Boolean).join(' ') : '';
  const subject = 'Bestellung FoodCoop Alte Eiche – ' + currentMonthYear() + (nameForSubject ? ' – ' + nameForSubject : '');
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

// Liest eine Bestellliste-Sicherung (die App-eigene Export-CSV aus exportBestellliste(), oder
// eine einfache Liste von Artikelnummern) und liefert erkannte {artikelnummer: menge}-Paare
// sowie die Anzahl nicht erkannter Zeilen/Einträge zurück. Reine Text-Analyse, fasst den
// Warenkorb selbst nicht an -- das übernimmt importCartFromBackup().
function parseCartImportText(text) {
  const lines = String(text || '').split(/\r\n|\n|\r/);

  // Fall 1: App-eigene Bestellliste-CSV -- die Datei enthält davor/danach noch Käuferdaten und
  // die Gesamtsumme (keine einheitliche Tabelle), deshalb nur den Tabellenblock ab der erkannten
  // Kopfzeile bis zur nächsten Leerzeile auswerten.
  const headerIdx = lines.findIndex(l => /^\s*artnr\s*,\s*bezeichnung\s*,\s*gebinde\s*,\s*menge\b/i.test(l));
  if (headerIdx !== -1) {
    const tableLines = [lines[headerIdx]];
    for (let i = headerIdx + 1; i < lines.length && lines[i].trim() !== ''; i++) tableLines.push(lines[i]);
    const rows = rowsToObjects(parseCSV(tableLines.join('\n')));
    const entries = {};
    let unrecognized = 0;
    rows.forEach(r => {
      const art = (r.artnr || '').trim();
      const menge = parseInt(r.menge, 10);
      if (art && menge > 0) entries[art] = (entries[art] || 0) + menge;
      else unrecognized++;
    });
    return { entries, unrecognized };
  }

  // Fall 2: keine erkannte Tabelle -- Text als einfache Liste von Artikelnummern behandeln,
  // getrennt durch Komma, Semikolon, Zeilenumbruch oder Leerzeichen. Menge 1 je Nennung,
  // Mehrfachnennung derselben Nummer wird aufaddiert.
  const entries = {};
  let unrecognized = 0;
  String(text || '').split(/[,;\s]+/).map(t => t.trim()).filter(Boolean).forEach(t => {
    if (/^\d+$/.test(t)) entries[t] = (entries[t] || 0) + 1;
    else unrecognized++;
  });
  return { entries, unrecognized };
}

// Ergänzt den Warenkorb um die aus dem Backup erkannten Artikel -- addiert Mengen zu bereits
// vorhandenen Positionen, ersetzt den Warenkorb nie (ein bewusstes Ersetzen erreicht man selbst
// über "Leeren" + Import). Artikelnummern, die nicht mehr im Katalog existieren, werden gezählt
// und gemeldet statt sie unkommentiert wegzulassen.
function importCartFromBackup(text) {
  const { entries } = parseCartImportText(text);
  const arts = Object.keys(entries);
  if (!arts.length) { showToast('Keine Artikelnummern erkannt.', true); return; }

  const byArt = new Map(state.products.map(p => [String(p.art), p]));
  const pct = totalSurchargePct();
  let addedCount = 0, unknownCount = 0;
  arts.forEach(art => {
    const p = byArt.get(art);
    if (!p) { unknownCount++; return; }
    state.cart[art] = (state.cart[art] || 0) + entries[art];
    state.cartPriceSeen[art] = verkaufspreis(p.preis, pct);
    addedCount++;
  });
  saveJSON(currentCartKey(), state.cart);
  saveJSON(currentCartPriceKey(), state.cartPriceSeen);
  renderAll();

  // Nicht-numerischer Text (z. B. Produktnamen, falls jemand mehr als nur Artikelnummern
  // einfügt) wird bewusst NICHT gezählt/gemeldet -- das ist kein Fehler, nur Begleittext, und
  // eine hohe Zahl "X nicht erkannt" wirkt alarmierender, als es ist.
  const parts = [];
  if (addedCount) parts.push(`${addedCount} Position${addedCount === 1 ? '' : 'en'} zum Warenkorb hinzugefügt`);
  if (unknownCount) parts.push(`${unknownCount} Artikelnummer${unknownCount === 1 ? '' : 'n'} nicht im Katalog gefunden`);
  showToast(parts.join(' · '), !addedCount);

  // Nur bei mindestens einer tatsächlich übernommenen Position zuklappen -- bei "nichts erkannt"
  // bleibt die Box offen, damit direkt ein neuer Versuch möglich ist, ohne sie erst wieder
  // aufklappen zu müssen.
  if (addedCount) {
    const box = document.getElementById('cartImportBox');
    if (box) box.open = false;
  }
}

/* ------------------------------------------------------------------ *
 *  Events                                                             *
 * ------------------------------------------------------------------ */

function setQty(art, qty) {
  qty = Math.max(0, Math.floor(Number(qty) || 0));
  if (qty === 0) {
    delete state.cart[art];
    delete state.cartPriceSeen[art];
  } else {
    state.cart[art] = qty;
    // Aktuell angezeigten Preis als "gesehen" festhalten -- Basis für die Preisänderungs-Warnung
    // in der Bestellübersicht, siehe currentCartPriceKey().
    const p = state.products.find(pr => String(pr.art) === String(art));
    if (p) state.cartPriceSeen[art] = verkaufspreis(p.preis, totalSurchargePct());
  }
  saveJSON(currentCartKey(), state.cart);
  saveJSON(currentCartPriceKey(), state.cartPriceSeen);
  updateQtyUI(art, qty);
}

// Menge geändert: nur die betroffenen Stellen im DOM anfassen statt renderAll() aufzurufen.
// filteredProducts()/renderShop() durchsucht+sortiert bei jedem Aufruf den kompletten
// 10.486-Artikel-Katalog (gemessen ~15-50ms) und ersetzt alle sichtbaren Karten neu -- unnötig,
// weil eine Mengenänderung weder Filter noch Sortierung beeinflusst. Ein voller Grid-Neubau
// hätte außerdem aufgeklappte "Preisdetails" wieder zugeklappt und den Tastatur-/Screenreader-
// Fokus vom gerade angeklickten Button gerissen (der alte DOM-Knoten wird durch einen neuen
// ersetzt, der Fokus fällt dann auf <body> zurück).
function updateQtyUI(art, qty) {
  const card = Array.from(document.querySelectorAll('.card[data-art]')).find(el => el.dataset.art === String(art));
  if (card) {
    const input = card.querySelector('.qty-input');
    if (input) input.value = qty;
  }

  renderCartBadge();

  if (!state.cartOpen) return;

  const row = Array.from(document.querySelectorAll('.cart-item[data-art]')).find(el => el.dataset.art === String(art));
  if (qty > 0 && row) {
    // Zeile bleibt bestehen -- nur Menge/Summe aktualisieren, nicht die ganze Liste neu aufbauen.
    const entries = cartEntries();
    const entry = entries.find(e => e.p.art === art);
    if (entry) {
      row.querySelector('.ci-qty span').textContent = entry.qty;
      row.querySelector('.ci-sum').textContent = money(entry.sum);
    }
    renderCartSummary(entries);
  } else {
    // Zeile taucht neu auf oder verschwindet komplett -- dafür muss die Liste neu aufgebaut werden.
    renderCartDrawer();
  }
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
  // Warenkorb für das jetzt angemeldete Konto laden -- ohne das würde nach einem Kontowechsel
  // innerhalb derselben Sitzung (Abmelden -> anderes Konto anmelden, ohne Neuladen der Seite)
  // noch der Warenkorb des vorherigen Kontos im Speicher stehen bleiben.
  state.cart = loadJSON(currentCartKey(), {});
  state.cartPriceSeen = loadJSON(currentCartPriceKey(), {});
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

  // Escape schließt den Warenkorb-Drawer, Tab bleibt darin gefangen, solange er offen ist --
  // liest den aktuellen state.cartOpen live statt einen Listener bei jedem Öffnen/Schließen an-
  // und abzumelden, damit das auch bei Wegen funktioniert, die den Drawer ohne cartClose/cartOverlay
  // schließen (z. B. "Zur Bestellübersicht").
  document.addEventListener('keydown', e => {
    if (!state.cartOpen) return;
    if (e.key === 'Escape') {
      state.cartOpen = false; renderAll();
      return;
    }
    if (e.key === 'Tab') {
      const drawer = document.getElementById('cartDrawer');
      const focusables = Array.from(drawer.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'))
        .filter(el => !el.disabled && el.offsetParent !== null);
      if (!focusables.length) return;
      const first = focusables[0], last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });

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
        document.getElementById('regPass2').value,
        document.getElementById('regVorname').value,
        document.getElementById('regNachname').value,
        document.getElementById('regIban').value
      );
      document.getElementById('registerForm').reset();
      onAuthSuccess('Konto erstellt – willkommen!');
    } catch (ex) { err.textContent = ex.message; }
  });

  document.getElementById('profileForm').addEventListener('submit', e => {
    e.preventDefault();
    const err = document.getElementById('profileError');
    const ok = document.getElementById('profileSuccess');
    err.textContent = ''; ok.textContent = '';
    try {
      updateAccount(getSession().username, {
        vorname: document.getElementById('profileVorname').value,
        nachname: document.getElementById('profileNachname').value,
        email: document.getElementById('profileEmail').value,
        iban: document.getElementById('profileIban').value
      });
      ok.textContent = 'Gespeichert.';
    } catch (ex) { err.textContent = ex.message; }
  });

  document.getElementById('deleteAccountBtn').addEventListener('click', () => {
    if (!confirm('Konto wirklich endgültig löschen? Alle hinterlegten Daten (Benutzername, Passwort, Vorname, Nachname, E-Mail, IBAN) werden aus diesem Browser entfernt. Das kann nicht rückgängig gemacht werden.')) return;
    const s = getSession();
    if (!s) return;
    // Nur den eigenen Warenkorb entfernen -- den Schlüssel vor deleteAccount() ermitteln, weil
    // das darin enthaltene clearSession() sonst currentCartKey() schon auf niemanden mehr zeigt.
    localStorage.removeItem(cartKeyForUser(s.username));
    localStorage.removeItem(cartPriceKeyForUser(s.username));
    deleteAccount(s.username);
    state.cart = {};
    state.cartPriceSeen = {};
    state.cartOpen = false;
    state.view = 'auth';
    renderAll();
    showToast('Konto wurde gelöscht.');
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
    state.cart = {};
    state.cartPriceSeen = {};
    state.cartOpen = false;
    state.view = 'auth';
    renderAll();
  });

  /* ---- Shop ---- */
  // Debounced: filteredProducts() durchsucht+sortiert bei jedem Aufruf alle 10.486 Artikel
  // (gemessen ~15-50ms) -- ohne Debounce würde jeder einzelne Tastendruck das komplette Raster
  // neu berechnen und spürbar ruckeln.
  const debouncedShopSearch = debounce(() => { state.page = 1; renderShop(); }, 200);
  document.getElementById('searchInput').addEventListener('input', e => {
    state.query = e.target.value;
    debouncedShopSearch();
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
    openCheckout();
  });
  document.getElementById('cartClearBtn').addEventListener('click', () => {
    if (confirm('Warenkorb wirklich leeren?')) {
      state.cart = {};
      state.cartPriceSeen = {};
      saveJSON(currentCartKey(), state.cart);
      saveJSON(currentCartPriceKey(), state.cartPriceSeen);
      renderAll();
    }
  });

  document.getElementById('cartImportFile').addEventListener('change', async e => {
    const file = e.target.files[0]; if (!file) return;
    try {
      const text = await readFile(file);
      importCartFromBackup(text);
    } catch (err) { showToast('Fehler beim Lesen der Datei: ' + err.message, true); }
    e.target.value = '';
  });
  document.getElementById('cartImportTextBtn').addEventListener('click', () => {
    const field = document.getElementById('cartImportText');
    importCartFromBackup(field.value);
    field.value = '';
  });

  document.querySelectorAll('[data-nav]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!isLoggedIn()) return;
      state.view = btn.dataset.nav; renderAll(); window.scrollTo(0, 0);
    });
  });

  document.getElementById('backToShopBtn').addEventListener('click', () => { state.view = 'shop'; renderAll(); });

  document.getElementById('reloadPricesBtn').addEventListener('click', async () => {
    const btn = document.getElementById('reloadPricesBtn');
    btn.disabled = true;
    btn.textContent = '🔄 Lädt …';
    try {
      await refreshCheckoutAndDetectChanges();
    } finally {
      btn.disabled = false;
      btn.textContent = '🔄 Preise neu laden';
      renderAll();
    }
  });

  document.getElementById('backFromImpressumBtn').addEventListener('click', () => {
    state.view = isLoggedIn() ? 'shop' : 'auth';
    renderAll();
  });

  // Eigener Handler statt der generischen [data-nav]-Bindung, da diese ein Login voraussetzt --
  // das Impressum muss aber auch ohne Anmeldung erreichbar sein.
  document.getElementById('impressumLink').addEventListener('click', () => {
    state.view = 'impressum';
    renderAll();
    window.scrollTo(0, 0);
  });

  document.getElementById('goToMyAccountLink').addEventListener('click', () => {
    state.view = 'profile';
    renderAll();
  });

  document.getElementById('printBtn').addEventListener('click', () => window.print());
  document.getElementById('exportBestellungBtn').addEventListener('click', exportBestellliste);
  document.getElementById('emailBestellungBtn').addEventListener('click', emailBestellung);

  // "✓ passt so" steht pro Zeile direkt neben dem markierten Preis (in renderCheckout() erzeugt) --
  // deshalb hier per Event-Delegation auf dem (statischen) Tabellen-Container abgefangen, statt bei
  // jedem Rendern neue Listener zu binden.
  document.getElementById('checkoutRows').addEventListener('click', e => {
    const btn = e.target.closest('.confirm-price-btn');
    if (!btn) return;
    const art = btn.dataset.art;
    // state.cartPriceSeen ist schon beim Laden (refreshCheckoutAndDetectChanges) auf den aktuell
    // angezeigten Preis aktualisiert worden -- hier wird nur noch die Markierung für GENAU diesen
    // Artikel in der Anzeige ausgeblendet, kein erneuter Serverabruf nötig.
    if (state.checkoutPrevEntries) state.checkoutPrevEntries.delete(art);
    renderCheckout();
  });

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
    if (e.target.classList.contains('cat-csv-remove')) {
      const btn = e.target;
      const kat = btn.closest('.cat-csv-row').dataset.kat;
      if (!confirm('Kategorie "' + kat + '" wirklich entfernen? Das wird sofort für alle Besucher veröffentlicht und kann nur durch erneutes Anlegen rückgängig gemacht werden.')) return;
      const label = btn.textContent;
      btn.disabled = true; btn.textContent = '🗑️ Entferne …';
      try {
        await removeCategory(kat);
        showToast('Kategorie "' + kat + '" entfernt und veröffentlicht.');
        renderAdmin();
      } catch (err) {
        showToast('Fehler beim Entfernen: ' + err.message, true);
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

  document.getElementById('addCategoryForm').addEventListener('submit', async e => {
    e.preventDefault();
    const nameInput = document.getElementById('newCategoryName');
    const fileInput = document.getElementById('newCategoryFile');
    const btn = document.getElementById('addCategoryBtn');
    const label = btn.textContent;
    btn.disabled = true; btn.textContent = '➕ Lege an …';
    try {
      await addCategoryFromFile(nameInput.value, fileInput.files[0]);
      showToast('Kategorie "' + nameInput.value.trim() + '" angelegt und veröffentlicht.');
      document.getElementById('addCategoryForm').reset();
      renderAdmin();
    } catch (err) {
      showToast('Fehler: ' + err.message, true);
    } finally {
      btn.disabled = false; btn.textContent = label;
    }
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
    state.catMeta = {};
    state.dataSource = {};
    saveJSON(LS_KEYS.products, state.products);
    saveJSON(LS_KEYS.surcharges, state.surcharges);
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
  // role="alert" (assertive) für Fehler, sonst role="status" (polite) -- damit Screenreader
  // den Hinweis überhaupt vorlesen; vorher gab es keinerlei Ankündigung für blinde Nutzer.
  t.setAttribute('role', isError ? 'alert' : 'status');
  t.textContent = msg;
  t.classList.toggle('error', !!isError);
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3500);
}

document.addEventListener('DOMContentLoaded', init);

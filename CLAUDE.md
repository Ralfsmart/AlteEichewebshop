# FoodCoop Alte Eiche — Webshop (CLAUDE.md)

Diese Datei ist für einen **eigenen Chat**, der ausschließlich an diesem Webshop-Code arbeitet —
getrennt von der Bestellverarbeitung (die hat ihre eigene CLAUDE.md unter
`..\Bestellungen\CLAUDE.md`, ein komplett anderes, unabhängiges Thema). Bitte nicht vermischen.

## Was das hier ist

Ein Webshop für die Einkaufsgemeinschaft FoodCoop Alte Eiche — **komplett ohne eigenes Backend,
ohne Datenbank**, nur statische Dateien (HTML/CSS/JS/CSV), gehostet über **GitHub Pages**:
`https://ralfsmart.github.io/AlteEichewebshop/`. Repo: `https://github.com/Ralfsmart/AlteEichewebshop`
(Branch `main`). Lokaler Klon liegt bereits hier in diesem Ordner, Remote `origin` ist bereits
korrekt gesetzt.

Ausführliche Nutzerdoku für den Admin/die Mitglieder: `README.md` in diesem Ordner sowie
`FoodCoopAlteEicheWebshopAnleitung.docx/.pdf`. Diese CLAUDE.md ist dagegen für die
Zusammenarbeit mit Claude gedacht: Architektur, Fallstricke, wie getestet wird.

## WICHTIGSTE FALLE: Das Repo wird auch OHNE Git verändert

Der Admin-Bereich der Seite selbst schreibt über die **GitHub Contents API direkt ins Repository**
(Button „🚀 Veröffentlichen" bzw. die Kategorie-Hinzufügen/Entfernen-Buttons, siehe unten) — das
läuft komplett am lokalen Git-Klon vorbei, direkt aus dem Browser des Nutzers. Diese Commits
erscheinen auf GitHub mit Autor **„Ralfsmart"** und Nachrichten wie
`"<Kategorie> aktualisiert (Admin-Panel)"`.

**Das bedeutet:** Der lokale Klon hier kann jederzeit veraltet sein, auch nach wenigen Minuten —
der Nutzer pflegt den Produktkatalog laufend direkt über die Live-Seite. Das hat in dieser Session
bereits zu einem großen, unerwarteten Diff geführt (330 Zeilen Unterschied in `app.js`, mehrere
neue/umbenannte Kategorien, neues Feature „Warenkorb pro Benutzerkonto").

**Vorgehen, IMMER, bevor Code geändert wird:**
1. `git fetch origin && git log HEAD..origin/main --oneline` — zeigt, was sich seit dem letzten
   lokalen Stand getan hat.
2. `git pull` (bzw. bei eigenen uncommiteten Änderungen: `git rebase origin/main`, Konflikte sind
   meist auf denselben kleinen Codeabschnitt begrenzt, den man gerade selbst bearbeitet).
3. Erst dann weiterarbeiten. Nach eigenen Änderungen: committen, pushen — und idealerweise direkt
   auf der Live-Seite (oder per `curl`) stichprobenartig prüfen, ob der Deploy angekommen ist
   (GitHub Pages braucht bis zu ~1 Minute).

## Architektur

- `index.html` — die gesamte Seite (Shop, Checkout, Profil, Admin-Bereich, Impressum), alles in
  einer Datei mit mehreren `<div id="view-...">`-Blöcken, die per `.hidden`-Klasse ein-/ausgeblendet
  werden (siehe `renderAll()` in app.js).
- `js/app.js` — die gesamte Anwendungslogik, ein zentrales `state`-Objekt, kein Framework, kein
  Build-Schritt. ~1800 Zeilen. Wichtigste Bereiche:
  - Katalog laden (`loadServerCatalog`, `fetchCsvFile`) und parsen (`parseCategoryRows`,
    `productFromMappedRow` — unterstützt zwei CSV-Formate, siehe Kommentare im Code).
  - Preisberechnung (`verkaufspreis`, `totalSurchargePct`, Grundpreis in `parseGrundpreis`).
  - Warenkorb (`cartEntries`, `renderCartDrawer`, `renderCheckout`) — **pro Benutzerkonto**
    gespeichert (`cartKeyForUser`/`currentCartKey()`, localStorage-Key `ws_cart_<username>`,
    NICHT mehr ein einziger globaler Schlüssel — das war mal ein Bug, der gefixt wurde).
  - Admin-Funktionen: Katalog-Upload/-Export/-Veröffentlichen je Kategorie, Zuschläge pflegen,
    **Kategorien anlegen/entfernen** (siehe eigener Abschnitt unten), GitHub-Zugang verwalten.
  - GitHub-Veröffentlichung: `publishToGitHub()` (PUT, legt an oder überschreibt),
    `deleteFromGitHub()` (DELETE), `githubErrorMessage()` für verständliche Fehlermeldungen
    (401/403/404/409 abgedeckt).
- `js/auth.js` — Kundenkonten + Admin-Passwort. **Kein Server, keine echte Sicherheit**: Passwörter
  sind gesalzen SHA-256-gehasht, aber alles liegt im Klartext-JSON in `localStorage`
  (`ws_users`, `ws_admin`, `ws_session`). Passwort-Reset für Kunden = Username+E-Mail-Abgleich
  auf demselben Gerät, kein echter Mail-Versand. **Admin-Passwort vergessen** hat keinen
  eingebauten Reset-Weg — Fix: im Browser-DevTools-Konsole `localStorage.removeItem('ws_admin')`
  ausführen (siehe Git-Historie dieses Chats für den vollen Wortlaut, den der Nutzer schon
  einmal bekommen hat).
- `js/csv.js` — minimaler CSV-Parser/-Serializer (RFC4180-artig, erkennt Komma vs. Semikolon aus
  der Kopfzeile).
- `js/data-default.js` — eingebettete Bodan-Originaldaten als Fallback (`window.DEFAULT_PRODUCTS`),
  greift wenn `data/*.csv` nicht erreichbar ist (z. B. offline, `file://`-Aufruf ohne Server).
- `data/categories.json` — **die Kategorienliste selbst**, s.u.
- `data/*.csv` — ein File pro Kategorie, Name frei wählbar (z. B. `data/getraenke.csv`).
- `data/zuschlaege.csv` — Unkostenzuschlag-Prozentsätze (Admin pflegt diese separat).
- `serve.ps1` — winziger lokaler Static-File-Server für Tests (siehe „Testen" unten).
- `build-data.ps1`, `split-categories.ps1`, `export.ps1`, `extract-logo.ps1`, `crop-logo.ps1` —
  einmalige/gelegentliche Hilfsskripte aus der Ersteinrichtung, für den Alltag nicht relevant.

## Kategorien-System (von Claude in dieser Session eingeführt, Stand Oktober 2026)

Ursprünglich war die Kategorienliste fest im Code verdrahtet (`CATEGORY_LIST`/`CATEGORY_FILES`
als `const`). Jetzt sind das `let`-Variablen, die beim Laden aus **`data/categories.json`**
befüllt werden (`loadCategoriesConfig()`, aufgerufen in `init()` vor dem ersten Render) — Format:
```json
[{ "name": "Trockenware", "file": "data/trockenware.csv" }, ...]
```
`DEFAULT_CATEGORY_CONFIG` im Code ist nur der Fallback, falls die Datei mal nicht erreichbar ist.

**Admin kann jetzt Kategorien anlegen/entfernen** (Abschnitt „Produktkatalog je Kategorie"):
- Anlegen (`addCategoryFromFile`): Name + CSV-Upload → Datei-Pfad wird automatisch aus dem Namen
  generiert (`uniqueCategoryFilePath`, slugifiziert, kollisionssicher) → veröffentlicht **sofort**
  (nicht erst als lokale Vorschau wie der normale Katalog-Upload) die neue CSV-Datei **und**
  die aktualisierte `categories.json` in einem Zug.
- Entfernen (`removeCategory`): veröffentlicht sofort die aktualisierte `categories.json`,
  löscht danach best-effort auch die verwaiste CSV-Datei aus dem Repo.
- Beide Aktionen ändern `CATEGORY_LIST`/`CATEGORY_FILES` **erst nach erfolgreichem
  Veröffentlichen** (nicht vorher) — sonst bliebe bei einem fehlgeschlagenen Publish-Call eine
  Phantom-Kategorie im Admin-Bereich zurück, die serverseitig gar nicht existiert (das war ein
  echter Bug, der gefixt und mit gemocktem `fetch` getestet wurde).
- Beide Aktionen brauchen zwingend einen hinterlegten GitHub-Zugang (kein Lokal-Modus wie beim
  normalen Katalog-Upload) — sonst würde die Änderung im Kategorie-Filter anderer Besucher gar
  nicht ankommen.

**Bekannter, gefixter Folgefehler:** `loadServerCatalog()` hat beim Zusammenführen von
frisch abgerufenen mit bereits vorhandenen Produkten (`others`) nur nach „wurde diese Kategorie
gerade neu abgerufen" gefiltert, nicht danach, ob die Kategorie überhaupt noch existiert. Wurde
eine Kategorie entfernt, blieben ihre Artikel dadurch bei jedem Browser, der sie vorher schon
geladen hatte, für immer im `localStorage`-Cache hängen und tauchten im Kategorie-Filter weiter
auf. Fix: `others` zusätzlich gegen die aktuelle `CATEGORY_LIST` filtern. **Falls so ein
„Geister-Artikel/-Kategorie"-Symptom nochmal auftaucht: zuerst serverseitig prüfen
(`curl .../data/categories.json`, `curl -o /dev/null -w "%{http_code}" .../data/<file>.csv`,
siehe „Diagnose" unten), bevor vermutet wird, der Code sei kaputt — der Server-Stand war in
diesem Fall bereits korrekt, nur der Browser-Cache des Nutzers nicht.**

Warenkorb-Einträge referenzieren Artikel nur über die Artikel-Nr. (`state.cart[art]`), nicht über
die Kategorie — ein Produkt, das in eine andere/umbenannte Kategorie verschoben wird (gleiche
Artikel-Nr.), bleibt im Warenkorb unterbrechungsfrei erhalten. Verschwindet ein Artikel dagegen
ganz (Kategorie komplett entfernt), zeigt der Warenkorb-Drawer dafür einen dezenten Hinweis
(„X Artikel sind nicht mehr im Katalog …", `cart-stale-notice`), und spätestens beim Öffnen der
Bestellübersicht wird er zusätzlich explizit durchgestrichen mit „nicht mehr verfügbar" angezeigt
(`openCheckout`/`renderCheckout`, vergleicht Vorher/Nachher-Snapshot).

## GitHub-Veröffentlichung — Token-Handling

Admin trägt Token unter „Veröffentlichung (GitHub)" ein (`ghOwner`, `ghRepo`, `ghBranch`,
`ghToken` im Admin-Formular), gespeichert in `localStorage` (`ws_github_config`), **im Klartext**.
Nötige Berechtigung: Fine-grained Personal Access Token, nur auf `AlteEichewebshop` beschränkt,
„Contents: Read and write". Token läuft irgendwann ab (401 „GitHub hat das Token abgelehnt") —
dann muss der Nutzer unter github.com/settings/tokens?type=beta ein neues erzeugen und im
Adminbereich hinterlegen (keine Claude-Aktion nötig/möglich, das ist reine Nutzerinteraktion im
Browser).

## Testen

Kein Build-Schritt, kein `npm install` — einfach `serve.ps1` starten:
```powershell
powershell -NoProfile -File serve.ps1 -Port 8899
```
(`.claude\launch.json` ist bereits für `preview_start` mit dem Namen `webshop` eingerichtet.)

**Admin-Bereich ohne echten Login testen** (z. B. um neue Admin-Features zu prüfen, ohne jedes Mal
ein Konto anzulegen): im Browser-JS direkt
```js
state.view = 'admin';
sessionStorage.setItem('ws_admin_unlocked', '1');
renderAll();
```

**GitHub-Veröffentlichung testen, ohne echte Netzwerkaufrufe/Repo-Änderungen auszulösen**: `fetch`
im Browser-JS mocken, bevor man die Admin-Funktion aufruft, danach wiederherstellen:
```js
const realFetch = window.fetch;
window.fetch = async (url, opts) => ({ ok: true, status: (opts && opts.method === 'GET') ? 404 : 200, json: async () => ({}) });
await addCategoryFromFile('Test', new File(['ArtikelNr,Bezeichnung,Hersteller,Land,Qualitaet,Gebinde,PreisInklMwst,EntMwst,MwstSatz\n1,T,H,L,Q,1kg,1,0,0'], 't.csv'));
window.fetch = realFetch;
```
So wurden Erfolgs- UND Fehlerpfade (abgelehntes Publish mittendrin) in dieser Session geprüft,
bevor überhaupt etwas Echtes auf GitHub landete.

**Diagnose auf der Live-Seite** (ohne Login/Browser, einfach von der Konsole aus):
```bash
curl -s "https://ralfsmart.github.io/AlteEichewebshop/data/categories.json?t=$(date +%s)"
curl -s -o /dev/null -w "%{http_code}\n" "https://ralfsmart.github.io/AlteEichewebshop/data/<datei>.csv?t=$(date +%s)"
```
Der `?t=...`-Parameter umgeht Caching. Deploy-Verzögerung nach einem Push: bis zu ~1 Minute.

## Sonstige Hinweise

- Alle Preise/Mengenangaben sind deutsch formatiert (`de-DE`, Komma als Dezimaltrennzeichen) —
  siehe `money()`/`pctFmt()`.
- Such-/Filterlogik unterstützt mehrere kommagetrennte Begriffe mit UND→ODER-Fallback
  (`filteredProducts()`).
- Keine Tests/CI in diesem Repo — Verifikation passiert manuell wie oben beschrieben.
- Node ist auf diesem Rechner installiert, `node --check js/app.js` eignet sich als schneller
  Syntax-Check vor dem Commit (kein Linter/Formatter eingerichtet).

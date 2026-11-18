---
name: webshop-test
description: Testet den FoodCoop-Webshop lokal und auf der Live-Seite, inklusive Admin-Bereich ohne echten Login und GitHub-Veröffentlichung ohne echte Netzwerkaufrufe. Nutzen bei Änderungen an js/app.js, js/auth.js, dem Admin-Bereich oder vor jedem Commit.
---

# Webshop testen

Kein Build-Schritt, kein `npm install`.

## 1. Lokal starten

```powershell
powershell -NoProfile -File serve.ps1 -Port 8899
```
(`.claude/launch.json` ist für `preview_start` mit dem Namen `webshop` eingerichtet.)

## 2. Admin-Bereich ohne echten Login

Im Browser-JS (Konsole oder `javascript_tool`):
```js
state.view = 'admin';
sessionStorage.setItem('ws_admin_unlocked', '1');
renderAll();
```

## 3. GitHub-Veröffentlichung ohne echte Netzwerkaufrufe/Repo-Änderungen

`fetch` im Browser-JS mocken, bevor die Admin-Funktion aufgerufen wird, danach wiederherstellen:
```js
const realFetch = window.fetch;
window.fetch = async (url, opts) => ({ ok: true, status: (opts && opts.method === 'GET') ? 404 : 200, json: async () => ({}) });
await addCategoryFromFile('Test', new File(['ArtikelNr,Bezeichnung,Hersteller,Land,Qualitaet,Gebinde,PreisInklMwst,EntMwst,MwstSatz\n1,T,H,L,Q,1kg,1,0,0'], 't.csv'));
window.fetch = realFetch;
```
Damit lassen sich Erfolgs- UND Fehlerpfade (abgelehntes Publish mittendrin) prüfen, bevor etwas Echtes auf GitHub landet.

## 4. Diagnose auf der Live-Seite (ohne Login/Browser)

```bash
curl -s "https://ralfsmart.github.io/AlteEichewebshop/data/categories.json?t=$(date +%s)"
curl -s -o /dev/null -w "%{http_code}\n" "https://ralfsmart.github.io/AlteEichewebshop/data/<datei>.csv?t=$(date +%s)"
```
Der `?t=...`-Parameter umgeht Caching. Deploy-Verzögerung nach einem Push: bis zu ~1 Minute.

## 5. Vor jedem Commit

```bash
node --check js/app.js
```

## 6. Vor jeder Codeänderung (wichtigste Falle)

Das Admin-Panel schreibt live über die GitHub Contents API ins Repository — unabhängig vom lokalen Git-Klon, der dadurch jederzeit veraltet sein kann:
```bash
git fetch origin && git log HEAD..origin/main --oneline
git pull
```
Erst danach weiterarbeiten.

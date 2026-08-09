# FoodCoop Alte Eiche — Webshop

Ein Webshop für die Einkaufsgemeinschaft, komplett ohne eigene Datenbank und ohne
Server-Backend (keine PHP-/Node-/Python-Anwendung nötig — nur statische Dateien). Der
Produktkatalog stammt aus `Bodan_Bestellung_26_Juni.xls` und wird über CSV-Dateien
aktualisiert.

## Online stellen (Hosting)

Weil es nur HTML/CSS/JS/CSV-Dateien sind, reicht **jedes statische Hosting** — GitHub Pages,
Netlify, Vercel, oder ein klassischer Webspace per FTP. Einfach den kompletten `webshop`-Ordner
hochladen, `index.html` als Startseite.

**Wichtig — zwei unterschiedliche Speicherorte:**

| Was | Wo gespeichert | Für alle Mitglieder sichtbar? |
|---|---|---|
| Produktkatalog & Zuschläge | `data/*.csv` auf dem Hosting, per `fetch()` bei jedem Seitenaufruf geladen | ✅ Ja, sofort für jeden, der die Seite öffnet |
| Kundenkonten, Warenkorb, Admin-Passwort | `localStorage` im Browser des jeweiligen Geräts | ❌ Nein, gerätegebunden |

Das heißt: Wenn ein Mitglied sich auf seinem Handy registriert, ist dieses Konto **nur auf
diesem Handy** bekannt — auf einem anderen Gerät muss es sich erneut registrieren. Das lässt
sich ohne echte Datenbank/Backend nicht auflösen; für eine kleine, vertrauensbasierte
Einkaufsgemeinschaft mit Selbstregistrierung ist das aber ein akzeptabler Kompromiss.

Der Produktkatalog dagegen **ist** für alle gleich, weil er als Datei vom Server geladen wird
(siehe „Daten aktualisieren" unten) — nur ihn zu ändern erfordert einen echten Deploy-Schritt,
es sei denn, die optionale GitHub-Veröffentlichung ist eingerichtet (siehe unten).

## Direktes Veröffentlichen über GitHub (optional)

Standardmäßig braucht eine Katalog-Änderung immer den manuellen Weg: Exportieren → Datei im
Hosting ersetzen → neu deployen. Wird der Shop stattdessen über **GitHub Pages** gehostet,
lässt sich das abkürzen: Im Admin-Bereich unter „Veröffentlichung (GitHub)" hinterlegt, erscheint
bei jeder Kategorie und bei den Zuschlägen ein Button „🚀 Veröffentlichen", der die Datei direkt
im Repository aktualisiert — ganz ohne Download/Upload von Hand.

**Einrichtung:**
1. Repository auf GitHub anlegen und den `webshop`-Ordner hineinpushen.
2. Unter „Settings → Pages" GitHub Pages für dieses Repository aktivieren (Branch `main`,
   Root-Verzeichnis).
3. Ein **fein-granulares Zugriffstoken** erstellen: GitHub → Settings → Developer settings →
   Personal access tokens → Fine-grained tokens → „Generate new token". Dabei:
   - **Repository access:** nur auf dieses eine Repository beschränken (nicht „All repositories").
   - **Permissions:** nur `Contents` → `Read and write`, sonst nichts.
   - **Expiration:** ein Ablaufdatum setzen (z. B. 90 Tage) statt "No expiration".
4. Im Admin-Bereich unter „Veröffentlichung (GitHub)" Benutzername/Organisation, Repository-Name,
   Branch (meist `main`) und das Token eintragen und speichern.

**Sicherheitshinweis:** Das Token wird nur lokal in diesem Browser gespeichert (localStorage),
aber im Klartext. Jeder mit Zugriff auf dieses Gerät könnte es auslesen. Ein auf ein einziges
Repository und nur „Contents: Read and write" beschränktes Token begrenzt den Schaden im
Missbrauchsfall auf genau dieses eine Repository — deshalb unbedingt kein Token mit vollem
Konto- oder Organisationszugriff hier eintragen. Über „Token entfernen" lässt es sich jederzeit
wieder löschen.

Ohne diese Einrichtung funktioniert der Shop genauso wie zuvor — die „Veröffentlichen"-Buttons
erscheinen einfach nicht, und der manuelle Export+Ersetzen-Weg bleibt verfügbar.

## Lokal testen / offline nutzen

Einfach `index.html` doppelklicken und im Browser öffnen. Ohne Internetzugriff auf die
`data/*.csv`-Dateien (z. B. per Doppelklick als `file://`) fällt der Shop automatisch auf die
eingebetteten Bodan-Originaldaten zurück — funktioniert also auch offline, nur eben nicht mit
geteilten Aktualisierungen.

Für einen lokalen Test mit echtem Server liegt ein kleiner bei:

```bash
powershell -ExecutionPolicy Bypass -File serve.ps1
```

Danach `http://localhost:8899/` öffnen.

## Zugang für Kunden

Beim ersten Aufruf erscheint eine Anmeldeseite. Mitglieder registrieren sich selbst mit
Benutzername, E-Mail-Adresse und Passwort — danach ist der Shop freigeschaltet. Passwörter
werden **gesalzen gehasht** (SHA-256) gespeichert, nie im Klartext.

**Wichtig zur Sicherheit:** Da alles im Browser läuft und es keinen Server gibt, ist das kein
Schutz gegen technisch versierte Angreifer (der Speicher lässt sich im Browser einsehen). Für
eine kleine, vertrauensbasierte Einkaufsgemeinschaft ist das ein sinnvoller Kompromiss — für
sensible Daten wäre es das nicht.

Im Admin-Bereich unter **„Kundenkonten"** lassen sich alle registrierten Konten als CSV
exportieren (Spalten: `Benutzername, EMail, Salt, Hash, Erstellt`) oder aus einer CSV wieder
einspielen (z. B. um Konten zu sichern oder auf ein anderes Gerät zu übertragen). Da Konten nur
lokal im Browser des jeweiligen Mitglieds liegen, zeigt dieser Bereich immer nur die Konten,
die auf **diesem** Gerät registriert wurden — die Verwaltung hat keinen Zugriff auf Konten
anderer Mitglieder und kann sie folglich auch nicht zurücksetzen.

**Passwort vergessen:** Auf der Login-Seite gibt es dafür „Passwort vergessen?" — das Mitglied
bestätigt Benutzername und die hinterlegte E-Mail-Adresse (beides muss zum lokal gespeicherten
Konto passen) und vergibt direkt ein neues Passwort. Läuft komplett ohne E-Mail-Versand oder
Eingriff der Verwaltung, passend zur Architektur ohne zentrale Datenbank.

## Admin-Zugang

„Daten verwalten" ist zusätzlich mit einem eigenen **Admin-Passwort** geschützt (unabhängig von
den Kundenkonten). Beim allerersten Aufruf muss dieses Passwort einmalig festgelegt werden.
Danach fragt der Verwaltungsbereich bei jedem neuen Besuch erneut danach (Entsperrung gilt nur
für die aktuelle Browser-Sitzung). Das Passwort lässt sich jederzeit in der Verwaltung ändern.

## Daten aktualisieren

Im Admin-Bereich („Daten verwalten", nach Passworteingabe):

- **Produktkatalog je Kategorie:** Für jede der 5 Kategorien (Trockenware, Drogerie/Kosmetik/
  Nonfood, Getränke alkoholisch, Getränke alkoholfrei, Feinkost/Veganer Ersatz) gibt es eine
  eigene Upload-/Download-Zeile. Ein Upload zeigt zunächst nur eine **lokale Vorschau** in
  deinem eigenen Browser (Kennzeichnung „⚠️ Nur lokale Vorschau").
  Zwei CSV-Formate werden automatisch erkannt:
  - eigenes/Original-Bodan-Format: `ArtikelNr, Bezeichnung, Hersteller, Land, Qualitaet,
    Gebinde, PreisInklMwst, EntMwst, MwstSatz` (Preis bereits brutto inkl. MwSt.)
  - Export direkt aus Bodans Bestellsystem („bodan2-*.csv"): `ArtNr, Bezeichnung, Hersteller,
    Land, Qualität, Gebinde, EK Ladeneinheit, EK VPE, UVP, EAN, MwSt` — „EK VPE" gilt als
    Netto-Einkaufspreis je Gebinde und wird automatisch um die MwSt. hochgerechnet
  **Um die Änderung für alle Mitglieder sichtbar zu machen:** „Exportieren" klicken und die
  heruntergeladene Datei im Hosting unter dem angezeigten Pfad ersetzen (z. B.
  `data/trockenware.csv`), dann neu deployen (Git-Push, FTP-Upload o. ä.). Danach zeigt die
  Zeile wieder „✅ Vom Server geladen".
- **„🔄 Alle Kategorien vom Server neu laden"** verwirft eine lokale Vorschau wieder und holt
  den aktuell veröffentlichten Stand zurück (mit Sicherheitsabfrage). Eine lokale Vorschau
  übersteht dagegen ein normales Neuladen der Seite (F5) — sie bleibt erhalten, bis sie
  entweder veröffentlicht oder bewusst über diesen Button verworfen wird.
- **Zuschläge:** Jeder Zuschlagsposten (Rücklage, Bankkosten, Fahrtkosten, …) hat ein eigenes,
  direkt bearbeitbares Namens- und Prozent-Feld im Admin-Bereich. Die Felder werden automatisch
  aufsummiert zum Gesamt-Zuschlag. Mit „+ Zuschlag hinzufügen" lassen sich weitere Posten
  anlegen, mit „✕" entfernen. Alternativ CSV mit `Art, Prozentsatz` hochladen (ersetzt alle
  Felder) oder den Gesamt-Zuschlag manuell überschreiben (Override-Feld). Genau wie beim
  Katalog liegt die gemeinsame Version in `data/zuschlaege.csv` auf dem Hosting — nach dem
  Bearbeiten „Exportieren" und dort ersetzen, damit alle Mitglieder den neuen Zuschlag sehen.
- **Zurücksetzen** stellt die eingebetteten Original-Bodan-Daten wieder her (Kundenkonten
  bleiben erhalten) — unabhängig davon, was aktuell auf dem Server liegt.

Die mitgelieferten `data/*.csv`-Dateien (eine je Kategorie) sind zugleich die Startvorlage
**und** die live vom Shop geladene Datenquelle.

## Mehrwertsteuer

Jeder Artikel behält seinen **original aus der Bodan-Liste übernommenen MwSt.-Satz** (7 % oder
19 %, artikelgenau) — das wurde bewusst nicht verändert, um mit den tatsächlichen Bodan-Preisen
konsistent zu bleiben.

## Preisberechnung

Für jeden Artikel:

```
Bodan-Preis (inkl. MwSt., artikelgenau 7 % oder 19 %)
+ Zuschlag der Gemeinschaft (Rücklage, Bankkosten, Fahrtkosten, … — Standard: 8 %)
= Verkaufspreis
```

Der Zuschlag deckt die Kosten der Einkaufsgemeinschaft (Banküberweisung, Fahrt zur Abholung,
Rücklage) und wird auf den Bodan-Bruttopreis aufgeschlagen.

**Der Zuschlag ist für Kunden nie einzeln sichtbar** — im Shop, Warenkorb und in der
Bestellübersicht erscheint ausschließlich der fertige Verkaufspreis sowie der MwSt.-Satz (7 %
oder 19 %). Die Aufschlüsselung in Bodan-Preis und Zuschlag ist ausschließlich im
Admin-Bereich einsehbar.

## Bestellung abschließen

Warenkorb → „Zur Bestellübersicht": zeigt alle Positionen mit Preis, MwSt.-Satz, Menge und
Summe, dazu Name/Adresse/Bankverbindung (wie im Original-Bestellformular). Von dort aus:

- **Drucken** — Druckansicht der Bestellübersicht
- **Bestellliste als CSV herunterladen** — Spalte `artnr` (Artikelnummer), `menge` (Anzahl) und
  `kommentar` (Produktbezeichnung, zur besseren Lesbarkeit)
- **Bestellung per E-Mail senden** — öffnet das E-Mail-Programm mit vorausgefüllter Nachricht
  an `alteeiche.info@gmail.com` (Koordination), inklusive aller Positionen und Kontaktdaten.
  Die Mitglieder schicken ihre Einzelbestellung dorthin; die Koordination fasst alle zu einer
  Sammelbestellung bei Bodan zusammen. Das läuft über einen normalen `mailto:`-Link (kein
  Server/Backend nötig) — die CSV-Datei lässt sich bei Bedarf zusätzlich manuell anhängen, da
  `mailto:` selbst keine Anhänge unterstützt. Die Empfänger-Adresse steht als Konstante
  `ORDER_EMAIL` in `js/app.js`.

## Aufbau

- `index.html`, `css/style.css`, `js/app.js`, `js/auth.js`, `js/csv.js` — die App
- `img/logo.png` — aus der Original-Exceldatei extrahiertes FoodCoop-Alte-Eiche-Logo
- `img/veggies-banner.svg` — selbst gestaltete Gemüse-Illustration (Login-Hintergrund)
- `img/fruits-market.svg` — selbst gestaltete, bunte Markt-Illustration (Hintergrund der
  Shop-Hauptseite; Such-/Filterleiste und Produktkarten liegen als weiß/grünlich
  halbtransparente Flächen darüber)
- `js/data-default.js` — der ursprüngliche Bodan-Katalog (10.486 Artikel), eingebettet als
  JavaScript, damit die Seite auch offline/per Doppelklick ohne Server funktioniert
- `data/*.csv` — dieselben Daten als CSV, eine Datei je Kategorie plus Zuschläge (Ausgangspunkt
  zum Bearbeiten in Excel)
- `export.ps1` — liest die Original-`.xls`-Datei erneut aus (per Excel-COM, falls Bodan eine
  neue Bestellliste schickt)
- `split-categories.ps1` — teilt `data/produkte.csv` in die 5 Kategorie-CSVs auf
- `build-data.ps1` — wandelt `data/*.csv` in `js/data-default.js` um

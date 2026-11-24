# KIT StudyFlow (v18) – KI-Wochenplaner & Fokus-Tracker

Eine kostenlose, build-freie Web-App (PWA) für dein Maschinenbau-Studium am KIT – läuft offlinefähig auf **Windows 11 (Firefox/Chrome)** und **Pixel 9a (Chrome)** mit verschlüsseltem QR-Pairing und Cloud-Sync über deinen eigenen privaten GitHub Gist.

---

## Überblick der 5 Bereiche
1. **Heute:** Tages-Fokusring (Focus-Friend-kompatibler `max`-Modus), schnelles Abhaken mit **1-Tap-Dauer-Chips**, rollierender **5-Tage-Vorarbeiten-Hebel**, Live-Timer, Anki-Tagesstand (Detailkarte ausklappbar) sowie Aufwach- & Koffein-Tracker.
2. **Wochenplan:** 7-Tage-Uni-Checkliste mit Drag-&-Drop / 1-Klick-Verschieben (am Handy mit fingerfreundlichem `•••`-Aktionsmenü), **Tools-Menü** (Semesterplan-Scanner per Bridge oder API, Checkliste kopieren, `.ics`-Upload), **Offener Rückstand** mit Autopilot, **Eigene feste Termine** (mit optionaler Nacharbeits-Dauer), **KIT-Modul-Regeln** & **Aufgaben-Katalog** (automatische P75-Kalibrierung ab 2 Sessions).
3. **KI-Planer:** Gemini-Chat (API mit Auto-Fallback) + **Gemini-Pro-Bridge** für Wochen-Checkliste, **Plan prüfen** & **Wochen-Rückblick** (inkl. flexibler Rhythmus-Orientierung).
4. **Statistik:** 14-Tage-Trend, Fach-Verteilung, Wochenvergleich, Heatmap, Koffein-/Schlaf-Analyse und vollständige Eintrags-Historie.
5. **Erfolge & Setup:** Stufen, Abzeichen, kompakte Einstellungen, GitHub-Gist-Sync (**Jetzt syncen** & **Gerät koppeln**; Notfall-Funktionen und Wochen-Archive unter *Erweitert & Notfall*), Backup/Restore.

---

## 1. Lokal auf Windows 11 starten
Einfach einen **Doppelklick auf `start-lokal.bat`** machen (funktioniert direkt mit Windows PowerShell – kein Node.js oder Python nötig). Die App öffnet sich einheitlich unter `http://127.0.0.1:8080`.

---

## 2. Kostenlos auf GitHub Pages hosten (in 3 Minuten, 0 €)
1. Erstelle auf [github.com/new](https://github.com/new) ein neues Repository (z. B. `kit-studyflow`).
2. Lade alle Dateien und Ordner dieses Projekts hoch (inkl. `.github/workflows/sync-webcal.yml`).
3. Gehe im Repo auf **Settings → Pages**:
   - **Source:** *Deploy from a branch*
   - **Branch:** `main` / `/ (root)` → **Save**.
4. Nach ca. 1 Minute ist deine App unter `https://<DEIN-USERNAME>.github.io/kit-studyflow/` online.
5. **Auf dem Pixel 9a (Chrome):** URL öffnen → Menü (`⋮`) → **„Zum Startbildschirm hinzufügen“** → App installieren (startet danach dank Service Worker auch offline).

---

## 3. Cloud-Sync & Gerät koppeln (Privater GitHub Gist)
1. Erstelle auf GitHub unter **Settings → Developer settings → Personal access tokens → Tokens (classic)** einen Token **nur** mit dem Scope **`gist`**.
2. Öffne die App am Laptop → **Erfolge & Setup → Einstellungen → GitHub Gist Cloud-Sync**:
   - Token eintragen, **Erweitert & Notfall** öffnen und **„Privaten Gist anlegen“** klicken.
   - Danach auf **„Jetzt syncen“** klicken.
3. **Pixel 9a koppeln:** Klicke am Laptop auf **„Gerät koppeln“**, vergib eine **PIN (AES-256-GCM-Verschlüsselung ist Standard)** und scanne den QR-Code – oder füge den `P1...`-Code am Handy unter **Gerät koppeln → Mit Code verbinden** ein.
   *(Hinweis: Bei lokalem Start unter `127.0.0.1` im Modal einmalig deine GitHub-Pages-URL als Ziel eintragen, da `127.0.0.1` am Handy nicht erreichbar ist.)*

---

## 4. Automatischer KIT-WebCal-Abruf (GitHub Action)
Damit dein KIT-Stundenplan alle 6 Stunden automatisch aktuell bleibt (separat in `kit-calendar.ics` gespeichert, ohne deinen WebCal-Link zu veröffentlichen):
1. Im GitHub-Repo unter **Settings → Secrets and variables → Actions → New repository secret** diese 3 Secrets anlegen:
   - `KIT_WEBCAL_URL` → Dein persönlicher WebCal-Link aus dem KIT-Campus-Portal
   - `GIST_TOKEN` → Dein GitHub Token aus Schritt 3
   - `GIST_ID` → Deine private Gist-ID aus Schritt 3
2. Unter **Actions → Sync KIT WebCal to Private Gist → Run workflow** auslösen.
3. Beim nächsten Öffnen oder Klick auf **Jetzt syncen** lädt die App den KIT-Stundenplan automatisch aus dem Gist.

*(Alternativ jederzeit über **Wochenplan → Tools → KIT-Kalender (.ics) laden** oder in den Einstellungen direkt hochladen.)*

---

## 5. Gemini KI-Planer & AnkiConnect einrichten
- **Gemini KI (API & Pro-Bridge):** Unter **Erfolge & Setup → Einstellungen → Gemini KI-Planer** deinen Google-AI-Studio-Key eintragen und **„Verbindung testen“** klicken (Key wird per HTTP-Header `x-goog-api-key` gesendet und standardmäßig **nicht** im Gist gespeichert). Ohne API-Key oder bei API-Lastspitzen funktionieren Wochenplanung, Plan-Prüfung, Wochen-Rückblick und Semesterplan-Scanner jederzeit über die **Gemini-Pro-Bridge**.
- **Altes Fokus-Tracker-Backup importieren:** Unter **Einstellungen → Backup & Fokus-Tracker Import** deine JSON-Datei laden oder als Text einfügen.
- **AnkiConnect (Windows 11, wichtig für Sicherheit):**
  In Anki unter *Extras → Erweiterungen → AnkiConnect → Konfiguration* **niemals** `"webCorsOriginList": ["*"]` setzen, sondern ausschließlich deine konkreten App-Origins freigeben:
  ```json
  {
    "apiKey": null,
    "apiLogPath": null,
    "webBindAddress": "127.0.0.1",
    "webBindPort": 8765,
    "webCorsOriginList": [
      "https://<DEIN-USERNAME>.github.io",
      "http://127.0.0.1:8080"
    ]
  }
  ```
  Danach Anki neu starten. Unterwegs am Handy greift der Hinweis *„Sync am Laptop mit Anki“* (oder manuelle Karten-Eingabe als Fallback).

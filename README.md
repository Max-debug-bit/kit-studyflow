# KIT StudyFlow – KI-Wochenplaner & Fokus-Tracker

Eine kostenlose, build-freie Web-App (PWA) für dein Maschinenbau-Studium am KIT – läuft auf **Windows 11 (Firefox)** und **Pixel 9a (Chrome)** mit Cloud-Sync über deinen eigenen privaten GitHub Gist.

---

## 1. Lokal auf Windows 11 sofort testen
Einfach einen **Doppelklick auf `start-lokal.bat`** machen (funktioniert direkt mit Windows PowerShell – kein Node.js oder Python nötig). Die App startet unter `http://127.0.0.1:8080`.

---

## 2. Kostenlos auf GitHub Pages hosten (in 3 Minuten, 0 €)
1. Erstelle auf [github.com/new](https://github.com/new) ein neues Repository (z. B. `kit-studyflow`).
2. Lade alle Dateien und Ordner dieses Projekts hoch (inkl. `.github/workflows/sync-webcal.yml` – einfach per *Add file → Upload files* oder GitHub Desktop).
3. Gehe im Repo auf **Settings → Pages**:
   - **Source:** *Deploy from a branch*
   - **Branch:** `main` / `/ (root)` → **Save**.
4. Nach ca. 1 Minute ist deine App unter `https://<DEIN-USERNAME>.github.io/kit-studyflow/` online!
5. **Auf dem Pixel 9a (Chrome):** Öffne die URL → Menü (`⋮`) → **„Zum Startbildschirm hinzufügen“** → App installieren.

---

## 3. Cloud-Sync zwischen Laptop & Pixel 9a (Privater GitHub Gist)
1. Erstelle auf GitHub unter **Settings → Developer settings → Personal access tokens → Tokens (classic)** einen neuen Token und setze **nur** den Haken bei **`gist`**.
2. Öffne deine App → **Erfolge & Setup → Einstellungen → GitHub Gist Cloud-Sync**:
   - Füge den Token ein und klicke auf **„Neuen privaten Gist anlegen“**.
   - Kopiere dir die erzeugte **Gist-ID**.
3. Auf dem **Pixel 9a**: Denselben Token + dieselbe **Gist-ID** eintragen → **„Cloud übernehmen“** klicken. Ab jetzt synchronisieren sich beide Geräte automatisch!

---

## 4. Automatischer KIT-WebCal-Abruf (GitHub Action)
Damit dein KIT-Stundenplan alle 6 Stunden automatisch aktuell bleibt (ohne deinen privaten WebCal-Link öffentlich zu zeigen):
1. Gehe in deinem GitHub-Repo auf **Settings → Secrets and variables → Actions → New repository secret** und lege 3 Secrets an:
   - `KIT_WEBCAL_URL` → Dein persönlicher WebCal-Link aus dem KIT-Campus-Portal
   - `GIST_TOKEN` → Dein GitHub Token aus Schritt 3
   - `GIST_ID` → Deine private Gist-ID aus Schritt 3
2. Gehe im Repo auf **Actions → Sync KIT WebCal to Private Gist → Run workflow**.
3. Beim nächsten Öffnen (oder Klick auf das Sync-Symbol) lädt deine App den KIT-Stundenplan automatisch aus deinem privaten Gist!

*(Alternativ kannst du jederzeit unter „Woche“ oder „Einstellungen“ auch einfach eine `.ics`-Datei direkt hochladen.)*

---

## 5. Gemini KI-Planer & AnkiConnect einrichten
- **Gemini KI:** Unter **Erfolge & Setup → Einstellungen → Gemini KI-Planer** deinen kostenlosen Google-AI-Studio-Key eintragen und auf **„Verbindung testen“** klicken. Standardmodell ist `gemini-3.8-flash` (mit automatischem Fallback bei Lastspitzen). Zusätzlich steht im Tab **KI-Planer** jederzeit die **Gemini-Pro-Bridge** bereit.
- **Altes Fokus-Tracker-Backup importieren:** Unter **Einstellungen → Backup & Fokus-Tracker Import** einfach deine bisherige JSON-Datei laden oder einfügen.
- **AnkiConnect (Windows 11):** In Anki unter *Extras → Erweiterungen → AnkiConnect → Konfiguration* deine App-URL unter `"webCorsOriginList"` ergänzen (z. B. `"https://<DEIN-USERNAME>.github.io"` und `"http://127.0.0.1:8080"`), Anki neu starten – fertig! Unterwegs am Pixel 9a greift automatisch Option B (manuelle Kartenanzahl).

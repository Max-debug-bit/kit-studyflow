// Tab 5: "Erfolge & Setup" – Monochrome Achievements & Full Settings

import {
  store,
  LEVELS,
  fmtMin,
  fmtHours,
  toDateStr,
  toTimeStr,
  escapeHtml as esc
} from '../store.js';
import { AVAILABLE_MODELS, testGeminiConnection } from '../gemini.js';
import { createPrivateGist, pullFromGist, pushToGist, syncNow, listGistArchives, restoreArchiveSnapshot, normalizeGistId, isGistConfigured } from '../sync.js';
import { syncModulesFromIcs } from '../ics.js';
import { syncAnkiConnect, setManualAnki, getAnkiLoadSummary } from '../anki.js';
import { renderQrSvg, encodePairingCode } from '../qr.js';
import { icon } from '../icons.js';

let activeSubtab = 'achievements';

export function setMoreSubtab(tab) {
  if (tab === 'achievements' || tab === 'settings') activeSubtab = tab;
}

export function renderMoreView(root, ctx) {
  const { toast, applyTheme, openModal, closeModal, handlePairingCodeFlow } = ctx;
  const st = store.getOverallStats();
  const anki = getAnkiLoadSummary();
  const lastBackupText = store.state.lb
    ? new Date(store.state.lb).toLocaleString('de-DE')
    : 'Noch kein Backup';

  root.innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="page-title">${activeSubtab === 'achievements' ? 'Erfolge & Stufen' : 'Einstellungen & Sync'}</h1>
        <div class="small muted">Stufen, Abzeichen, GitHub-Sync, Gemini KI, AnkiConnect & Backup</div>
      </div>
      <div class="segmented">
        <button id="sub-ach" class="${activeSubtab === 'achievements' ? 'active' : ''}">Erfolge</button>
        <button id="sub-set" class="${activeSubtab === 'settings' ? 'active' : ''}">Einstellungen</button>
      </div>
    </div>

    ${activeSubtab === 'achievements' ? `
      <div class="stack">
        <section class="card">
          <div class="row-between" style="margin-bottom:10px;">
            <div>
              <div class="xs soft mono">STUFE ${st.levelIdx + 1} / ${LEVELS.length}</div>
              <div style="font-size:1.3rem;font-weight:760;letter-spacing:-0.02em;">${st.level.name}</div>
            </div>
            <div style="text-align:right;">
              <div class="mono" style="font-weight:720;font-size:1.1rem;">${fmtHours(st.totalLearn)}</div>
              <div class="xs muted">${st.nextLevel ? `Noch ${fmtHours(st.nextLevel.minHours * 60 - st.totalLearn)} bis ${st.nextLevel.name}` : 'Höchststufe erreicht'}</div>
            </div>
          </div>
          <div class="progress-track">
            <div class="progress-fill" style="width:${st.levelProgress.toFixed(1)}%;"></div>
          </div>
          <div class="row" style="margin-top:12px;gap:6px;">
            ${LEVELS.map((lv, i) => `<span class="pill ${i <= st.levelIdx ? 'kit' : ''}">${lv.name} (${lv.minHours}h)</span>`).join('')}
          </div>
        </section>

        <section class="card">
          <div class="card-header">
            <h2 class="card-title">${icon('award', 15)} Abzeichen (${st.badges.filter((b) => b.unlocked).length} / ${st.badges.length})</h2>
          </div>
          <div class="badges-grid">
            ${st.badges.map((b) => `
              <div class="badge-card ${b.unlocked ? 'unlocked' : 'locked'}">
                <div class="badge-head">
                  ${icon(b.ico || 'award', 16)}
                  <span class="xs mono">${b.unlocked ? 'AKTIV' : 'OFFEN'}</span>
                </div>
                <div class="badge-name">${esc(b.name)}</div>
                <div class="badge-desc">${esc(b.desc)}</div>
              </div>
            `).join('')}
          </div>
        </section>
      </div>
    ` : `
      <div class="stack">
        <!-- 1. Fokus-Tracker & Vorlesungs-Automatik -->
        <section class="card">
          <div class="card-header">
            <h2 class="card-title">${icon('target', 15)} Fokus-Tracker & Darstellung</h2>
          </div>
          <form id="set-core-form" class="stack">
            <div class="field-grid">
              <div class="field"><label>Mindestziel (Minuten)</label><input type="number" id="s-goal" class="input mono" min="15" max="960" value="${store.state.goal}" /></div>
              <div class="field"><label>Standard-Schlafzeit</label><input type="time" id="s-sleep" class="input mono" value="${store.state.sl}" /></div>
              <div class="field">
                <label>Design</label>
                <select id="s-theme" class="input">
                  <option value="dark" ${store.state.theme === 'dark' ? 'selected' : ''}>Schwarz (Standard)</option>
                  <option value="light" ${store.state.theme === 'light' ? 'selected' : ''}>Hell</option>
                  <option value="auto" ${store.state.theme === 'auto' ? 'selected' : ''}>System</option>
                </select>
              </div>
            </div>
            <label class="row" style="cursor:pointer;">
              <input type="checkbox" id="s-sunfree" ${store.state.planningPrefs?.sundayFree !== false ? 'checked' : ''} />
              <span class="small">Sonntag standardmäßig frei lassen (außer Anki-Reviews) & Serie am Sonntag schützen</span>
            </label>
            <label class="row" style="cursor:pointer;">
              <input type="checkbox" id="s-autolec" ${store.state.autoLogLectures ? 'checked' : ''} />
              <span class="small">Besuchte Live-Vorlesungen aus dem KIT-Kalender automatisch als Vorlesung / Produktiv verbuchen</span>
            </label>
            <details style="padding:8px 10px;border-radius:var(--radius-xs);background:var(--bg-soft);border:1px solid var(--border);">
              <summary class="xs muted" style="cursor:pointer;font-weight:580;">Erweiterte Parameter (Zählregel, Koffein-Limit, Start-Puffer &amp; Anki-Minimum)</summary>
              <div class="field-grid" style="margin-top:10px;">
                <div class="field">
                  <label>Zählregel</label>
                  <select id="s-mode" class="input">
                    <option value="max" ${store.state.mode === 'max' ? 'selected' : ''}>Höchster Wert (Focus Friend)</option>
                    <option value="last" ${store.state.mode === 'last' ? 'selected' : ''}>Letzter Eintrag</option>
                    <option value="sum" ${store.state.mode === 'sum' ? 'selected' : ''}>Alles addieren</option>
                  </select>
                </div>
                <div class="field"><label>Koffein-Limit (mg)</label><input type="number" id="s-cl" class="input mono" min="50" max="1000" value="${store.state.cl || 400}" /></div>
                <div class="field"><label>Aufwachen freie Tage</label><input type="time" id="s-wakefree" class="input mono" value="${store.state.planningPrefs?.defaultWakeFreeDay || '10:00'}" /></div>
                <div class="field"><label>Start-Puffer freie Tage (min)</label><input type="number" id="s-offset" class="input mono" min="0" max="180" value="${store.state.planningPrefs?.freeDayStartOffsetMin ?? 45}" /></div>
                <div class="field"><label>Mindest-Anki / Tag (min)</label><input type="number" id="s-minanki" class="input mono" min="5" max="180" value="${store.state.anki.minDailyAnkiMin || 30}" /></div>
                <div class="field"><label>Ruhetag-Ziel (min)</label><input type="number" id="s-restmin" class="input mono" min="0" max="180" value="${store.state.planningPrefs?.restDayMinMinutes ?? 30}" /></div>
              </div>
            </details>
            <div class="row" style="justify-content:flex-end;">
              <button type="submit" class="btn btn-primary btn-sm">Speichern</button>
            </div>
          </form>
        </section>

        <!-- 2. Gemini KI -->
        <section class="card">
          <div class="card-header">
            <h2 class="card-title">${icon('spark', 15)} Gemini KI-Planer</h2>
          </div>
          <div class="stack">
            <div class="field-grid">
              <div class="field" style="grid-column: span 2;">
                <label>Gemini API-Key (Google AI Studio · Kostenlose Stufe)</label>
                <input type="password" id="s-gkey" class="input mono" value="${esc(store.state.ai.apiKey || '')}" placeholder="AQ.... oder AIza..." autocomplete="off" />
              </div>
              <div class="field">
                <label>Modell (mit Auto-Fallback)</label>
                <select id="s-gmodel" class="input">
                  ${AVAILABLE_MODELS.map((m) => `<option value="${m.id}" ${store.state.ai.model === m.id ? 'selected' : ''}>${esc(m.label)}</option>`).join('')}
                </select>
              </div>
            </div>
            <div class="field">
              <label>Studien-Profil für die KI</label>
              <textarea id="s-notes" class="input">${esc(store.state.ai.studyNotes || '')}</textarea>
            </div>
            <label class="row" style="cursor:pointer;">
              <input type="checkbox" id="s-sync-gkey" ${store.state.ai.syncApiKeyInGist ? 'checked' : ''} />
              <span class="small">Gemini API-Key im privaten GitHub Gist mitsynchronisieren</span>
            </label>
            <div class="row">
              <button class="btn btn-primary btn-sm" id="btn-save-ai">Speichern</button>
              <button class="btn btn-sm" id="btn-test-ai">Verbindung testen</button>
            </div>
          </div>
        </section>

        <!-- 3. GitHub Gist Sync -->
        <section class="card">
          <div class="card-header">
            <h2 class="card-title">${icon('cloud', 15)} GitHub Gist Cloud-Sync (Win 11 ↔ Pixel 9a)</h2>
            <div class="row" style="gap:6px;">
              <span class="pill">App v21</span>
              <span class="pill ${store.secrets.lastSyncStatus === 'ok' ? 'kit' : store.secrets.lastSyncStatus === 'err' ? 'danger' : ''}">
                ${store.secrets.lastSyncAt ? `Sync ${toTimeStr(new Date(store.secrets.lastSyncAt))}` : 'Lokal'}
              </span>
            </div>
          </div>
          <div class="xs muted mono" style="margin:-4px 0 10px;line-height:1.6;">
            <div><strong>Lokal:</strong> ${store.state.e.length} Zeiten · ${(store.state.checklist || []).length} Todos · ${(store.state.backlog || []).length} Rückstände · ${Object.keys(store.state.eventOverrides || {}).length} Ausfälle · ${anki.totalDue} Ankis</div>
            ${store.secrets.lastRemoteSummary
              ? `<div><strong>Cloud (Gist ${esc(store.secrets.lastRemoteSummary.gistIdShort || normalizeGistId(store.secrets.gistId).slice(0, 8))}…):</strong> ${store.secrets.lastRemoteSummary.e} Zeiten · ${store.secrets.lastRemoteSummary.chk} Todos · ${store.secrets.lastRemoteSummary.bl} Rückstände · ${store.secrets.lastRemoteSummary.ov} Ausfälle · ${store.secrets.lastRemoteSummary.anki} Ankis (${esc(store.secrets.lastRemoteSummary.action || 'Sync')})</div>`
              : `<div><strong>Cloud:</strong> ${store.secrets.gistId ? `Gist ${esc(normalizeGistId(store.secrets.gistId).slice(0, 8))}… (noch nicht abgeglichen)` : 'Noch kein Gist verbunden'}</div>`}
          </div>
          <div class="field-grid" style="margin-bottom:10px;">
            <div class="field"><label>GitHub Token (Classic, Scope: <code>gist</code>)</label><input type="password" id="s-ghtoken" class="input mono" value="${esc(store.secrets.githubToken || '')}" placeholder="ghp_..." autocomplete="off" /></div>
            <div class="field"><label>Privater Gist-ID</label><input type="text" id="s-gistid" class="input mono" value="${esc(store.secrets.gistId || '')}" placeholder="leer lassen zum Neuerstellen" /></div>
          </div>
          <label class="row" style="cursor:pointer;margin-bottom:10px;">
            <input type="checkbox" id="s-autosync" ${store.secrets.autoSync ? 'checked' : ''} />
            <span class="small">Änderungen automatisch synchronisieren</span>
          </label>
          <div class="row">
            <button class="btn btn-primary btn-sm" id="btn-sync-now">${icon('refresh', 13)} Jetzt syncen</button>
            <button class="btn btn-sm" id="btn-pair-open">${icon('spark', 13)} Gerät koppeln</button>
          </div>
          <details style="margin-top:10px;padding:8px 10px;border-radius:var(--radius-xs);background:var(--bg-soft);border:1px solid var(--border);">
            <summary class="xs muted" style="cursor:pointer;font-weight:580;">Erweitert &amp; Notfall (Überschreiben, Archive, Gist anlegen, Cache)</summary>
            <div class="row" style="margin-top:10px;gap:6px;">
              <button class="btn btn-sm" id="btn-save-gist">Zugangsdaten speichern</button>
              <button class="btn btn-sm" id="btn-create-gist">${icon('plus', 13)} Privaten Gist anlegen</button>
              <button class="btn btn-sm" id="btn-gist-archives">${icon('calendar', 13)} Wochen-Archive</button>
              <button class="btn btn-sm" id="btn-push-gist" title="Überschreibt die Cloud direkt mit diesem Gerät">${icon('upload', 13)} Lokal → Cloud</button>
              <button class="btn btn-sm" id="btn-pull-gist" title="Lädt den kompletten Stand aus der Cloud auf dieses Gerät">${icon('download', 13)} Cloud → Lokal</button>
              <button class="btn btn-sm" id="btn-force-update" title="Leert nur den App-Cache (deine Daten bleiben 100 % erhalten)">App-Update erzwingen</button>
            </div>
          </details>
          ${store.secrets.lastArchiveWeek ? `<div class="xs soft" style="margin-top:6px;">Letztes automatisches Wochen-Archiv: <span class="mono">${esc(store.secrets.lastArchiveWeek)}</span> (behält letzte 4 Wochen)</div>` : ''}
          ${store.secrets.lastSyncError ? `<div class="xs" style="color:var(--danger);margin-top:8px;">Fehler: ${esc(store.secrets.lastSyncError)}</div>` : ''}
        </section>

        <!-- 4. KIT WebCal & AnkiConnect -->
        <div class="grid-2">
          <section class="card">
            <div class="card-header"><h2 class="card-title">${icon('calendar', 15)} KIT-WebCal (.ics)</h2></div>
            <p class="xs muted" style="margin-top:0;">
              ${store.state.icsUpdatedAt ? `Stand: ${new Date(store.state.icsUpdatedAt).toLocaleString('de-DE')}` : 'Noch kein Kalender geladen.'}<br/>
              Automatisch über die GitHub Action oder direkter Datei-Upload:
            </p>
            <label class="btn btn-primary btn-sm" style="cursor:pointer;">
              ${icon('upload', 13)} .ics Datei importieren
              <input type="file" accept=".ics,text/calendar" id="set-ics-file" class="hidden" />
            </label>
          </section>

          <section class="card">
            <div class="card-header"><h2 class="card-title">${icon('layers', 15)} AnkiConnect & Option B</h2></div>
            <div class="field-grid" style="margin-bottom:10px;">
              <div class="field">
                <label>Modus</label>
                <select id="s-anki-mode" class="input">
                  <option value="auto" ${store.state.anki.mode === 'auto' ? 'selected' : ''}>AnkiConnect + Fallback</option>
                  <option value="manual" ${store.state.anki.mode === 'manual' ? 'selected' : ''}>Manuell (Option B)</option>
                </select>
              </div>
              <div class="field"><label>URL</label><input type="text" id="s-anki-url" class="input mono" value="${esc(store.state.anki.url || 'http://127.0.0.1:8765')}" /></div>
            </div>
            <div class="field-grid" style="margin-bottom:10px;">
              <div class="field"><label><span class="anki-dot blue"></span>Neu (Sek./Karte)</label><input type="number" id="s-anki-snew" class="input mono" min="5" max="240" value="${store.state.anki.secNew || 45}" /></div>
              <div class="field"><label><span class="anki-dot red"></span>Rot (Sek./Karte)</label><input type="number" id="s-anki-slearn" class="input mono" min="5" max="240" value="${store.state.anki.secLearn || 30}" /></div>
              <div class="field"><label><span class="anki-dot green"></span>Grün (Sek./Karte)</label><input type="number" id="s-anki-srev" class="input mono" min="5" max="240" value="${store.state.anki.secReview || 15}" /></div>
            </div>
            <label class="row" style="cursor:pointer;margin-bottom:10px;">
              <input type="checkbox" id="s-anki-autolog" ${store.state.anki.autoLogTime !== false ? 'checked' : ''} />
              <span class="xs">Heutige echte Anki-Zeit beim Sync automatisch in Tagesring übernehmen</span>
            </label>
            <div class="row">
              <button class="btn btn-primary btn-sm" id="btn-save-anki">Speichern</button>
              <button class="btn btn-sm" id="btn-test-anki">Testen</button>
            </div>
          </section>
        </div>

        <!-- 5. Backup -->
        <section class="card">
          <div class="card-header">
            <h2 class="card-title">${icon('download', 15)} Backup & Fokus-Tracker Import</h2>
            <span class="xs soft">Letztes Backup: ${lastBackupText}</span>
          </div>
          <div class="row" style="margin-bottom:12px;">
            <button class="btn btn-primary btn-sm" id="btn-exp-file">${icon('download', 13)} Datei speichern</button>
            <button class="btn btn-sm" id="btn-exp-copy">${icon('copy', 13)} Text kopieren</button>
            <label class="btn btn-sm" style="cursor:pointer;">
              ${icon('upload', 13)} Laden (Zusammenführen)
              <input type="file" accept=".json,application/json" id="imp-merge-file" class="hidden" />
            </label>
            <label class="btn btn-sm" style="cursor:pointer;">
              ${icon('upload', 13)} Laden (Ersetzen)
              <input type="file" accept=".json,application/json" id="imp-replace-file" class="hidden" />
            </label>
          </div>
          <details>
            <summary class="small muted" style="cursor:pointer;">JSON-Backup als Text einfügen (1:1 kompatibel mit altem Fokus-Tracker)</summary>
            <div class="stack" style="margin-top:8px;">
              <textarea id="imp-text-area" class="input mono" placeholder='{"e":[...],"goal":180,"w":{...},"cf":[...]}'></textarea>
              <div class="row">
                <button class="btn btn-primary btn-sm" id="btn-imp-text-merge">Zusammenführen</button>
                <button class="btn btn-sm" id="btn-imp-text-replace">Ersetzen</button>
              </div>
            </div>
          </details>
        </section>

        <!-- 6. Alles löschen -->
        <section class="card">
          <div class="card-header"><h2 class="card-title" style="color:var(--danger);">${icon('trash', 15)} Alle lokalen Daten löschen</h2></div>
          <p class="xs muted" style="margin-top:0;">Entfernt alle lokalen Einträge, Aufwachzeiten, Koffein-Daten und Checklisten nach expliziter Bestätigung.</p>
          <button class="btn btn-danger btn-sm" id="btn-wipe-all">
            ${icon('trash', 13)} Alle lokalen Daten löschen...
          </button>
        </section>
      </div>
    `}
  `;

  root.querySelector('#sub-ach')?.addEventListener('click', () => { activeSubtab = 'achievements'; renderMoreView(root, ctx); });
  root.querySelector('#sub-set')?.addEventListener('click', () => { activeSubtab = 'settings'; renderMoreView(root, ctx); });
  if (activeSubtab !== 'settings') return;

  root.querySelector('#set-core-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    store.state.goal = Math.max(15, Number(root.querySelector('#s-goal').value) || 120);
    store.state.mode = root.querySelector('#s-mode').value;
    store.state.sl = root.querySelector('#s-sleep').value || '23:00';
    store.state.cl = Math.max(50, Number(root.querySelector('#s-cl').value) || 400);
    store.state.theme = root.querySelector('#s-theme').value;
    store.state.autoLogLectures = root.querySelector('#s-autolec').checked;
    store.state.planningPrefs = {
      defaultWakeFreeDay: root.querySelector('#s-wakefree').value || '10:00',
      freeDayStartOffsetMin: Math.max(0, Number(root.querySelector('#s-offset').value) || 0),
      sundayFree: root.querySelector('#s-sunfree').checked,
      sundayRestProtectsStreak: root.querySelector('#s-sunfree').checked,
      restDayMinMinutes: Math.max(0, Number(root.querySelector('#s-restmin').value) || 0)
    };
    store.state.anki.minDailyAnkiMin = Math.max(5, Number(root.querySelector('#s-minanki').value) || 30);
    store.state.anki.updatedAt = Date.now();
    store.state.settingsUpdatedAt = Date.now();
    applyTheme(store.state.theme);
    store.save();
    toast('Einstellungen gespeichert.', 'ok');
  });

  root.querySelector('#btn-save-ai')?.addEventListener('click', () => {
    store.state.ai.apiKey = root.querySelector('#s-gkey').value.trim();
    store.state.ai.model = root.querySelector('#s-gmodel').value;
    store.state.ai.studyNotes = root.querySelector('#s-notes').value.trim();
    store.state.ai.syncApiKeyInGist = root.querySelector('#s-sync-gkey').checked;
    store.state.aiPrefsUpdatedAt = Date.now();
    store.save();
    toast('KI-Einstellungen gespeichert.', 'ok');
  });

  root.querySelector('#btn-test-ai')?.addEventListener('click', async () => {
    const key = root.querySelector('#s-gkey').value.trim();
    const model = root.querySelector('#s-gmodel').value;
    if (!key) { toast('Bitte zuerst API-Key eingeben.', 'err'); return; }
    toast('Teste Verbindung...');
    try {
      const res = await testGeminiConnection(key, model);
      store.state.ai.apiKey = key;
      store.state.ai.model = model;
      store.state.aiPrefsUpdatedAt = Date.now();
      store.save();
      toast(`Verbindung OK (${res.modelUsed}).`, 'ok');
    } catch (err) {
      toast(`Fehler: ${err.message}`, 'err');
    }
  });

  const saveGistInputs = () => {
    store.secrets.githubToken = root.querySelector('#s-ghtoken').value.replace(/\s+/g, '');
    store.secrets.gistId = normalizeGistId(root.querySelector('#s-gistid').value);
    store.secrets.autoSync = root.querySelector('#s-autosync').checked;
    store.saveSecrets({ silent: true });
  };

  root.querySelector('#btn-save-gist')?.addEventListener('click', () => { saveGistInputs(); renderMoreView(root, ctx); toast('Gespeichert.', 'ok'); });
  root.querySelector('#btn-create-gist')?.addEventListener('click', async () => {
    saveGistInputs();
    try {
      const id = await createPrivateGist();
      renderMoreView(root, ctx);
      toast(`Privater Gist erstellt: ${id}`, 'ok');
    } catch (err) {
      toast(err.message, 'err');
    }
  });
  root.querySelector('#btn-sync-now')?.addEventListener('click', async () => {
    saveGistInputs();
    const res = await syncNow();
    renderMoreView(root, ctx);
    if (res.ok) {
      const s = res.summary || store.secrets.lastRemoteSummary;
      toast(s ? `Sync OK · Cloud: ${s.chk} Todos · ${s.anki} Ankis` : 'Synchronisiert.', 'ok');
    } else {
      toast(`Fehler: ${res.error || res.reason}`, 'err');
    }
  });
  root.querySelector('#btn-push-gist')?.addEventListener('click', () => {
    saveGistInputs();
    if (!store.secrets.githubToken || !store.secrets.gistId) {
      toast('Bitte zuerst GitHub Token & Gist-ID eintragen.', 'err');
      return;
    }
    openModal(`
      <div class="card-header">
        <h3 class="card-title">Cloud-Stand überschreiben?</h3>
        <button class="icon-btn" id="m-close">${icon('x', 15)}</button>
      </div>
      <p class="small muted" style="margin-top:0;">
        <strong>Lokal → Cloud</strong> überschreibt deinen gesamten GitHub Gist direkt mit dem Stand dieses Geräts (ohne vorheriges Zusammenführen).
      </p>
      <div class="row" style="justify-content:flex-end;margin-top:12px;">
        <button type="button" class="btn btn-sm" id="m-cancel">Abbrechen</button>
        <button type="button" class="btn btn-danger btn-sm" id="m-confirm">${icon('upload', 13)} Ja, Cloud überschreiben</button>
      </div>
    `, (modalEl) => {
      modalEl.querySelector('#m-close')?.addEventListener('click', closeModal);
      modalEl.querySelector('#m-cancel')?.addEventListener('click', closeModal);
      modalEl.querySelector('#m-confirm')?.addEventListener('click', async () => {
        const btn = modalEl.querySelector('#m-confirm');
        if (btn) btn.disabled = true;
        const res = await pushToGist({ forceArchive: false, force: true });
        closeModal();
        renderMoreView(root, ctx);
        if (res.ok) {
          const s = res.summary || store.secrets.lastRemoteSummary;
          toast(s ? `In Cloud hochgeladen: ${s.chk} Todos · ${s.anki} Ankis` : 'In Cloud hochgeladen.', 'ok');
        } else {
          toast(`Upload-Fehler: ${res.error || res.reason}`, 'err');
        }
      });
    });
  });
  root.querySelector('#btn-pull-gist')?.addEventListener('click', () => {
    saveGistInputs();
    if (!store.secrets.githubToken || !store.secrets.gistId) {
      toast('Bitte zuerst GitHub Token & Gist-ID eintragen.', 'err');
      return;
    }
    openModal(`
      <div class="card-header">
        <h3 class="card-title">Lokalen Stand aus Cloud überschreiben?</h3>
        <button class="icon-btn" id="m-close">${icon('x', 15)}</button>
      </div>
      <p class="small muted" style="margin-top:0;">
        <strong>Cloud → Lokal</strong> ersetzt deine lokalen Daten auf diesem Gerät direkt durch den Stand im GitHub Gist.
      </p>
      <div class="row" style="justify-content:flex-end;margin-top:12px;">
        <button type="button" class="btn btn-sm" id="m-cancel">Abbrechen</button>
        <button type="button" class="btn btn-danger btn-sm" id="m-confirm">${icon('download', 13)} Ja, aus Cloud laden</button>
      </div>
    `, (modalEl) => {
      modalEl.querySelector('#m-close')?.addEventListener('click', closeModal);
      modalEl.querySelector('#m-cancel')?.addEventListener('click', closeModal);
      modalEl.querySelector('#m-confirm')?.addEventListener('click', async () => {
        const btn = modalEl.querySelector('#m-confirm');
        if (btn) btn.disabled = true;
        const res = await pullFromGist({ preferRemote: true });
        closeModal();
        renderMoreView(root, ctx);
        if (res.ok) {
          const s = res.summary || store.secrets.lastRemoteSummary;
          toast(s ? `Aus Cloud geladen: ${s.chk} Todos · ${s.anki} Ankis` : 'Aus Cloud geladen.', 'ok');
        } else {
          toast(`Lade-Fehler: ${res.error || res.reason}`, 'err');
        }
      });
    });
  });
  root.querySelector('#btn-force-update')?.addEventListener('click', async () => {
    try {
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((r) => r.unregister()));
      }
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
    } catch { /* ignore */ }
    location.reload();
  });

  // Helper: Ask user explicitly whether destructive local replacement (Archive / Backup Replace / Wipe) should also overwrite Cloud Gist
  const promptCloudOverwrite = (title, description) => {
    if (!isGistConfigured() || !store.secrets.gistId) return;
    openModal(`
      <div class="card-header">
        <h3 class="card-title">${esc(title)}</h3>
        <button class="icon-btn" id="m-close">${icon('x', 15)}</button>
      </div>
      <p class="small muted" style="margin-top:0;">${esc(description)}</p>
      <p class="xs muted">
        Wenn du <strong>Nur lokal behalten</strong> wählst, wird Auto-Sync pausiert, damit dein Cloud-Stand die Aktion nicht sofort wieder rückgängig macht.
      </p>
      <div class="row" style="justify-content:flex-end;margin-top:12px;">
        <button type="button" class="btn btn-sm" id="co-local-only">Nur lokal (Auto-Sync aus)</button>
        <button type="button" class="btn btn-danger btn-sm" id="co-push-cloud">${icon('upload', 13)} Auch in Cloud überschreiben</button>
      </div>
    `, (modalEl) => {
      const pauseLocal = () => {
        store.secrets.autoSync = false;
        store.saveSecrets({ silent: false });
        closeModal();
        toast('Nur lokal übernommen (Auto-Sync vorübergehend deaktiviert).', 'ok');
      };
      modalEl.querySelector('#m-close')?.addEventListener('click', pauseLocal);
      modalEl.querySelector('#co-local-only')?.addEventListener('click', pauseLocal);
      modalEl.querySelector('#co-push-cloud')?.addEventListener('click', async () => {
        const btn = modalEl.querySelector('#co-push-cloud');
        if (btn) btn.disabled = true;
        const res = await pushToGist({ force: true });
        closeModal();
        if (res.ok) toast('Stand erfolgreich in die Cloud übernommen.', 'ok');
        else toast(`Cloud-Upload fehlgeschlagen: ${res.error || res.reason}`, 'err');
      });
    });
  };

  // Weekly Gist Archives Modal (#8)
  root.querySelector('#btn-gist-archives')?.addEventListener('click', () => {
    saveGistInputs();
    if (!store.secrets.githubToken || !store.secrets.gistId) {
      toast('Bitte zuerst GitHub Token & Gist-ID eintragen.', 'err');
      return;
    }
    openModal(`
      <div class="card-header">
        <h3 class="card-title">Wochen-Archive im privaten Gist</h3>
        <button class="icon-btn" id="m-close">${icon('x', 15)}</button>
      </div>
      <p class="xs muted" style="margin-top:0;">
        Automatisch wird 1x pro Kalenderwoche ein unveränderlicher Snapshot (letzte 4 Wochen, ohne API-Key) in deinem privaten Gist gespeichert.
      </p>
      <div class="stack">
        <div class="row">
          <button class="btn btn-primary btn-sm" id="arch-now">${icon('upload', 13)} Aktuelle Woche jetzt sichern</button>
          <span class="xs muted" id="arch-status">Lade Archive...</span>
        </div>
        <div id="arch-list" class="entry-list"></div>
      </div>
    `, async (modalEl) => {
      modalEl.querySelector('#m-close')?.addEventListener('click', closeModal);
      const listEl = modalEl.querySelector('#arch-list');
      const statusEl = modalEl.querySelector('#arch-status');

      const loadList = async () => {
        statusEl.textContent = 'Lade...';
        try {
          const items = await listGistArchives();
          statusEl.textContent = `${items.length} ${items.length === 1 ? 'Archiv' : 'Archive'} gefunden`;
          listEl.innerHTML = items.map((a, idx) => `
            <div class="entry-row">
              <div>
                <div class="small mono" style="font-weight:620;">${esc(a.label)}</div>
                <div class="xs soft">${(a.size / 1024).toFixed(1)} KB</div>
              </div>
              <button class="btn btn-xs btn-primary" data-arch-restore="${idx}">Wiederherstellen</button>
            </div>
          `).join('') || '<div class="xs soft">Noch keine Wochen-Archive im Gist vorhanden.</div>';
          listEl.querySelectorAll('[data-arch-restore]').forEach((btn) => {
            btn.addEventListener('click', () => {
              const a = items[Number(btn.getAttribute('data-arch-restore'))];
              if (!a) return;
              try {
                const r = restoreArchiveSnapshot(a.content, a.label, { skipSync: true });
                closeModal();
                toast(`Archiv ${a.label} lokal geladen (${r.entries} Einträge · Kalender behalten).`, 'ok', { undo: true });
                promptCloudOverwrite(
                  `Archiv ${a.label} in Cloud übernehmen?`,
                  'Das Wochen-Archiv wurde lokal geladen (dein Stundenplan blieb erhalten). Soll dieser Stand auch den aktuellen Cloud-Gist überschreiben?'
                );
              } catch (err) {
                toast(`Fehler: ${err.message}`, 'err');
              }
            });
          });
        } catch (err) {
          statusEl.textContent = `Fehler: ${err.message}`;
        }
      };

      modalEl.querySelector('#arch-now')?.addEventListener('click', async () => {
        statusEl.textContent = 'Sichere Wochen-Archiv...';
        const res = await pushToGist({ forceArchive: true });
        if (res.ok) {
          toast(`Wochen-Archiv ${res.archivedWeek} gesichert.`, 'ok');
          loadList();
        } else {
          statusEl.textContent = `Fehler: ${res.error || res.reason}`;
        }
      });

      loadList();
    });
  });

  // Combined Device Pairing Modal (QR-Code Laptop + Code Paste Handy)
  root.querySelector('#btn-pair-open')?.addEventListener('click', () => {
    saveGistInputs();
    const hasCreds = Boolean(store.secrets.githubToken && store.secrets.gistId);
    let pairTab = hasCreds ? 'qr' : 'paste';
    const isLocalOrigin = location.hostname === '127.0.0.1' || location.hostname === 'localhost';
    const savedPublicUrl = (store.secrets.publicAppUrl || '').trim();
    const defaultTargetUrl = isLocalOrigin ? savedPublicUrl : `${location.origin}${location.pathname}`;

    openModal(`
      <div class="card-header">
        <h3 class="card-title">Gerät koppeln (Laptop ↔ Handy)</h3>
        <button class="icon-btn" id="m-close">${icon('x', 15)}</button>
      </div>
      <div class="segmented" style="margin-bottom:12px;">
        <button type="button" data-pair-tab="qr" class="${pairTab === 'qr' ? 'active' : ''}">QR erzeugen (Laptop)</button>
        <button type="button" data-pair-tab="paste" class="${pairTab === 'paste' ? 'active' : ''}">Mit Code verbinden (Handy)</button>
      </div>

      <!-- Panel A: QR Generator -->
      <div id="pair-panel-qr" class="stack ${pairTab !== 'qr' ? 'hidden' : ''}">
        ${!hasCreds ? `
          <div class="banner warn" style="margin:0;">
            <span class="xs">Bitte zuerst oben GitHub Token &amp; Gist-ID eintragen (oder unter „Erweitert &amp; Notfall“ einen privaten Gist anlegen).</span>
          </div>
        ` : `
          <p class="xs muted" style="margin:0;">
            Der QR-Code wird 100 % lokal offline erzeugt. Standardmäßig werden Token &amp; Key per <strong>AES-256-GCM mit deiner PIN</strong> verschlüsselt.
          </p>
          ${isLocalOrigin ? `
            <div class="banner warn" style="margin:0;">
              <span class="xs"><strong>Lokaler Start erkannt (${esc(location.origin)}):</strong> Ein QR-Link auf <code>127.0.0.1</code> funktioniert am Handy nicht. Trag deine GitHub-Pages-URL ein oder nutze „Kopplungs-Code kopieren“.</span>
            </div>
            <div class="field">
              <label>GitHub-Pages-URL der App (für QR-Link am Handy)</label>
              <input type="url" id="qr-target-url" class="input mono" value="${esc(defaultTargetUrl)}" placeholder="https://dein-name.github.io/kit-study-planner/" />
            </div>
          ` : ''}
          <div class="row">
            <input type="password" id="qr-pin" class="input mono" style="flex:1;" placeholder="PIN (Standard: 4–6 Ziffern für AES-Schutz)" autocomplete="off" />
            <label class="row xs muted" style="cursor:pointer;">
              <input type="checkbox" id="qr-inc-ai" checked /> Gemini-Key mitgeben
            </label>
            <button type="button" class="btn btn-primary btn-sm" id="qr-gen">QR erzeugen</button>
          </div>
          <label class="row xs muted" style="cursor:pointer;">
            <input type="checkbox" id="qr-allow-plain" />
            Ohne PIN erlauben (unverschlüsselt — nur privat scannen)
          </label>
          <div id="qr-out" class="stack hidden" style="align-items:center;padding-top:8px;"></div>
        `}
      </div>

      <!-- Panel B: Paste Code -->
      <form id="pair-panel-paste" class="stack ${pairTab !== 'paste' ? 'hidden' : ''}">
        <p class="xs muted" style="margin:0;">
          Füge den am Laptop kopierten <code>P1...</code> (oder <code>P0...</code>) Kopplungs-Code ein, um Token &amp; Gist-ID sofort zu übernehmen.
        </p>
        <textarea id="pair-paste-val" class="input mono" placeholder="P1.... oder P0.... hier einfügen" required></textarea>
        <div class="row" style="justify-content:flex-end;">
          <button type="submit" class="btn btn-primary btn-sm">Koppeln</button>
        </div>
      </form>
    `, (modalEl) => {
      modalEl.querySelector('#m-close')?.addEventListener('click', closeModal);

      modalEl.querySelectorAll('[data-pair-tab]').forEach((btn) => {
        btn.addEventListener('click', () => {
          pairTab = btn.getAttribute('data-pair-tab');
          modalEl.querySelectorAll('[data-pair-tab]').forEach((b) => b.classList.toggle('active', b === btn));
          modalEl.querySelector('#pair-panel-qr')?.classList.toggle('hidden', pairTab !== 'qr');
          modalEl.querySelector('#pair-panel-paste')?.classList.toggle('hidden', pairTab !== 'paste');
        });
      });

      modalEl.querySelector('#qr-gen')?.addEventListener('click', async () => {
        const pin = modalEl.querySelector('#qr-pin').value.trim();
        const allowPlain = Boolean(modalEl.querySelector('#qr-allow-plain')?.checked);
        if (!pin && !allowPlain) {
          toast('Bitte vergib eine PIN (Standard) oder hake explizit „Ohne PIN erlauben“ an.', 'err');
          modalEl.querySelector('#qr-pin')?.focus();
          return;
        }
        const incAi = modalEl.querySelector('#qr-inc-ai').checked;
        const payload = { gt: store.secrets.githubToken.trim(), gid: store.secrets.gistId.trim() };
        if (incAi && store.state.ai.apiKey) payload.ak = store.state.ai.apiKey.trim();

        let code;
        try {
          code = await encodePairingCode(payload, pin);
        } catch (err) {
          toast(err.message || 'Verschlüsselung fehlgeschlagen.', 'err');
          return;
        }

        let baseUrl = `${location.origin}${location.pathname}`;
        if (isLocalOrigin) {
          const customUrl = (modalEl.querySelector('#qr-target-url')?.value || '').trim();
          if (customUrl) {
            store.secrets.publicAppUrl = customUrl;
            store.saveSecrets({ silent: true });
            baseUrl = customUrl;
          } else {
            baseUrl = '';
          }
        }

        const out = modalEl.querySelector('#qr-out');
        out.classList.remove('hidden');

        if (isLocalOrigin && (!baseUrl || /^https?:\/\/(?:127\.0\.0\.1|localhost)(?::|\/|$)/i.test(baseUrl))) {
          out.innerHTML = `
            <div class="xs" style="color:var(--gold);text-align:center;">
              Keine gültige GitHub-Pages-URL angegeben — daher kein <code>127.0.0.1</code>-QR erzeugt.<br/>
              Kopiere einfach den ${pin ? 'AES-verschlüsselten' : 'unverschlüsselten'} Code und füge ihn am Handy unter <strong>Mit Code verbinden</strong> ein:
            </div>
            <div class="row">
              <button type="button" class="btn btn-primary btn-sm" id="qr-copy-code">${icon('copy', 13)} Kopplungs-Code kopieren</button>
            </div>
          `;
        } else {
          const pairUrl = `${baseUrl}#pair=${encodeURIComponent(code)}`;
          out.innerHTML = `
            <div style="padding:10px;background:#fff;border-radius:12px;">${renderQrSvg(pairUrl, 230)}</div>
            <div class="xs muted">${pin ? 'AES-256-GCM PIN-verschlüsselt' : 'Unverschlüsselt (nur privat scannen)'} · Ziel: <span class="mono">${esc(baseUrl)}</span></div>
            <div class="row">
              <button type="button" class="btn btn-sm" id="qr-copy-code">${icon('copy', 13)} Kopplungs-Code kopieren</button>
            </div>
          `;
        }
        out.querySelector('#qr-copy-code')?.addEventListener('click', async () => {
          try { await navigator.clipboard.writeText(code); toast('Kopplungs-Code kopiert.', 'ok'); }
          catch { toast('Kopieren fehlgeschlagen.', 'err'); }
        });
      });

      modalEl.querySelector('#pair-panel-paste')?.addEventListener('submit', (e) => {
        e.preventDefault();
        const code = modalEl.querySelector('#pair-paste-val').value.trim();
        closeModal();
        if (code && handlePairingCodeFlow) handlePairingCodeFlow(code);
      });
    });
  });

  root.querySelector('#set-ics-file')?.addEventListener('change', async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const res = syncModulesFromIcs(store, await f.text());
    toast(`KIT-Kalender geladen (${res.totalEvents} Serientermine).`, 'ok');
  });

  root.querySelector('#btn-save-anki')?.addEventListener('click', () => {
    const mode = root.querySelector('#s-anki-mode').value;
    store.state.anki.url = root.querySelector('#s-anki-url').value.trim() || 'http://127.0.0.1:8765';
    store.state.anki.secNew = Math.max(5, Math.round(Number(root.querySelector('#s-anki-snew').value) || 45));
    store.state.anki.secLearn = Math.max(5, Math.round(Number(root.querySelector('#s-anki-slearn').value) || 30));
    store.state.anki.secReview = Math.max(5, Math.round(Number(root.querySelector('#s-anki-srev').value) || 15));
    store.state.anki.autoLogTime = Boolean(root.querySelector('#s-anki-autolog')?.checked);
    store.state.anki.mode = mode;
    store.state.anki.updatedAt = Date.now();
    store.save();
    toast('Anki-Einstellungen gespeichert.', 'ok');
  });

  root.querySelector('#btn-test-anki')?.addEventListener('click', async () => {
    store.state.anki.url = root.querySelector('#s-anki-url').value.trim() || 'http://127.0.0.1:8765';
    try {
      const res = await syncAnkiConnect();
      toast(`AnkiConnect OK: ${res.totalDue} fällige Karten.`, 'ok');
    } catch (err) {
      toast(`Nicht erreichbar (${err.message}).`, 'err');
    }
  });

  root.querySelector('#btn-exp-file')?.addEventListener('click', () => {
    const json = store.exportBackupJSON({ includeApiKey: false });
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `kit-studyflow-backup-${toDateStr()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast('Backup gespeichert.', 'ok');
  });

  root.querySelector('#btn-exp-copy')?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(store.exportBackupJSON({ includeApiKey: false }));
      toast('Backup kopiert.', 'ok');
    } catch { toast('Kopieren fehlgeschlagen.', 'err'); }
  });

  const doImport = (text, strategy) => {
    try {
      const hasCloud = isGistConfigured() && Boolean(store.secrets.gistId);
      const res = store.importBackupJSON(text, strategy, { skipSync: strategy === 'replace' && hasCloud });
      toast(`Importiert: ${res.entries} Einträge, ${res.wakes} Aufwachzeiten, ${res.caffeine} Koffein.`, 'ok');
      if (strategy === 'replace' && hasCloud) {
        promptCloudOverwrite(
          'Backup-Ersatz in Cloud übernehmen?',
          'Das Backup hat deinen lokalen Stand ersetzt. Soll dieser Stand auch den aktuellen Cloud-Gist überschreiben (sonst holt der nächste Sync den alten Cloud-Stand zurück)?'
        );
      }
    } catch (err) { toast(`Import-Fehler: ${err.message}`, 'err'); }
  };

  root.querySelector('#imp-merge-file')?.addEventListener('change', async (e) => {
    const f = e.target.files?.[0];
    if (f) doImport(await f.text(), 'merge');
  });
  root.querySelector('#imp-replace-file')?.addEventListener('change', async (e) => {
    const f = e.target.files?.[0];
    if (f) doImport(await f.text(), 'replace');
  });
  root.querySelector('#btn-imp-text-merge')?.addEventListener('click', () => {
    const txt = root.querySelector('#imp-text-area')?.value || '';
    if (txt.trim()) doImport(txt, 'merge');
  });
  root.querySelector('#btn-imp-text-replace')?.addEventListener('click', () => {
    const txt = root.querySelector('#imp-text-area')?.value || '';
    if (txt.trim()) doImport(txt, 'replace');
  });

  root.querySelector('#btn-wipe-all')?.addEventListener('click', () => {
    openModal(`
      <div class="card-header">
        <h3 class="card-title" style="color:var(--danger);">Wirklich alle lokalen Daten löschen?</h3>
        <button class="icon-btn" id="m-close">${icon('x', 15)}</button>
      </div>
      <p class="small muted" style="margin-top:0;">
        Entfernt alle lokalen Lernzeiten, Checklisten, Rückstände, Aufwachzeiten und Koffein-Daten. Direkt danach erscheint ein Rückgängig-Hinweis.
      </p>
      <div class="row" style="justify-content:flex-end;margin-top:12px;">
        <button type="button" class="btn btn-sm" id="m-cancel">Abbrechen</button>
        <button type="button" class="btn btn-danger btn-sm" id="m-wipe-go">${icon('trash', 13)} Ja, alles löschen</button>
      </div>
    `, (modalEl) => {
      modalEl.querySelector('#m-close')?.addEventListener('click', closeModal);
      modalEl.querySelector('#m-cancel')?.addEventListener('click', closeModal);
      modalEl.querySelector('#m-wipe-go')?.addEventListener('click', () => {
        closeModal();
        const hasCloud = isGistConfigured() && Boolean(store.secrets.gistId);
        store.wipeAllData({ skipSync: hasCloud });
        toast('Alle lokalen Daten gelöscht.', 'err', { undo: true });
        if (hasCloud) {
          promptCloudOverwrite(
            'Cloud-Stand ebenfalls leeren?',
            'Alle lokalen Daten wurden gelöscht. Soll der private GitHub Gist ebenfalls geleert werden, oder willst du Auto-Sync pausieren, damit die alten Daten nicht zurückgeladen werden?'
          );
        }
      });
    });
  });
}

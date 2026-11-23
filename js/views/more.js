// Tab 5: "Erfolge & Setup" – Monochrome Achievements & Full Settings

import {
  store,
  LEVELS,
  WEEKDAYS_MON,
  fmtMin,
  fmtHours,
  toDateStr,
  toTimeStr
} from '../store.js';
import { AVAILABLE_MODELS, testGeminiConnection } from '../gemini.js';
import { createPrivateGist, pullFromGist, pushToGist, syncNow, listGistArchives, restoreArchiveSnapshot, normalizeGistId } from '../sync.js';
import { syncModulesFromIcs } from '../ics.js';
import { syncAnkiConnect, setManualAnki, getAnkiLoadSummary } from '../anki.js';
import { renderQrSvg, encodePairingCode } from '../qr.js';
import { icon } from '../icons.js';

let activeSubtab = 'achievements';
let wipeConfirmArmed = false;

export function setMoreSubtab(tab) {
  if (tab === 'achievements' || tab === 'settings') activeSubtab = tab;
}

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function renderMoreView(root, ctx) {
  const { toast, applyTheme, openModal, closeModal, handlePairingCodeFlow } = ctx;
  const st = store.getOverallStats();
  const anki = getAnkiLoadSummary();
  const todayLearn = store.getDayBreakdown(toDateStr()).learnTotal;

  const bestWdIdx = st.weekdayAvgs.indexOf(Math.max(...st.weekdayAvgs));
  const bestWdLabel = st.weekdayAvgs[bestWdIdx] > 0 ? `${WEEKDAYS_MON[bestWdIdx]} (Ø ${fmtMin(st.weekdayAvgs[bestWdIdx])})` : 'Noch zu wenig Daten';
  const weekDiff = st.thisWeek - st.lastWeek;
  const movies = (st.totalLearn / 120).toFixed(1);
  const football = (st.totalLearn / 90).toFixed(1);
  const remainingFor1000Min = Math.max(0, 60000 - st.totalLearn);
  const dailyPace = st.avg30 > 0 ? st.avg30 : st.avgActive;
  const daysTo1000 = dailyPace > 0 ? Math.ceil(remainingFor1000Min / dailyPace) : null;
  const eta1000 = daysTo1000 !== null
    ? (daysTo1000 === 0 ? 'Erreicht' : `ca. ${daysTo1000} Tage (${(daysTo1000 / 365).toFixed(1)} Jahre)`)
    : 'Noch keine Prognose';
  const vsAvgDelta = Math.round(todayLearn - st.avgActive);
  const lastBackupText = store.state.lb
    ? new Date(store.state.lb).toLocaleString('de-DE')
    : 'Noch kein Backup';

  root.innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="page-title">${activeSubtab === 'achievements' ? 'Erfolge & Erkenntnisse' : 'Einstellungen & Sync'}</h1>
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

        <section class="card">
          <div class="card-header">
            <h2 class="card-title">${icon('activity', 15)} Erkenntnisse</h2>
          </div>
          <div class="grid-2">
            <div class="kpi-box"><div class="kpi-label">Stärkster Wochentag</div><div class="kpi-val kit" style="font-size:0.96rem;">${bestWdLabel}</div></div>
            <div class="kpi-box"><div class="kpi-label">Wochenvergleich</div><div class="kpi-val ${weekDiff >= 0 ? 'both' : 'danger'}" style="font-size:0.96rem;">${fmtMin(st.thisWeek)} (${weekDiff >= 0 ? '+' : ''}${fmtMin(weekDiff)})</div></div>
            <div class="kpi-box"><div class="kpi-label">Hochrechnung Monat</div><div class="kpi-val learn" style="font-size:0.96rem;">${fmtHours(st.monthProjection)}</div></div>
            <div class="kpi-box"><div class="kpi-label">Häufigste Eintragszeit</div><div class="kpi-val" style="font-size:0.96rem;">${st.peakHour >= 0 ? `${String(st.peakHour).padStart(2, '0')}:00–${String(st.peakHour).padStart(2, '0')}:59 Uhr` : '–'}</div></div>
            <div class="kpi-box"><div class="kpi-label">Entspricht</div><div class="kpi-val" style="font-size:0.94rem;">${movies} Spielfilmen · ${football} Fußballspielen</div></div>
            <div class="kpi-box"><div class="kpi-label">Prognose 1.000 Stunden</div><div class="kpi-val purple" style="font-size:0.94rem;">${eta1000}</div></div>
            <div class="kpi-box"><div class="kpi-label">Heute vs. Durchschnitt</div><div class="kpi-val ${vsAvgDelta >= 0 ? 'both' : ''}" style="font-size:0.96rem;">${fmtMin(todayLearn)} (${vsAvgDelta >= 0 ? '+' : ''}${fmtMin(vsAvgDelta)} vs. Ø ${fmtMin(st.avgActive)})</div></div>
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
              <div class="field">
                <label>Zählregel</label>
                <select id="s-mode" class="input">
                  <option value="max" ${store.state.mode === 'max' ? 'selected' : ''}>Höchster Wert</option>
                  <option value="last" ${store.state.mode === 'last' ? 'selected' : ''}>Letzter Eintrag</option>
                  <option value="sum" ${store.state.mode === 'sum' ? 'selected' : ''}>Alles addieren</option>
                </select>
              </div>
              <div class="field"><label>Standard-Schlafzeit</label><input type="time" id="s-sleep" class="input mono" value="${store.state.sl}" /></div>
              <div class="field"><label>Koffein-Limit (mg)</label><input type="number" id="s-cl" class="input mono" min="50" max="1000" value="${store.state.cl || 400}" /></div>
              <div class="field">
                <label>Design</label>
                <select id="s-theme" class="input">
                  <option value="dark" ${store.state.theme === 'dark' ? 'selected' : ''}>Schwarz (Standard)</option>
                  <option value="light" ${store.state.theme === 'light' ? 'selected' : ''}>Hell</option>
                  <option value="auto" ${store.state.theme === 'auto' ? 'selected' : ''}>System</option>
                </select>
              </div>
            </div>
            <div class="field-grid">
              <div class="field"><label>Aufwachen freie Tage</label><input type="time" id="s-wakefree" class="input mono" value="${store.state.planningPrefs?.defaultWakeFreeDay || '10:00'}" /></div>
              <div class="field"><label>Start-Puffer freie Tage (min)</label><input type="number" id="s-offset" class="input mono" min="0" max="180" value="${store.state.planningPrefs?.freeDayStartOffsetMin ?? 45}" /></div>
              <div class="field"><label>Mindest-Anki / Tag (min)</label><input type="number" id="s-minanki" class="input mono" min="5" max="180" value="${store.state.anki.minDailyAnkiMin || 30}" /></div>
              <div class="field"><label>Ruhetag-Ziel (min)</label><input type="number" id="s-restmin" class="input mono" min="0" max="180" value="${store.state.planningPrefs?.restDayMinMinutes ?? 30}" /></div>
            </div>
            <label class="row" style="cursor:pointer;">
              <input type="checkbox" id="s-sunfree" ${store.state.planningPrefs?.sundayFree !== false ? 'checked' : ''} />
              <span class="small">Sonntag standardmäßig frei lassen (außer Anki-Reviews) & Serie am Sonntag schützen</span>
            </label>
            <label class="row" style="cursor:pointer;">
              <input type="checkbox" id="s-autolec" ${store.state.autoLogLectures ? 'checked' : ''} />
              <span class="small">Besuchte Live-Vorlesungen aus dem KIT-Kalender automatisch als Vorlesung / Produktiv verbuchen</span>
            </label>
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
              <span class="pill">App v11</span>
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
            <button class="btn btn-primary btn-sm" id="btn-save-gist">Speichern</button>
            <button class="btn btn-sm" id="btn-sync-now">${icon('refresh', 13)} Jetzt syncen</button>
            <button class="btn btn-sm" id="btn-push-gist" title="Überschreibt die Cloud direkt mit diesem Gerät">${icon('upload', 13)} Lokal → Cloud</button>
            <button class="btn btn-sm" id="btn-pull-gist" title="Lädt den kompletten Stand aus der Cloud auf dieses Gerät">${icon('download', 13)} Cloud → Lokal</button>
            <button class="btn btn-sm" id="btn-create-gist">${icon('plus', 13)} Privaten Gist anlegen</button>
            <button class="btn btn-sm" id="btn-gist-archives">${icon('calendar', 13)} Wochen-Archive</button>
            <button class="btn btn-sm" id="btn-pair-qr">${icon('spark', 13)} Handy koppeln (QR)</button>
            <button class="btn btn-sm" id="btn-pair-paste">Mit Code koppeln</button>
            <button class="btn btn-sm" id="btn-force-update" title="Leert nur den App-Cache (deine Daten bleiben 100 % erhalten)">App-Update erzwingen</button>
          </div>
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

        <!-- 6. Diagnose & Alles löschen -->
        <div class="grid-2">
          <section class="card">
            <div class="card-header"><h2 class="card-title">${icon('activity', 15)} Diagnose</h2></div>
            <div class="small muted">
              Erkannte Hänger (&gt; 250 ms): <strong class="mono" style="color:var(--text);">${store.state.dg.n || 0}</strong><br/>
              Längster Hänger: <strong class="mono" style="color:var(--text);">${Math.round(store.state.dg.max || 0)} ms</strong><br/>
              Max. Frame-Zeit: <strong class="mono" style="color:var(--text);">${(store.state.dg.tmax || 0).toFixed(1)} ms</strong>
            </div>
          </section>

          <section class="card">
            <div class="card-header"><h2 class="card-title" style="color:var(--danger);">${icon('trash', 15)} Alles löschen</h2></div>
            <p class="xs muted" style="margin-top:0;">Entfernt alle lokalen Einträge, Aufwachzeiten, Koffein-Daten und Checklisten (zweimal drücken).</p>
            <button class="btn btn-danger btn-sm" id="btn-wipe-all">
              ${wipeConfirmArmed ? 'Wirklich ALLES löschen? (2/2)' : 'Alles löschen (1/2)'}
            </button>
          </section>
        </div>
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
    applyTheme(store.state.theme);
    store.save();
    toast('Einstellungen gespeichert.', 'ok');
  });

  root.querySelector('#btn-save-ai')?.addEventListener('click', () => {
    store.state.ai.apiKey = root.querySelector('#s-gkey').value.trim();
    store.state.ai.model = root.querySelector('#s-gmodel').value;
    store.state.ai.studyNotes = root.querySelector('#s-notes').value.trim();
    store.state.ai.syncApiKeyInGist = root.querySelector('#s-sync-gkey').checked;
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
  root.querySelector('#btn-push-gist')?.addEventListener('click', async () => {
    saveGistInputs();
    const res = await pushToGist({ forceArchive: false });
    renderMoreView(root, ctx);
    if (res.ok) {
      const s = res.summary || store.secrets.lastRemoteSummary;
      toast(s ? `In Cloud hochgeladen: ${s.chk} Todos · ${s.anki} Ankis` : 'In Cloud hochgeladen.', 'ok');
    } else {
      toast(`Upload-Fehler: ${res.error || res.reason}`, 'err');
    }
  });
  root.querySelector('#btn-pull-gist')?.addEventListener('click', async () => {
    saveGistInputs();
    const res = await pullFromGist({ preferRemote: true });
    renderMoreView(root, ctx);
    if (res.ok) {
      const s = res.summary || store.secrets.lastRemoteSummary;
      toast(s ? `Aus Cloud geladen: ${s.chk} Todos · ${s.anki} Ankis` : 'Aus Cloud geladen.', 'ok');
    } else {
      toast(`Lade-Fehler: ${res.error || res.reason}`, 'err');
    }
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
        Automatisch wird 1x pro Kalenderwoche ein unveränderlicher Snapshot (letzte 4 Wochen) in deinem privaten Gist gespeichert.
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
                const r = restoreArchiveSnapshot(a.content, a.label);
                closeModal();
                toast(`Archiv ${a.label} wiederhergestellt (${r.entries} Einträge).`, 'ok', { undo: true });
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

  // Pixel 9a Offline QR Pairing (#8)
  root.querySelector('#btn-pair-qr')?.addEventListener('click', () => {
    saveGistInputs();
    if (!store.secrets.githubToken || !store.secrets.gistId) {
      toast('Bitte zuerst GitHub Token & Gist-ID eintragen (oder Gist anlegen).', 'err');
      return;
    }
    openModal(`
      <div class="card-header">
        <h3 class="card-title">Pixel 9a per QR-Code koppeln</h3>
        <button class="icon-btn" id="m-close">${icon('x', 15)}</button>
      </div>
      <p class="xs muted" style="margin-top:0;">
        Der QR-Code wird 100 % lokal offline erzeugt. Optional eine kurze PIN vergeben, damit Token & Key AES-verschlüsselt übertragen werden.
      </p>
      <div class="stack">
        <div class="row">
          <input type="password" id="qr-pin" class="input mono" style="flex:1;" placeholder="Optionale PIN (z. B. 4–6 Ziffern)" />
          <label class="row xs muted" style="cursor:pointer;">
            <input type="checkbox" id="qr-inc-ai" checked /> Gemini-Key mitgeben
          </label>
          <button class="btn btn-primary btn-sm" id="qr-gen">QR erzeugen</button>
        </div>
        <div id="qr-out" class="stack hidden" style="align-items:center;padding-top:8px;"></div>
      </div>
    `, (modalEl) => {
      modalEl.querySelector('#m-close')?.addEventListener('click', closeModal);
      const renderCode = async () => {
        const pin = modalEl.querySelector('#qr-pin').value.trim();
        const incAi = modalEl.querySelector('#qr-inc-ai').checked;
        const payload = { gt: store.secrets.githubToken.trim(), gid: store.secrets.gistId.trim() };
        if (incAi && store.state.ai.apiKey) payload.ak = store.state.ai.apiKey.trim();
        const code = await encodePairingCode(payload, pin);
        const baseUrl = `${location.origin}${location.pathname}`;
        const pairUrl = `${baseUrl}#pair=${encodeURIComponent(code)}`;
        const out = modalEl.querySelector('#qr-out');
        out.classList.remove('hidden');
        out.innerHTML = `
          <div style="padding:10px;background:#fff;border-radius:12px;">${renderQrSvg(pairUrl, 230)}</div>
          <div class="xs muted">${pin ? 'AES-GCM PIN-verschlüsselt' : 'Unverschlüsselt (nur privat scannen)'} · Auf GitHub Pages direkt per Kamera öffnen</div>
          <div class="row">
            <button class="btn btn-sm" id="qr-copy-code">${icon('copy', 13)} Kopplungs-Code kopieren</button>
          </div>
        `;
        out.querySelector('#qr-copy-code')?.addEventListener('click', async () => {
          try { await navigator.clipboard.writeText(code); toast('Kopplungs-Code kopiert.', 'ok'); }
          catch { toast('Kopieren fehlgeschlagen.', 'err'); }
        });
      };
      modalEl.querySelector('#qr-gen')?.addEventListener('click', renderCode);
    });
  });

  root.querySelector('#btn-pair-paste')?.addEventListener('click', () => {
    openModal(`
      <div class="card-header">
        <h3 class="card-title">Mit Kopplungs-Code verbinden</h3>
        <button class="icon-btn" id="m-close">${icon('x', 15)}</button>
      </div>
      <form id="pair-paste-form" class="stack">
        <textarea id="pair-paste-val" class="input mono" placeholder="P0.... oder P1.... hier einfügen" required></textarea>
        <div class="row" style="justify-content:flex-end;">
          <button type="submit" class="btn btn-primary btn-sm">Koppeln</button>
        </div>
      </form>
    `, (modalEl) => {
      modalEl.querySelector('#m-close')?.addEventListener('click', closeModal);
      modalEl.querySelector('#pair-paste-form')?.addEventListener('submit', (e) => {
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
    setManualAnki({
      secNew: root.querySelector('#s-anki-snew').value,
      secLearn: root.querySelector('#s-anki-slearn').value,
      secReview: root.querySelector('#s-anki-srev').value
    });
    store.state.anki.mode = mode;
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
      const res = store.importBackupJSON(text, strategy);
      toast(`Importiert: ${res.entries} Einträge, ${res.wakes} Aufwachzeiten, ${res.caffeine} Koffein.`, 'ok');
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
    if (!wipeConfirmArmed) {
      wipeConfirmArmed = true;
      renderMoreView(root, ctx);
      setTimeout(() => { wipeConfirmArmed = false; }, 6000);
      return;
    }
    wipeConfirmArmed = false;
    store.wipeAllData();
    toast('Alle lokalen Daten gelöscht.', 'err', { undo: true });
  });
}

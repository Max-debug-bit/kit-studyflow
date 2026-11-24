// Tab 2: "Wochenplan" – Uni-Plan Checklist + Vormerken + Offener Rückstand + Eigene feste Termine + 1-Klick-Termin-Overrides + KIT Modul-Regeln

import {
  store,
  toDateStr,
  addDays,
  getMondayOfWeek,
  fmtDateShort,
  fmtMin,
  WEEKDAYS_DE,
  parseDateStr,
  escapeHtml as esc
} from '../store.js';
import {
  reconcileBacklogStatus,
  getAutopilotSuggestions,
  acceptAutopilotSuggestion,
  dismissAutopilotSuggestion,
  addBacklogItem,
  toggleBacklogDone,
  deleteBacklogItem,
  scheduleBacklogToDay,
  getChecklistForDay,
  addChecklistItem,
  toggleChecklistItem,
  updateChecklistItem,
  deleteChecklistItem,
  estimateChecklistItemMinutes,
  inferMetaFromChecklistItem,
  moveChecklistItemToDate,
  shiftChecklistItemByDays,
  moveChecklistItemToBacklog,
  addReminder,
  toggleReminder,
  deleteReminder,
  addCustomEvent,
  deleteCustomEvent,
  setEventOverride,
  getDayLectures,
  getDayUniSummaryLabel,
  setLectureAttendance,
  applySemesterScanResult,
  exportWeekChecklistAsText
} from '../checklist.js';
import {
  scanSemesterPlanImage,
  buildSemesterScanBridgePrompt,
  parseSemesterScanReply
} from '../gemini.js';
import { syncModulesFromIcs } from '../ics.js';
import { icon } from '../icons.js';

let weekOffset = 0;
let activeToolsMenuClose = null;

export function getActiveWeekOffset() {
  return weekOffset;
}

export function renderWeekView(root, { toast, navigate, openModal, closeModal, promptLogFromChecklist }) {
  const today = toDateStr();
  reconcileBacklogStatus({ todayStr: today });

  const monday = addDays(getMondayOfWeek(today), weekOffset * 7);
  const sunday = addDays(monday, 6);
  const modules = Object.values(store.state.modules).sort((a, b) => a.shortName.localeCompare(b.shortName));
  const reminders = store.state.reminders || [];
  const backlog = store.state.backlog || [];
  const customEvents = store.state.customEvents || [];
  const calibratedCatalog = store.getCalibratedTaskCatalog();

  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = addDays(monday, i);
    const wd = WEEKDAYS_DE[parseDateStr(d).getDay()].toUpperCase();
    const lectures = getDayLectures(d);
    const autoUni = getDayUniSummaryLabel(d, lectures);
    const note = store.state.dayNotes?.[d] || autoUni || (lectures.filter((l) => !l.cancelled).length === 0 ? 'Frei' : '');
    const items = getChecklistForDay(d);
    const openMin = items.filter((x) => !x.done).reduce((s, x) => s + estimateChecklistItemMinutes(x, calibratedCatalog), 0);
    days.push({ d, wd, note, lectures, items, openMin });
  }

  const openBacklogCount = backlog.filter((b) => b.status === 'open' || b.status === 'overdue').length;
  const autopilot = getAutopilotSuggestions();
  const calibration = store.getCalibrationSummary();
  const calByMod = {};
  for (const c of calibration.byModule) {
    if (c.suggestAdjust) calByMod[c.modId] = c;
  }

  root.innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="page-title">Uni-Plan · ${fmtDateShort(monday)}–${fmtDateShort(sunday)}</h1>
        <div class="small muted">Checkliste pro Tag · ${store.state.icsRaw ? `${modules.length} KIT-Fächer` : 'Kein .ics geladen'} · ${openBacklogCount} im Rückstand</div>
      </div>
      <div class="row" style="gap:6px;">
        <button class="btn btn-sm" id="wk-prev" title="Vorherige Woche">${icon('arrowLeft', 14)}</button>
        <button class="btn btn-sm" id="wk-now">Diese Woche</button>
        <button class="btn btn-sm" id="wk-next" title="Nächste Woche">${icon('arrowRight', 14)}</button>
        <button class="btn btn-sm btn-primary" id="wk-ai-plan">${icon('spark', 14)} KI-Planer</button>
        <div class="menu-wrap">
          <button class="btn btn-sm" id="wk-tools-btn" aria-haspopup="true" aria-expanded="false">${icon('sliders', 13)} Tools</button>
          <div class="menu-pop hidden" id="wk-tools-menu" role="menu">
            <button type="button" class="menu-item" id="wk-scan-sem">${icon('video', 14)} Semesterplan scannen</button>
            <button type="button" class="menu-item" id="wk-copy-text">${icon('copy', 14)} Checkliste kopieren</button>
            <label class="menu-item" style="cursor:pointer;">
              ${icon('upload', 14)} KIT-Kalender (.ics) laden
              <input type="file" accept=".ics,text/calendar" id="wk-ics-upload-menu" class="hidden" />
            </label>
          </div>
        </div>
      </div>
    </div>

    <div class="stack">
      ${!store.state.icsRaw ? `
        <div class="banner info">
          <span><strong>KIT-Stundenplan laden:</strong> Importiere deine <code>.ics</code>-Datei aus dem KIT-Campus-Portal.</span>
          <label class="btn btn-sm btn-primary" style="cursor:pointer;">
            ${icon('upload', 14)} .ics laden
            <input type="file" accept=".ics,text/calendar" id="wk-ics-upload" class="hidden" />
          </label>
        </div>
      ` : ''}

      <!-- 1. 7-Day Uni-Plan Checkliste (Drag & Drop + 1-Klick Verschieben) -->
      <section class="checklist-section">
        ${days.map((day) => {
          const isToday = day.d === today;
          return `
            <div class="day-drop-zone" data-drop-day="${day.d}" style="margin-bottom:18px;">
              <div class="day-divider ${isToday ? 'is-today' : ''}">
                <div class="day-divider-left">
                  <span class="day-divider-title">${day.wd}, ${fmtDateShort(day.d)}${isToday ? ' (HEUTE)' : ''}</span>
                  <span class="day-divider-meta" data-edit-note="${day.d}" style="cursor:pointer;" title="Tages-Hinweis bearbeiten">
                    ${day.note ? `| ${esc(day.note)}` : '| + Hinweis'}
                  </span>
                  ${day.openMin > 0 ? `<span class="xs soft mono">· ~${fmtMin(day.openMin)} offen</span>` : ''}
                </div>
                <button class="btn btn-xs btn-ghost" data-add-day="${day.d}">${icon('plus', 12)} Punkt</button>
              </div>

              ${day.lectures.length ? `
                <div class="row" style="margin-bottom:8px;gap:6px;">
                  ${day.lectures.map((l) => {
                    const cls = l.cancelled ? 'danger' : l.mode === 'video' ? 'purple' : l.attended ? 'prod' : '';
                    const suffix = l.cancelled
                      ? ' · Fällt aus'
                      : l.mode === 'video'
                        ? ' · Video'
                        : l.typeOverride === 'exercise'
                          ? ' · Übung'
                          : l.typeOverride === 'lecture'
                            ? ' · VL'
                            : l.attended
                              ? ' · Besucht'
                              : '';
                    return `
                      <span class="pill ${cls} ${l.cancelled ? 'strike' : ''}" style="cursor:pointer;"
                        data-lec-open="${esc(l.uid)}" data-lec-date="${day.d}"
                        title="Klicken: Anwesenheit oder Termin-Typ (VL / Übung / Fällt aus) ändern">
                        ${l.mode === 'video' ? icon('video', 11) : icon('building', 11)}
                        ${esc(l.shortName)} ${l.start}–${l.end}${suffix}
                      </span>
                    `;
                  }).join('')}
                </div>
              ` : ''}

              <div class="check-list">
                ${day.items.map((it) => {
                  const est = estimateChecklistItemMinutes(it, calibratedCatalog);
                  return `
                  <div class="check-item ${it.done ? 'done' : ''}" draggable="true" data-drag-chk="${esc(it.id)}">
                    <div class="check-item-main" data-chk-toggle="${esc(it.id)}">
                      <span class="check-box">${it.done ? icon('check', 12) : ''}</span>
                      <div class="row" style="gap:8px;flex:1;">
                        ${it.timeLabel ? `<span class="check-time">${esc(it.timeLabel)}</span>` : ''}
                        <span class="check-text">${esc(it.title)}</span>
                        ${!it.done && est > 0 ? `<span class="xs soft mono">~${fmtMin(est)}</span>` : ''}
                        ${it.kind === 'a' ? '<span class="pill anki">Anki</span>' : ''}
                        ${it.backlogId ? '<span class="pill">Rückstand</span>' : ''}
                        ${it.pulledFromDate && it.pulledFromDate > it.d ? '<span class="pill kit">Vorgezogen</span>' : ''}
                      </div>
                    </div>
                    <div class="check-actions">
                      <span class="desktop-only" style="gap:4px;align-items:center;">
                        ${!it.done ? `<button class="btn btn-xs btn-ghost" data-chk-shift="${esc(it.id)}" data-delta="-1" title="1 Tag vorziehen">${icon('arrowLeft', 12)}</button>` : ''}
                        ${!it.done ? `<button class="btn btn-xs btn-ghost" data-chk-shift="${esc(it.id)}" data-delta="1" title="1 Tag nach hinten">${icon('arrowRight', 12)}</button>` : ''}
                        ${!it.done ? `<button class="btn btn-xs btn-ghost" data-chk-timer="${esc(it.id)}" data-kind="${esc(it.kind)}" data-dur="${est || 45}" title="Timer starten">${icon('play', 12)}</button>` : ''}
                        <button class="btn btn-xs btn-ghost" data-chk-edit="${esc(it.id)}" title="Bearbeiten / Auf anderen Tag legen">${icon('edit', 12)}</button>
                        <button class="btn btn-xs btn-ghost" data-chk-del="${esc(it.id)}" title="Löschen">${icon('x', 13)}</button>
                      </span>
                      <button type="button" class="btn btn-xs btn-ghost mobile-only" data-chk-menu="${esc(it.id)}" aria-label="Aktionen">•••</button>
                    </div>
                  </div>
                `;
                }).join('') || `<div class="xs soft" style="padding:4px 10px;">Keine Checklisten-Punkte (Todo hierher ziehen zum Verschieben)</div>`}
              </div>
            </div>
          `;
        }).join('')}

        <!-- VORMERKEN -->
        <div style="margin-top:8px;">
          <div class="day-divider">
            <div class="day-divider-left">
              <span class="day-divider-title">${icon('bookmark', 13)} VORMERKEN</span>
            </div>
          </div>
          <div class="check-list">
            ${reminders.map((r) => `
              <div class="check-item ${r.done ? 'done' : ''}">
                <div class="check-item-main" data-rem-toggle="${esc(r.id)}">
                  <span class="check-box">${r.done ? icon('check', 12) : ''}</span>
                  <span class="check-text">${esc(r.text)}</span>
                </div>
                <button class="btn btn-xs btn-ghost" data-rem-del="${esc(r.id)}">${icon('x', 13)}</button>
              </div>
            `).join('') || '<div class="xs soft" style="padding:4px 10px;">Keine vorgemerkten Termine.</div>'}
          </div>
          <form id="rem-form" class="row" style="margin-top:10px;">
            <input type="text" id="rem-input" class="input" style="flex:1;" placeholder="Vormerken (z. B. MKL-Workshop Block 4: Mi 14:00–15:30 am 02.12., 13.01. & 03.02.)..." required />
            <button type="submit" class="btn btn-sm">${icon('plus', 14)} Vormerken</button>
          </form>
        </div>
      </section>

      <!-- 2. Offener Rückstand (Altlasten-Speicher) & Eigene feste Termine -->
      <div class="grid-2">
        <section class="card">
          <div class="card-header">
            <h2 class="card-title">${icon('list', 15)} Offener Rückstand (${openBacklogCount})</h2>
          </div>
          <p class="xs muted" style="margin-top:0;">
            Altlasten (offene Videos, Ankis, HAs), die Gemini automatisch für dich einplant. Beim Abhaken in der Checkliste werden sie hier mit erledigt – beim Löschen fallen sie zurück auf Offen.
          </p>
          ${autopilot.length ? `
            <div class="entry-list" style="margin-bottom:10px;padding-bottom:10px;border-bottom:1px solid var(--border);">
              <div class="xs soft mono">AUTOPILOT-VORSCHLÄGE (${autopilot.length})</div>
              ${autopilot.map((s, idx) => `
                <div class="entry-row" style="padding:6px 9px;border-style:dashed;">
                  <div>
                    <div class="xs" style="font-weight:580;">${esc(s.title)}</div>
                    <div class="xs soft">~${fmtMin(s.estMin)} · ${esc(s.reason)}</div>
                  </div>
                  <div class="row" style="gap:4px;flex-wrap:nowrap;">
                    <button class="btn btn-xs btn-primary" data-wk-ap-acc="${idx}">+</button>
                    <button class="btn btn-xs btn-ghost" data-wk-ap-dis="${esc(s.uid)}">${icon('x', 12)}</button>
                  </div>
                </div>
              `).join('')}
            </div>
          ` : ''}
          <div class="entry-list" style="margin-bottom:10px;">
            ${backlog.map((b) => {
              const badge = b.status === 'done'
                ? '<span class="pill kit">Erledigt</span>'
                : b.status === 'overdue'
                  ? `<span class="pill danger">Überfällig (${fmtDateShort(b.scheduledDate)})</span>`
                  : b.status === 'scheduled'
                    ? `<span class="pill learn">Geplant ${fmtDateShort(b.scheduledDate)}</span>`
                    : '<span class="pill prod">Offen</span>';
              return `
                <div class="entry-row ${b.status === 'done' ? 'non-counting' : ''}">
                  <div class="row" style="gap:8px;flex:1;min-width:0;">
                    <span class="check-box" style="cursor:pointer;${b.status === 'done' ? 'background:var(--accent);border-color:var(--accent);' : ''}" data-bl-toggle="${esc(b.id)}">${b.status === 'done' ? icon('check', 12) : ''}</span>
                    <div style="min-width:0;">
                      <div class="small ${b.status === 'done' ? 'strike' : ''}" style="font-weight:580;">${esc(b.title)}</div>
                      <div class="row" style="gap:6px;margin-top:2px;">
                        ${badge}
                        ${b.estMin ? `<span class="xs soft mono">~${fmtMin(b.estMin)}</span>` : ''}
                      </div>
                    </div>
                  </div>
                  <div class="row" style="gap:4px;flex-wrap:nowrap;">
                    ${b.status === 'open' || b.status === 'overdue' ? `<button class="btn btn-xs" data-bl-today="${esc(b.id)}" title="Auf heute einplanen">Heute</button>` : ''}
                    <button class="btn btn-xs btn-ghost" data-bl-del="${esc(b.id)}">${icon('x', 13)}</button>
                  </div>
                </div>
              `;
            }).join('') || '<div class="xs soft">Kein offener Rückstand – alles im Takt.</div>'}
          </div>
          <form id="bl-form" class="row">
            <input type="text" id="bl-title" class="input" style="flex:1;min-width:150px;" placeholder="z. B. HM: 1 offenes VL-Video" required />
            <input type="number" id="bl-min" class="input mono" style="width:76px;" min="10" max="480" value="90" title="Geschätzte Minuten" />
            <button type="submit" class="btn btn-primary btn-sm">${icon('plus', 14)}</button>
          </form>
        </section>

        <!-- Eigene feste Termine (TM-Tut, MKL-Workshops etc.) -->
        <section class="card">
          <div class="card-header">
            <h2 class="card-title">${icon('calendar', 15)} Eigene feste Termine (${customEvents.length})</h2>
            <button class="btn btn-xs btn-primary" id="btn-add-custom">${icon('plus', 12)} Termin</button>
          </div>
          <p class="xs muted" style="margin-top:0;">
            Für Uni-Termine, die nicht im KIT-WebCal stehen (z. B. wöchentliches TM-Tut Do 09:45–11:15 oder einmalige MKL-Workshops). Werden automatisch als Uni-/Vorlesungszeit mitgezählt.
          </p>
          <div class="entry-list">
            ${customEvents.map((c) => `
              <div class="entry-row">
                <div>
                  <div style="font-weight:600;font-size:0.88rem;">${esc(c.title)}</div>
                  <div class="xs muted mono">
                    ${c.recurrence === 'weekly' ? `Jeden ${WEEKDAYS_DE[c.weekday]}` : fmtDateShort(c.date)} · ${c.start}–${c.end}
                    · ${c.eventType === 'lecture' ? 'VL' : c.eventType === 'workshop' ? 'Workshop' : 'Übung/Tut'}${c.liveReviewMinutes > 0 ? ` · Nacharb. ~${c.liveReviewMinutes}m` : ''}
                  </div>
                </div>
                <button class="btn btn-xs btn-ghost" data-del-custom="${esc(c.id)}">${icon('x', 13)}</button>
              </div>
            `).join('') || '<div class="xs soft">Noch keine eigenen Termine. Klick auf „+ Termin“ z. B. für dein TM-Tut (Do 09:45–11:15).</div>'}
          </div>
        </section>
      </div>

      <!-- 3. KIT Modul-Regeln -->
      <section class="card">
        <div class="card-header">
          <h2 class="card-title">${icon('sliders', 15)} KIT-Modul-Regeln (${modules.length})</h2>
          <div class="row" style="gap:6px;">
            <label class="btn btn-xs" style="cursor:pointer;">
              ${icon('upload', 12)} .ics
              <input type="file" accept=".ics,text/calendar" id="wk-ics-upload-2" class="hidden" />
            </label>
            <button class="btn btn-xs btn-primary" id="btn-add-module">${icon('plus', 12)} Fach</button>
          </div>
        </div>
        <div class="grid-2">
          ${modules.map((m) => {
            const cal = calByMod[m.id];
            return `
            <div class="entry-row">
              <div>
                <div style="font-weight:620;">${esc(m.shortName)}</div>
                <div class="xs muted">
                  ${m.attendance === 'live'
                    ? `Live${m.liveReviewMinutes > 0 ? ` · Nacharb. ~${m.liveReviewMinutes}m` : ' · keine Nacharb.'}`
                    : m.attendance === 'video'
                      ? `Video (~${m.videoStudyMinutes || 165}m)`
                      : 'Übersprungen'}
                  ${m.createsAnki ? ' · Ankis' : ''}
                  ${m.triggersHomework ? ` · HA (${m.homeworkMode === 'understanding' ? 'Verständnis' : 'Abgabe'})` : ''}
                </div>
              </div>
              <div class="row" style="gap:5px;flex-wrap:nowrap;">
                ${cal ? `<button class="btn btn-xs btn-primary" data-cal-apply="${esc(m.id)}" data-cal-act="${esc(cal.taetigkeit)}" data-cal-min="${cal.p75Min}" title="Oberes Ende (P75) aus ${cal.anzahl} Sessions · reiner Ø ${cal.echterSchnittMin}m">P75 ${cal.p75Min}m</button>` : ''}
                <button class="btn btn-xs" data-edit-mod="${esc(m.id)}">Regel</button>
              </div>
            </div>
          `;
          }).join('') || '<div class="small muted">Lade eine .ics-Datei oder lege deine Fächer manuell an.</div>'}
        </div>
      </section>

      <!-- 4. Aufgaben-Katalog (Bausteine für KI & Auto-Kalibrierung ab 2 Sessions) -->
      <section class="card">
        <div class="card-header">
          <div>
            <h2 class="card-title">${icon('list', 15)} Aufgaben-Katalog (${calibratedCatalog.length})</h2>
            <div class="xs muted" style="margin-top:2px;">Wird an KI-Prompt & API geschickt · ab 2 echten Sessions automatisch am oberen Ende (P75-Puffer) kalibriert (KI darf nur hinzufügen, nie löschen)</div>
          </div>
          <button class="btn btn-xs btn-primary" id="btn-add-catalog">${icon('plus', 12)} Baustein</button>
        </div>
        <div class="grid-2">
          ${calibratedCatalog.map((c) => `
            <div class="entry-row">
              <div style="min-width:0;">
                <div class="row" style="gap:6px;">
                  <span class="pill">${esc(c.subject || 'Allgemein')}</span>
                  <span style="font-weight:600;font-size:0.86rem;">${esc(c.title)}</span>
                  ${c.source === 'ai' ? '<span class="pill purple">KI</span>' : ''}
                </div>
                <div class="xs muted mono" style="margin-top:3px;">
                  Start: ${c.defaultMin}m
                  ${c.calibrated
                    ? ` · <strong style="color:var(--kit);" title="75. Perzentil (oberes Ende gegen Zeitdruck) · reiner Ø war ${c.avgRealMin}m">Auto-Puffer (${c.sampleCount}x): ${c.effectiveMin}m</strong>`
                    : c.sampleCount === 1
                      ? ` · 1 Session: ${c.avgRealMin}m (ab 2x auto)`
                      : ` · Aktiv: ${c.effectiveMin}m`}
                  ${c.notes ? ` · ${esc(c.notes)}` : ''}
                </div>
              </div>
              <button class="btn btn-xs" data-edit-cat="${esc(c.id)}">Ändern</button>
            </div>
          `).join('') || '<div class="small muted">Noch keine Bausteine. Klicke auf „+ Baustein“.</div>'}
        </div>
      </section>
    </div>
  `;

  // Navigation & Tools Menu
  const viewCtx = { toast, navigate, openModal, closeModal, promptLogFromChecklist };
  root.querySelector('#wk-prev')?.addEventListener('click', () => { weekOffset--; renderWeekView(root, viewCtx); });
  root.querySelector('#wk-now')?.addEventListener('click', () => { weekOffset = 0; renderWeekView(root, viewCtx); });
  root.querySelector('#wk-next')?.addEventListener('click', () => { weekOffset++; renderWeekView(root, viewCtx); });
  root.querySelector('#wk-ai-plan')?.addEventListener('click', () => navigate('planner'));

  if (activeToolsMenuClose) {
    document.removeEventListener('click', activeToolsMenuClose);
    activeToolsMenuClose = null;
  }
  const toolsBtn = root.querySelector('#wk-tools-btn');
  const toolsMenu = root.querySelector('#wk-tools-menu');
  const closeToolsMenu = () => {
    toolsMenu?.classList.add('hidden');
    toolsBtn?.setAttribute('aria-expanded', 'false');
  };
  toolsBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    const isHidden = toolsMenu.classList.toggle('hidden');
    toolsBtn.setAttribute('aria-expanded', String(!isHidden));
  });
  activeToolsMenuClose = (e) => {
    if (!toolsMenu || toolsMenu.classList.contains('hidden')) return;
    if (!toolsMenu.contains(e.target) && e.target !== toolsBtn) closeToolsMenu();
  };
  document.addEventListener('click', activeToolsMenuClose);

  // Semesterplan-Scanner Modal (BOTH Gemini-Pro-Bridge AND Direct API!)
  root.querySelector('#wk-scan-sem')?.addEventListener('click', () => {
    closeToolsMenu();
    let lastScan = null;
    let scanMode = 'bridge'; // Default to reliable Gemini-Pro-Bridge, 1-click toggle to API

    const renderScanPreview = (modalEl, scan) => {
      const previewEl = modalEl.querySelector('#sem-preview');
      previewEl.classList.remove('hidden');
      previewEl.innerHTML = `
        <div class="proposal-card" style="margin-top:0;">
          <div class="row-between" style="margin-bottom:8px;">
            <strong class="small">${esc(scan.summary)}</strong>
            <button class="btn btn-xs btn-primary" id="sem-apply">${icon('check', 12)} Alle übernehmen</button>
          </div>
          <div class="xs muted" style="margin-bottom:6px;">
            ${scan.overrides.length} Tages-Overrides · ${scan.customEvents.length} Zusatztermine · ${scan.reminders.length} Vormerkungen (${esc(scan.modelUsed || '')})
            ${scan.rejectedCount > 0 ? ` · <span style="color:var(--danger);">${scan.rejectedCount} ungültige Einträge verworfen</span>` : ''}
          </div>
          <div class="entry-list" style="max-height:240px;overflow-y:auto;">
            ${scan.overrides.map((o) => `
              <div class="entry-row" style="padding:5px 8px;">
                <span class="xs mono">${fmtDateShort(o.d)} · ${esc(o.matchModule)} ${o.label ? `(${esc(o.label)})` : ''}</span>
                <span class="pill">${o.overrideType === 'exercise' ? 'Übung' : o.overrideType === 'cancelled' ? 'Fällt aus' : 'VL'}</span>
              </div>
            `).join('')}
            ${scan.customEvents.map((e) => `
              <div class="entry-row" style="padding:5px 8px;">
                <span class="xs mono">${fmtDateShort(e.date)} ${esc(e.start)}–${esc(e.end)} · ${esc(e.title)}</span>
                <span class="pill kit">Termin</span>
              </div>
            `).join('')}
            ${scan.reminders.map((r) => `
              <div class="entry-row" style="padding:5px 8px;">
                <span class="xs">${esc(r)}</span>
                <span class="pill">Vormerken</span>
              </div>
            `).join('')}
          </div>
        </div>
      `;
      previewEl.querySelector('#sem-apply')?.addEventListener('click', () => {
        const res = applySemesterScanResult(scan);
        closeModal();
        toast(`Übernommen: ${res.appliedOverrides} Overrides, ${res.addedEvents} Termine, ${res.addedReminders} Vormerkungen.`, 'ok', { undo: true });
      });
    };

    openModal(`
      <div class="card-header">
        <h3 class="card-title">Semesterplan einlesen (Pro-Bridge & API)</h3>
        <button class="icon-btn" id="m-close">${icon('x', 15)}</button>
      </div>
      <div class="row-between" style="margin-bottom:10px;">
        <div class="segmented">
          <button type="button" data-sem-mode="bridge" class="active">Gemini-Pro-Bridge</button>
          <button type="button" data-sem-mode="api">Direkt per API</button>
        </div>
        <span class="xs soft">Empfohlen bei API-Spikes: Bridge</span>
      </div>
      <div class="stack">
        <div class="field">
          <label>Hinweis für Gemini (optional — gilt für Bridge & API)</label>
          <input type="text" id="sem-hint" class="input" placeholder="z. B. MKL-Plan · Ich bin in Block 4 (Mi 14:00–15:30)" />
        </div>

        <!-- Panel A: Gemini-Pro-Bridge (Zero API needed!) -->
        <div id="sem-panel-bridge" class="stack">
          <p class="xs muted" style="margin:0;">
            1. Prompt kopieren → 2. Zusammen mit deinem Semesterplan-Screenshot in <strong>Gemini Pro</strong> schicken → 3. JSON-Antwort hier einfügen.
          </p>
          <div class="row">
            <button type="button" class="btn btn-primary btn-sm" id="sem-copy-prompt">${icon('copy', 13)} Scan-Prompt kopieren</button>
          </div>
          <textarea id="sem-bridge-paste" class="input mono" style="min-height:110px;" placeholder="JSON-Antwort aus Gemini Pro hier einfügen..."></textarea>
          <div class="row">
            <button type="button" class="btn btn-primary btn-sm" id="sem-bridge-parse">${icon('check', 13)} Vorschau erzeugen</button>
            <span class="xs muted" id="sem-bridge-status"></span>
          </div>
        </div>

        <!-- Panel B: Direct API -->
        <div id="sem-panel-api" class="stack hidden">
          <div class="field">
            <label>Screenshot / Bild auswählen (PNG, JPG, WebP)</label>
            <input type="file" id="sem-file" accept="image/*" class="input" />
          </div>
          <div class="row">
            <button type="button" class="btn btn-primary btn-sm" id="sem-analyze">${icon('spark', 14)} Mit Gemini-API analysieren</button>
            <span class="xs muted" id="sem-status"></span>
          </div>
        </div>

        <div id="sem-preview" class="hidden stack"></div>
      </div>
    `, (modalEl) => {
      modalEl.querySelector('#m-close')?.addEventListener('click', closeModal);

      modalEl.querySelectorAll('[data-sem-mode]').forEach((btn) => {
        btn.addEventListener('click', () => {
          scanMode = btn.getAttribute('data-sem-mode');
          modalEl.querySelectorAll('[data-sem-mode]').forEach((b) => b.classList.toggle('active', b === btn));
          modalEl.querySelector('#sem-panel-bridge').classList.toggle('hidden', scanMode !== 'bridge');
          modalEl.querySelector('#sem-panel-api').classList.toggle('hidden', scanMode !== 'api');
        });
      });

      modalEl.querySelector('#sem-copy-prompt')?.addEventListener('click', async () => {
        const hint = modalEl.querySelector('#sem-hint').value.trim();
        try {
          await navigator.clipboard.writeText(buildSemesterScanBridgePrompt(hint));
          toast('Semesterplan-Prompt kopiert! Jetzt mit Screenshot in Gemini Pro einfügen.', 'ok');
        } catch {
          toast('Kopieren fehlgeschlagen.', 'err');
        }
      });

      modalEl.querySelector('#sem-bridge-parse')?.addEventListener('click', () => {
        const raw = modalEl.querySelector('#sem-bridge-paste').value;
        const st = modalEl.querySelector('#sem-bridge-status');
        try {
          lastScan = parseSemesterScanReply(raw, 'Gemini Pro (Bridge)');
          st.textContent = 'Antwort erkannt!';
          renderScanPreview(modalEl, lastScan);
        } catch (err) {
          st.textContent = '';
          toast(`JSON-Fehler: ${err.message}`, 'err');
        }
      });

      modalEl.querySelector('#sem-analyze')?.addEventListener('click', async () => {
        const file = modalEl.querySelector('#sem-file')?.files?.[0];
        if (!file) { toast('Bitte zuerst ein Bild auswählen.', 'err'); return; }
        const statusEl = modalEl.querySelector('#sem-status');
        const btn = modalEl.querySelector('#sem-analyze');
        btn.disabled = true;
        statusEl.textContent = 'Analysiere Bild mit Gemini...';
        try {
          const base64Data = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result).split(',')[1]);
            reader.onerror = () => reject(new Error('Datei konnte nicht gelesen werden.'));
            reader.readAsDataURL(file);
          });
          lastScan = await scanSemesterPlanImage({
            base64Data,
            mimeType: file.type || 'image/png',
            userHint: modalEl.querySelector('#sem-hint').value.trim()
          });
          statusEl.textContent = `Fertig (${lastScan.modelUsed})`;
          renderScanPreview(modalEl, lastScan);
        } catch (err) {
          statusEl.textContent = '';
          toast(`Scanner-Fehler: ${err.message}`, 'err');
        } finally {
          btn.disabled = false;
        }
      });
    });
  });

  // Autopilot on Week view
  root.querySelectorAll('[data-wk-ap-acc]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const s = autopilot[Number(btn.getAttribute('data-wk-ap-acc'))];
      if (s) { acceptAutopilotSuggestion(s); toast('Zum Rückstand hinzugefügt.', 'ok'); }
    });
  });
  root.querySelectorAll('[data-wk-ap-dis]').forEach((btn) => {
    btn.addEventListener('click', () => dismissAutopilotSuggestion(btn.getAttribute('data-wk-ap-dis')));
  });

  // 1-click Calibration apply (#8)
  root.querySelectorAll('[data-cal-apply]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-cal-apply');
      const act = btn.getAttribute('data-cal-act');
      const min = Number(btn.getAttribute('data-cal-min'));
      const mod = store.state.modules[id];
      if (!mod || !min) return;
      if (act === 'video') { mod.videoStudyMinutes = min; mod.studyMinutes = min; }
      else { mod.liveReviewMinutes = min; }
      store.touchMapKey('modules', id);
      store.save();
      toast(`${mod.shortName} auf P75 ${min} min kalibriert.`, 'ok');
    });
  });

  root.querySelector('#wk-copy-text')?.addEventListener('click', async () => {
    closeToolsMenu();
    try { await navigator.clipboard.writeText(exportWeekChecklistAsText(monday)); toast('Checkliste kopiert.', 'ok'); }
    catch { toast('Kopieren fehlgeschlagen.', 'err'); }
  });

  // ICS Upload
  const handleIcs = (input) => {
    input?.addEventListener('change', async () => {
      const f = input.files?.[0];
      if (!f) return;
      closeToolsMenu();
      const res = syncModulesFromIcs(store, await f.text());
      toast(`KIT-Kalender geladen: ${res.totalEvents} Serientermine, ${res.modulesAdded} neue Fächer.`, 'ok');
    });
  };
  handleIcs(root.querySelector('#wk-ics-upload'));
  handleIcs(root.querySelector('#wk-ics-upload-2'));
  handleIcs(root.querySelector('#wk-ics-upload-menu'));

  // Checklist actions + 1-Click Day Shift + Drag & Drop + Log-Modal + Undo Toast
  root.querySelectorAll('[data-chk-toggle]').forEach((el) => {
    el.addEventListener('click', () => {
      const updated = toggleChecklistItem(el.getAttribute('data-chk-toggle'));
      if (updated && updated.done && promptLogFromChecklist) promptLogFromChecklist(updated);
    });
  });
  root.querySelectorAll('[data-chk-shift]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-chk-shift');
      const delta = Number(btn.getAttribute('data-delta'));
      const res = shiftChecklistItemByDays(id, delta);
      if (res.ok) {
        const targetWd = WEEKDAYS_DE[parseDateStr(res.targetDate).getDay()];
        toast(`Verschoben auf ${targetWd}, ${fmtDateShort(res.targetDate)}.`, 'ok');
      }
    });
  });

  // Desktop Drag & Drop between days
  let draggedChkId = null;
  root.querySelectorAll('[data-drag-chk]').forEach((el) => {
    el.addEventListener('dragstart', (e) => {
      draggedChkId = el.getAttribute('data-drag-chk');
      el.classList.add('dragging');
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', draggedChkId);
      }
    });
    el.addEventListener('dragend', () => {
      el.classList.remove('dragging');
      draggedChkId = null;
      root.querySelectorAll('.day-drop-zone.drag-over').forEach((z) => z.classList.remove('drag-over'));
    });
  });
  root.querySelectorAll('[data-drop-day]').forEach((zone) => {
    zone.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      zone.classList.add('drag-over');
    });
    zone.addEventListener('dragleave', (e) => {
      if (!zone.contains(e.relatedTarget)) zone.classList.remove('drag-over');
    });
    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      zone.classList.remove('drag-over');
      const id = draggedChkId || e.dataTransfer?.getData('text/plain');
      const targetDay = zone.getAttribute('data-drop-day');
      if (!id || !targetDay) return;
      const res = moveChecklistItemToDate(id, targetDay);
      if (res.ok) {
        const wd = WEEKDAYS_DE[parseDateStr(targetDay).getDay()];
        toast(`Verschoben auf ${wd}, ${fmtDateShort(targetDay)}.`, 'ok');
      }
    });
  });
  root.querySelectorAll('[data-chk-del]').forEach((btn) => {
    btn.addEventListener('click', () => {
      deleteChecklistItem(btn.getAttribute('data-chk-del'));
      toast('Punkt gelöscht.', '', { undo: true });
    });
  });
  root.querySelectorAll('[data-chk-timer]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const chkId = btn.getAttribute('data-chk-timer');
      const it = store.state.checklist.find((x) => x.id === chkId);
      const meta = it ? inferMetaFromChecklistItem(it) : { kind: btn.getAttribute('data-kind') || 'l', mod: '', act: '' };
      const catId = it?.catalogId || (meta.kind !== 'a' ? (store.matchCatalogItemForText(it?.title || '', meta.act, meta.mod)?.id || '') : '');
      store.startTimer({
        mode: 'countdown',
        kind: btn.getAttribute('data-kind') || meta.kind || 'l',
        durationMin: Number(btn.getAttribute('data-dur')) || 45,
        planBlockId: chkId,
        mod: meta.mod || '',
        note: it?.title || '',
        act: meta.act || '',
        catalogId: catId
      });
      toast('Timer gestartet.', 'ok');
      navigate('today');
    });
  });

  // Backlog actions
  root.querySelector('#bl-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const tEl = root.querySelector('#bl-title');
    const mEl = root.querySelector('#bl-min');
    if (addBacklogItem({ title: tEl.value, estMin: mEl.value })) {
      tEl.value = '';
      toast('Zum offenen Rückstand hinzugefügt.', 'ok');
    }
  });
  root.querySelectorAll('[data-bl-toggle]').forEach((el) => el.addEventListener('click', () => toggleBacklogDone(el.getAttribute('data-bl-toggle'))));
  root.querySelectorAll('[data-bl-del]').forEach((btn) => btn.addEventListener('click', () => { deleteBacklogItem(btn.getAttribute('data-bl-del')); toast('Rückstand gelöscht.', '', { undo: true }); }));
  root.querySelectorAll('[data-bl-today]').forEach((btn) => {
    btn.addEventListener('click', () => {
      scheduleBacklogToDay(btn.getAttribute('data-bl-today'), today);
      toast('Auf heute eingeplant.', 'ok');
    });
  });

  // Custom events modal
  root.querySelector('#btn-add-custom')?.addEventListener('click', () => {
    openModal(`
      <div class="card-header">
        <h3 class="card-title">Eigener fester Uni-Termin</h3>
        <button class="icon-btn" id="m-close">${icon('x', 15)}</button>
      </div>
      <form id="m-cev-form" class="stack">
        <div class="field"><label>Bezeichnung</label><input class="input" id="mc-name" placeholder="z. B. TM-Tut oder MKL-Workshop (Block 4)" required /></div>
        <div class="field-grid">
          <div class="field">
            <label>Wiederholung</label>
            <select class="input" id="mc-rec">
              <option value="weekly">Wöchentlich</option>
              <option value="once">Einmaliges Datum</option>
            </select>
          </div>
          <div class="field" id="mc-wd-wrap">
            <label>Wochentag</label>
            <select class="input" id="mc-wd">
              <option value="1">Montag</option>
              <option value="2">Dienstag</option>
              <option value="3">Mittwoch</option>
              <option value="4" selected>Donnerstag</option>
              <option value="5">Freitag</option>
              <option value="6">Samstag</option>
              <option value="0">Sonntag</option>
            </select>
          </div>
          <div class="field hidden" id="mc-dt-wrap">
            <label>Datum</label>
            <input type="date" class="input mono" id="mc-dt" value="${today}" />
          </div>
        </div>
        <div class="field-grid">
          <div class="field"><label>Start</label><input type="time" class="input mono" id="mc-st" value="09:45" required /></div>
          <div class="field"><label>Ende</label><input type="time" class="input mono" id="mc-en" value="11:15" required /></div>
        </div>
        <div class="field-grid">
          <div class="field">
            <label>Typ</label>
            <select class="input" id="mc-type">
              <option value="exercise">Übung / Tutorium</option>
              <option value="workshop">Workshop</option>
              <option value="lecture">Vorlesung</option>
            </select>
          </div>
          <div class="field">
            <label>Nacharbeit (min, optional)</label>
            <input type="number" class="input mono" id="mc-rev-min" min="0" max="360" value="0" />
          </div>
        </div>
        <div class="row" style="justify-content:flex-end;"><button type="submit" class="btn btn-primary btn-sm">Speichern</button></div>
      </form>
    `, (modalEl) => {
      modalEl.querySelector('#m-close')?.addEventListener('click', closeModal);
      const recSel = modalEl.querySelector('#mc-rec');
      const typeSel = modalEl.querySelector('#mc-type');
      const revInp = modalEl.querySelector('#mc-rev-min');
      recSel?.addEventListener('change', () => {
        const isOnce = recSel.value === 'once';
        modalEl.querySelector('#mc-wd-wrap').classList.toggle('hidden', isOnce);
        modalEl.querySelector('#mc-dt-wrap').classList.toggle('hidden', !isOnce);
      });
      typeSel?.addEventListener('change', () => {
        const curVal = Number(revInp.value) || 0;
        if (typeSel.value === 'lecture' && curVal === 0) revInp.value = '75';
        else if (typeSel.value !== 'lecture' && curVal === 75) revInp.value = '0';
      });
      modalEl.querySelector('#m-cev-form')?.addEventListener('submit', (e) => {
        e.preventDefault();
        addCustomEvent({
          title: modalEl.querySelector('#mc-name').value,
          recurrence: recSel.value,
          weekday: modalEl.querySelector('#mc-wd').value,
          date: modalEl.querySelector('#mc-dt').value,
          start: modalEl.querySelector('#mc-st').value,
          end: modalEl.querySelector('#mc-en').value,
          eventType: typeSel.value,
          liveReviewMinutes: Math.max(0, Number(revInp.value) || 0)
        });
        closeModal();
        toast('Termin hinzugefügt.', 'ok');
      });
    });
  });

  root.querySelectorAll('[data-del-custom]').forEach((btn) => {
    btn.addEventListener('click', () => { deleteCustomEvent(btn.getAttribute('data-del-custom')); toast('Termin entfernt.'); });
  });

  // 1-Klick-Termin-Override Modal (for MKL VL <-> Übung <-> Fällt aus + Attendance)
  root.querySelectorAll('[data-lec-open]').forEach((el) => {
    el.addEventListener('click', () => {
      const uid = el.getAttribute('data-lec-open');
      const d = el.getAttribute('data-lec-date');
      const lec = getDayLectures(d).find((x) => x.uid === uid);
      if (!lec) return;
      const curOv = store.state.eventOverrides?.[uid] || 'default';
      const curAtt = store.state.lectureAttendance?.[uid] || 'auto';

      openModal(`
        <div class="card-header">
          <h3 class="card-title">${esc(lec.shortName)} · ${fmtDateShort(d)}</h3>
          <button class="icon-btn" id="m-close">${icon('x', 15)}</button>
        </div>
        <div class="stack">
          <div class="xs muted mono">${lec.start}–${lec.end} (${lec.durationMin} min)${lec.location ? ` · ${esc(lec.location)}` : ''}</div>
          <div class="field">
            <label>Termin-Typ nur für diesen Tag (z. B. MKL-Wechsel oder Ausfall)</label>
            <select class="input" id="ov-type">
              <option value="default" ${curOv === 'default' ? 'selected' : ''}>Standard aus Modul-Regel</option>
              <option value="lecture" ${curOv === 'lecture' ? 'selected' : ''}>Vorlesung (Nacharbeit einplanen)</option>
              <option value="exercise" ${curOv === 'exercise' ? 'selected' : ''}>Übung (Nacharbeit lt. Modul-Regel)</option>
              <option value="cancelled" ${curOv === 'cancelled' ? 'selected' : ''}>Fällt aus (nicht blockiert, 0 min)</option>
            </select>
          </div>
          <div class="field">
            <label>Anwesenheit (für Vorlesung / Produktiv-Statistik)</label>
            <select class="input" id="ov-att">
              <option value="auto" ${curAtt === 'auto' ? 'selected' : ''}>Automatisch (bei Live nach Ende)</option>
              <option value="attended" ${curAtt === 'attended' ? 'selected' : ''}>Besucht (+${lec.durationMin} min)</option>
              <option value="skipped" ${curAtt === 'skipped' ? 'selected' : ''}>Nicht besucht (0 min)</option>
            </select>
          </div>
          <div class="row-between">
            ${lec.moduleId ? `<button class="btn btn-sm" id="ov-mod">Allgemeine Modul-Regel</button>` : '<span></span>'}
            <button class="btn btn-primary btn-sm" id="ov-save">Übernehmen</button>
          </div>
        </div>
      `, (modalEl) => {
        modalEl.querySelector('#m-close')?.addEventListener('click', closeModal);
        modalEl.querySelector('#ov-mod')?.addEventListener('click', () => { closeModal(); openModuleModal(lec.moduleId); });
        modalEl.querySelector('#ov-save')?.addEventListener('click', () => {
          setEventOverride(uid, d, modalEl.querySelector('#ov-type').value);
          if (modalEl.querySelector('#ov-type').value !== 'cancelled') {
            setLectureAttendance(uid, d, modalEl.querySelector('#ov-att').value);
          }
          closeModal();
          toast('Termin aktualisiert.', 'ok');
        });
      });
    });
  });

  // Add / Edit / Quick-Move Checklist Item Modal (with Catalog Blueprint Picker + Quick Day Chips!)
  const openCheckItemModal = (existing = null, defaultDate = today) => {
    const it = existing || { d: defaultDate, timeLabel: '', title: '', kind: 'l', estMin: 45, catalogId: '' };
    const dayChips = days.map((d) => `
      <button type="button" class="chip ${d.d === it.d ? 'active' : ''}" data-pick-day="${d.d}">${d.wd} ${fmtDateShort(d.d)}</button>
    `).join('');
    openModal(`
      <div class="card-header">
        <h3 class="card-title">${existing ? 'Punkt bearbeiten / verschieben' : 'Neuer Checklisten-Punkt'}</h3>
        <button class="icon-btn" id="m-close">${icon('x', 15)}</button>
      </div>
      <form id="m-chk-form" class="stack">
        ${!existing && calibratedCatalog.length ? `
          <div class="field">
            <label>Aus Aufgaben-Katalog vorbefüllen (optional)</label>
            <select class="input" id="mc-cat-pick">
              <option value="">— Frei eingeben —</option>
              ${calibratedCatalog.map((c) => `<option value="${esc(c.id)}">${esc(c.subject)} · ${esc(c.title)} (~${c.effectiveMin}m)</option>`).join('')}
            </select>
          </div>
        ` : ''}
        <div class="field"><label>Aufgabe</label><input class="input" id="mc-title" value="${esc(it.title)}" placeholder="z. B. HM: neues VL-Video 1 schauen" required /></div>
        <div class="field">
          <label>Schnell auf Wochentag legen</label>
          <div class="chip-row">${dayChips}</div>
        </div>
        <div class="field-grid">
          <div class="field"><label>Tag (Datum)</label><input type="date" class="input mono" id="mc-date" value="${esc(it.d)}" required /></div>
          <div class="field"><label>Zeit-Hinweis (opt.)</label><input class="input mono" id="mc-time" value="${esc(it.timeLabel || '')}" placeholder="z. B. 10:45 oder Ab 15:30" /></div>
        </div>
        <div class="field-grid">
          <div class="field">
            <label>Kategorie</label>
            <select class="input" id="mc-kind">
              <option value="l" ${it.kind === 'l' ? 'selected' : ''}>Lernen / Video / HA</option>
              <option value="a" ${it.kind === 'a' ? 'selected' : ''}>Anki</option>
              <option value="p" ${it.kind === 'p' ? 'selected' : ''}>Vorlesung / Orga</option>
            </select>
          </div>
          <div class="field"><label>Geschätzte Dauer (min)</label><input type="number" class="input mono" id="mc-est" min="0" max="480" value="${it.estMin || 45}" /></div>
        </div>
        <div class="row-between">
          ${existing ? `<button type="button" class="btn btn-sm" id="mc-to-backlog">In Rückstand schieben</button>` : '<span></span>'}
          <button type="submit" class="btn btn-primary btn-sm">Speichern</button>
        </div>
      </form>
    `, (modalEl) => {
      modalEl.querySelector('#m-close')?.addEventListener('click', closeModal);
      let pickedCatalogId = it.catalogId || '';

      modalEl.querySelector('#mc-cat-pick')?.addEventListener('change', (e) => {
        const cid = e.target.value;
        const cat = calibratedCatalog.find((c) => c.id === cid);
        if (!cat) { pickedCatalogId = ''; return; }
        pickedCatalogId = cat.id;
        modalEl.querySelector('#mc-title').value = cat.title;
        modalEl.querySelector('#mc-kind').value = cat.kind || 'l';
        modalEl.querySelector('#mc-est').value = cat.effectiveMin;
      });

      modalEl.querySelectorAll('[data-pick-day]').forEach((chip) => {
        chip.addEventListener('click', () => {
          const d = chip.getAttribute('data-pick-day');
          modalEl.querySelector('#mc-date').value = d;
          modalEl.querySelectorAll('[data-pick-day]').forEach((c) => c.classList.toggle('active', c === chip));
        });
      });

      modalEl.querySelector('#mc-to-backlog')?.addEventListener('click', () => {
        if (existing) {
          moveChecklistItemToBacklog(existing.id);
          closeModal();
          toast('In den offenen Rückstand verschoben.', 'ok', { undo: true });
        }
      });

      modalEl.querySelector('#m-chk-form')?.addEventListener('submit', (e) => {
        e.preventDefault();
        const nextDate = modalEl.querySelector('#mc-date').value;
        const patch = {
          d: nextDate,
          timeLabel: modalEl.querySelector('#mc-time').value.trim(),
          title: modalEl.querySelector('#mc-title').value.trim(),
          kind: modalEl.querySelector('#mc-kind').value,
          estMin: Number(modalEl.querySelector('#mc-est').value) || 0,
          catalogId: pickedCatalogId
        };
        if (existing) {
          if (nextDate !== existing.d) moveChecklistItemToDate(existing.id, nextDate, { save: false });
          updateChecklistItem(existing.id, patch);
        } else {
          addChecklistItem(patch);
        }
        closeModal();
      });
    });
  };

  root.querySelectorAll('[data-add-day]').forEach((btn) => btn.addEventListener('click', () => openCheckItemModal(null, btn.getAttribute('data-add-day'))));
  root.querySelectorAll('[data-chk-edit]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const it = store.state.checklist.find((x) => x.id === btn.getAttribute('data-chk-edit'));
      if (it) openCheckItemModal(it);
    });
  });
  root.querySelectorAll('[data-chk-menu]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const it = store.state.checklist.find((x) => x.id === btn.getAttribute('data-chk-menu'));
      if (!it) return;
      const est = estimateChecklistItemMinutes(it, calibratedCatalog);
      const wd = WEEKDAYS_DE[parseDateStr(it.d).getDay()];
      openModal(`
        <div class="card-header">
          <h3 class="card-title">Punkt-Aktionen</h3>
          <button class="icon-btn" id="m-close">${icon('x', 15)}</button>
        </div>
        <div class="small" style="font-weight:600;margin-bottom:2px;">${esc(it.title)}</div>
        <div class="xs muted mono" style="margin-bottom:12px;">${wd}, ${fmtDateShort(it.d)}${est > 0 ? ` · ~${fmtMin(est)}` : ''}</div>
        <div class="stack" style="gap:6px;">
          ${!it.done ? `
            <button type="button" class="menu-item" id="cm-done">${icon('check', 15)} Abhaken &amp; Zeit loggen</button>
            <button type="button" class="menu-item" id="cm-timer">${icon('play', 15)} Mit Timer starten (~${est || 45}m)</button>
            <button type="button" class="menu-item" id="cm-prev">${icon('arrowLeft', 15)} 1 Tag vorziehen</button>
            <button type="button" class="menu-item" id="cm-next">${icon('arrowRight', 15)} 1 Tag nach hinten</button>
          ` : `
            <button type="button" class="menu-item" id="cm-done">${icon('check', 15)} Wieder als offen markieren</button>
          `}
          <button type="button" class="menu-item" id="cm-edit">${icon('edit', 15)} Bearbeiten / Tag wählen</button>
          ${!it.done ? `<button type="button" class="menu-item" id="cm-backlog">${icon('list', 15)} In Rückstand schieben</button>` : ''}
          <div style="border-top:1px solid var(--border);margin-top:4px;padding-top:6px;">
            <button type="button" class="menu-item danger" id="cm-del">${icon('trash', 15)} Punkt löschen</button>
          </div>
        </div>
      `, (modalEl) => {
        modalEl.querySelector('#m-close')?.addEventListener('click', closeModal);
        modalEl.querySelector('#cm-done')?.addEventListener('click', () => {
          closeModal();
          const updated = toggleChecklistItem(it.id);
          if (updated && updated.done && promptLogFromChecklist) promptLogFromChecklist(updated);
        });
        modalEl.querySelector('#cm-timer')?.addEventListener('click', () => {
          closeModal();
          const meta = inferMetaFromChecklistItem(it);
          const catId = it.catalogId || (meta.kind !== 'a' ? (store.matchCatalogItemForText(it.title || '', meta.act, meta.mod)?.id || '') : '');
          store.startTimer({
            mode: 'countdown',
            kind: it.kind || meta.kind || 'l',
            durationMin: est || 45,
            planBlockId: it.id,
            mod: meta.mod || '',
            note: it.title || '',
            act: meta.act || '',
            catalogId: catId
          });
          toast('Timer gestartet.', 'ok');
          navigate('today');
        });
        modalEl.querySelector('#cm-prev')?.addEventListener('click', () => {
          closeModal();
          const res = shiftChecklistItemByDays(it.id, -1);
          if (res.ok) toast(`Verschoben auf ${WEEKDAYS_DE[parseDateStr(res.targetDate).getDay()]}, ${fmtDateShort(res.targetDate)}.`, 'ok');
        });
        modalEl.querySelector('#cm-next')?.addEventListener('click', () => {
          closeModal();
          const res = shiftChecklistItemByDays(it.id, 1);
          if (res.ok) toast(`Verschoben auf ${WEEKDAYS_DE[parseDateStr(res.targetDate).getDay()]}, ${fmtDateShort(res.targetDate)}.`, 'ok');
        });
        modalEl.querySelector('#cm-edit')?.addEventListener('click', () => {
          closeModal();
          openCheckItemModal(it);
        });
        modalEl.querySelector('#cm-backlog')?.addEventListener('click', () => {
          closeModal();
          moveChecklistItemToBacklog(it.id);
          toast('In den offenen Rückstand verschoben.', 'ok', { undo: true });
        });
        modalEl.querySelector('#cm-del')?.addEventListener('click', () => {
          closeModal();
          deleteChecklistItem(it.id);
          toast('Punkt gelöscht.', '', { undo: true });
        });
      });
    });
  });

  // Edit day header note
  root.querySelectorAll('[data-edit-note]').forEach((el) => {
    el.addEventListener('click', () => {
      const d = el.getAttribute('data-edit-note');
      const cur = store.state.dayNotes?.[d] || getDayUniSummaryLabel(d) || '';
      openModal(`
        <div class="card-header"><h3 class="card-title">Tages-Hinweis (${fmtDateShort(d)})</h3><button class="icon-btn" id="m-close">${icon('x', 15)}</button></div>
        <form id="m-note-form" class="stack">
          <input class="input" id="mn-txt" value="${esc(cur)}" placeholder="z. B. Start ~10:45 · MKL-Ü 14:00" />
          <div class="row" style="justify-content:flex-end;"><button type="submit" class="btn btn-primary btn-sm">Speichern</button></div>
        </form>
      `, (modalEl) => {
        modalEl.querySelector('#m-close')?.addEventListener('click', closeModal);
        modalEl.querySelector('#m-note-form')?.addEventListener('submit', (e) => {
          e.preventDefault();
          const val = modalEl.querySelector('#mn-txt').value.trim();
          if (!val) delete store.state.dayNotes[d];
          else store.state.dayNotes[d] = val;
          store.touchMapKey('dayNotes', d);
          store.save();
          closeModal();
        });
      });
    });
  });

  // Vormerken
  root.querySelector('#rem-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const inp = root.querySelector('#rem-input');
    if (addReminder(inp.value)) inp.value = '';
  });
  root.querySelectorAll('[data-rem-toggle]').forEach((el) => el.addEventListener('click', () => toggleReminder(el.getAttribute('data-rem-toggle'))));
  root.querySelectorAll('[data-rem-del]').forEach((btn) => btn.addEventListener('click', () => deleteReminder(btn.getAttribute('data-rem-del'))));

  // Module Rule Modal (v2: liveReviewMinutes vs videoStudyMinutes + triggersHomework + homeworkMode)
  const openModuleModal = (modId = null) => {
    const existing = modId ? store.state.modules[modId] : null;
    const m = existing || {
      id: '', shortName: '', name: '', type: 'V', attendance: 'live',
      liveReviewMinutes: 75, videoStudyMinutes: 165, createsAnki: true,
      triggersHomework: false, homeworkMode: 'understanding', ankiDeck: '', notes: ''
    };
    openModal(`
      <div class="card-header">
        <h3 class="card-title">${existing ? `Modul-Regel: ${esc(m.shortName)}` : 'Neues Fach'}</h3>
        <button class="icon-btn" id="m-close">${icon('x', 15)}</button>
      </div>
      <form id="m-mod-form" class="stack">
        <div class="field-grid">
          <div class="field"><label>Kurzname</label><input class="input" id="mm-short" value="${esc(m.shortName)}" placeholder="z. B. HM I (V)" required /></div>
          <div class="field">
            <label>Teilnahme-Modus</label>
            <select class="input" id="mm-att">
              <option value="live" ${m.attendance === 'live' ? 'selected' : ''}>Live vor Ort (Vorlesungszeit)</option>
              <option value="video" ${m.attendance === 'video' ? 'selected' : ''}>Video später durcharbeiten</option>
              <option value="skip" ${m.attendance === 'skip' ? 'selected' : ''}>Überspringen</option>
            </select>
          </div>
        </div>
        <div class="field-grid">
          <div class="field"><label>Nacharbeit nach Live (min)</label><input type="number" class="input mono" id="mm-live-min" min="0" max="480" value="${m.liveReviewMinutes ?? 0}" /></div>
          <div class="field"><label>Video durcharbeiten (min)</label><input type="number" class="input mono" id="mm-vid-min" min="0" max="480" value="${m.videoStudyMinutes ?? m.studyMinutes ?? 165}" /></div>
        </div>
        <label class="row" style="cursor:pointer;">
          <input type="checkbox" id="mm-anki" ${m.createsAnki ? 'checked' : ''} />
          <span class="small">Erstelle nach Vorlesungen Anki-Karten (z. B. MKL, WK, FT, TM)</span>
        </label>
        <div class="field-grid">
          <label class="row" style="cursor:pointer;">
            <input type="checkbox" id="mm-hw" ${m.triggersHomework ? 'checked' : ''} />
            <span class="small">Löst neue Hausaufgabe aus</span>
          </label>
          <div class="field">
            <label>Hausaufgaben-Modus</label>
            <select class="input" id="mm-hw-mode">
              <option value="understanding" ${(m.homeworkMode || 'understanding') === 'understanding' ? 'selected' : ''}>Verständnis (Abgabe über andere)</option>
              <option value="deadline" ${m.homeworkMode === 'deadline' ? 'selected' : ''}>Eigene Abgabe mit Deadline</option>
            </select>
          </div>
        </div>
        <div class="field"><label>Anki-Deck (optional)</label><input class="input" id="mm-deck" value="${esc(m.ankiDeck || '')}" placeholder="z. B. KIT::Werkstoffkunde" /></div>
        <div class="field"><label>Notiz für Gemini</label><textarea class="input" id="mm-notes">${esc(m.notes || '')}</textarea></div>
        <div class="row-between">
          ${existing ? `<button type="button" class="btn btn-sm btn-danger" id="mm-del">Entfernen</button>` : '<span></span>'}
          <button type="submit" class="btn btn-primary btn-sm">Speichern</button>
        </div>
      </form>
    `, (modalEl) => {
      modalEl.querySelector('#m-close')?.addEventListener('click', closeModal);
      modalEl.querySelector('#mm-del')?.addEventListener('click', () => {
        store.markDeleted(`mod_${existing.id}`);
        delete store.state.modules[existing.id];
        store.touchMapKey('modules', existing.id);
        store.save();
        closeModal();
      });
      modalEl.querySelector('#m-mod-form')?.addEventListener('submit', (e) => {
        e.preventDefault();
        const shortName = modalEl.querySelector('#mm-short').value.trim();
        const id = existing ? existing.id : `mod_${Date.now()}`;
        const liveMin = Math.max(0, Number(modalEl.querySelector('#mm-live-min').value) || 0);
        const vidMin = Math.max(0, Number(modalEl.querySelector('#mm-vid-min').value) || 0);
        store.state.modules[id] = {
          ...(existing || { id, code: '', name: shortName, type: 'V' }),
          shortName,
          attendance: modalEl.querySelector('#mm-att').value,
          liveReviewMinutes: liveMin,
          videoStudyMinutes: vidMin,
          studyMinutes: vidMin,
          createsAnki: modalEl.querySelector('#mm-anki').checked,
          triggersHomework: modalEl.querySelector('#mm-hw').checked,
          homeworkMode: modalEl.querySelector('#mm-hw-mode').value,
          ankiDeck: modalEl.querySelector('#mm-deck').value.trim(),
          notes: modalEl.querySelector('#mm-notes').value.trim()
        };
        store.touchMapKey('modules', id);
        store.save();
        closeModal();
        toast(`Regel für ${shortName} gespeichert.`, 'ok');
      });
    });
  };

  root.querySelector('#btn-add-module')?.addEventListener('click', () => openModuleModal(null));
  root.querySelectorAll('[data-edit-mod]').forEach((el) => el.addEventListener('click', () => openModuleModal(el.getAttribute('data-edit-mod'))));

  // Task Catalog Blueprint Modal (User can add/edit/delete; AI can only add!)
  const openCatalogModal = (catId = null) => {
    const existing = catId ? calibratedCatalog.find((c) => c.id === catId) : null;
    const c = existing || { id: '', subject: '', title: '', act: 'review', kind: 'l', defaultMin: 60, notes: '' };
    openModal(`
      <div class="card-header">
        <h3 class="card-title">${existing ? 'Katalog-Baustein bearbeiten' : 'Neuer Katalog-Baustein'}</h3>
        <button class="icon-btn" id="m-close">${icon('x', 15)}</button>
      </div>
      ${existing && existing.sampleCount > 0 ? `
        <div class="xs muted mono" style="margin-bottom:10px;">
          Bisher ${existing.sampleCount} echte ${existing.sampleCount === 1 ? 'Session' : 'Sessions'} · Oberes Ende (P75): <strong>${existing.upperRealMin} min</strong> (Ø ${existing.avgRealMin} min)
          ${existing.calibrated ? ' — aktiv für KI-Planung' : ' — ab 2 Sessions automatisch aktiv'}
        </div>
      ` : ''}
      <form id="m-cat-form" class="stack">
        <div class="field-grid">
          <div class="field"><label>Fach / Bereich</label><input class="input" id="mcat-subj" value="${esc(c.subject)}" placeholder="z. B. HM I, TM I, MKL A" required /></div>
          <div class="field"><label>Start-Dauer (min)</label><input type="number" class="input mono" id="mcat-min" min="5" max="480" value="${c.defaultMin || 60}" required /></div>
        </div>
        <div class="field"><label>Bezeichnung</label><input class="input" id="mcat-title" value="${esc(c.title)}" placeholder="z. B. HM: VL-Video durcharbeiten" required /></div>
        <div class="field-grid">
          <div class="field">
            <label>Tätigkeit (für Auto-Kalibrierung)</label>
            <select class="input" id="mcat-act">
              <option value="" ${!c.act ? 'selected' : ''}>Allgemein</option>
              <option value="video" ${c.act === 'video' ? 'selected' : ''}>VL-Video durcharbeiten</option>
              <option value="review" ${c.act === 'review' ? 'selected' : ''}>VL nacharbeiten & Ankis</option>
              <option value="homework" ${c.act === 'homework' ? 'selected' : ''}>Hausaufgabe / Praxis</option>
              <option value="exam" ${c.act === 'exam' ? 'selected' : ''}>Altklausur / Üben</option>
            </select>
          </div>
          <div class="field">
            <label>Kategorie</label>
            <select class="input" id="mcat-kind">
              <option value="l" ${c.kind !== 'p' ? 'selected' : ''}>Lernen</option>
              <option value="p" ${c.kind === 'p' ? 'selected' : ''}>Orga / Produktiv</option>
            </select>
          </div>
        </div>
        <div class="field"><label>Notiz für KI (optional)</label><input class="input" id="mcat-notes" value="${esc(c.notes || '')}" placeholder="z. B. ohne Abgabedruck, Folien + Karten" /></div>
        <div class="row-between">
          ${existing ? `<button type="button" class="btn btn-sm btn-danger" id="mcat-del">Löschen</button>` : '<span></span>'}
          <button type="submit" class="btn btn-primary btn-sm">Speichern</button>
        </div>
      </form>
    `, (modalEl) => {
      modalEl.querySelector('#m-close')?.addEventListener('click', closeModal);
      modalEl.querySelector('#mcat-del')?.addEventListener('click', () => {
        store.deleteTaskCatalogItem(existing.id);
        closeModal();
        toast('Baustein gelöscht.', '', { undo: true });
      });
      modalEl.querySelector('#m-cat-form')?.addEventListener('submit', (e) => {
        e.preventDefault();
        store.upsertTaskCatalogItem({
          id: existing ? existing.id : '',
          subject: modalEl.querySelector('#mcat-subj').value,
          title: modalEl.querySelector('#mcat-title').value,
          act: modalEl.querySelector('#mcat-act').value,
          kind: modalEl.querySelector('#mcat-kind').value,
          defaultMin: modalEl.querySelector('#mcat-min').value,
          notes: modalEl.querySelector('#mcat-notes').value
        });
        closeModal();
        toast('Katalog-Baustein gespeichert.', 'ok');
      });
    });
  };

  root.querySelector('#btn-add-catalog')?.addEventListener('click', () => openCatalogModal(null));
  root.querySelectorAll('[data-edit-cat]').forEach((btn) => {
    btn.addEventListener('click', () => openCatalogModal(btn.getAttribute('data-edit-cat')));
  });
}

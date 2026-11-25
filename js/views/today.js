// Tab 1: "Heute" – Hero Daily Checklist at top + Automatic Lecture Attendance (-> Vorlesung/Produktiv) + Clean Monochrome Fokus-Tracker

import {
  store,
  toDateStr,
  toTimeStr,
  addDays,
  fmtMin,
  fmtDateDE,
  fmtDateShort,
  pad2,
  WEEKDAYS_DE,
  parseDateStr,
  escapeHtml as esc
} from '../store.js';
import {
  reconcileBacklogStatus,
  getAutopilotSuggestions,
  acceptAutopilotSuggestion,
  dismissAutopilotSuggestion,
  getChecklistForDay,
  addChecklistItem,
  toggleChecklistItem,
  deleteChecklistItem,
  moveChecklistItemToDate,
  estimateChecklistItemMinutes,
  inferMetaFromChecklistItem,
  getWeekAheadImpact,
  getUnfinishedFromYesterday,
  rolloverYesterdayToToday,
  getDayLectures,
  getDayUniSummaryLabel,
  setLectureAttendance,
  syncDayLecturesToProductive
} from '../checklist.js';
import {
  getAnkiLoadSummary,
  getAnkiReviewAnalytics,
  syncAnkiConnect,
  syncDayAnkiFromRevlog,
  setManualAnki,
  toggleExcludedAnkiDeck
} from '../anki.js';
import {
  renderDailyRingSVG,
  renderDayTimelineSVG,
  renderRestOfDaySVG,
  renderTimerProjectionSVG,
  renderCaffeineCurveSVG,
  renderAnkiSyncChartSVG,
  bindChartTooltips
} from '../charts.js';
import { icon } from '../icons.js';

let lastEntryFeedback = '';
let selectedTimerMode = 'countdown';
let selectedTimerKind = 'l';
let selectedTimerMin = 45;
let activeTimerTick = null;

function fmtHMS(totalSec) {
  const s = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${pad2(h)}:${pad2(m)}:${pad2(sec)}` : `${pad2(m)}:${pad2(sec)}`;
}

export function renderTodayView(root, ctx) {
  const { toast, navigate, promptLogFromChecklist } = ctx;
  if (activeTimerTick) {
    clearTimeout(activeTimerTick);
    activeTimerTick = null;
  }

  const now = new Date();
  const today = toDateStr(now);
  const tomorrow = addDays(today, 1);
  reconcileBacklogStatus({ todayStr: today });

  // Sync today's attended live lectures automatically to Vorlesung/Produktiv (p) & real Anki revlog time to Anki (a)
  if (store.state.autoLogLectures) {
    syncDayLecturesToProductive(today, { save: false });
  }
  syncDayAnkiFromRevlog(today, { save: false });

  const day = store.getDayBreakdown(today);
  const isRest = store.isRestDay(today);
  const goal = store.getGoalForDay(today);
  const pct = goal > 0 ? Math.round((day.learnTotal / goal) * 100) : 100;
  const streaks = store.getStreakStats(today);
  const live = store.getLiveRatio(today, now);
  const caf = store.getCaffeineTodaySummary(now);
  const todayEntries = store.getEntriesForDate(today);
  const anki = getAnkiLoadSummary();
  const ankiRev = getAnkiReviewAnalytics(today);
  const recentAnkiSyncs = ankiRev.syncHistory.slice(-20);
  const calibratedCatalog = store.getCalibratedTaskCatalog();
  const minDailyAnki = Math.max(10, Number(store.state.anki.minDailyAnkiMin) || 30);
  const ankiSyncedToday = Boolean(anki.lastSyncAt && toDateStr(new Date(anki.lastSyncAt)) === today);
  const ankiDoneToday = store.isAnkiDoneDay(today, anki.totalDue);
  const timerStatus = store.getTimerStatus();
  const ui = store.state.ui;
  if (timerStatus) ui.tdt = true;

  // Today's checklist & lectures (includes dynamic daily Anki check-off)
  const todayItems = getChecklistForDay(today);
  const openTodayCount = todayItems.filter((x) => !x.done).length;
  const doneCount = todayItems.filter((x) => x.done).length + (ankiDoneToday ? 1 : 0);
  const totalCheckCount = todayItems.length + 1;
  const checkPct = totalCheckCount ? Math.round((doneCount / totalCheckCount) * 100) : 0;
  const yesterdayOpen = getUnfinishedFromYesterday(today);
  const tomorrowItems = getChecklistForDay(tomorrow);
  const weekImpact = getWeekAheadImpact(today);
  const autoOpenAhead = openTodayCount <= 1;

  const todayLectures = getDayLectures(today, now);
  const attendedLectures = todayLectures.filter((l) => l.attended);
  const attendedMin = attendedLectures.reduce((s, l) => s + l.durationMin, 0);
  const dayNote = store.state.dayNotes?.[today] || getDayUniSummaryLabel(today, todayLectures);
  const wdUpper = WEEKDAYS_DE[parseDateStr(today).getDay()].toUpperCase();
  const autopilot = getAutopilotSuggestions(now);
  const load7 = store.getLoadSummary7d(today);

  const moduleOptions = Object.values(store.state.modules)
    .map((m) => `<option value="${esc(m.id)}">${esc(m.shortName)}</option>`)
    .join('');

  const wake14 = [];
  for (let i = 0; i < 14; i++) {
    const d = addDays(today, -i);
    wake14.push({ d, w: store.state.w[d] || '', sx: store.state.sx[d] || '' });
  }
  const missingWakes = wake14.filter((x) => !x.w).length;

  const recentEntries = [...store.state.e]
    .sort((a, b) => (b.d + (b.t || '')).localeCompare(a.d + (a.t || '')) || b.id - a.id)
    .slice(0, 30);
  const countingByDate = {};
  for (const x of recentEntries) {
    if (!countingByDate[x.d]) countingByDate[x.d] = store.getDayBreakdown(x.d).countingIds;
  }

  const recentCaf = [...store.state.cf]
    .sort((a, b) => (b.d + (b.t || '')).localeCompare(a.d + (a.t || '')) || b.id - a.id)
    .slice(0, 20);

  const timerProj = timerStatus ? renderTimerProjectionSVG(live, timerStatus) : null;

  root.innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="page-title">${fmtDateDE(today)}</h1>
        <div class="small muted">${dayNote ? esc(dayNote) : 'Keine Live-Vorlesungen'} · Ziel ${fmtMin(goal)} · <span title="${esc(load7.hint)}">7T: ${load7.total7Hours.toFixed(1)} h (${load7.label})</span></div>
      </div>
      <div class="row">
        <button class="btn btn-sm" id="btn-goto-week">${icon('calendar', 14)} Wochenplan</button>
        <button class="btn btn-sm btn-primary" id="btn-goto-planner">${icon('spark', 14)} KI-Planer</button>
      </div>
    </div>

    <div class="stack">
      ${!live.hasWake ? `
        <div class="checkin-bar">
          <div class="row" style="gap:8px;">
            <span class="small" style="font-weight:640;">${icon('sun', 14)} Morgen-Check-in</span>
            <input type="time" id="ci-wake" class="input mono" style="width:104px;padding:5px 8px;" value="${toTimeStr(now)}" />
            <button class="btn btn-xs" id="ci-now">Jetzt</button>
          </div>
          <div class="row" style="gap:8px;">
            <div class="segmented">
              <button type="button" data-ci-em="reset" class="${(store.state.ai.energyMode || 'normal') === 'reset' ? 'active' : ''}">Reset</button>
              <button type="button" data-ci-em="normal" class="${(store.state.ai.energyMode || 'normal') === 'normal' ? 'active' : ''}">Normal</button>
              <button type="button" data-ci-em="fokus" class="${(store.state.ai.energyMode || 'normal') === 'fokus' ? 'active' : ''}">Fokus</button>
            </div>
            <button class="btn btn-primary btn-sm" id="ci-start">Tag starten</button>
          </div>
        </div>
      ` : ''}

      <!-- HERO 1: HEUTE CHECKLISTE (Das wichtigste Feature!) -->
      <section class="checklist-section">
        <div class="day-divider is-today" style="padding-top:0;">
          <div class="day-divider-left">
            <span class="day-divider-title">${wdUpper}, ${fmtDateShort(today)} (HEUTE)</span>
            ${dayNote ? `<span class="day-divider-meta">| ${esc(dayNote)}</span>` : ''}
          </div>
          <div class="row" style="gap:8px;">
            <span class="pill ${doneCount === totalCheckCount && totalCheckCount > 0 ? 'kit' : ''}">${doneCount} / ${totalCheckCount} erledigt</span>
          </div>
        </div>

        ${totalCheckCount ? `
          <div class="progress-track" style="margin-bottom:12px;">
            <div class="progress-fill green" style="width:${checkPct}%;"></div>
          </div>
        ` : ''}

        ${yesterdayOpen.length ? `
          <div class="banner info" style="margin-bottom:10px;">
            <span><strong>${yesterdayOpen.length}</strong> offene${yesterdayOpen.length === 1 ? 'r Punkt' : ' Punkte'} von gestern (${esc(yesterdayOpen[0].title)}${yesterdayOpen.length > 1 ? ` +${yesterdayOpen.length - 1}` : ''})</span>
            <button class="btn btn-xs btn-primary" id="btn-rollover">Auf heute schieben</button>
          </div>
        ` : ''}

        <!-- Dynamic Daily Anki Check-off Row (partial progress OK — user decides when done for today!) -->
        <div class="check-item ${ankiDoneToday ? 'done' : ''}" style="margin-bottom:8px;background:var(--bg-soft);border-color:${ankiDoneToday ? 'rgba(16,185,129,0.3)' : 'rgba(244,114,182,0.28)'};">
          <div class="check-item-main" id="anki-row-toggle" title="Anki für heute abhaken (auch wenn noch Karten übrig sind)">
            <span class="check-box">${ankiDoneToday ? icon('check', 12) : ''}</span>
            <div style="min-width:0;flex:1;">
              <div class="row" style="gap:6px;">
                <span class="pill anki">Anki heute</span>
                <span class="check-text" style="font-size:0.88rem;">
                  ${ankiDoneToday
                    ? `Für heute erledigt${day.a > 0 ? ` (${fmtMin(day.a)} geloggt)` : ''}${anki.totalDue > 0 ? ` · ${anki.totalDue} Karten für später` : ''}`
                    : anki.totalDue > 0
                      ? `${anki.totalDue} fällige Karten (alle ~${anki.estMinutes} min · Teilpensum ok)`
                      : (ankiSyncedToday ? '0 fällige Karten' : `Noch kein Sync heute (Puffer ~${minDailyAnki} min)`)}
                </span>
              </div>
              <div class="xs muted mono" style="margin-top:3px;">
                <span class="anki-dot blue"></span>${anki.totalNew} · <span class="anki-dot red"></span>${anki.totalLearn} · <span class="anki-dot green"></span>${anki.totalReview}
                ${day.a > 0 ? ` · heute geloggt: ${fmtMin(day.a)}` : ''}
                ${anki.lastSyncAt ? ` · Sync ${toTimeStr(new Date(anki.lastSyncAt))}` : ''}
              </div>
            </div>
          </div>
          <div class="check-actions">
            <button class="btn btn-xs desktop-only" id="btn-anki-row-sync" title="AnkiConnect jetzt abfragen">${icon('refresh', 12)} Sync</button>
            <button class="btn btn-xs btn-ghost mobile-only" id="btn-anki-mobile-hint" title="AnkiConnect läuft am Laptop">Laptop-Sync</button>
            <button class="btn btn-xs" id="btn-anki-row-log" title="Zwischenzeit loggen (ohne für heute abzuhaken)">+ Zeit</button>
            <button class="btn btn-xs btn-ghost" id="btn-anki-open-details" title="Anki-Stapel & manuelle Eingabe öffnen">${icon('layers', 12)}</button>
          </div>
        </div>

        <div class="check-list">
          ${todayItems.map((it) => {
            const est = estimateChecklistItemMinutes(it, calibratedCatalog);
            return `
            <div class="check-item ${it.done ? 'done' : ''}">
              <div class="check-item-main" data-chk-toggle="${esc(it.id)}">
                <span class="check-box">${it.done ? icon('check', 12) : ''}</span>
                <div class="row" style="gap:8px;flex:1;">
                  ${it.timeLabel ? `<span class="check-time">${esc(it.timeLabel)}</span>` : ''}
                  <span class="check-text">${esc(it.title)}</span>
                  ${it.kind === 'a' ? '<span class="pill anki">Anki</span>' : ''}
                  ${it.pulledFromDate && it.pulledFromDate > today ? `<span class="pill kit" title="Vorgezogen von ${fmtDateShort(it.pulledFromDate)}">Vorgezogen</span>` : ''}
                </div>
              </div>
              <div class="check-actions">
                ${!it.done ? `<button class="btn btn-xs btn-ghost" data-chk-tomorrow="${esc(it.id)}" title="Auf morgen verschieben">${icon('arrowRight', 12)}</button>` : ''}
                ${!it.done ? `<button class="btn btn-xs btn-ghost" data-chk-timer="${esc(it.id)}" data-kind="${esc(it.kind)}" data-dur="${est || 45}" title="Mit Timer starten (~${est || 45} min)">${icon('play', 12)}</button>` : ''}
                <button class="btn btn-xs btn-ghost" data-chk-del="${esc(it.id)}" title="Entfernen">${icon('x', 13)}</button>
              </div>
            </div>
          `;
          }).join('') || `
            <div class="small muted" style="padding:10px 4px;">
              Noch keine Punkte für heute. Füge unten schnell Aufgaben hinzu, importiere deinen Text-Plan unter <strong>Wochenplan</strong> oder lass <strong>KI-Planer</strong> deine Woche bauen.
            </div>
          `}
        </div>

        <!-- Quick-Add for Today -->
        <form id="today-chk-form" class="row" style="margin-top:12px;padding-top:12px;border-top:1px solid var(--border);">
          <input type="text" id="tchk-time" class="input mono" style="width:118px;" placeholder="Zeit (opt.)" />
          <input type="text" id="tchk-title" class="input" style="flex:1;min-width:180px;" placeholder="Aufgabe für heute hinzufügen (z. B. HM: 1 VL-Video schauen)..." required />
          <button type="submit" class="btn btn-primary btn-sm">${icon('plus', 14)} Hinzufügen</button>
        </form>

        ${(weekImpact.candidates.length || weekImpact.boughtForwardMin > 0) ? `
          <details style="margin-top:12px;padding-top:10px;border-top:1px solid var(--border);" ${autoOpenAhead ? 'open' : ''}>
            <summary class="row-between" style="cursor:pointer;gap:8px;list-style:none;">
              <div class="row" style="gap:7px;">
                <span class="xs mono" style="font-weight:700;letter-spacing:0.04em;color:var(--text);">VORARBEITEN-HEBEL (${esc(weekImpact.horizonLabel || 'NÄCHSTE 5 TAGE')})</span>
                ${weekImpact.boughtForwardMin > 0 ? `<span class="pill kit">+${fmtMin(weekImpact.boughtForwardMin)} vorgearbeitet</span>` : ''}
              </div>
              <span class="xs muted mono">
                ${weekImpact.restWeekOpenCount > 0 ? `Offen: ~${fmtMin(weekImpact.restWeekOpenMin)} (${weekImpact.restWeekOpenCount}) ▾` : 'Alles voraus frei! ▾'}
              </span>
            </summary>
            <div style="margin-top:8px;">
              ${weekImpact.todayOpenMin > 0 && weekImpact.restWeekOpenMin > 0 ? `
                <div class="xs muted" style="margin-bottom:8px;">
                  Wenn du heute alles abhakst (${fmtMin(weekImpact.todayOpenMin)}), erledigst du <strong style="color:var(--kit);">${Math.round((weekImpact.todayOpenMin / (weekImpact.todayOpenMin + weekImpact.restWeekOpenMin)) * 100)} %</strong> deines Pensums der nächsten Tage.
                </div>
              ` : ''}
              ${weekImpact.candidates.length ? `
                <div class="entry-list">
                  ${weekImpact.candidates.map((c) => `
                    <div class="entry-row" style="padding:7px 10px;">
                      <div style="min-width:0;flex:1;">
                        <div class="small" style="font-weight:580;">${esc(c.title)} <span class="xs soft mono">~${fmtMin(c.estMin)}</span></div>
                        <div class="xs" style="color:${c.freesWholeDay ? 'var(--kit)' : 'var(--text-muted)'};margin-top:2px;">
                          Wenn heute vorgezogen → <strong>${esc(c.impactText)}</strong>
                        </div>
                      </div>
                      <button class="btn btn-xs" data-pull-today="${esc(c.id)}" title="Auf heute vorziehen">${icon('arrowLeft', 12)} Vorziehen</button>
                    </div>
                  `).join('')}
                </div>
              ` : ''}
            </div>
          </details>
        ` : tomorrowItems.length ? `
          <div style="margin-top:12px;padding-top:10px;border-top:1px solid var(--border);">
            <div class="xs soft" style="margin-bottom:4px;font-family:var(--mono);">MORGEN (${fmtDateShort(tomorrow)}) · ${tomorrowItems.length} ${tomorrowItems.length === 1 ? 'PUNKT' : 'PUNKTE'}</div>
            <div class="xs muted">${tomorrowItems.slice(0, 3).map((x) => `${x.timeLabel ? `${esc(x.timeLabel)}: ` : ''}${esc(x.title)}`).join(' · ')}${tomorrowItems.length > 3 ? ` (+${tomorrowItems.length - 3})` : ''}</div>
          </div>
        ` : ''}
      </section>

      ${autopilot.length ? `
        <section class="card" style="padding:12px 16px;">
          <div class="row-between" style="margin-bottom:8px;">
            <span class="small" style="font-weight:620;">${icon('refresh', 14)} Nacharbeit erkannt (${autopilot.length})</span>
            ${autopilot.length > 1 ? '<button class="btn btn-xs btn-primary" id="btn-ap-all">Alle in Rückstand</button>' : ''}
          </div>
          <div class="entry-list">
            ${autopilot.map((s, idx) => `
              <div class="entry-row" style="padding:7px 10px;">
                <div>
                  <div class="small" style="font-weight:560;">${esc(s.title)}</div>
                  <div class="xs soft">${esc(s.reason)} · ~${fmtMin(s.estMin)}</div>
                </div>
                <div class="row" style="gap:5px;flex-wrap:nowrap;">
                  <button class="btn btn-xs btn-primary" data-ap-accept="${idx}">+ Rückstand</button>
                  <button class="btn btn-xs btn-ghost" data-ap-dismiss="${esc(s.uid)}" title="Ignorieren">${icon('x', 13)}</button>
                </div>
              </div>
            `).join('')}
          </div>
        </section>
      ` : ''}

      <!-- HERO 2: HEUTIGE VORLESUNGEN (Auto -> Vorlesung / Produktiv) & ANKI -->
      <div class="grid-2">
        <section class="card">
          <div class="card-header">
            <h2 class="card-title">${icon('building', 15)} Heutige Vorlesungen</h2>
            ${attendedMin > 0 ? `<span class="pill prod">${attendedLectures.length} besucht · ${fmtMin(attendedMin)}</span>` : '<span class="pill">0 min gebucht</span>'}
          </div>
          ${todayLectures.length ? `
            <div class="entry-list">
              ${todayLectures.map((l) => `
                <div class="lecture-row ${l.mode === 'video' ? 'video-mode' : ''} ${l.cancelled || l.override === 'skipped' ? 'skipped' : ''}">
                  <div>
                    <div style="font-weight:600;font-size:0.88rem;" class="${l.cancelled ? 'strike' : ''}">${esc(l.shortName)}</div>
                    <div class="xs muted mono">${l.start}–${l.end} · ${l.durationMin} min${l.cancelled ? ' · Fällt aus' : l.mode === 'video' ? ' · Video-Regel' : l.typeOverride === 'exercise' ? ' · Übung' : ''}${l.location ? ` · ${esc(l.location)}` : ''}</div>
                  </div>
                  <div class="row" style="gap:5px;flex-wrap:nowrap;">
                    ${!l.cancelled ? `
                      <button class="btn btn-xs ${l.attended ? 'btn-primary' : ''}" data-lec-att="${esc(l.uid)}" data-next="${l.attended ? 'skipped' : 'attended'}">
                        ${l.attended ? `${icon('check', 12)} Besucht` : 'Als besucht'}
                      </button>
                    ` : '<span class="pill danger">Fällt aus</span>'}
                  </div>
                </div>
              `).join('')}
            </div>
            <div class="xs soft" style="margin-top:8px;">
              Besuchte Live-Vorlesungen werden automatisch als <strong>Vorlesung / Produktiv</strong> gezählt.
            </div>
          ` : `
            <div class="small muted">Heute keine Termine im KIT-Kalender. ${!store.state.icsRaw ? 'Lade deine .ics-Datei unter Wochenplan oder Einstellungen.' : ''}</div>
          `}
        </section>

        <!-- Anki Quick-Card (Standardmäßig eingeklappt; per Hero-Zeile oder Klick aufklappbar) -->
        <section class="card ${ui.d_anki_card ? '' : 'collapsed'}" data-collapse="d_anki_card" id="anki-detail-card">
          <button class="collapsible-header" data-toggle="d_anki_card">
            <h2 class="card-title">${icon('layers', 15)} Anki-Details <span class="pill anki">${anki.totalDue} Karten · ~${anki.estMinutes} min</span></h2>
            <span class="chevron">${icon('chevron', 16)}</span>
          </button>
          <div class="collapsible-body">
            <div class="row-between" style="margin-bottom:10px;">
              <div class="row xs mono" style="gap:10px;">
                <span><span class="anki-dot blue"></span>Neu: ${anki.totalNew}</span>
                <span><span class="anki-dot red"></span>Rot: ${anki.totalLearn}</span>
                <span><span class="anki-dot green"></span>Grün: ${anki.totalReview}</span>
              </div>
              <div class="row" style="gap:6px;">
                <button class="btn btn-xs desktop-only" id="btn-anki-sync">${icon('refresh', 12)} Sync</button>
                <span class="xs soft mobile-only">Sync am Laptop mit Anki</span>
                <button class="btn btn-xs btn-primary" id="btn-anki-timer">${icon('play', 11)} Start</button>
              </div>
            </div>

            ${ankiRev.todayCards > 0 ? `
              <div style="margin-bottom:10px;padding:7px 10px;border-radius:var(--radius-xs);background:var(--bg-soft);border:1px solid var(--border);">
                <div class="xs mono" style="color:var(--anki);font-weight:640;">
                  Heute in Anki geschafft: ${fmtMin(ankiRev.todayMin)} (${ankiRev.todayCards} Karten)
                </div>
                <div class="xs muted" style="margin-top:3px;">
                  ${ankiRev.todayDecks.slice(0, 6).map((d) => `${esc(d.name)} <strong>${fmtMin(d.min)}</strong> (${d.cards})`).join(' · ')}
                </div>
              </div>
            ` : ''}

            ${anki.decks.length ? `
              <div class="entry-list" style="margin-bottom:10px;">
                ${anki.decks.slice(0, 8).map((d) => `
                  <div class="entry-row" style="padding:6px 10px;">
                    <span class="small">${d.group ? `<span class="xs soft">${esc(d.group)} / </span>` : ''}${esc(d.name)}</span>
                    <div class="row" style="gap:6px;flex-wrap:nowrap;">
                      <span class="xs mono muted"><span class="anki-dot blue"></span>${d.newCards} · <span class="anki-dot red"></span>${d.learnCards || 0} · <span class="anki-dot green"></span>${d.reviewCards}</span>
                      <button class="btn btn-xs btn-ghost" data-anki-hide="${esc(d.fullName || d.name)}" title="Stapel aus Zählung ausblenden">${icon('x', 11)}</button>
                    </div>
                  </div>
                `).join('')}
              </div>
            ` : ''}

            ${recentAnkiSyncs.length ? `
              <div style="margin-bottom:10px;">
                <div class="row-between xs soft" style="margin-bottom:4px;">
                  <span>Sync-Verlauf (Blau · Rot · Grün + Gesamt)</span>
                  <span class="mono">${recentAnkiSyncs.length} ${recentAnkiSyncs.length === 1 ? 'Punkt' : 'Punkte'}</span>
                </div>
                <div class="chart-box">${renderAnkiSyncChartSVG(recentAnkiSyncs, { mode: 'all', compact: true })}</div>
                <div class="chart-tooltip">Tippe auf einen Sync-Punkt für Uhrzeit & Kartenstände.</div>
              </div>
            ` : ''}

            ${anki.hasLegacyDecks ? `
              <div class="xs soft" style="margin-bottom:8px;">
                Tipp: Bei geöffnetem Anki einmal <strong>Sync</strong> klicken, um Übergruppen automatisch zu trennen — oder Übergruppe per <strong>×</strong> ausblenden.
              </div>
            ` : ''}

            ${(anki.excludedDecks || []).length ? `
              <div class="chip-row" style="margin-bottom:10px;">
                ${anki.excludedDecks.map((name) => `
                  <button class="chip" data-anki-unhide="${esc(name)}" title="Wieder einblenden">Ausgeblendet: ${esc(name)} ↺</button>
                `).join('')}
              </div>
            ` : ''}

            <div class="row" style="align-items:flex-end;">
              <div class="field" style="flex:1;min-width:68px;">
                <label><span class="anki-dot blue"></span>Neu (${anki.weights.secNew}s)</label>
                <input type="number" min="0" class="input mono" id="anki-m-new" value="${anki.totalNew}" />
              </div>
              <div class="field" style="flex:1;min-width:68px;">
                <label><span class="anki-dot red"></span>Rot (${anki.weights.secLearn}s)</label>
                <input type="number" min="0" class="input mono" id="anki-m-learn" value="${anki.totalLearn}" />
              </div>
              <div class="field" style="flex:1;min-width:68px;">
                <label><span class="anki-dot green"></span>Grün (${anki.weights.secReview}s)</label>
                <input type="number" min="0" class="input mono" id="anki-m-rev" value="${anki.totalReview}" />
              </div>
              <button class="btn btn-sm" id="btn-anki-manual-save">OK</button>
            </div>
          </div>
        </section>
      </div>

      <!-- 3. Fokus-Tracker: Tagesring & Live-Quote -->
      <div class="grid-2">
        <section class="card">
          <div class="card-header">
            <h2 class="card-title">${icon('target', 15)} Tagesring</h2>
            <div class="row" style="gap:6px;">
              <button class="btn btn-xs ${isRest ? 'btn-primary' : ''}" id="btn-toggle-rest" title="Schützt deine Serie an Ruhe- oder Reset-Tagen">${isRest ? 'Ruhetag aktiv' : 'Ruhetag'}</button>
              ${day.learnTotal >= goal ? '<span class="pill gold">Ziel erreicht</span>' : `<span class="pill learn">${pct} %</span>`}
            </div>
          </div>
          <div class="hero-grid">
            <div class="ring-wrap">
              ${renderDailyRingSVG(day.learnTotal, goal)}
              <div class="ring-center">
                <div class="ring-value" style="${day.learnTotal >= goal ? 'color:var(--gold)' : ''}">${fmtMin(day.learnTotal)}</div>
                <div class="ring-sub">von ${fmtMin(goal)}</div>
              </div>
            </div>
            <div class="kpi-grid">
              <div class="kpi-box">
                <div class="kpi-label">Serie</div>
                <div class="kpi-val gold">${streaks.current} ${streaks.current === 1 ? 'Tag' : 'Tage'}</div>
              </div>
              <div class="kpi-box">
                <div class="kpi-label">Davon Anki</div>
                <div class="kpi-val anki">${fmtMin(day.a)}</div>
              </div>
              <div class="kpi-box">
                <div class="kpi-label">Vorlesung / Prod.</div>
                <div class="kpi-val prod">${fmtMin(day.p)}</div>
              </div>
              <div class="kpi-box">
                <div class="kpi-label">Zusammen</div>
                <div class="kpi-val both">${fmtMin(day.total)}</div>
              </div>
            </div>
          </div>
        </section>

        <section class="card">
          <div class="card-header">
            <h2 class="card-title">${icon('clock', 15)} Live-Wachzeit-Quote</h2>
            ${live.hasWake ? `<span class="pill kit" id="live-awake-badge">Wach: ${fmtMin(live.span.elapsedMin)}</span>` : '<span class="pill prod">Aufwachzeit fehlt</span>'}
          </div>
          <div id="live-quote-area">
            ${live.hasWake ? `
              <div class="grid-3" style="margin-bottom:10px;">
                <div class="kpi-box">
                  <div class="kpi-label">Lernen</div>
                  <div class="kpi-val learn" id="lq-learn">${live.learnPct.toFixed(1)} %</div>
                  <div class="xs muted">Prognose: ${live.endLearnPct.toFixed(1)} %</div>
                </div>
                <div class="kpi-box">
                  <div class="kpi-label">Vorlesung</div>
                  <div class="kpi-val prod" id="lq-prod">${live.prodPct.toFixed(1)} %</div>
                  <div class="xs muted">Prognose: ${live.endProdPct.toFixed(1)} %</div>
                </div>
                <div class="kpi-box">
                  <div class="kpi-label">Zusammen</div>
                  <div class="kpi-val both" id="lq-both">${live.bothPct.toFixed(1)} %</div>
                  <div class="xs muted">bis ${live.span.sleepStr}: ${live.endBothPct.toFixed(1)} %</div>
                </div>
              </div>
              <div class="xs muted" style="margin-bottom:4px;">Tages-Zeitachse (${live.span.wakeStr}–${live.span.sleepStr}):</div>
              <div class="chart-box" style="margin-bottom:8px;">${renderDayTimelineSVG({ span: live.span, lectures: todayLectures, entries: todayEntries, caffeine: caf.todayItems })}</div>
              <div class="xs muted" style="margin-bottom:4px;">Rest des Tages (Prognose):</div>
              <div class="chart-box">${renderRestOfDaySVG(live)}</div>
              <div class="legend" style="margin-top:4px;">
                <span class="legend-item"><span class="legend-dot" style="background:var(--both)"></span>Zusammen</span>
                <span class="legend-item"><span class="legend-dot" style="background:var(--learn)"></span>Lernen</span>
                <span class="legend-item"><span class="legend-dot" style="background:var(--anki)"></span>Anki</span>
                <span class="legend-item"><span class="legend-dot" style="background:var(--prod)"></span>Vorlesung</span>
                <span class="legend-item"><span class="legend-dot" style="background:var(--caf)"></span>Koffein</span>
              </div>
            ` : `
              <p class="small muted" style="margin:4px 0 12px;">
                Trage deine heutige Aufwachzeit ein, um deine Live-Quote und die Rest-des-Tages-Kurve zu berechnen.
              </p>
              <div class="row">
                <input type="time" id="quick-wake-input" class="input mono" style="max-width:140px;" value="08:30" />
                <button class="btn btn-primary btn-sm" id="quick-wake-save">Speichern</button>
              </div>
            `}
          </div>
        </section>
      </div>

      <!-- 4. Neuer Fokus-Eintrag (standardmäßig zugeklappt) -->
      <section class="card ${ui.d_entry_open ? '' : 'collapsed'}" data-collapse="d_entry_open">
        <button class="collapsible-header" data-toggle="d_entry_open">
          <h2 class="card-title">${icon('plus', 15)} Neuer Zeit-Eintrag</h2>
          <span class="chevron">${icon('chevron', 16)}</span>
        </button>
        <div class="collapsible-body">
          <form id="entry-form">
            <div class="field-grid">
              <div class="field">
                <label>Datum</label>
                <input type="date" id="en-date" class="input mono" value="${today}" max="${today}" required />
              </div>
              <div class="field">
                <label>Uhrzeit</label>
                <input type="time" id="en-time" class="input mono" value="${toTimeStr(now)}" required />
              </div>
              <div class="field">
                <label>Art</label>
                <select id="en-kind" class="input">
                  <option value="l">Lernzeit</option>
                  <option value="a">Anki-Lernzeit</option>
                  <option value="p">Vorlesung / Produktiv</option>
                </select>
              </div>
              <div class="field">
                <label>Minuten</label>
                <input type="number" id="en-min" class="input mono" min="1" max="1440" placeholder="z. B. 90" required />
              </div>
              <div class="field">
                <label>Fach (optional)</label>
                <select id="en-mod" class="input">
                  <option value="">Allgemein</option>
                  ${moduleOptions}
                </select>
              </div>
              <div class="field" id="en-act-field">
                <label>Tätigkeit (für KI)</label>
                <select id="en-act" class="input">
                  <option value="">Allgemein</option>
                  <option value="video">VL-Video durcharbeiten</option>
                  <option value="review">VL nacharbeiten & Ankis</option>
                  <option value="homework">Hausaufgabe (Verständnis)</option>
                  <option value="exam">Altklausur / Üben</option>
                  <option value="anki" hidden>Anki-Reviews (fest)</option>
                  <option value="prod" hidden>Vorlesung / Produktiv (fest)</option>
                </select>
              </div>
            </div>
            <div class="field" style="margin-top:10px;">
              <label>Was genau gelernt? (optional – wird strukturiert an Gemini weitergegeben)</label>
              <input type="text" id="en-note" class="input" placeholder="z. B. HM Video 7 (Reihen) oder WK Kap. 4 + 35 Ankis" />
            </div>
            <div class="row-between" style="margin-top:12px;">
              <div class="small muted" id="entry-feedback">${esc(lastEntryFeedback)}</div>
              <button type="submit" class="btn btn-primary btn-sm">Eintragen</button>
            </div>
          </form>
        </div>
      </section>

      <!-- 5. Koffein & Schlaf -->
      <div class="grid-2">
        <section class="card ${ui.d_caf ? '' : 'collapsed'}" data-collapse="d_caf">
          <button class="collapsible-header" data-toggle="d_caf">
            <h2 class="card-title">${icon('coffee', 15)} Koffein <span class="pill caf">${caf.todayMg} mg heute · ~${Math.round(caf.currentMg)} mg aktiv</span></h2>
            <span class="chevron">${icon('chevron', 16)}</span>
          </button>
          <div class="collapsible-body">
            <div class="grid-3" style="margin-bottom:10px;">
              <div class="kpi-box"><div class="kpi-label">Aktiv</div><div class="kpi-val caf">${Math.round(caf.currentMg)} mg</div></div>
              <div class="kpi-box"><div class="kpi-label">Schlafzeit</div><div class="kpi-val">${Math.round(caf.sleepMg)} mg</div></div>
              <div class="kpi-box"><div class="kpi-label">&lt; 50 mg ab</div><div class="kpi-val kit" style="font-size:0.9rem;">${esc(caf.under50Str)}</div></div>
            </div>
            <div class="chart-box" style="margin-bottom:10px;">${renderCaffeineCurveSVG(caf)}</div>
            <form id="caf-form" class="field-grid" style="margin-bottom:10px;">
              <div class="field"><label>Menge (mg)</label><input type="number" id="caf-mg" class="input mono" min="5" max="1000" value="100" required /></div>
              <div class="field"><label>Uhrzeit</label><input type="time" id="caf-time" class="input mono" value="${toTimeStr(now)}" required /></div>
              <div class="field"><label>Datum</label><input type="date" id="caf-date" class="input mono" value="${today}" max="${today}" required /></div>
              <div class="field"><button type="submit" class="btn btn-primary btn-sm">Hinzufügen</button></div>
            </form>
            <div class="chip-row" style="margin-bottom:10px;">
              <button type="button" class="chip" data-caf-preset="80">Espresso 80</button>
              <button type="button" class="chip" data-caf-preset="100">Kaffee 100</button>
              <button type="button" class="chip" data-caf-preset="160">Energy 160</button>
              <button type="button" class="chip" data-caf-preset="50">Mate 50</button>
            </div>
            <details>
              <summary class="xs muted" style="cursor:pointer;">Historie (${recentCaf.length})</summary>
              <div class="entry-list" style="margin-top:8px;">
                ${recentCaf.map((c) => `
                  <div class="entry-row" style="padding:6px 10px;">
                    <span class="small mono"><strong>${c.mg} mg</strong> · ${fmtDateShort(c.d)} ${esc(c.t)}</span>
                    <button class="btn btn-xs btn-ghost" data-del-caf="${c.id}">${icon('x', 12)}</button>
                  </div>
                `).join('') || '<div class="xs muted">Keine Einträge.</div>'}
              </div>
            </details>
          </div>
        </section>

        <section class="card ${ui.d_wake ? '' : 'collapsed'}" data-collapse="d_wake">
          <button class="collapsible-header" data-toggle="d_wake">
            <h2 class="card-title">${icon('sun', 15)} Aufwachen & Einschlafen ${missingWakes > 0 ? `<span class="pill prod">${missingWakes} offen</span>` : '<span class="pill kit">Komplett</span>'}</h2>
            <span class="chevron">${icon('chevron', 16)}</span>
          </button>
          <div class="collapsible-body">
            <form id="wake-form" class="field-grid" style="margin-bottom:12px;">
              <div class="field"><label>Datum</label><input type="date" id="wk-date" class="input mono" value="${today}" max="${today}" required /></div>
              <div class="field"><label>Aufwachen</label><input type="time" id="wk-wake" class="input mono" value="${store.state.w[today] || '08:30'}" /></div>
              <div class="field"><label>Schlaf (Std. ${store.state.sl})</label><input type="time" id="wk-sleep" class="input mono" value="${store.state.sx[today] || ''}" /></div>
              <div class="field"><button type="submit" class="btn btn-primary btn-sm">Speichern</button></div>
            </form>
            <details>
              <summary class="xs muted" style="cursor:pointer;">Letzte 14 Tage</summary>
              <div class="entry-list" style="margin-top:8px;">
                ${wake14.map((row) => `
                  <div class="entry-row" style="padding:6px 10px;">
                    <span class="small">${fmtDateDE(row.d)}</span>
                    <div class="row" style="gap:6px;">
                      ${row.w ? `<span class="pill kit mono">${row.w}</span>` : '<span class="pill danger">Fehlt</span>'}
                      <span class="pill mono">${row.sx || store.state.sl}</span>
                      <button class="btn btn-xs btn-ghost" data-pick-wake="${row.d}">${icon('edit', 12)}</button>
                    </div>
                  </div>
                `).join('')}
              </div>
            </details>
          </div>
        </section>
      </div>

      <!-- 6. Letzte Einträge -->
      <section class="card ${ui.d_ent ? '' : 'collapsed'}" data-collapse="d_ent">
        <button class="collapsible-header" data-toggle="d_ent">
          <h2 class="card-title">${icon('activity', 15)} Letzte Einträge (${recentEntries.length})</h2>
          <span class="chevron">${icon('chevron', 16)}</span>
        </button>
        <div class="collapsible-body">
          <div class="entry-list">
            ${recentEntries.map((x) => {
              const counts = countingByDate[x.d]?.has(x.id);
              const badge = x.k === 'a'
                ? `<span class="pill anki">${x.autoAnki ? 'Anki (Auto)' : 'Anki'}</span>`
                : x.k === 'p'
                  ? `<span class="pill prod">${x.autoLecture ? 'Vorlesung (Auto)' : 'Vorlesung / Prod.'}</span>`
                  : '<span class="pill learn">Lernen</span>';
              const modObj = x.mod ? store.state.modules[x.mod] : null;
              const actMap = { video: 'Video', review: 'Nacharbeit', homework: 'HA', anki: 'Anki', exam: 'Klausur' };
              return `
                <div class="entry-row ${counts ? '' : 'non-counting'}">
                  <div class="row" style="gap:8px;">
                    ${badge}
                    <strong class="mono ${counts ? '' : 'strike'}">${fmtMin(x.m)}</strong>
                    <span class="small muted mono">${fmtDateShort(x.d)} ${esc(x.t || '')}</span>
                    ${modObj ? `<span class="pill">${esc(modObj.shortName)}</span>` : ''}
                    ${x.act && actMap[x.act] ? `<span class="pill">${actMap[x.act]}</span>` : ''}
                    ${x.note ? `<span class="xs muted">${esc(x.note)}</span>` : ''}
                    ${!counts ? '<span class="xs soft">(zählt nicht)</span>' : ''}
                  </div>
                  <button class="btn btn-xs btn-ghost" data-del-entry="${x.id}" title="Löschen">${icon('x', 13)}</button>
                </div>
              `;
            }).join('') || '<div class="small muted">Noch keine Einträge vorhanden.</div>'}
          </div>
        </div>
      </section>

      <!-- 7. Timer (ganz unten, klappt automatisch auf wenn aktiv) -->
      <section class="card ${ui.tdt ? '' : 'collapsed'}" data-collapse="tdt" id="timer-card">
        <button class="collapsible-header" data-toggle="tdt">
          <h2 class="card-title">${icon('clock', 15)} Fokus-Timer ${timerStatus ? '<span class="pill gold">AKTIV</span>' : ''}</h2>
          <span class="chevron">${icon('chevron', 16)}</span>
        </button>
        <div class="collapsible-body">
          ${timerStatus ? `
            <div class="row-between">
              <span class="pill ${timerStatus.kind === 'a' ? 'anki' : timerStatus.kind === 'p' ? 'prod' : 'learn'}">
                ${timerStatus.kind === 'a' ? 'Anki' : timerStatus.kind === 'p' ? 'Vorlesung / Prod.' : 'Lernen'} · ${timerStatus.mode === 'countdown' ? 'Countdown' : 'Hochzählen'}
              </span>
              <span class="xs muted">Wird zum heutigen Tageswert addiert</span>
            </div>
            <div class="timer-display" id="timer-clock">
              ${timerStatus.mode === 'countdown' ? fmtHMS(timerStatus.remainingSec) : fmtHMS(timerStatus.elapsedSec)}
            </div>
            <div class="row" style="justify-content:center;margin-bottom:14px;">
              <button class="btn btn-primary btn-sm" id="btn-timer-stop-save">${icon('check', 14)} Stopp & speichern</button>
              <button class="btn btn-danger btn-sm" id="btn-timer-discard">${icon('x', 14)} Verwerfen</button>
            </div>
            ${timerProj ? `
              <div class="small muted" style="margin-bottom:6px;">
                Prognose bei Abschluss (+${timerProj.totalAdd} min): Lernen <strong>${timerProj.endLearn.toFixed(1)} %</strong> · Vorlesung <strong>${timerProj.endProd.toFixed(1)} %</strong> · Zusammen <strong>${timerProj.endBoth.toFixed(1)} %</strong>
              </div>
              <div class="chart-box">${timerProj.svg}</div>
            ` : ''}
          ` : `
            <div class="row-between" style="margin-bottom:12px;">
              <div class="segmented">
                <button type="button" data-tmode="countdown" class="${selectedTimerMode === 'countdown' ? 'active' : ''}">Countdown</button>
                <button type="button" data-tmode="up" class="${selectedTimerMode === 'up' ? 'active' : ''}">Hochzählen</button>
              </div>
              <div class="segmented">
                <button type="button" data-tkind="l" class="${selectedTimerKind === 'l' ? 'active' : ''}">Lernen</button>
                <button type="button" data-tkind="a" class="${selectedTimerKind === 'a' ? 'active' : ''}">Anki</button>
                <button type="button" data-tkind="p" class="${selectedTimerKind === 'p' ? 'active' : ''}">Vorlesung</button>
              </div>
            </div>
            ${selectedTimerMode === 'countdown' ? `
              <div class="chip-row" style="margin-bottom:10px;">
                ${[15, 30, 45, 60, 90].map((m) => `<button type="button" class="chip ${selectedTimerMin === m ? 'active' : ''}" data-tmin="${m}">${m} min</button>`).join('')}
                <input type="number" id="tm-custom-min" class="input mono" style="width:88px;padding:4px 8px;" min="1" max="360" value="${selectedTimerMin}" />
              </div>
            ` : ''}
            <button class="btn btn-primary" id="btn-timer-start" style="width:100%;">${icon('play', 13)} Timer starten</button>
          `}
        </div>
      </section>
    </div>
  `;

  // ---------- Event Binding ----------
  root.querySelector('#btn-goto-week')?.addEventListener('click', () => navigate('week'));
  root.querySelector('#btn-goto-planner')?.addEventListener('click', () => navigate('planner'));
  root.querySelector('#btn-toggle-rest')?.addEventListener('click', () => {
    const active = store.toggleRestDay(today);
    toast(active ? `Ruhetag aktiviert (Ziel ${store.getGoalForDay(today)} min · Serie geschützt).` : 'Normaler Lerntag aktiviert.', 'ok');
  });

  // 10s Morning Check-in (#3)
  root.querySelector('#ci-now')?.addEventListener('click', () => {
    const el = root.querySelector('#ci-wake');
    if (el) el.value = toTimeStr(new Date());
  });
  root.querySelectorAll('[data-ci-em]').forEach((btn) => {
    btn.addEventListener('click', () => {
      store.state.ai.energyMode = btn.getAttribute('data-ci-em');
      root.querySelectorAll('[data-ci-em]').forEach((b) => b.classList.toggle('active', b === btn));
    });
  });
  root.querySelector('#ci-start')?.addEventListener('click', () => {
    const val = root.querySelector('#ci-wake')?.value || toTimeStr(new Date());
    store.setWakeTime(today, val);
    toast(`Aufwachzeit ${val} gesetzt (${store.state.ai.energyMode || 'normal'}).`, 'ok');
  });

  // Checklist actions + Checklist -> Log-Bar (#1) + Undo Toast (#7)
  root.querySelector('#btn-rollover')?.addEventListener('click', () => {
    const n = rolloverYesterdayToToday(today);
    toast(`${n} ${n === 1 ? 'Punkt' : 'Punkte'} auf heute geschoben.`, 'ok');
  });

  root.querySelectorAll('[data-chk-toggle]').forEach((el) => {
    el.addEventListener('click', () => {
      const updated = toggleChecklistItem(el.getAttribute('data-chk-toggle'));
      if (updated && updated.done && promptLogFromChecklist) {
        promptLogFromChecklist(updated);
      }
    });
  });

  root.querySelectorAll('[data-chk-tomorrow]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const res = moveChecklistItemToDate(btn.getAttribute('data-chk-tomorrow'), tomorrow);
      if (res.ok) toast(`Auf morgen (${fmtDateShort(tomorrow)}) verschoben.`, 'ok');
    });
  });

  root.querySelectorAll('[data-pull-today]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const res = moveChecklistItemToDate(btn.getAttribute('data-pull-today'), today);
      if (res.ok) {
        const fromWd = WEEKDAYS_DE[parseDateStr(res.oldDate).getDay()];
        toast(`Vorgezogen auf heute — ${fromWd} (${fmtDateShort(res.oldDate)}) ist jetzt ~${fmtMin(res.estMin)} leichter!`, 'ok');
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
      setTimeout(() => document.getElementById('timer-card')?.scrollIntoView({ behavior: 'smooth' }), 60);
    });
  });

  root.querySelector('#today-chk-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const titleEl = root.querySelector('#tchk-title');
    const timeEl = root.querySelector('#tchk-time');
    if (addChecklistItem({ d: today, title: titleEl.value, timeLabel: timeEl.value })) {
      titleEl.value = '';
      timeEl.value = '';
    }
  });

  // Autopilot actions
  root.querySelectorAll('[data-ap-accept]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const s = autopilot[Number(btn.getAttribute('data-ap-accept'))];
      if (s) { acceptAutopilotSuggestion(s); toast('Zum Rückstand hinzugefügt.', 'ok'); }
    });
  });
  root.querySelectorAll('[data-ap-dismiss]').forEach((btn) => {
    btn.addEventListener('click', () => dismissAutopilotSuggestion(btn.getAttribute('data-ap-dismiss')));
  });
  root.querySelector('#btn-ap-all')?.addEventListener('click', () => {
    autopilot.forEach((s) => acceptAutopilotSuggestion(s));
    toast(`${autopilot.length} Punkte in den Rückstand übernommen.`, 'ok');
  });

  // Lecture attendance toggles
  root.querySelectorAll('[data-lec-att]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const uid = btn.getAttribute('data-lec-att');
      const next = btn.getAttribute('data-next');
      setLectureAttendance(uid, today, next);
      toast(next === 'attended' ? 'Vorlesung als besucht verbucht.' : 'Vorlesung als nicht besucht markiert.', 'ok');
    });
  });

  // Collapsibles
  root.querySelectorAll('[data-toggle]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = btn.getAttribute('data-toggle');
      store.state.ui[key] = !store.state.ui[key];
      store.save({ skipSync: true, silent: true });
      btn.closest('.card')?.classList.toggle('collapsed', !store.state.ui[key]);
    });
  });

  root.querySelector('#quick-wake-save')?.addEventListener('click', () => {
    const val = root.querySelector('#quick-wake-input')?.value;
    if (val) { store.setWakeTime(today, val); toast(`Aufwachzeit ${val} gespeichert.`, 'ok'); }
  });

  // Anki (both Hero Auto-Anki row & Anki card)
  const triggerAnkiSync = async () => {
    try {
      const res = await syncAnkiConnect();
      const parentInfo = res.filteredParents?.length ? ` · Übergruppe ${res.filteredParents.join(', ')} gefiltert` : '';
      const todayInfo = res.todayRealMin > 0 ? ` · Heute gelernt: ${fmtMin(res.todayRealMin)} (${res.todayRealCards} K.)` : '';
      toast(`AnkiConnect: ${res.totalDue} fällige Karten (${res.deckCount} Stapel${parentInfo})${todayInfo}.`, 'ok');
    } catch (err) {
      toast(`AnkiConnect nicht erreichbar (${err.message}).`, 'err');
    }
  };
  root.querySelectorAll('[data-anki-hide]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const name = btn.getAttribute('data-anki-hide');
      toggleExcludedAnkiDeck(name);
      toast(`„${name}“ aus der Anki-Zählung ausgeblendet.`, 'ok');
    });
  });
  root.querySelectorAll('[data-anki-unhide]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const name = btn.getAttribute('data-anki-unhide');
      toggleExcludedAnkiDeck(name);
      toast(`„${name}“ wieder eingeblendet.`, 'ok');
    });
  });
  root.querySelector('#btn-anki-sync')?.addEventListener('click', triggerAnkiSync);
  root.querySelector('#btn-anki-row-sync')?.addEventListener('click', triggerAnkiSync);
  root.querySelector('#btn-anki-mobile-hint')?.addEventListener('click', () => {
    toast('Sync am Laptop mit geöffnetem Anki — am Handy wird der Stand per Cloud-Sync übernommen (oder unter Anki-Details manuell eintragen).');
  });
  root.querySelector('#btn-anki-open-details')?.addEventListener('click', () => {
    store.state.ui.d_anki_card = true;
    store.save({ skipSync: true, silent: true });
    const card = root.querySelector('#anki-detail-card');
    if (card) {
      card.classList.remove('collapsed');
      card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  });
  root.querySelector('#anki-row-toggle')?.addEventListener('click', () => {
    const nextDone = !ankiDoneToday;
    store.setAnkiDoneDay(today, nextDone);
    if (nextDone && promptLogFromChecklist) {
      promptLogFromChecklist({
        id: 'anki_daily',
        title: 'Anki für heute abhaken',
        kind: 'a',
        estMin: 0,
        done: true,
        isAnkiDaily: true,
        remainingCards: anki.totalDue,
        alreadyLoggedMin: day.a
      });
    } else if (!nextDone) {
      toast('Anki für heute wieder geöffnet.');
    }
  });
  root.querySelector('#btn-anki-row-log')?.addEventListener('click', () => {
    if (promptLogFromChecklist) {
      promptLogFromChecklist({
        id: 'anki_session',
        title: 'Anki-Zwischenzeit loggen',
        kind: 'a',
        estMin: 0,
        done: true,
        isAnkiDaily: true,
        remainingCards: anki.totalDue,
        alreadyLoggedMin: day.a
      });
    }
  });

  root.querySelector('#btn-anki-timer')?.addEventListener('click', () => {
    store.startTimer({ mode: 'countdown', kind: 'a', durationMin: Math.max(10, Math.min(90, anki.estMinutes || 30)) });
    toast('Anki-Timer gestartet.', 'ok');
  });

  root.querySelector('#btn-anki-manual-save')?.addEventListener('click', () => {
    setManualAnki({
      newCards: root.querySelector('#anki-m-new')?.value,
      learnCards: root.querySelector('#anki-m-learn')?.value,
      reviewCards: root.querySelector('#anki-m-rev')?.value
    });
    toast('Anki-Karten (Blau/Rot/Grün) gespeichert.', 'ok');
  });

  // Entry form: lock Tätigkeit when Art is Anki ('a') or Vorlesung ('p')
  const enKindEl = root.querySelector('#en-kind');
  const enActEl = root.querySelector('#en-act');
  let lastLearnAct = '';

  const syncEntryActLock = () => {
    if (!enKindEl || !enActEl) return;
    const kind = enKindEl.value;
    if (kind === 'a') {
      if (enActEl.value !== 'anki' && enActEl.value !== 'prod') lastLearnAct = enActEl.value;
      enActEl.value = 'anki';
      enActEl.disabled = true;
      enActEl.style.opacity = '0.55';
    } else if (kind === 'p') {
      if (enActEl.value !== 'anki' && enActEl.value !== 'prod') lastLearnAct = enActEl.value;
      enActEl.value = 'prod';
      enActEl.disabled = true;
      enActEl.style.opacity = '0.55';
    } else {
      enActEl.disabled = false;
      enActEl.style.opacity = '';
      if (enActEl.value === 'anki' || enActEl.value === 'prod') {
        enActEl.value = lastLearnAct || '';
      }
    }
  };
  enKindEl?.addEventListener('change', syncEntryActLock);
  syncEntryActLock();

  root.querySelector('#entry-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const kind = root.querySelector('#en-kind').value;
    const act = kind === 'a' ? 'anki' : kind === 'p' ? '' : root.querySelector('#en-act').value;
    const res = store.addEntry({
      d: root.querySelector('#en-date').value,
      t: root.querySelector('#en-time').value,
      k: kind,
      m: root.querySelector('#en-min').value,
      mod: root.querySelector('#en-mod').value,
      act,
      note: root.querySelector('#en-note').value
    });
    lastEntryFeedback = res.message;
    toast(res.message, res.ok ? 'ok' : 'err');
  });

  // Caffeine
  root.querySelectorAll('[data-caf-preset]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const mgInput = root.querySelector('#caf-mg');
      if (mgInput) mgInput.value = btn.getAttribute('data-caf-preset');
    });
  });

  root.querySelector('#caf-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const item = store.addCaffeine({
      mg: root.querySelector('#caf-mg').value,
      t: root.querySelector('#caf-time').value,
      d: root.querySelector('#caf-date').value
    });
    if (item) toast(`${item.mg} mg Koffein eingetragen.`, 'ok');
  });

  root.querySelectorAll('[data-del-caf]').forEach((btn) => {
    btn.addEventListener('click', () => { store.deleteCaffeine(Number(btn.getAttribute('data-del-caf'))); toast('Koffein gelöscht.', '', { undo: true }); });
  });

  // Wake / Sleep
  const wkDateEl = root.querySelector('#wk-date');
  wkDateEl?.addEventListener('change', () => {
    const d = wkDateEl.value;
    root.querySelector('#wk-wake').value = store.state.w[d] || '';
    root.querySelector('#wk-sleep').value = store.state.sx[d] || '';
  });

  root.querySelector('#wake-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const d = root.querySelector('#wk-date').value;
    if (d > today) { toast('Zukünftige Tage sind gesperrt.', 'err'); return; }
    store.setWakeTime(d, root.querySelector('#wk-wake').value);
    store.setSleepTime(d, root.querySelector('#wk-sleep').value);
    toast(`Schlafzeiten für ${fmtDateShort(d)} gespeichert.`, 'ok');
  });

  root.querySelectorAll('[data-pick-wake]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const d = btn.getAttribute('data-pick-wake');
      if (wkDateEl) {
        wkDateEl.value = d;
        root.querySelector('#wk-wake').value = store.state.w[d] || '08:30';
        root.querySelector('#wk-sleep').value = store.state.sx[d] || '';
        root.querySelector('#wk-wake').focus();
      }
    });
  });

  root.querySelectorAll('[data-del-entry]').forEach((btn) => {
    btn.addEventListener('click', () => { store.deleteEntry(Number(btn.getAttribute('data-del-entry'))); toast('Eintrag gelöscht.', '', { undo: true }); });
  });

  // Timer controls
  root.querySelectorAll('[data-tmode]').forEach((btn) => {
    btn.addEventListener('click', () => { selectedTimerMode = btn.getAttribute('data-tmode'); renderTodayView(root, ctx); });
  });
  root.querySelectorAll('[data-tkind]').forEach((btn) => {
    btn.addEventListener('click', () => { selectedTimerKind = btn.getAttribute('data-tkind'); renderTodayView(root, ctx); });
  });
  root.querySelectorAll('[data-tmin]').forEach((btn) => {
    btn.addEventListener('click', () => {
      selectedTimerMin = Number(btn.getAttribute('data-tmin'));
      const inp = root.querySelector('#tm-custom-min');
      if (inp) inp.value = selectedTimerMin;
      root.querySelectorAll('[data-tmin]').forEach((b) => b.classList.toggle('active', b === btn));
    });
  });
  root.querySelector('#btn-timer-start')?.addEventListener('click', () => {
    const custom = Number(root.querySelector('#tm-custom-min')?.value) || selectedTimerMin;
    selectedTimerMin = custom;
    store.startTimer({ mode: selectedTimerMode, kind: selectedTimerKind, durationMin: custom });
    toast('Timer gestartet.', 'ok');
  });
  root.querySelector('#btn-timer-stop-save')?.addEventListener('click', () => {
    const res = store.stopAndSaveTimer();
    if (res) toast(res.message, res.saved ? 'ok' : '');
  });
  root.querySelector('#btn-timer-discard')?.addEventListener('click', () => {
    store.discardTimer();
    toast('Timer verworfen.');
  });

  // Adaptive tick: 1s only while timer is running & tab visible; 30s otherwise; auto-rerenders at midnight rollover!
  const renderedDate = today;
  const scheduleTick = () => {
    const running = Boolean(store.getTimerStatus());
    const hidden = document.visibilityState === 'hidden';
    const delayMs = (!hidden && running) ? 1000 : 30000;
    activeTimerTick = setTimeout(() => {
      activeTimerTick = null;
      if (document.visibilityState === 'hidden') {
        scheduleTick();
        return;
      }
      const nowDay = toDateStr();
      if (nowDay !== renderedDate) {
        renderTodayView(root, ctx);
        return;
      }
      const expired = store.checkExpiredTimer();
      if (expired) { toast(expired.message, 'ok'); return; }
      const st = store.getTimerStatus();
      const clockEl = document.getElementById('timer-clock');
      if (st && clockEl) clockEl.textContent = st.mode === 'countdown' ? fmtHMS(st.remainingSec) : fmtHMS(st.elapsedSec);
      const lr = store.getLiveRatio(nowDay, new Date());
      if (lr.hasWake) {
        const aEl = document.getElementById('live-awake-badge');
        const lEl = document.getElementById('lq-learn');
        const pEl = document.getElementById('lq-prod');
        const bEl = document.getElementById('lq-both');
        if (aEl) aEl.textContent = `Wach: ${fmtMin(lr.span.elapsedMin)}`;
        if (lEl) lEl.textContent = `${lr.learnPct.toFixed(1)} %`;
        if (pEl) pEl.textContent = `${lr.prodPct.toFixed(1)} %`;
        if (bEl) bEl.textContent = `${lr.bothPct.toFixed(1)} %`;
      }
      scheduleTick();
    }, delayMs);
  };
  bindChartTooltips(root);
  scheduleTick();
}

export function cleanupTodayView() {
  if (activeTimerTick) {
    clearTimeout(activeTimerTick);
    activeTimerTick = null;
  }
}

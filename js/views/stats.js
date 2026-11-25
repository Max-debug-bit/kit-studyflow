// Tab 4: "Statistik" – Priorisierte Semester-Steuerung (Fach-Invest, Verlauf, Anki-Sync, 7T-Last) + Detail-Analysen

import {
  store,
  toDateStr,
  addDays,
  fmtMin,
  fmtHours,
  fmtDateShort,
  WEEKDAYS_MON,
  parseDateStr,
  escapeHtml as esc
} from '../store.js';
import {
  renderWakeRatioBarsSVG,
  renderHistoryBarsSVG,
  renderCaffeine14dSVG,
  renderHeatmap20WeeksSVG,
  renderSimpleBarsSVG,
  renderAnkiSyncChartSVG,
  bindChartTooltips
} from '../charts.js';
import { getAnkiReviewAnalytics } from '../anki.js';
import { getAttendedUniMinutesBySubject } from '../checklist.js';
import { icon } from '../icons.js';

let historyRange = 14;
let subjectRangeDays = 0; // 0 = Gesamt, 30 = 30T, 7 = 7T
let includeUniInSubject = false;
let ankiGraphMode = 'all'; // 'all' | 'brg' | 'total'
let ankiGraphLimit = 30;   // 30 | 0 (Alle)

export function renderStatsView(root, { toast } = {}) {
  const now = new Date();
  const today = toDateStr(now);
  const goal = store.state.goal || 120;
  const st = store.getOverallStats();
  const rec = store.getRecordsAndMilestones(today, st);

  const wakeRows = Object.keys(store.state.w)
    .filter((d) => d <= today)
    .sort((a, b) => b.localeCompare(a))
    .slice(0, 14)
    .map((d) => {
      const sp = store.getAwakeSpan(d, now);
      const b = store.getDayBreakdown(d);
      const awakeMin = Math.max(1, sp ? sp.elapsedMin : 1);
      let lPct = Math.min(100, (b.l / awakeMin) * 100);
      let aPct = Math.min(100, (b.a / awakeMin) * 100);
      let pPct = Math.min(100, (b.p / awakeMin) * 100);
      const rawSum = lPct + aPct + pPct;
      if (rawSum > 100) {
        const scale = 100 / rawSum;
        lPct *= scale;
        aPct *= scale;
        pPct *= scale;
      }
      return { d, awakeMin, lMin: b.l, aMin: b.a, pMin: b.p, lPct, aPct, pPct, totalPct: Math.min(100, rawSum) };
    });

  const hasCaffeineData = (store.state.cf || []).length > 0;
  const caf14 = [];
  if (hasCaffeineData) {
    for (let i = 13; i >= 0; i--) {
      const d = addDays(today, -i);
      caf14.push({ d, mg: st.cafStats.cafByDay[d] || 0 });
    }
  }

  const histRows = [];
  for (let i = historyRange - 1; i >= 0; i--) {
    const d = addDays(today, -i);
    const b = store.getDayBreakdown(d);
    histRows.push({
      d,
      lMin: b.l,
      aMin: b.a,
      learnTotal: b.learnTotal,
      goalMin: store.getGoalForDay(d),
      isRest: store.isRestDay(d)
    });
  }

  const todayDow = parseDateStr(today).getDay();
  const todayMonIdx = todayDow === 0 ? 6 : todayDow - 1;
  const endOfThisWeek = addDays(today, 6 - todayMonIdx);
  const startHeat = addDays(endOfThisWeek, -(20 * 7 - 1));
  const heatCells = [];
  for (let i = 0; i < 140; i++) {
    const d = addDays(startHeat, i);
    const col = Math.floor(i / 7);
    const row = i % 7;
    const min = d <= today ? store.getDayBreakdown(d).learnTotal : 0;
    heatCells.push({
      d,
      col,
      row,
      min,
      goalMin: store.getGoalForDay(d),
      isRest: store.isRestDay(d)
    });
  }

  const weekdayItems = WEEKDAYS_MON.map((lbl, i) => ({
    label: lbl,
    value: st.weekdayAvgs[i],
    tip: `${lbl}: Ø ${fmtMin(st.weekdayAvgs[i])}`
  }));

  const lectureUnits = (st.totalProd / 90).toFixed(1);
  const totalChk = (store.state.checklist || []).length;
  const doneChk = (store.state.checklist || []).filter((c) => c.done).length;
  const canCompareCaf = st.cafStats.withCafCount >= 2 && st.cafStats.withoutCafCount >= 2;
  const calibration = store.getCalibrationSummary();
  const load7 = store.getLoadSummary7d(today);
  const ankiRev = getAnkiReviewAnalytics(today);
  const shownAnkiSyncs = ankiGraphLimit > 0 ? ankiRev.syncHistory.slice(-ankiGraphLimit) : ankiRev.syncHistory;
  const ps = ankiRev.paceStats;
  const hasRealPace = Boolean(ps && (ps.cntNew + ps.cntLearn + ps.cntRev) >= 10);

  const rawSubjectBalance = store.getSubjectBalance({ days: subjectRangeDays, todayStr: today });
  const uniBySubj = includeUniInSubject ? getAttendedUniMinutesBySubject({ days: subjectRangeDays, todayStr: today, nowDate: now }) : {};
  const subjMap = new Map();
  for (const s of rawSubjectBalance) {
    subjMap.set(s.subject, { ...s, uniMin: 0 });
  }
  if (includeUniInSubject) {
    for (const [subjName, uMin] of Object.entries(uniBySubj)) {
      if (uMin <= 0) continue;
      if (subjMap.has(subjName)) {
        subjMap.get(subjName).uniMin += uMin;
      } else {
        subjMap.set(subjName, {
          subject: subjName,
          focusMin: 0,
          ankiMin: 0,
          learnMin: 0,
          uniMin: uMin,
          ankiReviewedCards: 0,
          ankiAvgSec: 0,
          sessions: 0,
          openBacklog: 0,
          chkDone: 0,
          chkTotal: 0,
          ankiNew: 0,
          ankiLearn: 0,
          ankiReview: 0,
          ankiTotal: 0
        });
      }
    }
  }
  const subjectRows = Array.from(subjMap.values())
    .map((s) => ({ ...s, investMin: s.focusMin + s.ankiMin + (s.uniMin || 0) }))
    .sort((a, b) => b.investMin - a.investMin || b.openBacklog - a.openBacklog || a.subject.localeCompare(b.subject));

  const maxSubjMin = Math.max(60, ...subjectRows.map((s) => s.investMin));
  const totalSubjFocusMin = subjectRows.reduce((acc, s) => acc + s.focusMin, 0);
  const totalSubjAnkiMin = subjectRows.reduce((acc, s) => acc + s.ankiMin, 0);
  const totalSubjUniMin = subjectRows.reduce((acc, s) => acc + (s.uniMin || 0), 0);
  const totalSubjInvestMin = totalSubjFocusMin + totalSubjAnkiMin + totalSubjUniMin;

  const patterns = store.getPersonalPatterns(today);
  const actMap = { video: 'Video', review: 'Nacharbeit', homework: 'HA', anki: 'Anki', exam: 'Klausur' };

  root.innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="page-title">Statistik</h1>
        <div class="small muted">Zeit pro Fach, Verlauf, Anki-Sync &amp; 7-Tage-Belastung im direkten Blick</div>
      </div>
      <div class="row">
        <button class="btn btn-sm" id="btn-copy-report">${icon('copy', 14)} Studienbericht (MD)</button>
      </div>
    </div>

    <div class="stack">
      <!-- 1. Kompakter Wochen- & 7-Tage-Belastungs-Überblick -->
      <section class="card">
        <div class="card-header">
          <h2 class="card-title">${icon('activity', 15)} Wochen- &amp; 7-Tage-Überblick</h2>
          <span class="pill ${load7.level === 'hoch' ? 'prod' : load7.level === 'solide' ? 'learn' : 'kit'}">${load7.label}</span>
        </div>
        <div class="grid-4" style="margin-bottom:8px;">
          <div class="kpi-box">
            <div class="kpi-label">Diese Woche (Lernen)</div>
            <div class="kpi-val learn">${fmtMin(st.thisWeek)}</div>
            <div class="xs muted">Ø aktiv: ${fmtMin(st.avgActive)}/Tag</div>
          </div>
          <div class="kpi-box">
            <div class="kpi-label">7T Uni + Lernen</div>
            <div class="kpi-val">${load7.total7Hours.toFixed(1)} h</div>
            <div class="xs muted">${load7.consecutiveDays} ${load7.consecutiveDays === 1 ? 'Tag' : 'Tage'} am Stück</div>
          </div>
          <div class="kpi-box">
            <div class="kpi-label">Zielquote &amp; Serie</div>
            <div class="kpi-val kit">${st.goalRate.toFixed(0)} %</div>
            <div class="xs muted">Serie: ${st.streaks.current} T (Rekord ${st.streaks.longest} T)</div>
          </div>
          <div class="kpi-box">
            <div class="kpi-label">Gesamt (Lernen + VL)</div>
            <div class="kpi-val both">${fmtHours(st.totalLearn)}</div>
            <div class="xs muted">+ ${fmtHours(st.totalProd)} VL · Ziel ${rec.nextMilestoneH} h</div>
          </div>
        </div>
        <div class="xs muted">${esc(load7.hint)}</div>
      </section>

      <!-- 2. Investierte Zeit pro Fach (Lernen + Echte Anki-Zeit + opt. Live-Uni) -->
      <section class="card">
        <div class="card-header" style="flex-wrap:wrap;gap:8px;">
          <div>
            <h2 class="card-title">${icon('layers', 15)} Investierte Zeit pro Fach</h2>
            <div class="xs muted" style="margin-top:2px;">
              Gesamt: <strong class="mono">${fmtHours(totalSubjInvestMin)}</strong>
              · Lernen <span class="mono" style="color:var(--learn);">${fmtHours(totalSubjFocusMin)}</span>
              · Anki (echt) <span class="mono" style="color:var(--anki);">${fmtHours(totalSubjAnkiMin)}</span>
              ${includeUniInSubject ? ` · Live-Uni <span class="mono" style="color:var(--prod);">${fmtHours(totalSubjUniMin)}</span>` : ''}
            </div>
          </div>
          <div class="row" style="gap:6px;">
            <div class="segmented">
              <button type="button" data-subj-days="0" class="${subjectRangeDays === 0 ? 'active' : ''}">Gesamt</button>
              <button type="button" data-subj-days="30" class="${subjectRangeDays === 30 ? 'active' : ''}">30 T</button>
              <button type="button" data-subj-days="7" class="${subjectRangeDays === 7 ? 'active' : ''}">7 T</button>
            </div>
            <button type="button" class="btn btn-xs ${includeUniInSubject ? 'btn-primary' : ''}" id="btn-subj-uni" title="Besuchte Live-Vorlesungen & Übungen mit einrechnen">
              + Live-Uni
            </button>
          </div>
        </div>

        <div class="legend" style="margin-bottom:10px;">
          <span class="legend-item"><span class="legend-dot" style="background:var(--learn)"></span>Lernen (Videos / HA / Nacharbeit)</span>
          <span class="legend-item"><span class="legend-dot" style="background:var(--anki)"></span>Anki (echte Zeit pro Stapel)</span>
          ${includeUniInSubject ? `<span class="legend-item"><span class="legend-dot" style="background:var(--prod)"></span>Live-Vorlesung / Übung</span>` : ''}
        </div>

        ${!ankiRev.hasRevlog ? `
          <div class="xs muted" style="margin-bottom:10px;padding:7px 10px;border-radius:var(--radius-xs);background:var(--bg-soft);border:1px solid var(--border);">
            Tipp: Klicke am Laptop bei geöffnetem Anki einmal auf <strong>Sync</strong> — dann lädt StudyFlow automatisch deine echten Anki-Minuten pro Stapel (inkl. der letzten 6 Monate) in diese Übersicht.
          </div>
        ` : ''}

        ${subjectRows.length ? `
          <div class="entry-list">
            ${subjectRows.map((s) => {
              const focusW = maxSubjMin > 0 ? Math.min(100, (s.focusMin / maxSubjMin) * 100) : 0;
              const ankiW = maxSubjMin > 0 ? Math.min(100 - focusW, (s.ankiMin / maxSubjMin) * 100) : 0;
              const uniW = includeUniInSubject && maxSubjMin > 0 ? Math.min(100 - focusW - ankiW, ((s.uniMin || 0) / maxSubjMin) * 100) : 0;
              const sharePct = totalSubjInvestMin > 0 ? Math.round((s.investMin / totalSubjInvestMin) * 100) : 0;
              return `
                <div class="entry-row" style="flex-direction:column;align-items:stretch;gap:6px;">
                  <div class="row-between" style="gap:8px;flex-wrap:wrap;">
                    <div class="row" style="gap:6px;">
                      <strong class="small">${esc(s.subject)}</strong>
                      ${s.investMin > 0 ? `<span class="xs soft mono">${sharePct} %</span>` : ''}
                      <span class="pill both mono">${fmtMin(s.investMin)}</span>
                    </div>
                    <div class="row xs mono" style="gap:5px;">
                      ${s.focusMin > 0 ? `<span class="pill learn" title="Lernzeit ohne Anki">Lernen ${fmtMin(s.focusMin)}</span>` : ''}
                      ${s.ankiMin > 0 || s.ankiReviewedCards > 0 ? `<span class="pill anki" title="${s.ankiReviewedCards} Karten wiederholt${s.ankiAvgSec > 0 ? ` · Ø ${s.ankiAvgSec}s/Karte` : ''}">Anki ${fmtMin(s.ankiMin)}${s.ankiReviewedCards > 0 ? ` (${s.ankiReviewedCards})` : ''}</span>` : ''}
                      ${includeUniInSubject && s.uniMin > 0 ? `<span class="pill prod">Uni ${fmtMin(s.uniMin)}</span>` : ''}
                      ${s.openBacklog > 0 ? `<span class="pill prod">${s.openBacklog} offen</span>` : ''}
                      ${s.ankiTotal > 0 ? `<span class="pill" title="Aktuell fällige Anki-Karten (Blau·Rot·Grün)">${s.ankiNew}B·${s.ankiLearn}R·${s.ankiReview}G</span>` : ''}
                    </div>
                  </div>
                  <div class="progress-stack">
                    ${focusW > 0 ? `<div class="progress-seg" style="width:${focusW.toFixed(1)}%;background:var(--learn);"></div>` : ''}
                    ${ankiW > 0 ? `<div class="progress-seg" style="width:${ankiW.toFixed(1)}%;background:var(--anki);"></div>` : ''}
                    ${uniW > 0 ? `<div class="progress-seg" style="width:${uniW.toFixed(1)}%;background:var(--prod);"></div>` : ''}
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        ` : '<div class="xs muted">Importiere deinen KIT-Kalender (.ics) oder synchronisiere Anki, um deine investierte Zeit pro Fach zu sehen.</div>'}
      </section>

      <!-- 3. Verlauf (14 / 30 / 90 Tage) -->
      <section class="card">
        <div class="card-header">
          <h2 class="card-title">${icon('chart', 15)} Verlauf (${historyRange} Tage)</h2>
          <div class="segmented">
            <button data-hr="14" class="${historyRange === 14 ? 'active' : ''}">14 T</button>
            <button data-hr="30" class="${historyRange === 30 ? 'active' : ''}">30 T</button>
            <button data-hr="90" class="${historyRange === 90 ? 'active' : ''}">90 T</button>
          </div>
        </div>
        <div class="legend" style="margin-bottom:6px;">
          <span class="legend-item"><span class="legend-dot" style="background:var(--learn)"></span>Lernen (kräftig = Ziel erreicht)</span>
          <span class="legend-item"><span class="legend-dot" style="background:var(--anki)"></span>Anki</span>
          <span class="legend-item"><span class="legend-dot" style="background:var(--gold)"></span>Ziel (${fmtMin(goal)})</span>
        </div>
        <div class="chart-box">${renderHistoryBarsSVG(histRows, goal)}</div>
        <div class="chart-tooltip">Tippe auf einen Tag im Verlauf für den genauen Wert.</div>
      </section>

      <!-- 4. Anki-Sync-Verlauf (Blau / Rot / Grün + Gesamt pro Sync) & Echte Anki-Zeit -->
      <section class="card">
        <div class="card-header" style="flex-wrap:wrap;gap:8px;">
          <div>
            <h2 class="card-title">${icon('activity', 15)} Anki-Sync-Verlauf</h2>
            <div class="xs muted" style="margin-top:2px;">Jeder Sync erzeugt einen neuen Punkt · Blau (Neu), Rot (Lernen), Grün (Wiederholen) &amp; Gesamt</div>
          </div>
          <div class="row" style="gap:6px;">
            <div class="segmented">
              <button type="button" data-anki-gm="all" class="${ankiGraphMode === 'all' ? 'active' : ''}">Alle + Gesamt</button>
              <button type="button" data-anki-gm="brg" class="${ankiGraphMode === 'brg' ? 'active' : ''}">Nur B·R·G</button>
              <button type="button" data-anki-gm="total" class="${ankiGraphMode === 'total' ? 'active' : ''}">Nur Gesamt</button>
            </div>
            ${ankiRev.syncHistory.length > 30 ? `
              <div class="segmented">
                <button type="button" data-anki-lim="30" class="${ankiGraphLimit === 30 ? 'active' : ''}">30</button>
                <button type="button" data-anki-lim="0" class="${ankiGraphLimit === 0 ? 'active' : ''}">Alle</button>
              </div>
            ` : ''}
          </div>
        </div>

        <div class="grid-4" style="margin-bottom:12px;">
          <div class="kpi-box">
            <div class="kpi-label">Heute in Anki (echt)</div>
            <div class="kpi-val anki">${fmtMin(ankiRev.todayMin)}</div>
            <div class="xs muted">${ankiRev.todayCards} Karten</div>
          </div>
          <div class="kpi-box">
            <div class="kpi-label">Letzte 7 Tage</div>
            <div class="kpi-val anki">${fmtMin(ankiRev.weekMin)}</div>
            <div class="xs muted">${ankiRev.weekCards} Karten</div>
          </div>
          <div class="kpi-box">
            <div class="kpi-label">Anki-DB Gesamt</div>
            <div class="kpi-val">${fmtHours(ankiRev.totalMin)}</div>
            <div class="xs muted">${ankiRev.totalCards} Karten</div>
          </div>
          <div class="kpi-box">
            <div class="kpi-label">Echtes Tempo (30T)</div>
            <div class="kpi-val kit">${ankiRev.avgSecPerCard > 0 ? `Ø ${ankiRev.avgSecPerCard} s` : '–'}</div>
            <div class="xs muted">${hasRealPace ? `B:${ps.secNewReal || '–'}s · R:${ps.secLearnReal || '–'}s · G:${ps.secRevReal || '–'}s` : 'pro Karte'}</div>
          </div>
        </div>

        ${hasRealPace ? `
          <div class="row-between" style="margin-bottom:10px;padding:6px 10px;border-radius:var(--radius-xs);background:var(--bg-soft);border:1px solid var(--border);gap:8px;flex-wrap:wrap;">
            <span class="xs muted">Gemessene Antwortdauer (30T): <strong>Blau ${ps.secNewReal || store.state.anki.secNew}s</strong> · <strong>Rot ${ps.secLearnReal || store.state.anki.secLearn}s</strong> · <strong>Grün ${ps.secRevReal || store.state.anki.secReview}s</strong> (aktuell eingestellt: ${store.state.anki.secNew}/${store.state.anki.secLearn}/${store.state.anki.secReview}s)</span>
            <button type="button" class="btn btn-xs" id="btn-apply-anki-pace">Als Schätzgewicht übernehmen</button>
          </div>
        ` : ''}

        ${shownAnkiSyncs.length ? `
          <div class="legend" style="margin-bottom:6px;">
            ${ankiGraphMode !== 'brg' ? `<span class="legend-item"><span class="legend-dot" style="background:var(--anki)"></span>Gesamt fällig</span>` : ''}
            ${ankiGraphMode !== 'total' ? `
              <span class="legend-item"><span class="legend-dot" style="background:var(--learn)"></span>Blau (Neu)</span>
              <span class="legend-item"><span class="legend-dot" style="background:var(--danger)"></span>Rot (Lernen)</span>
              <span class="legend-item"><span class="legend-dot" style="background:var(--kit)"></span>Grün (Wiederholen)</span>
            ` : ''}
            <span class="xs soft">(${shownAnkiSyncs.length} ${shownAnkiSyncs.length === 1 ? 'Sync-Punkt' : 'Sync-Punkte'})</span>
          </div>
          <div class="chart-box">${renderAnkiSyncChartSVG(shownAnkiSyncs, { mode: ankiGraphMode })}</div>
          <div class="chart-tooltip">Tippe oder fahre über einen Sync-Punkt für Datum, Uhrzeit, Differenz &amp; B/R/G-Werte.</div>
        ` : `
          <div class="small muted">Noch keine Sync-Punkte aufgezeichnet. Sobald du auf „Heute“ deinen ersten Anki-Sync startest, erscheint hier automatisch jeder Sync als neuer Datenpunkt.</div>
        `}
      </section>

      <!-- 5. Detail-Analysen & Langzeit-Rekorde (kompakt einklappbar) -->
      <section class="card">
        <details>
          <summary class="card-title" style="cursor:pointer;display:flex;align-items:center;justify-content:space-between;">
            <span>${icon('clock', 15)} Anteil an der Wachzeit</span>
            <span class="xs muted mono">Lern-Quote ${st.wakeStats.learnQuote.toFixed(1)} % · inkl. VL ${st.wakeStats.bothQuote.toFixed(1)} %</span>
          </summary>
          <div style="margin-top:12px;">
            <div class="grid-4" style="margin-bottom:12px;">
              <div class="kpi-box"><div class="kpi-label">Lern-Quote</div><div class="kpi-val learn">${st.wakeStats.learnQuote.toFixed(1)} %</div></div>
              <div class="kpi-box"><div class="kpi-label">Zusammen (inkl. VL)</div><div class="kpi-val both">${st.wakeStats.bothQuote.toFixed(1)} %</div></div>
              <div class="kpi-box"><div class="kpi-label">Wachzeit gesamt</div><div class="kpi-val">${fmtHours(st.wakeStats.wakeTotalMin)}</div></div>
              <div class="kpi-box"><div class="kpi-label">Ø Wachzeit / Tag</div><div class="kpi-val">${fmtMin(st.wakeStats.avgWakeMin)}</div></div>
              <div class="kpi-box"><div class="kpi-label">Lernzeit inkl. Anki</div><div class="kpi-val learn">${fmtHours(st.wakeStats.wakeLearnMin)}</div></div>
              <div class="kpi-box"><div class="kpi-label">Davon Anki</div><div class="kpi-val anki">${fmtHours(st.wakeStats.wakeAnkiMin)}</div></div>
              <div class="kpi-box"><div class="kpi-label">Vorlesung / Prod.</div><div class="kpi-val prod">${fmtHours(st.wakeStats.wakeProdMin)}</div></div>
              <div class="kpi-box"><div class="kpi-label">VL-Blöcke (à 90 min)</div><div class="kpi-val prod">~${lectureUnits}</div></div>
            </div>
            ${wakeRows.length ? `
              <div class="legend" style="margin-bottom:6px;">
                <span class="legend-item"><span class="legend-dot" style="background:var(--learn)"></span>Lernen</span>
                <span class="legend-item"><span class="legend-dot" style="background:var(--anki)"></span>Anki</span>
                <span class="legend-item"><span class="legend-dot" style="background:var(--prod)"></span>Vorlesung / Prod.</span>
                <span class="xs soft">(Neuester Tag zuerst)</span>
              </div>
              <div class="chart-box">${renderWakeRatioBarsSVG(wakeRows)}</div>
              <div class="chart-tooltip">Tippe oder fahre über einen Balken für Datum, Wachzeit und genaue Prozentwerte.</div>
            ` : '<div class="small muted">Noch keine Tage mit Aufwachzeit vorhanden.</div>'}
          </div>
        </details>
      </section>

      <section class="card">
        <details>
          <summary class="card-title" style="cursor:pointer;display:flex;align-items:center;justify-content:space-between;">
            <span>${icon('award', 15)} Allzeit-Kennzahlen, Rekorde &amp; Aktivitäts-Heatmap</span>
            <span class="xs muted mono">${st.activeLearnDays} aktive Tage · Rekord ${fmtMin(st.recordDay.min)}</span>
          </summary>
          <div class="stack" style="margin-top:12px;">
            <div class="grid-4">
              <div class="kpi-box"><div class="kpi-label">Lernen gesamt</div><div class="kpi-val learn">${fmtHours(st.totalLearn)}</div></div>
              <div class="kpi-box"><div class="kpi-label">Aktive Tage</div><div class="kpi-val">${st.activeLearnDays}</div></div>
              <div class="kpi-box"><div class="kpi-label">Median</div><div class="kpi-val">${fmtMin(st.median)}</div></div>
              <div class="kpi-box"><div class="kpi-label">Rekordtag</div><div class="kpi-val gold">${fmtMin(st.recordDay.min)}${st.recordDay.d ? ` <span class="xs muted">(${fmtDateShort(st.recordDay.d)})</span>` : ''}</div></div>
              <div class="kpi-box"><div class="kpi-label">Ø letzte 30 Tage</div><div class="kpi-val">${fmtMin(st.avg30)}</div></div>
              <div class="kpi-box"><div class="kpi-label">Dieser Monat</div><div class="kpi-val">${fmtHours(st.thisMonth)}</div></div>
              <div class="kpi-box"><div class="kpi-label">Anki gesamt</div><div class="kpi-val anki">${fmtMin(st.totalAnki)}</div></div>
              <div class="kpi-box"><div class="kpi-label">Checkliste</div><div class="kpi-val">${totalChk > 0 ? `${doneChk}/${totalChk}` : '–'}</div></div>
            </div>

            <div class="grid-3">
              <div class="kpi-box">
                <div class="kpi-label">Stärkste Woche</div>
                <div class="kpi-val gold">${fmtMin(rec.bestWeek.min)}${rec.bestWeek.mon ? ` <span class="xs muted">(ab ${fmtDateShort(rec.bestWeek.mon)})</span>` : ''}</div>
                <div class="xs muted">${rec.isCurrentBestWeek ? 'Aktuell auf Wochenrekord!' : rec.bestWeek.min > 0 ? `Noch ${fmtMin(rec.toBeatWeekMin)} für neuen Rekord` : '–'}</div>
              </div>
              <div class="kpi-box">
                <div class="kpi-label">Höchste Wachzeit-Quote</div>
                <div class="kpi-val learn">${rec.bestQuote.pct.toFixed(1)} %${rec.bestQuote.d ? ` <span class="xs muted">(${fmtDateShort(rec.bestQuote.d)})</span>` : ''}</div>
                <div class="xs muted">${rec.bestQuote.d ? `${fmtMin(rec.bestQuote.learnMin)} von ${fmtMin(rec.bestQuote.awakeMin)} Wachzeit` : '–'}</div>
              </div>
              <div class="kpi-box">
                <div class="kpi-label">Stärkster Monat</div>
                <div class="kpi-val kit">${fmtHours(rec.bestMonth.min)}${rec.bestMonth.ym ? ` <span class="xs muted">(${rec.bestMonth.ym})</span>` : ''}</div>
                <div class="xs muted">Meilenstein ${rec.nextMilestoneH} h: ${rec.milestonePct.toFixed(0)} %</div>
              </div>
            </div>

            <div>
              <div class="row-between xs" style="margin-bottom:5px;">
                <span class="muted">Nächster Meilenstein: <strong>${rec.nextMilestoneH} Stunden</strong></span>
                <span class="mono">Noch ${fmtMin(rec.remainingMin)} (${rec.milestonePct.toFixed(0)} %)</span>
              </div>
              <div class="progress-track">
                <div class="progress-fill green" style="width:${rec.milestonePct.toFixed(1)}%;"></div>
              </div>
            </div>

            <div>
              <div class="row-between xs soft" style="margin-bottom:6px;">
                <span>Aktivität (20 Wochen)</span>
                <span>Intensität relativ zum Tagesziel</span>
              </div>
              <div class="heatmap-wrap chart-box">${renderHeatmap20WeeksSVG(heatCells, goal)}</div>
              <div class="chart-tooltip">Tippe auf ein Feld der Heatmap für Datum &amp; Lernzeit.</div>
            </div>
          </div>
        </details>
      </section>

      <section class="card">
        <details>
          <summary class="card-title" style="cursor:pointer;display:flex;align-items:center;justify-content:space-between;">
            <span>${icon('spark', 15)} Lern-Muster, Wochentage &amp; KI-Kalibrierung (P75)</span>
            <span class="xs muted mono">${calibration.byModule.length} kalibrierte Fächer</span>
          </summary>
          <div class="stack" style="margin-top:12px;">
            <div class="grid-${hasCaffeineData ? '3' : '2'}" style="gap:10px;">
              <div class="kpi-box">
                <div class="kpi-label">Kapazität nach Uni-Last (Lernzeit / Tag)</div>
                <div class="grid-3" style="margin-top:6px;">
                  <div>
                    <div class="xs soft">Freie Tage (${patterns.capacityByUniLoad.freeDaysCount})</div>
                    <div class="mono" style="font-weight:700;color:var(--kit);">${patterns.capacityByUniLoad.freeDaysCount ? fmtMin(patterns.capacityByUniLoad.freeDaysAvgMin) : '–'}</div>
                  </div>
                  <div>
                    <div class="xs soft">1–2 VL (${patterns.capacityByUniLoad.mediumUniCount})</div>
                    <div class="mono" style="font-weight:700;color:var(--learn);">${patterns.capacityByUniLoad.mediumUniCount ? fmtMin(patterns.capacityByUniLoad.mediumUniAvgMin) : '–'}</div>
                  </div>
                  <div>
                    <div class="xs soft">3+ VL (${patterns.capacityByUniLoad.heavyUniCount})</div>
                    <div class="mono" style="font-weight:700;color:var(--prod);">${patterns.capacityByUniLoad.heavyUniCount ? fmtMin(patterns.capacityByUniLoad.heavyUniAvgMin) : '–'}</div>
                  </div>
                </div>
              </div>

              <div class="kpi-box">
                <div class="kpi-label">Früh (&lt; 09:30) vs. Spät (&ge; 09:30) aufwachen</div>
                ${patterns.wakeCompare.ready ? `
                  <div class="stack" style="gap:4px;margin-top:6px;">
                    <div class="small"><strong>Früh (${patterns.wakeCompare.earlyCount}T):</strong> ${fmtMin(patterns.wakeCompare.earlyAvgMin)} <span class="xs muted">(${patterns.wakeCompare.earlyAvgQuote} %)</span></div>
                    <div class="small"><strong>Spät (${patterns.wakeCompare.lateCount}T):</strong> ${fmtMin(patterns.wakeCompare.lateAvgMin)} <span class="xs muted">(${patterns.wakeCompare.lateAvgQuote} %)</span></div>
                  </div>
                ` : `<div class="xs muted" style="margin-top:4px;">Benötigt mind. je 2 Tage früh (&lt; 09:30) und spät (&ge; 09:30).</div>`}
              </div>

              ${hasCaffeineData ? `
                <div class="kpi-box">
                  <div class="kpi-label">Spätes Koffein (&ge; 15:00) vs. Aufwachzeit</div>
                  ${patterns.lateCaffeineWake.ready ? `
                    <div class="stack" style="gap:4px;margin-top:6px;">
                      <div class="small"><strong>Mit (&ge;15h, ${patterns.lateCaffeineWake.withCount}T):</strong> Ø ${patterns.lateCaffeineWake.withAvgWake}</div>
                      <div class="small"><strong>Ohne (${patterns.lateCaffeineWake.withoutCount}T):</strong> Ø ${patterns.lateCaffeineWake.withoutAvgWake}</div>
                    </div>
                  ` : `<div class="xs muted" style="margin-top:4px;">Benötigt mind. je 2 Tage mit und ohne Koffein ab 15:00 Uhr.</div>`}
                </div>
              ` : ''}
            </div>

            <div class="grid-2">
              <div>
                <div class="xs soft" style="margin-bottom:6px;">Durchschnitt pro Wochentag (inkl. Tagen ohne Lernzeit)</div>
                <div class="chart-box">${renderSimpleBarsSVG(weekdayItems, { valueFormatter: (v) => fmtMin(v), color: 'var(--kit)' })}</div>
                <div class="chart-tooltip">Tippe auf einen Wochentag.</div>
              </div>

              <div>
                <div class="xs soft" style="margin-bottom:6px;">Echte Dauer pro Fach (P75 für KI-Planung)</div>
                ${calibration.byModule.length ? `
                  <div class="entry-list" style="margin-bottom:8px;">
                    ${calibration.byModule.map((c) => `
                      <div class="entry-row" style="padding:7px 10px;">
                        <div>
                          <div class="small" style="font-weight:600;">${esc(c.fach)}${actMap[c.taetigkeit] ? ` · ${actMap[c.taetigkeit]}` : ''}</div>
                          <div class="xs soft">${c.anzahl} ${c.anzahl === 1 ? 'Session' : 'Sessions'} · Regel: ${c.regelMin} min</div>
                        </div>
                        <span class="pill ${c.suggestAdjust ? 'prod' : 'kit'} mono" title="Oberes Ende (P75 gegen Zeitdruck) · reiner Ø: ${c.echterSchnittMin} min">P75 ${c.p75Min} min</span>
                      </div>
                    `).join('')}
                  </div>
                ` : '<div class="xs muted" style="margin-bottom:8px;">Wähle beim Eintragen optional Fach + Tätigkeit, dann kalibriert die App deine echten Zeiten für Gemini.</div>'}
                ${calibration.recentSessions.length ? `
                  <details>
                    <summary class="xs muted" style="cursor:pointer;">Letzte protokollierte Themen (${calibration.recentSessions.length})</summary>
                    <div class="entry-list" style="margin-top:8px;">
                      ${calibration.recentSessions.slice(0, 8).map((s) => `
                        <div class="entry-row" style="padding:6px 9px;">
                          <span class="xs"><strong>${fmtDateShort(s.d)}</strong>${s.fach ? ` · ${esc(s.fach)}` : ''}${s.was ? ` – ${esc(s.was)}` : ''}</span>
                          <span class="xs mono muted">${s.dauerMin} min</span>
                        </div>
                      `).join('')}
                    </div>
                  </details>
                ` : ''}
              </div>
            </div>
          </div>
        </details>
      </section>

      ${hasCaffeineData ? `
        <section class="card">
          <details>
            <summary class="card-title" style="cursor:pointer;display:flex;align-items:center;justify-content:space-between;">
              <span>${icon('coffee', 15)} Koffein-Statistik</span>
              <span class="xs muted mono">${st.cafStats.cafDayCount} Tage · 7T: ${load7.caf7Mg} mg</span>
            </summary>
            <div style="margin-top:12px;">
              <div class="grid-3" style="margin-bottom:12px;">
                <div class="kpi-box"><div class="kpi-label">Ø an Koffein-Tagen</div><div class="kpi-val caf">${Math.round(st.cafStats.cafAvgOnDays)} mg</div></div>
                <div class="kpi-box"><div class="kpi-label">Höchsttag</div><div class="kpi-val">${st.cafStats.cafMaxDay.mg} mg${st.cafStats.cafMaxDay.d ? ` <span class="xs muted">(${fmtDateShort(st.cafStats.cafMaxDay.d)})</span>` : ''}</div></div>
                <div class="kpi-box"><div class="kpi-label">Koffein 7T</div><div class="kpi-val caf">${load7.caf7Mg} mg</div></div>
              </div>
              <div class="chart-box">${renderCaffeine14dSVG(caf14, store.state.cl || 400)}</div>
              <div class="chart-tooltip">14-Tage Koffeinverlauf (Limit ${store.state.cl || 400} mg).</div>

              <div class="kpi-box" style="margin-top:12px;">
                <div class="kpi-label">Lernzeit: Tage mit vs. ohne Koffein</div>
                ${canCompareCaf ? `
                  <div class="row-between" style="margin-top:6px;">
                    <div><strong>Mit Koffein (${st.cafStats.withCafCount} T):</strong> ${fmtMin(st.cafStats.withCafAvg)} / Tag</div>
                    <div><strong>Ohne Koffein (${st.cafStats.withoutCafCount} T):</strong> ${fmtMin(st.cafStats.withoutCafAvg)} / Tag</div>
                  </div>
                  <div class="xs soft" style="margin-top:5px;">Zeigt nur einen Zusammenhang, keine Ursache.</div>
                ` : `
                  <div class="small muted" style="margin-top:4px;">Mindestens je 2 Tage mit und ohne Koffein benötigt.</div>
                `}
              </div>
            </div>
          </details>
        </section>
      ` : ''}
    </div>
  `;

  root.querySelector('#btn-copy-report')?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(store.buildMarkdownStudyReport(today));
      if (toast) toast('Studienbericht (Markdown) kopiert.', 'ok');
    } catch {
      if (toast) toast('Kopieren fehlgeschlagen.', 'err');
    }
  });

  root.querySelectorAll('[data-hr]').forEach((btn) => {
    btn.addEventListener('click', () => {
      historyRange = Number(btn.getAttribute('data-hr'));
      renderStatsView(root, { toast });
    });
  });

  root.querySelectorAll('[data-subj-days]').forEach((btn) => {
    btn.addEventListener('click', () => {
      subjectRangeDays = Number(btn.getAttribute('data-subj-days')) || 0;
      renderStatsView(root, { toast });
    });
  });

  root.querySelector('#btn-subj-uni')?.addEventListener('click', () => {
    includeUniInSubject = !includeUniInSubject;
    renderStatsView(root, { toast });
  });

  root.querySelectorAll('[data-anki-gm]').forEach((btn) => {
    btn.addEventListener('click', () => {
      ankiGraphMode = btn.getAttribute('data-anki-gm') || 'all';
      renderStatsView(root, { toast });
    });
  });

  root.querySelectorAll('[data-anki-lim]').forEach((btn) => {
    btn.addEventListener('click', () => {
      ankiGraphLimit = Number(btn.getAttribute('data-anki-lim')) || 0;
      renderStatsView(root, { toast });
    });
  });

  root.querySelector('#btn-apply-anki-pace')?.addEventListener('click', () => {
    if (!ps) return;
    if (ps.secNewReal >= 5) store.state.anki.secNew = ps.secNewReal;
    if (ps.secLearnReal >= 5) store.state.anki.secLearn = ps.secLearnReal;
    if (ps.secRevReal >= 5) store.state.anki.secReview = ps.secRevReal;
    store.state.anki.updatedAt = Date.now();
    store.save();
    if (toast) toast('Echte Anki-Antwortzeiten als Schätzgewicht übernommen.', 'ok');
    renderStatsView(root, { toast });
  });

  bindChartTooltips(root);
}

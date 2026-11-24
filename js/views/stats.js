// Tab 4: "Statistik" – Minimalist Monochrome Analytics + Vorlesung/Produktiv Breakdown

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
  bindChartTooltips
} from '../charts.js';
import { icon } from '../icons.js';

let historyRange = 14;

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

  const caf14 = [];
  for (let i = 13; i >= 0; i--) {
    const d = addDays(today, -i);
    caf14.push({ d, mg: st.cafStats.cafByDay[d] || 0 });
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

  const hourItems = st.hourCounts.map((cnt, h) => ({
    label: `${h}`,
    value: cnt,
    tip: `${String(h).padStart(2, '0')}:00–${String(h).padStart(2, '0')}:59 Uhr · ${cnt} Einträge`
  }));

  // Count total lecture equivalents (90 min units) & checklist completion rate
  const lectureUnits = (st.totalProd / 90).toFixed(1);
  const totalChk = (store.state.checklist || []).length;
  const doneChk = (store.state.checklist || []).filter((c) => c.done).length;
  const canCompareCaf = st.cafStats.withCafCount >= 2 && st.cafStats.withoutCafCount >= 2;
  const calibration = store.getCalibrationSummary();
  const load7 = store.getLoadSummary7d(today);
  const subjectBalance = store.getSubjectBalance();
  const maxSubjMin = Math.max(60, ...subjectBalance.map((s) => s.learnMin));
  const patterns = store.getPersonalPatterns(today);
  const actMap = { video: 'Video', review: 'Nacharbeit', homework: 'HA', anki: 'Anki', exam: 'Klausur' };

  root.innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="page-title">Statistik</h1>
        <div class="small muted">Lernzeit, Anki, Vorlesungszeit, Wachzeit-Quote & Koffein</div>
      </div>
      <div class="row">
        <button class="btn btn-sm" id="btn-copy-report">${icon('copy', 14)} Studienbericht (MD)</button>
      </div>
    </div>

    <div class="stack">
      <!-- 1. Lernzeit & Vorlesungen an der Wachzeit -->
      <section class="card">
        <div class="card-header">
          <h2 class="card-title">${icon('clock', 15)} Anteil an der Wachzeit</h2>
          <span class="pill kit">${st.wakeStats.dayCount} ${st.wakeStats.dayCount === 1 ? 'Tag' : 'Tage'} mit Aufwachzeit</span>
        </div>
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
      </section>

      <!-- 2. Kennzahlen -->
      <section class="card">
        <div class="card-header">
          <h2 class="card-title">${icon('chart', 15)} Kennzahlen</h2>
          ${totalChk > 0 ? `<span class="pill">Checkliste: ${doneChk}/${totalChk} erledigt</span>` : ''}
        </div>
        <div class="grid-4">
          <div class="kpi-box"><div class="kpi-label">Lernen gesamt</div><div class="kpi-val learn">${fmtHours(st.totalLearn)}</div></div>
          <div class="kpi-box"><div class="kpi-label">Aktive Tage</div><div class="kpi-val">${st.activeLearnDays}</div></div>
          <div class="kpi-box"><div class="kpi-label">Durchschnitt (aktiv)</div><div class="kpi-val">${fmtMin(st.avgActive)}</div></div>
          <div class="kpi-box"><div class="kpi-label">Median</div><div class="kpi-val">${fmtMin(st.median)}</div></div>
          <div class="kpi-box"><div class="kpi-label">Rekordtag</div><div class="kpi-val gold">${fmtMin(st.recordDay.min)}${st.recordDay.d ? ` <span class="xs muted">(${fmtDateShort(st.recordDay.d)})</span>` : ''}</div></div>
          <div class="kpi-box"><div class="kpi-label">Längste Serie</div><div class="kpi-val gold">${st.streaks.longest} Tage</div></div>
          <div class="kpi-box"><div class="kpi-label">Zielquote</div><div class="kpi-val kit">${st.goalRate.toFixed(0)} %</div></div>
          <div class="kpi-box"><div class="kpi-label">Diese Woche</div><div class="kpi-val">${fmtMin(st.thisWeek)}</div></div>
          <div class="kpi-box"><div class="kpi-label">Ø letzte 30 Tage</div><div class="kpi-val">${fmtMin(st.avg30)}</div></div>
          <div class="kpi-box"><div class="kpi-label">Dieser Monat</div><div class="kpi-val">${fmtHours(st.thisMonth)}</div></div>
          <div class="kpi-box"><div class="kpi-label">Anki gesamt</div><div class="kpi-val anki">${fmtMin(st.totalAnki)}</div></div>
          <div class="kpi-box"><div class="kpi-label">Vorlesung gesamt</div><div class="kpi-val prod">${fmtHours(st.totalProd)}</div></div>
        </div>
      </section>

      <!-- 2a. Rekorde & Nächster Meilenstein (#3) -->
      <section class="card">
        <div class="card-header">
          <h2 class="card-title">${icon('award', 15)} Rekorde & Nächster Meilenstein</h2>
          <span class="pill gold">Ziel: ${rec.nextMilestoneH} h</span>
        </div>
        <div class="grid-3" style="margin-bottom:12px;">
          <div class="kpi-box">
            <div class="kpi-label">Stärkste Woche</div>
            <div class="kpi-val gold">${fmtMin(rec.bestWeek.min)}${rec.bestWeek.mon ? ` <span class="xs muted">(ab ${fmtDateShort(rec.bestWeek.mon)})</span>` : ''}</div>
            <div class="xs muted">${rec.isCurrentBestWeek ? 'Aktuell auf Wochenrekord!' : rec.bestWeek.min > 0 ? `Noch ${fmtMin(rec.toBeatWeekMin)} diese Woche für neuen Rekord` : '–'}</div>
          </div>
          <div class="kpi-box">
            <div class="kpi-label">Höchste Wachzeit-Quote</div>
            <div class="kpi-val learn">${rec.bestQuote.pct.toFixed(1)} %${rec.bestQuote.d ? ` <span class="xs muted">(${fmtDateShort(rec.bestQuote.d)})</span>` : ''}</div>
            <div class="xs muted">${rec.bestQuote.d ? `${fmtMin(rec.bestQuote.learnMin)} von ${fmtMin(rec.bestQuote.awakeMin)} Wachzeit` : '–'}</div>
          </div>
          <div class="kpi-box">
            <div class="kpi-label">Stärkster Monat</div>
            <div class="kpi-val kit">${fmtHours(rec.bestMonth.min)}${rec.bestMonth.ym ? ` <span class="xs muted">(${rec.bestMonth.ym})</span>` : ''}</div>
            <div class="xs muted">Gesamt: ${fmtHours(st.totalLearn)}</div>
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
      </section>

      <!-- 2b. Fach-Balance-Board (#3) & Persönliche Lern-Muster (#7) -->
      <div class="grid-2">
        <section class="card">
          <div class="card-header">
            <h2 class="card-title">${icon('layers', 15)} Fach-Balance-Board</h2>
            <span class="xs soft">Wird an Gemini übergeben</span>
          </div>
          ${subjectBalance.length ? `
            <div class="entry-list">
              ${subjectBalance.map((s) => {
                const barW = Math.min(100, Math.round((s.learnMin / maxSubjMin) * 100));
                return `
                  <div class="entry-row" style="flex-direction:column;align-items:stretch;gap:6px;">
                    <div class="row-between">
                      <strong class="small">${esc(s.subject)}</strong>
                      <div class="row xs mono" style="gap:6px;">
                        <span class="pill learn">${fmtMin(s.learnMin)}</span>
                        ${s.openBacklog > 0 ? `<span class="pill prod">${s.openBacklog} offen</span>` : '<span class="pill kit">0 offen</span>'}
                        ${s.chkTotal > 0 ? `<span class="pill">${s.chkDone}/${s.chkTotal}</span>` : ''}
                        ${s.ankiTotal > 0 ? `<span class="pill anki">${s.ankiNew}B·${s.ankiLearn}R·${s.ankiReview}G</span>` : ''}
                      </div>
                    </div>
                    <div class="progress-track" style="height:4px;">
                      <div class="progress-fill" style="width:${barW}%;background:var(--learn);"></div>
                    </div>
                  </div>
                `;
              }).join('')}
            </div>
          ` : '<div class="xs muted">Importiere deinen KIT-Kalender (.ics) oder lege Fächer unter Wochenplan an, um deine Fach-Balance zu sehen.</div>'}
        </section>

        <section class="card">
          <div class="card-header">
            <h2 class="card-title">${icon('spark', 15)} Persönliche Lern-Muster</h2>
            <span class="xs soft">Aus deinen echten Daten</span>
          </div>
          <div class="stack" style="gap:10px;">
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
                <div class="row-between" style="margin-top:6px;">
                  <div class="small"><strong>Früh (${patterns.wakeCompare.earlyCount}T):</strong> ${fmtMin(patterns.wakeCompare.earlyAvgMin)} <span class="xs muted">(${patterns.wakeCompare.earlyAvgQuote} %)</span></div>
                  <div class="small"><strong>Spät (${patterns.wakeCompare.lateCount}T):</strong> ${fmtMin(patterns.wakeCompare.lateAvgMin)} <span class="xs muted">(${patterns.wakeCompare.lateAvgQuote} %)</span></div>
                </div>
              ` : `<div class="xs muted" style="margin-top:4px;">Benötigt mind. je 2 Tage früh (&lt; 09:30) und spät (&ge; 09:30).</div>`}
            </div>

            <div class="kpi-box">
              <div class="kpi-label">Spätes Koffein (&ge; 15:00) vs. Aufwachzeit nächster Tag</div>
              ${patterns.lateCaffeineWake.ready ? `
                <div class="row-between" style="margin-top:6px;">
                  <div class="small"><strong>Nach spätem Koffein (${patterns.lateCaffeineWake.withCount}T):</strong> Ø ${patterns.lateCaffeineWake.withAvgWake}</div>
                  <div class="small"><strong>Ohne (${patterns.lateCaffeineWake.withoutCount}T):</strong> Ø ${patterns.lateCaffeineWake.withoutAvgWake}</div>
                </div>
              ` : `<div class="xs muted" style="margin-top:4px;">Benötigt mind. je 2 Tage mit und ohne Koffein ab 15:00 Uhr.</div>`}
            </div>
            <div class="xs soft">Hinweis: Zeigt statistische Zusammenhänge aus deinen Daten, keine Ursache.</div>
          </div>
        </section>
      </div>

      <!-- 3. Verlauf -->
      <section class="card">
        <div class="card-header">
          <h2 class="card-title">${icon('activity', 15)} Verlauf (${historyRange} Tage)</h2>
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

      <!-- 4. Aktivitäts-Heatmap -->
      <section class="card">
        <div class="card-header">
          <h2 class="card-title">${icon('calendar', 15)} Aktivität (20 Wochen)</h2>
          <span class="xs soft">Intensität relativ zum Tagesziel</span>
        </div>
        <div class="heatmap-wrap chart-box">${renderHeatmap20WeeksSVG(heatCells, goal)}</div>
        <div class="chart-tooltip">Tippe auf ein Feld der Heatmap für Datum & Lernzeit.</div>
      </section>

      <!-- 5. Koffein -->
      <section class="card">
        <div class="card-header">
          <h2 class="card-title">${icon('coffee', 15)} Koffein-Statistik</h2>
          <span class="pill caf">${st.cafStats.cafDayCount} Tage mit Koffein</span>
        </div>
        <div class="grid-3" style="margin-bottom:12px;">
          <div class="kpi-box"><div class="kpi-label">Ø an Koffein-Tagen</div><div class="kpi-val caf">${Math.round(st.cafStats.cafAvgOnDays)} mg</div></div>
          <div class="kpi-box"><div class="kpi-label">Höchsttag</div><div class="kpi-val">${st.cafStats.cafMaxDay.mg} mg${st.cafStats.cafMaxDay.d ? ` <span class="xs muted">(${fmtDateShort(st.cafStats.cafMaxDay.d)})</span>` : ''}</div></div>
          <div class="kpi-box"><div class="kpi-label">Tage mit Koffein</div><div class="kpi-val">${st.cafStats.cafDayCount}</div></div>
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
      </section>

      <!-- 6. Wochentage & Eintrags-Uhrzeiten -->
      <div class="grid-2">
        <section class="card">
          <div class="card-header"><h2 class="card-title">${icon('calendar', 15)} Durchschnitt pro Wochentag</h2></div>
          <div class="xs soft" style="margin-bottom:6px;">Inklusive Tagen ohne Lernzeit.</div>
          <div class="chart-box">${renderSimpleBarsSVG(weekdayItems, { valueFormatter: (v) => fmtMin(v), color: 'var(--kit)' })}</div>
          <div class="chart-tooltip">Tippe auf einen Wochentag.</div>
        </section>

        <section class="card">
          <div class="card-header"><h2 class="card-title">${icon('clock', 15)} Wann du einträgst</h2></div>
          <div class="xs soft" style="margin-bottom:6px;">Verteilung über 0–23 Uhr.</div>
          <div class="chart-box">${renderSimpleBarsSVG(hourItems, { valueFormatter: (v) => `${v}x`, color: 'var(--purple)' })}</div>
          <div class="chart-tooltip">${st.peakHour >= 0 ? `Häufigste Uhrzeit: ${String(st.peakHour).padStart(2, '0')}:00 Uhr` : 'Noch keine Einträge.'}</div>
        </section>
      </div>

      <!-- 7. Realitäts-Kalibrierung (#8) & dezenter 7-Tage-Last-Indikator (#6) -->
      <div class="grid-2">
        <section class="card">
          <div class="card-header"><h2 class="card-title">${icon('sliders', 15)} Echte Dauer pro Fach (für KI)</h2></div>
          ${calibration.byModule.length ? `
            <div class="entry-list" style="margin-bottom:10px;">
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
          ` : '<div class="xs muted" style="margin-bottom:10px;">Wähle beim Eintragen optional Fach + Tätigkeit, dann kalibriert die App deine echten Zeiten für Gemini.</div>'}
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
        </section>

        <section class="card">
          <div class="card-header">
            <h2 class="card-title">${icon('activity', 15)} 7-Tage-Belastung</h2>
            <span class="pill ${load7.level === 'hoch' ? 'prod' : load7.level === 'solide' ? 'learn' : 'kit'}">${load7.label}</span>
          </div>
          <div class="grid-3" style="margin-bottom:8px;">
            <div class="kpi-box"><div class="kpi-label">Uni + Lernen</div><div class="kpi-val">${load7.total7Hours.toFixed(1)} h</div></div>
            <div class="kpi-box"><div class="kpi-label">Tage am Stück</div><div class="kpi-val">${load7.consecutiveDays}</div></div>
            <div class="kpi-box"><div class="kpi-label">Koffein 7T</div><div class="kpi-val caf">${load7.caf7Mg} mg</div></div>
          </div>
          <div class="xs muted">${esc(load7.hint)}</div>
        </section>
      </div>
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

  bindChartTooltips(root);
}

// Pure SVG interactive chart components (zero external dependencies, works 100% offline)

import { fmtMin, fmtDateShort, minToTime, toDateStr, toTimeStr, timeToMin, escapeHtml } from './store.js';

export function renderDayTimelineSVG({ span, lectures = [], entries = [], caffeine = [] }) {
  if (!span) return '';
  const W = 520, H = 68;
  const padL = 8, padR = 8;
  const barX = padL, barW = W - padL - padR;
  const barY = 20, barH = 20;
  const startM = span.wakeMin;
  const endM = Math.max(startM + 60, span.sleepMin);
  const dur = endM - startM;
  const xOf = (m) => barX + Math.max(0, Math.min(1, (m - startM) / dur)) * barW;
  const normMin = (tStr) => {
    let m = timeToMin(tStr);
    if (endM > 1440 && m < startM) m += 1440;
    return m;
  };

  const nowX = xOf(span.nowMin);
  const elapsedW = Math.max(0, nowX - barX);

  const lecRects = lectures
    .filter((l) => !l.cancelled && (l.attended || l.mode === 'live'))
    .map((l) => {
      const s = normMin(l.start);
      const e = normMin(l.end);
      const x1 = xOf(s);
      const x2 = xOf(e);
      if (x2 <= x1) return '';
      return `<rect x="${x1.toFixed(1)}" y="${barY}" width="${Math.max(2, x2 - x1).toFixed(1)}" height="${barH}" rx="3" fill="var(--prod)" opacity="0.72"><title>${escapeHtml(l.shortName)} (${escapeHtml(l.start)}–${escapeHtml(l.end)})</title></rect>`;
    })
    .join('');

  const studyRects = entries
    .filter((x) => x.k === 'l' || x.k === 'a')
    .map((x) => {
      const endMin = normMin(x.t || '12:00');
      const blockLen = Math.max(10, Math.min(240, Number(x.blockMin || x.m || 30)));
      const s = Math.max(startM, endMin - blockLen);
      const x1 = xOf(s);
      const x2 = xOf(endMin);
      if (x2 <= x1) return '';
      const color = x.k === 'a' ? 'var(--anki)' : 'var(--learn)';
      return `<rect x="${x1.toFixed(1)}" y="${barY + 3}" width="${Math.max(3, x2 - x1).toFixed(1)}" height="${barH - 6}" rx="2.5" fill="${color}" opacity="0.92"><title>${x.k === 'a' ? 'Anki' : 'Lernen'} · ${blockLen} min (${escapeHtml(x.t || '')})</title></rect>`;
    })
    .join('');

  const cafTicks = caffeine.map((c) => {
    const cx = xOf(normMin(c.t));
    return `
      <line x1="${cx.toFixed(1)}" y1="${barY - 6}" x2="${cx.toFixed(1)}" y2="${barY}" stroke="var(--caf)" stroke-width="2" stroke-linecap="round"><title>Koffein ${Number(c.mg) || 0} mg (${escapeHtml(c.t)})</title></line>
      <circle cx="${cx.toFixed(1)}" cy="${barY - 7}" r="2.2" fill="var(--caf)" />
    `;
  }).join('');

  // Clean 4 time ticks across wake -> sleep
  const ticks = [0, 0.33, 0.66, 1].map((f, idx) => {
    const m = startM + dur * f;
    return {
      x: xOf(m),
      txt: minToTime(m),
      anchor: idx === 0 ? 'start' : idx === 3 ? 'end' : 'middle'
    };
  });

  return `
    <svg viewBox="0 0 ${W} ${H}" aria-label="Tages-Zeitachse">
      <rect x="${barX}" y="${barY}" width="${barW}" height="${barH}" rx="6" fill="var(--bg)" stroke="var(--border-strong)" stroke-width="1" />
      <rect x="${barX}" y="${barY}" width="${elapsedW.toFixed(1)}" height="${barH}" rx="6" fill="var(--bg-hover)" />
      ${lecRects}
      ${studyRects}
      ${cafTicks}
      <line x1="${nowX.toFixed(1)}" y1="${barY - 4}" x2="${nowX.toFixed(1)}" y2="${barY + barH + 4}" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" />
      ${ticks.map((t) => `<text x="${t.x.toFixed(1)}" y="${H - 4}" text-anchor="${t.anchor}" font-size="10" fill="var(--text-soft)" font-family="var(--mono)">${t.txt}</text>`).join('')}
    </svg>
  `;
}

export function renderDailyRingSVG(learnMin, goalMin) {
  const pct = goalMin > 0 ? Math.min(1, learnMin / goalMin) : 0;
  const reached = goalMin > 0 && learnMin >= goalMin;
  const r = 64;
  const circ = 2 * Math.PI * r;
  const dash = circ * pct;
  const strokeColor = reached ? 'var(--gold)' : 'var(--learn)';
  const glow = reached ? 'filter: drop-shadow(0 0 8px rgba(234,179,8,0.55));' : '';

  return `
    <svg viewBox="0 0 160 160" width="160" height="160" aria-label="Tagesring ${Math.round(pct * 100)} Prozent">
      <circle cx="80" cy="80" r="${r}" fill="none" stroke="var(--bg-soft)" stroke-width="14" />
      <circle cx="80" cy="80" r="${r}" fill="none"
        stroke="${strokeColor}"
        stroke-width="14"
        stroke-linecap="round"
        stroke-dasharray="${dash.toFixed(1)} ${circ.toFixed(1)}"
        transform="rotate(-90 80 80)"
        style="transition: stroke-dasharray 0.45s ease; ${glow}" />
    </svg>
  `;
}

export function renderRestOfDaySVG(live) {
  if (!live || !live.hasWake) return '';
  const { span, day } = live;
  const W = 520, H = 165;
  const padL = 36, padR = 14, padT = 14, padB = 26;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const startM = Math.min(span.nowMin, span.sleepMin);
  const endM = Math.max(startM + 10, span.sleepMin);
  const steps = 24;

  const ptsLearn = [];
  const ptsProd = [];
  const ptsBoth = [];
  let maxPct = 10;

  for (let i = 0; i <= steps; i++) {
    const m = startM + ((endM - startM) * i) / steps;
    const awake = Math.max(1, m - span.wakeMin);
    const lp = Math.min(100, (day.learnTotal / awake) * 100);
    const pp = Math.min(100, (day.p / awake) * 100);
    const bp = Math.min(100, (day.total / awake) * 100);
    maxPct = Math.max(maxPct, bp);
    ptsLearn.push({ i, v: lp });
    ptsProd.push({ i, v: pp });
    ptsBoth.push({ i, v: bp });
  }

  const yMax = Math.min(100, Math.ceil((maxPct + 5) / 10) * 10);
  const xOf = (i) => padL + (plotW * i) / steps;
  const yOf = (v) => padT + plotH - (plotH * v) / yMax;
  const poly = (arr) => arr.map((p) => `${xOf(p.i).toFixed(1)},${yOf(p.v).toFixed(1)}`).join(' ');

  const ticks = [0, 0.5, 1];
  const xLabels = [
    { x: padL, txt: minToTime(startM) },
    { x: padL + plotW / 2, txt: minToTime((startM + endM) / 2) },
    { x: padL + plotW, txt: minToTime(endM) }
  ];

  return `
    <svg viewBox="0 0 ${W} ${H}" aria-label="Rest des Tages Prognose">
      ${ticks.map((t) => {
        const val = Math.round(yMax * t);
        const y = yOf(val);
        return `
          <line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="var(--border)" stroke-dasharray="3 3" />
          <text x="${padL - 6}" y="${y + 4}" text-anchor="end" font-size="10" fill="var(--text-soft)">${val}%</text>
        `;
      }).join('')}
      <polyline fill="none" stroke="var(--both)" stroke-width="2.4" points="${poly(ptsBoth)}" />
      <polyline fill="none" stroke="var(--learn)" stroke-width="2.2" points="${poly(ptsLearn)}" />
      <polyline fill="none" stroke="var(--prod)" stroke-width="2" stroke-dasharray="4 3" points="${poly(ptsProd)}" />
      ${xLabels.map((l, idx) => `
        <text x="${l.x}" y="${H - 6}" text-anchor="${idx === 0 ? 'start' : idx === 2 ? 'end' : 'middle'}" font-size="10" fill="var(--text-soft)">${l.txt}</text>
      `).join('')}
    </svg>
  `;
}

export function renderTimerProjectionSVG(live, timerStatus) {
  if (!live || !live.hasWake || !timerStatus || timerStatus.mode !== 'countdown') return '';
  const { span, day } = live;
  const W = 520, H = 150;
  const padL = 36, padR = 14, padT = 14, padB = 26;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const remMin = Math.max(1, timerStatus.remainingSec / 60);
  const elapsedAlreadyMin = timerStatus.elapsedSec / 60;
  const totalAdd = Math.max(1, timerStatus.durationSec / 60);
  const steps = 20;

  const ptsLearn = [], ptsProd = [], ptsBoth = [];
  let maxPct = 15;

  for (let i = 0; i <= steps; i++) {
    const frac = i / steps;
    const futureMin = remMin * frac;
    const addedSoFar = elapsedAlreadyMin + futureMin;
    const awake = Math.max(1, span.elapsedMin + futureMin);
    const lVal = day.learnTotal + (timerStatus.kind === 'l' || timerStatus.kind === 'a' ? addedSoFar : 0);
    const pVal = day.p + (timerStatus.kind === 'p' ? addedSoFar : 0);
    const bVal = lVal + pVal;

    const lp = Math.min(100, (lVal / awake) * 100);
    const pp = Math.min(100, (pVal / awake) * 100);
    const bp = Math.min(100, (bVal / awake) * 100);
    maxPct = Math.max(maxPct, bp);
    ptsLearn.push({ i, v: lp });
    ptsProd.push({ i, v: pp });
    ptsBoth.push({ i, v: bp });
  }

  const yMax = Math.min(100, Math.ceil((maxPct + 5) / 10) * 10);
  const xOf = (i) => padL + (plotW * i) / steps;
  const yOf = (v) => padT + plotH - (plotH * v) / yMax;
  const poly = (arr) => arr.map((p) => `${xOf(p.i).toFixed(1)},${yOf(p.v).toFixed(1)}`).join(' ');

  const endLearn = ptsLearn[ptsLearn.length - 1].v;
  const endProd = ptsProd[ptsProd.length - 1].v;
  const endBoth = ptsBoth[ptsBoth.length - 1].v;

  return {
    endLearn,
    endProd,
    endBoth,
    totalAdd: Math.round(totalAdd),
    svg: `
      <svg viewBox="0 0 ${W} ${H}" aria-label="Timer Prognose">
        <line x1="${padL}" y1="${yOf(yMax)}" x2="${W - padR}" y2="${yOf(yMax)}" stroke="var(--border)" stroke-dasharray="3 3" />
        <line x1="${padL}" y1="${yOf(yMax / 2)}" x2="${W - padR}" y2="${yOf(yMax / 2)}" stroke="var(--border)" stroke-dasharray="3 3" />
        <text x="${padL - 6}" y="${yOf(yMax) + 4}" text-anchor="end" font-size="10" fill="var(--text-soft)">${yMax}%</text>
        <text x="${padL - 6}" y="${yOf(yMax / 2) + 4}" text-anchor="end" font-size="10" fill="var(--text-soft)">${Math.round(yMax / 2)}%</text>
        <polyline fill="none" stroke="var(--both)" stroke-width="2.4" points="${poly(ptsBoth)}" />
        <polyline fill="none" stroke="var(--learn)" stroke-width="2.2" points="${poly(ptsLearn)}" />
        <polyline fill="none" stroke="var(--prod)" stroke-width="2" stroke-dasharray="4 3" points="${poly(ptsProd)}" />
        <text x="${padL}" y="${H - 6}" font-size="10" fill="var(--text-soft)">Jetzt</text>
        <text x="${W - padR}" y="${H - 6}" text-anchor="end" font-size="10" fill="var(--text-soft)">Ende (+${Math.round(remMin)} min)</text>
      </svg>
    `
  };
}

export function renderCaffeineCurveSVG(caf) {
  const { points, nowMs, sleepMs } = caf;
  if (!points || points.length < 2) return '';
  const W = 520, H = 160;
  const padL = 38, padR = 14, padT = 14, padB = 26;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const minMs = points[0].ms;
  const maxMs = points[points.length - 1].ms;
  const maxMg = Math.max(100, Math.ceil(Math.max(...points.map((p) => p.mg), 50) / 50) * 50);

  const xOf = (ms) => padL + ((ms - minMs) / Math.max(1, maxMs - minMs)) * plotW;
  const yOf = (mg) => padT + plotH - (mg / maxMg) * plotH;

  const polyPts = points.map((p) => `${xOf(p.ms).toFixed(1)},${yOf(p.mg).toFixed(1)}`).join(' ');
  const areaPts = `${xOf(minMs).toFixed(1)},${(padT + plotH).toFixed(1)} ${polyPts} ${xOf(maxMs).toFixed(1)},${(padT + plotH).toFixed(1)}`;
  const y50 = yOf(50);
  const nowX = xOf(Math.min(maxMs, Math.max(minMs, nowMs)));
  const sleepX = xOf(Math.min(maxMs, Math.max(minMs, sleepMs)));

  const labels = [0, 0.33, 0.66, 1].map((f) => {
    const ms = minMs + (maxMs - minMs) * f;
    return { x: xOf(ms), txt: toTimeStr(new Date(ms)) };
  });

  return `
    <svg viewBox="0 0 ${W} ${H}" aria-label="Koffein Verlaufskurve">
      <line x1="${padL}" y1="${y50}" x2="${W - padR}" y2="${y50}" stroke="var(--kit)" stroke-dasharray="4 3" stroke-width="1.2" />
      <text x="${W - padR - 2}" y="${y50 - 4}" text-anchor="end" font-size="9.5" fill="var(--kit)">50 mg Grenze</text>
      <text x="${padL - 6}" y="${yOf(maxMg) + 4}" text-anchor="end" font-size="10" fill="var(--text-soft)">${maxMg}</text>
      <text x="${padL - 6}" y="${yOf(0) + 3}" text-anchor="end" font-size="10" fill="var(--text-soft)">0</text>
      <polygon fill="var(--caf-soft)" points="${areaPts}" />
      <polyline fill="none" stroke="var(--caf)" stroke-width="2.4" points="${polyPts}" />
      <line x1="${nowX}" y1="${padT}" x2="${nowX}" y2="${padT + plotH}" stroke="var(--learn)" stroke-width="1.4" stroke-dasharray="2 2" />
      <text x="${nowX + 3}" y="${padT + 10}" font-size="9.5" fill="var(--learn)">Jetzt</text>
      <line x1="${sleepX}" y1="${padT}" x2="${sleepX}" y2="${padT + plotH}" stroke="var(--purple)" stroke-width="1.4" stroke-dasharray="3 2" />
      <text x="${sleepX - 3}" y="${padT + 10}" text-anchor="end" font-size="9.5" fill="var(--purple)">Schlaf</text>
      ${labels.map((l, idx) => `
        <text x="${l.x}" y="${H - 6}" text-anchor="${idx === 0 ? 'start' : idx === labels.length - 1 ? 'end' : 'middle'}" font-size="10" fill="var(--text-soft)">${l.txt}</text>
      `).join('')}
    </svg>
  `;
}

export function renderWakeRatioBarsSVG(rows) {
  // rows: newest first! [{ d, awakeMin, lMin, aMin, pMin, lPct, aPct, pPct, totalPct }]
  const W = 560, H = 190;
  const padL = 34, padR = 10, padT = 14, padB = 34;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const n = Math.max(1, rows.length);
  const maxPct = Math.max(30, Math.min(100, Math.ceil((Math.max(...rows.map((r) => r.totalPct), 25) + 5) / 10) * 10));
  const barSlot = plotW / n;
  const barW = Math.max(10, Math.min(28, barSlot * 0.68));

  const yOf = (pct) => padT + plotH - (pct / maxPct) * plotH;

  return `
    <svg viewBox="0 0 ${W} ${H}" aria-label="14 Tage Lernzeit an Wachzeit">
      ${[0, 0.5, 1].map((t) => {
        const v = Math.round(maxPct * t);
        const y = yOf(v);
        return `
          <line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="var(--border)" stroke-dasharray="3 3" />
          <text x="${padL - 6}" y="${y + 4}" text-anchor="end" font-size="10" fill="var(--text-soft)">${v}%</text>
        `;
      }).join('')}
      ${rows.map((r, i) => {
        const cx = padL + i * barSlot + barSlot / 2;
        const x = cx - barW / 2;
        const hL = (r.lPct / maxPct) * plotH;
        const hA = (r.aPct / maxPct) * plotH;
        const hP = (r.pPct / maxPct) * plotH;
        const yBase = padT + plotH;
        const yL = yBase - hL;
        const yA = yL - hA;
        const yP = yA - hP;
        const tip = `${fmtDateShort(r.d)} · Wachzeit ${fmtMin(r.awakeMin)} · Lernen ${fmtMin(r.lMin)} (${r.lPct.toFixed(1)}%) · Anki ${fmtMin(r.aMin)} (${r.aPct.toFixed(1)}%) · Vorlesung/Prod. ${fmtMin(r.pMin)} (${r.pPct.toFixed(1)}%) · Ges. ${r.totalPct.toFixed(1)}%`;
        return `
          <g class="bar-hit" data-tip="${escapeHtml(tip)}" style="cursor:pointer;">
            <rect x="${x - 2}" y="${padT}" width="${barW + 4}" height="${plotH}" fill="transparent" />
            ${hL > 0 ? `<rect x="${x}" y="${yL}" width="${barW}" height="${hL}" rx="2" fill="var(--learn)" />` : ''}
            ${hA > 0 ? `<rect x="${x}" y="${yA}" width="${barW}" height="${hA}" rx="2" fill="var(--anki)" />` : ''}
            ${hP > 0 ? `<rect x="${x}" y="${yP}" width="${barW}" height="${hP}" rx="2" fill="var(--prod)" />` : ''}
            <text x="${cx}" y="${H - 12}" text-anchor="middle" font-size="9.5" fill="var(--text-soft)">${fmtDateShort(r.d).slice(0, 5)}</text>
          </g>
        `;
      }).join('')}
    </svg>
  `;
}

export function renderHistoryBarsSVG(rows, goalMin) {
  // rows: [{ d, lMin, aMin, learnTotal, goalMin?, isRest? }] oldest -> newest
  const W = 580, H = 195;
  const padL = 36, padR = 12, padT = 14, padB = 28;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const n = Math.max(1, rows.length);
  const maxMin = Math.max(goalMin * 1.2, ...rows.map((r) => r.learnTotal), 60);
  const maxHours = Math.ceil(maxMin / 60);
  const yMaxMin = maxHours * 60;
  const barSlot = plotW / n;
  const barW = Math.max(3, Math.min(24, barSlot * 0.72));
  const yOf = (m) => padT + plotH - (m / yMaxMin) * plotH;
  const yGoal = yOf(goalMin);
  const labelStep = n > 45 ? 15 : n > 20 ? 5 : 2;

  return `
    <svg viewBox="0 0 ${W} ${H}" aria-label="Lernzeit Verlauf">
      ${Array.from({ length: maxHours + 1 }, (_, h) => {
        if (maxHours > 6 && h % 2 !== 0 && h !== maxHours) return '';
        const y = yOf(h * 60);
        return `
          <line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="var(--border)" stroke-dasharray="3 3" />
          <text x="${padL - 6}" y="${y + 4}" text-anchor="end" font-size="10" fill="var(--text-soft)">${h}h</text>
        `;
      }).join('')}
      <line x1="${padL}" y1="${yGoal}" x2="${W - padR}" y2="${yGoal}" stroke="var(--gold)" stroke-width="1.6" stroke-dasharray="5 4" />
      ${rows.map((r, i) => {
        const cx = padL + i * barSlot + barSlot / 2;
        const x = cx - barW / 2;
        const rowGoal = r.goalMin !== undefined ? r.goalMin : goalMin;
        const hitGoal = rowGoal > 0 ? r.learnTotal >= rowGoal : r.learnTotal > 0;
        const hL = (r.lMin / yMaxMin) * plotH;
        const hA = (r.aMin / yMaxMin) * plotH;
        const yBase = padT + plotH;
        const restLabel = r.isRest ? ` · Ruhetag (Ziel ${fmtMin(rowGoal)})` : '';
        const tip = `${fmtDateShort(r.d)} · Lernen inkl. Anki: ${fmtMin(r.learnTotal)} (davon Anki: ${fmtMin(r.aMin)})${restLabel}${hitGoal ? ' · Ziel erreicht' : r.isRest ? ' · Serie geschützt' : ''}`;
        return `
          <g class="bar-hit" data-tip="${escapeHtml(tip)}" style="cursor:pointer;">
            <rect x="${x - 1}" y="${padT}" width="${barW + 2}" height="${plotH}" fill="transparent" />
            ${hL > 0 ? `<rect x="${x}" y="${yBase - hL}" width="${barW}" height="${hL}" rx="2" fill="var(--learn)" opacity="${hitGoal ? '1' : '0.45'}" />` : ''}
            ${hA > 0 ? `<rect x="${x}" y="${yBase - hL - hA}" width="${barW}" height="${hA}" rx="2" fill="var(--anki)" opacity="${hitGoal ? '1' : '0.78'}" />` : ''}
            ${r.isRest && r.learnTotal === 0 ? `<circle cx="${cx}" cy="${yBase - 4}" r="2.2" fill="var(--kit)" opacity="0.55" />` : ''}
            ${(i % labelStep === 0 || i === n - 1) ? `<text x="${cx}" y="${H - 8}" text-anchor="middle" font-size="9.5" fill="var(--text-soft)">${fmtDateShort(r.d).slice(0, 5)}</text>` : ''}
          </g>
        `;
      }).join('')}
    </svg>
  `;
}

export function renderCaffeine14dSVG(rows, limitMg = 400) {
  const W = 540, H = 155;
  const padL = 38, padR = 12, padT = 14, padB = 26;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const n = Math.max(1, rows.length);
  const maxMg = Math.max(limitMg, ...rows.map((r) => r.mg), 200);
  const slot = plotW / n;
  const barW = Math.max(8, Math.min(26, slot * 0.65));
  const yOf = (v) => padT + plotH - (v / maxMg) * plotH;

  return `
    <svg viewBox="0 0 ${W} ${H}" aria-label="14 Tage Koffein">
      <line x1="${padL}" y1="${yOf(limitMg)}" x2="${W - padR}" y2="${yOf(limitMg)}" stroke="var(--danger)" stroke-dasharray="4 3" stroke-width="1.2" />
      <text x="${padL - 5}" y="${yOf(limitMg) + 4}" text-anchor="end" font-size="9.5" fill="var(--danger)">${limitMg}</text>
      <text x="${padL - 5}" y="${yOf(0) + 3}" text-anchor="end" font-size="9.5" fill="var(--text-soft)">0</text>
      ${rows.map((r, i) => {
        const cx = padL + i * slot + slot / 2;
        const h = (r.mg / maxMg) * plotH;
        const tip = `${fmtDateShort(r.d)} · ${r.mg} mg Koffein`;
        return `
          <g class="bar-hit" data-tip="${escapeHtml(tip)}" style="cursor:pointer;">
            <rect x="${cx - barW / 2}" y="${padT}" width="${barW}" height="${plotH}" fill="transparent" />
            ${h > 0 ? `<rect x="${cx - barW / 2}" y="${padT + plotH - h}" width="${barW}" height="${h}" rx="3" fill="${r.mg > limitMg ? 'var(--danger)' : 'var(--caf)'}" />` : ''}
            ${i % 2 === 0 ? `<text x="${cx}" y="${H - 6}" text-anchor="middle" font-size="9.5" fill="var(--text-soft)">${fmtDateShort(r.d).slice(0, 5)}</text>` : ''}
          </g>
        `;
      }).join('')}
    </svg>
  `;
}

export function renderHeatmap20WeeksSVG(cells, goalMin) {
  // cells: 140 items [{ d, min, col (0..19), row (0..6), goalMin?, isRest? }]
  const cellSize = 15;
  const gap = 4;
  const padL = 24;
  const padT = 8;
  const W = padL + 20 * (cellSize + gap) + 8;
  const H = padT + 7 * (cellSize + gap) + 8;
  const dayLabels = ['Mo', '', 'Mi', '', 'Fr', '', 'So'];

  const colorFor = (c) => {
    const cellGoal = c.goalMin !== undefined ? c.goalMin : goalMin;
    if (c.min <= 0) return c.isRest ? 'rgba(0, 150, 130, 0.10)' : 'var(--bg-soft)';
    const r = cellGoal > 0 ? c.min / cellGoal : 1;
    if (r >= 1) return 'var(--kit)';
    if (r >= 0.7) return 'rgba(0, 150, 130, 0.72)';
    if (r >= 0.4) return 'rgba(0, 150, 130, 0.45)';
    return 'rgba(0, 150, 130, 0.24)';
  };

  return `
    <svg viewBox="0 0 ${W} ${H}" style="min-width: 390px;" aria-label="20 Wochen Aktivitäts-Heatmap">
      ${dayLabels.map((lbl, r) => lbl ? `<text x="2" y="${padT + r * (cellSize + gap) + 11}" font-size="9.5" fill="var(--text-soft)">${lbl}</text>` : '').join('')}
      ${cells.map((c) => {
        const x = padL + c.col * (cellSize + gap);
        const y = padT + c.row * (cellSize + gap);
        const cellGoal = c.goalMin !== undefined ? c.goalMin : goalMin;
        const hit = cellGoal > 0 ? c.min >= cellGoal : c.min > 0;
        const restNote = c.isRest ? ` · Ruhetag (Ziel ${fmtMin(cellGoal)})` : '';
        const tip = `${fmtDateShort(c.d)} · ${fmtMin(c.min)}${restNote}${hit ? ' · Ziel erreicht' : c.isRest ? ' · Serie geschützt' : ''}`;
        return `<rect class="bar-hit" data-tip="${escapeHtml(tip)}" x="${x}" y="${y}" width="${cellSize}" height="${cellSize}" rx="3.5" fill="${colorFor(c)}" stroke="${c.isRest && c.min <= 0 ? 'rgba(0, 150, 130, 0.28)' : 'var(--border)'}" stroke-width="0.6" style="cursor:pointer;" />`;
      }).join('')}
    </svg>
  `;
}

export function renderSimpleBarsSVG(items, { valueFormatter = (v) => String(v), color = 'var(--learn)' } = {}) {
  // items: [{ label, value, tip }]
  const W = 540, H = 150;
  const padL = 12, padR = 12, padT = 18, padB = 26;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const maxVal = Math.max(1, ...items.map((x) => x.value));
  const slot = plotW / Math.max(1, items.length);
  const barW = Math.max(8, Math.min(34, slot * 0.66));

  return `
    <svg viewBox="0 0 ${W} ${H}">
      ${items.map((it, i) => {
        const cx = padL + i * slot + slot / 2;
        const h = (it.value / maxVal) * plotH;
        const y = padT + plotH - h;
        const tip = it.tip || `${it.label}: ${valueFormatter(it.value)}`;
        return `
          <g class="bar-hit" data-tip="${escapeHtml(tip)}" style="cursor:pointer;">
            <rect x="${cx - barW / 2}" y="${padT}" width="${barW}" height="${plotH}" fill="transparent" />
            ${h > 0 ? `<rect x="${cx - barW / 2}" y="${y}" width="${barW}" height="${h}" rx="3" fill="${color}" />` : ''}
            ${items.length <= 8 && it.value > 0 ? `<text x="${cx}" y="${Math.max(12, y - 4)}" text-anchor="middle" font-size="9.5" fill="var(--text-muted)">${escapeHtml(valueFormatter(it.value))}</text>` : ''}
            ${(items.length <= 12 || i % 2 === 0) ? `<text x="${cx}" y="${H - 6}" text-anchor="middle" font-size="9.5" fill="var(--text-soft)">${escapeHtml(it.label)}</text>` : ''}
          </g>
        `;
      }).join('')}
    </svg>
  `;
}

export function renderAnkiSyncChartSVG(points = [], { mode = 'all', compact = false } = {}) {
  // points: [{ ts, b, r, g, tot, estMin }] oldest -> newest, 1 point per Anki sync
  if (!Array.isArray(points) || points.length === 0) return '';
  const W = 560;
  const H = compact ? 150 : 196;
  const padL = 36, padR = 14, padT = 16, padB = 30;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const n = points.length;

  const showTotal = mode === 'all' || mode === 'total';
  const showBRG = mode === 'all' || mode === 'brg';

  let rawMax = 10;
  for (const p of points) {
    if (showTotal) rawMax = Math.max(rawMax, Number(p.tot) || 0);
    if (showBRG) rawMax = Math.max(rawMax, Number(p.b) || 0, Number(p.r) || 0, Number(p.g) || 0);
  }
  const stepUnit = rawMax > 200 ? 50 : rawMax > 60 ? 20 : 10;
  const yMax = Math.max(10, Math.ceil((rawMax * 1.08) / stepUnit) * stepUnit);

  const xOf = (i) => (n === 1 ? padL + plotW / 2 : padL + (plotW * i) / (n - 1));
  const yOf = (val) => padT + plotH - (Math.max(0, Number(val) || 0) / yMax) * plotH;
  const poly = (getter) => points.map((p, i) => `${xOf(i).toFixed(1)},${yOf(getter(p)).toFixed(1)}`).join(' ');

  const totalAreaPts = n >= 2 && showTotal
    ? `${xOf(0).toFixed(1)},${(padT + plotH).toFixed(1)} ${poly((p) => p.tot)} ${xOf(n - 1).toFixed(1)},${(padT + plotH).toFixed(1)}`
    : '';

  // Day-change vertical dividers
  const dayDividers = [];
  for (let i = 1; i < n; i++) {
    const prevD = toDateStr(new Date(points[i - 1].ts));
    const curD = toDateStr(new Date(points[i].ts));
    if (curD !== prevD) {
      const mx = (xOf(i - 1) + xOf(i)) / 2;
      dayDividers.push(`<line x1="${mx.toFixed(1)}" y1="${padT}" x2="${mx.toFixed(1)}" y2="${padT + plotH}" stroke="var(--border-strong)" stroke-dasharray="2 3" stroke-width="1" />`);
    }
  }

  // Pick up to 5 evenly spaced X labels so timestamps never overlap
  const maxLabels = compact ? 4 : 5;
  const labelIdxSet = new Set([0, n - 1]);
  if (n > 2) {
    const innerCount = Math.min(n - 2, maxLabels - 2);
    for (let k = 1; k <= innerCount; k++) {
      labelIdxSet.add(Math.round((k * (n - 1)) / (innerCount + 1)));
    }
  }

  let prevLabelDay = '';
  const xLabelsHtml = Array.from(labelIdxSet).sort((a, b) => a - b).map((idx) => {
    const dt = new Date(points[idx].ts);
    const dStr = toDateStr(dt);
    const shortD = fmtDateShort(dStr).slice(0, 5);
    const tStr = toTimeStr(dt);
    const labelTxt = dStr === prevLabelDay ? tStr : `${shortD} ${tStr}`;
    prevLabelDay = dStr;
    const anchor = n === 1 ? 'middle' : idx === 0 ? 'start' : idx === n - 1 ? 'end' : 'middle';
    return `<text x="${xOf(idx).toFixed(1)}" y="${H - 7}" text-anchor="${anchor}" font-size="9.5" fill="var(--text-soft)" font-family="var(--mono)">${escapeHtml(labelTxt)}</text>`;
  }).join('');

  const dotR = n > 35 ? 2.3 : compact ? 2.8 : 3.3;
  const hitSlotW = n === 1 ? plotW : Math.max(8, plotW / n);

  const hitGroups = points.map((p, i) => {
    const cx = xOf(i);
    const dt = new Date(p.ts);
    const dStr = fmtDateShort(toDateStr(dt));
    const tStr = toTimeStr(dt);
    const prev = i > 0 ? points[i - 1] : null;
    const delta = prev ? (Number(p.tot) || 0) - (Number(prev.tot) || 0) : null;
    const deltaTxt = delta !== null ? ` (${delta > 0 ? '+' : ''}${delta} seit letztem Sync)` : '';
    const tip = `Sync ${dStr} ${tStr} · Gesamt: ${p.tot} Karten (~${p.estMin || 0} min)${deltaTxt} · Blau: ${p.b} · Rot: ${p.r} · Grün: ${p.g}`;

    return `
      <g class="bar-hit" data-tip="${escapeHtml(tip)}" style="cursor:pointer;">
        <rect x="${(cx - hitSlotW / 2).toFixed(1)}" y="${padT}" width="${hitSlotW.toFixed(1)}" height="${plotH}" fill="transparent" />
        ${showBRG ? `<circle cx="${cx.toFixed(1)}" cy="${yOf(p.g).toFixed(1)}" r="${dotR}" fill="var(--kit)" />` : ''}
        ${showBRG ? `<circle cx="${cx.toFixed(1)}" cy="${yOf(p.b).toFixed(1)}" r="${dotR}" fill="var(--learn)" />` : ''}
        ${showBRG ? `<circle cx="${cx.toFixed(1)}" cy="${yOf(p.r).toFixed(1)}" r="${dotR}" fill="var(--danger)" />` : ''}
        ${showTotal ? `<circle cx="${cx.toFixed(1)}" cy="${yOf(p.tot).toFixed(1)}" r="${(dotR + 0.5).toFixed(1)}" fill="var(--anki)" stroke="var(--bg-elev)" stroke-width="1" />` : ''}
      </g>
    `;
  }).join('');

  return `
    <svg viewBox="0 0 ${W} ${H}" aria-label="Anki Sync Verlauf">
      ${[0, 0.5, 1].map((t) => {
        const val = Math.round(yMax * t);
        const y = yOf(val);
        return `
          <line x1="${padL}" y1="${y.toFixed(1)}" x2="${W - padR}" y2="${y.toFixed(1)}" stroke="var(--border)" stroke-dasharray="3 3" />
          <text x="${padL - 6}" y="${(y + 3.5).toFixed(1)}" text-anchor="end" font-size="10" fill="var(--text-soft)" font-family="var(--mono)">${val}</text>
        `;
      }).join('')}
      ${dayDividers.join('')}
      ${totalAreaPts ? `<polygon fill="rgba(244, 114, 182, 0.09)" points="${totalAreaPts}" />` : ''}
      ${n >= 2 && showBRG ? `<polyline fill="none" stroke="var(--kit)" stroke-width="1.9" stroke-linejoin="round" stroke-linecap="round" points="${poly((p) => p.g)}" />` : ''}
      ${n >= 2 && showBRG ? `<polyline fill="none" stroke="var(--learn)" stroke-width="1.9" stroke-linejoin="round" stroke-linecap="round" points="${poly((p) => p.b)}" />` : ''}
      ${n >= 2 && showBRG ? `<polyline fill="none" stroke="var(--danger)" stroke-width="1.9" stroke-linejoin="round" stroke-linecap="round" points="${poly((p) => p.r)}" />` : ''}
      ${n >= 2 && showTotal ? `<polyline fill="none" stroke="var(--anki)" stroke-width="2.3" stroke-linejoin="round" stroke-linecap="round" points="${poly((p) => p.tot)}" />` : ''}
      ${hitGroups}
      ${xLabelsHtml}
    </svg>
  `;
}

export function bindChartTooltips(container) {
  container.querySelectorAll('.chart-box').forEach((box) => {
    const tipEl = box.parentElement?.querySelector('.chart-tooltip');
    if (!tipEl) return;
    box.querySelectorAll('.bar-hit').forEach((el) => {
      const show = () => {
        const txt = el.getAttribute('data-tip');
        if (txt) tipEl.textContent = txt;
      };
      el.addEventListener('click', show);
      el.addEventListener('pointerenter', show);
      el.addEventListener('touchstart', show, { passive: true });
    });
  });
}

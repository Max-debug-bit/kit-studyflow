// Main bootstrap: monochrome icons, keyboard shortcuts (1-5, N, Strg+Z), Undo Toast,
// Checklist->Log floating bar (#1), Pixel 9a #pair= QR onboarding (#8), auto-lecture sync & PWA SW

import { store, toDateStr, toTimeStr, fmtDateShort, parseDateStr, WEEKDAYS_DE, escapeHtml } from './store.js';
import { scheduleAutoSync, flushPendingSync, syncNow, pullFromGist, isGistConfigured, onSyncStatusChange } from './sync.js';
import { syncDayLecturesToProductive, syncRecentLecturesToProductive, reconcileBacklogStatus, inferMetaFromChecklistItem, estimateChecklistItemMinutes } from './checklist.js';
import { decodePairingCode, isPinProtectedPairingCode } from './qr.js';
import { icon } from './icons.js';
import { renderTodayView, cleanupTodayView } from './views/today.js';
import { renderWeekView } from './views/week.js';
import { renderPlannerView, queuePlanAudit, queueWeeklyReview } from './views/planner.js';
import { renderStatsView } from './views/stats.js';
import { renderMoreView, setMoreSubtab } from './views/more.js';

const TABS = ['today', 'week', 'planner', 'stats', 'more'];
const TAB_TITLES = {
  today: 'Heute',
  week: 'Wochenplan',
  planner: 'KI-Planer',
  stats: 'Statistik',
  more: 'Erfolge & Setup'
};

let currentTab = 'today';
let deferredRender = false;

const viewRoot = document.getElementById('view-container');
const mobileTitle = document.getElementById('mobile-page-title');
const bannersRoot = document.getElementById('global-banners');
const toastRoot = document.getElementById('toast-root');
const modalRoot = document.getElementById('modal-root');

// Hydrate static shell monochrome SVG icons
document.querySelectorAll('[data-ico]').forEach((el) => {
  el.innerHTML = icon(el.getAttribute('data-ico'), el.classList.contains('bnav-icon') ? 18 : 16);
});

function toast(message, type = '', opts = {}) {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  const span = document.createElement('span');
  span.textContent = message;
  el.appendChild(span);

  if (opts.undo && store.canUndo()) {
    const btn = document.createElement('button');
    btn.className = 'btn btn-xs';
    btn.textContent = 'Rückgängig';
    btn.addEventListener('click', () => {
      el.remove();
      const undone = store.undo();
      if (undone) toast(`Rückgängig: ${undone}`, 'ok');
    });
    el.appendChild(btn);
  }

  toastRoot.appendChild(el);
  setTimeout(() => el.remove(), opts.undo ? 5500 : 3800);
}

function isUserActivelyEditing() {
  if (!modalRoot.classList.contains('hidden')) return true;
  const active = document.activeElement;
  return Boolean(active && active.matches && active.matches('input, textarea, select'));
}

function captureViewDrafts() {
  const fields = new Map();
  viewRoot.querySelectorAll('input[id], textarea[id]').forEach((el) => {
    const t = (el.type || '').toLowerCase();
    if (['checkbox', 'radio', 'file', 'hidden', 'submit', 'button'].includes(t)) return;
    if (el.value !== el.defaultValue) {
      fields.set(el.id, el.value);
    }
  });
  const openDetailsById = new Set();
  const openDetailsByIdx = new Set();
  viewRoot.querySelectorAll('details').forEach((d, idx) => {
    if (!d.open) return;
    if (d.id) openDetailsById.add(d.id);
    else openDetailsByIdx.add(idx);
  });
  const activeEl = document.activeElement;
  const activeId = (activeEl && viewRoot.contains(activeEl) && activeEl.id) ? activeEl.id : '';
  let selStart = null;
  let selEnd = null;
  if (activeId && typeof activeEl.selectionStart === 'number') {
    selStart = activeEl.selectionStart;
    selEnd = activeEl.selectionEnd;
  }
  return { fields, openDetailsById, openDetailsByIdx, activeId, selStart, selEnd };
}

function restoreViewDrafts(snap) {
  if (!snap) return;
  snap.fields.forEach((val, id) => {
    const el = document.getElementById(id);
    if (el && viewRoot.contains(el)) el.value = val;
  });
  viewRoot.querySelectorAll('details').forEach((d, idx) => {
    if (d.id ? snap.openDetailsById.has(d.id) : snap.openDetailsByIdx.has(idx)) {
      d.open = true;
    }
  });
  if (snap.activeId && document.hasFocus()) {
    const el = document.getElementById(snap.activeId);
    if (el && viewRoot.contains(el) && typeof el.focus === 'function') {
      el.focus({ preventScroll: true });
      if (snap.selStart !== null && typeof el.setSelectionRange === 'function') {
        try { el.setSelectionRange(snap.selStart, snap.selEnd); } catch { /* ignore */ }
      }
    }
  }
}

function flushDeferredRenderIfReady() {
  if (!deferredRender) return;
  if (document.visibilityState === 'hidden' || !document.hasFocus()) return;
  if (isUserActivelyEditing()) return;
  deferredRender = false;
  renderCurrentView({ preserveDrafts: true });
}

function openModal(html, onBind) {
  modalRoot.innerHTML = `<div class="modal-card">${html}</div>`;
  modalRoot.classList.remove('hidden');
  modalRoot.onclick = (e) => {
    if (e.target === modalRoot) closeModal();
  };
  if (onBind) onBind(modalRoot.querySelector('.modal-card'));
}

function closeModal() {
  modalRoot.classList.add('hidden');
  modalRoot.innerHTML = '';
  flushDeferredRenderIfReady();
}

// ---------- Checklist -> Lernzeit-Brücke (#1, without Timer!) ----------

function promptLogFromChecklist(item) {
  if (!item || !item.done) return;

  const meta = inferMetaFromChecklistItem(item);
  const today = toDateStr();
  const isPastItem = Boolean(item.d && item.d < today);
  const kindLabels = { l: 'Lernzeit', a: 'Anki-Lernzeit', p: 'Vorlesung / Produktiv' };
  const actLabels = { '': 'Allgemein', video: 'Video', review: 'Nacharbeit', homework: 'HA', exam: 'Klausur/Üben', anki: 'Anki', prod: 'Vorlesung' };

  // Default to real task duration ('add'), with 1-click switch to Focus-Friend daily total ('total').
  // Input starts EMPTY — 1-Tap chips save immediately without blindly pre-filling the input!
  let logMode = 'add';
  let activeKind = meta.kind;
  const moduleOpts = Object.values(store.state.modules || {})
    .map((m) => `<option value="${escapeHtml(m.id)}" ${m.id === meta.mod ? 'selected' : ''}>${escapeHtml(m.shortName)}</option>`)
    .join('');
  const calibratedCatalog = store.getCalibratedTaskCatalog();
  const autoCatObj = item.catalogId
    ? calibratedCatalog.find((c) => c.id === item.catalogId)
    : (activeKind !== 'a' ? store.matchCatalogItemForText(item.title, meta.act, meta.mod) : null);
  const autoCatId = autoCatObj?.id || '';
  const catalogOpts = calibratedCatalog
    .map((c) => `<option value="${escapeHtml(c.id)}" ${c.id === autoCatId ? 'selected' : ''}>${escapeHtml(c.subject)} · ${escapeHtml(c.title)} (${c.effectiveMin}m)</option>`)
    .join('');

  const estMin = item.isAnkiDaily
    ? (store.state.anki.minDailyAnkiMin || 30)
    : estimateChecklistItemMinutes(item, calibratedCatalog);
  const basePresets = item.isAnkiDaily ? [15, 20, 30, 45] : [30, 45, 60, 90];
  const showEstChip = !item.isAnkiDaily && estMin > 0;

  const autoModName = meta.mod && store.state.modules[meta.mod] ? store.state.modules[meta.mod].shortName : 'Allgemein';
  const autoSummaryParts = [kindLabels[activeKind]];
  if (autoModName !== 'Allgemein') autoSummaryParts.push(autoModName);
  if (meta.act && actLabels[meta.act]) autoSummaryParts.push(actLabels[meta.act]);
  if (autoCatObj) autoSummaryParts.push(autoCatObj.title);
  const detailsSummaryText = autoSummaryParts.join(' · ');

  openModal(`
    <div class="card-header">
      <h3 class="card-title">${icon('check', 15)} Wie lange hat das gedauert?</h3>
      <button class="icon-btn" id="qlm-close" type="button">${icon('x', 15)}</button>
    </div>
    <div class="small" style="font-weight:620;margin-bottom:4px;">${escapeHtml(item.title)}</div>
    <div class="xs muted" style="margin-bottom:10px;">
      ${item.isAnkiDaily
        ? `Tippe direkt eine Zeit an oder gib Minuten ein${item.remainingCards > 0 ? ` (${item.remainingCards} Karten bleiben für später)` : ''}.`
        : '1 Tipp auf eine Dauer speichert sofort — oder eigene Minuten / Focus-Friend Stand eintragen.'}
    </div>
    <form id="qlm-form" class="stack">
      <div id="qlm-chips-wrap" class="quick-dur-chips">
        ${basePresets.map((m) => `<button type="button" class="quick-dur-chip" data-quick-min="${m}">${m} m</button>`).join('')}
        ${showEstChip ? `<button type="button" class="quick-dur-chip est" data-quick-min="${estMin}" title="Plan- / Katalog-Schätzung direkt speichern">~${estMin} m</button>` : ''}
      </div>

      <div class="row-between" style="gap:8px;">
        <div class="segmented" title="Dauer = Minuten dieser Aufgabe · Focus-Friend Stand = Gesamtwert aus Focus Friend">
          <button type="button" data-qlm="add" class="active">Dauer (min)</button>
          <button type="button" data-qlm="total">Focus-Friend Stand</button>
        </div>
        <span class="xs mono muted" id="qlm-preview"></span>
      </div>

      ${isPastItem ? `
        <div class="row-between" style="gap:8px;padding:7px 10px;border-radius:var(--radius-xs);background:var(--bg-soft);border:1px solid var(--border);">
          <div class="row" style="gap:8px;">
            <label for="qlm-date" class="xs muted">Buchen für Tag:</label>
            <input type="date" id="qlm-date" class="input mono" style="width:auto;padding:4px 8px;font-size:0.8rem;" value="${today}" max="${today}" />
          </div>
          <button type="button" class="btn btn-xs" id="qlm-pick-orig">Auf ${fmtDateShort(item.d)} legen</button>
        </div>
      ` : ''}

      <div class="row" style="gap:8px;">
        <input type="number" id="qlm-min" class="input mono" style="flex:1;" min="1" max="1440" placeholder="Eigene Minuten (z. B. 45)" />
        <button type="submit" class="btn btn-primary btn-sm" id="qlm-save">${icon('check', 13)} Speichern</button>
      </div>

      <details style="padding:8px 10px;border-radius:var(--radius-xs);background:var(--bg-soft);border:1px solid var(--border);">
        <summary class="xs muted" style="cursor:pointer;" id="qlm-details-summary">Details anpassen (${escapeHtml(detailsSummaryText)})</summary>
        <div class="stack" style="margin-top:10px;">
          <div class="field">
            <label>Art</label>
            <select id="qlm-kind" class="input">
              <option value="l" ${activeKind === 'l' ? 'selected' : ''}>Lernzeit</option>
              <option value="a" ${activeKind === 'a' ? 'selected' : ''}>Anki-Lernzeit</option>
              <option value="p" ${activeKind === 'p' ? 'selected' : ''}>Vorlesung / Produktiv</option>
            </select>
          </div>
          <div class="field-grid">
            <div class="field">
              <label>Fach (optional)</label>
              <select id="qlm-mod" class="input">
                <option value="">Allgemein</option>
                ${moduleOpts}
              </select>
            </div>
            <div class="field">
              <label>Tätigkeit (für KI)</label>
              <select id="qlm-act" class="input">
                <option value="" ${!meta.act ? 'selected' : ''}>Allgemein</option>
                <option value="video" ${meta.act === 'video' ? 'selected' : ''}>VL-Video durcharbeiten</option>
                <option value="review" ${meta.act === 'review' ? 'selected' : ''}>VL nacharbeiten & Ankis</option>
                <option value="homework" ${meta.act === 'homework' ? 'selected' : ''}>Hausaufgabe (Verständnis)</option>
                <option value="exam" ${meta.act === 'exam' ? 'selected' : ''}>Altklausur / Üben</option>
                <option value="anki" hidden>Anki-Reviews (fest)</option>
                <option value="prod" hidden>Vorlesung / Produktiv (fest)</option>
              </select>
            </div>
          </div>
          ${!item.isAnkiDaily ? `
            <div class="field">
              <label>Katalog-Baustein (kalibriert ab 2x automatisch)</label>
              <select id="qlm-cat" class="input">
                <option value="">Automatisch / keiner</option>
                ${catalogOpts}
              </select>
            </div>
          ` : ''}
        </div>
      </details>

      <div class="row" style="justify-content:flex-start;">
        <button type="button" class="btn btn-sm btn-ghost" id="qlm-skip">${item.isAnkiDaily && item.alreadyLoggedMin > 0 ? `Ohne neue Zeit (${item.alreadyLoggedMin} min behalten)` : 'Ohne Zeit abhaken'}</button>
      </div>
    </form>
  `, (modalEl) => {
    const inp = modalEl.querySelector('#qlm-min');
    const prevEl = modalEl.querySelector('#qlm-preview');
    const chipsWrap = modalEl.querySelector('#qlm-chips-wrap');
    const kindSel = modalEl.querySelector('#qlm-kind');
    const modSel = modalEl.querySelector('#qlm-mod');
    const actSel = modalEl.querySelector('#qlm-act');
    const catSel = modalEl.querySelector('#qlm-cat');
    const summaryEl = modalEl.querySelector('#qlm-details-summary');
    const dateEl = modalEl.querySelector('#qlm-date');
    let lastLearnAct = meta.act && meta.act !== 'anki' ? meta.act : '';

    const getTargetDate = () => {
      const v = dateEl?.value || today;
      return v > today ? today : v;
    };

    const refreshDetailsSummary = () => {
      if (!summaryEl) return;
      const parts = [kindLabels[activeKind]];
      const mId = modSel?.value || '';
      if (mId && store.state.modules[mId]) parts.push(store.state.modules[mId].shortName);
      const aVal = activeKind === 'a' ? 'anki' : activeKind === 'p' ? 'prod' : (actSel?.value || '');
      if (aVal && actLabels[aVal]) parts.push(actLabels[aVal]);
      const cVal = catSel?.value || '';
      if (cVal) {
        const hit = calibratedCatalog.find((c) => c.id === cVal);
        if (hit) parts.push(hit.title);
      }
      summaryEl.textContent = `Details anpassen (${parts.join(' · ')})`;
    };

    const syncActLock = () => {
      activeKind = kindSel.value;
      if (activeKind === 'a') {
        if (actSel.value !== 'anki' && actSel.value !== 'prod') lastLearnAct = actSel.value;
        actSel.value = 'anki';
        actSel.disabled = true;
        actSel.style.opacity = '0.55';
      } else if (activeKind === 'p') {
        if (actSel.value !== 'anki' && actSel.value !== 'prod') lastLearnAct = actSel.value;
        actSel.value = 'prod';
        actSel.disabled = true;
        actSel.style.opacity = '0.55';
      } else {
        actSel.disabled = false;
        actSel.style.opacity = '';
        if (actSel.value === 'anki' || actSel.value === 'prod') actSel.value = lastLearnAct || '';
      }
      refreshDetailsSummary();
    };

    const refreshPreview = () => {
      const freshBefore = store.getDayBreakdown(getTargetDate());
      const curMin = freshBefore[activeKind] || 0;
      const val = Math.round(Number(inp.value) || 0);
      if (chipsWrap) chipsWrap.classList.toggle('hidden', logMode !== 'add');
      if (logMode === 'add') {
        inp.placeholder = 'Eigene Minuten (z. B. 45)';
        if (val > 0) {
          prevEl.textContent = `Neu: ${curMin + val} min (+${val} min)`;
          prevEl.style.color = 'var(--kit)';
        } else {
          prevEl.textContent = `Stand: ${curMin} min`;
          prevEl.style.color = 'var(--text-soft)';
        }
      } else {
        inp.placeholder = `Focus-Friend Gesamtstand (aktuell ${curMin} min)`;
        if (val > 0) {
          const diff = val - curMin;
          prevEl.textContent = diff > 0
            ? `+${diff} min (${curMin} → ${val} min)`
            : `≤ Stand (${curMin} min)`;
          prevEl.style.color = diff > 0 ? 'var(--kit)' : 'var(--danger)';
        } else {
          prevEl.textContent = `Stand: ${curMin} min`;
          prevEl.style.color = 'var(--text-soft)';
        }
      }
    };

    const commitMinutes = (rawVal, forcedMode = null) => {
      const val = Math.round(Number(rawVal) || 0);
      if (val <= 0) {
        toast('Bitte gib eine echte Minutenzahl ein (oder klicke „Ohne Zeit abhaken“).', 'err');
        inp.focus();
        return;
      }
      const modeUsed = forcedMode || logMode;
      const targetDate = getTargetDate();
      const freshBefore = store.getDayBreakdown(targetDate);
      const curMin = freshBefore[activeKind] || 0;
      let totalToRecord;
      let sessionMin;
      if (modeUsed === 'total') {
        totalToRecord = val;
        sessionMin = val > curMin ? val - curMin : val;
      } else {
        sessionMin = val;
        totalToRecord = store.state.mode === 'sum' ? val : curMin + val;
      }
      const finalAct = activeKind === 'a' ? 'anki' : activeKind === 'p' ? '' : actSel.value;
      const chosenCat = catSel?.value || autoCatId || '';
      const res = store.addEntry({
        d: targetDate,
        t: toTimeStr(),
        k: activeKind,
        m: totalToRecord,
        mod: modSel.value,
        act: finalAct,
        catalogId: activeKind === 'a' ? '' : chosenCat,
        note: item.title,
        sessionMin
      });
      closeModal();
      const wasPulled = (item.pulledFromDate && item.pulledFromDate > (item.d || today)) || (item.d && item.d > today);
      const relievedDate = item.pulledFromDate || (item.d && item.d > today ? item.d : '');
      const relievedLabel = relievedDate ? `${WEEKDAYS_DE[parseDateStr(relievedDate).getDay()]} (${fmtDateShort(relievedDate)})` : 'deine Restwoche';
      toast(
        res.ok
          ? (wasPulled
              ? `Stark vorgearbeitet! +${sessionMin} min gespeichert — ${relievedLabel} ist jetzt spürbar leichter.`
              : modeUsed === 'total'
                ? `Stand ${totalToRecord} min (+${sessionMin} min) für „${item.title}“ gespeichert.`
                : `+${sessionMin} min für „${item.title}“ gespeichert (Stand: ${totalToRecord} min).`)
          : res.message,
        res.ok ? 'ok' : 'err'
      );
    };

    syncActLock();
    refreshPreview();

    // 1-Tap immediate save on duration chips
    modalEl.querySelectorAll('[data-quick-min]').forEach((btn) => {
      btn.addEventListener('click', () => {
        commitMinutes(Number(btn.getAttribute('data-quick-min')), 'add');
      });
    });

    inp.addEventListener('input', refreshPreview);
    kindSel.addEventListener('change', () => { syncActLock(); refreshPreview(); });
    modSel?.addEventListener('change', refreshDetailsSummary);
    actSel?.addEventListener('change', refreshDetailsSummary);
    catSel?.addEventListener('change', refreshDetailsSummary);
    dateEl?.addEventListener('change', refreshPreview);
    modalEl.querySelector('#qlm-pick-orig')?.addEventListener('click', () => {
      if (dateEl && item.d) {
        dateEl.value = item.d;
        refreshPreview();
      }
    });

    modalEl.querySelectorAll('[data-qlm]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const next = btn.getAttribute('data-qlm');
        if (next === logMode) return;
        logMode = next;
        modalEl.querySelectorAll('[data-qlm]').forEach((b) => b.classList.toggle('active', b === btn));
        inp.value = '';
        refreshPreview();
        inp.focus();
      });
    });

    modalEl.querySelector('#qlm-close')?.addEventListener('click', closeModal);
    modalEl.querySelector('#qlm-skip')?.addEventListener('click', () => {
      closeModal();
      toast(`„${item.title}“ abgehakt (ohne Zeit-Eintrag).`);
    });

    modalEl.querySelector('#qlm-form')?.addEventListener('submit', (e) => {
      e.preventDefault();
      commitMinutes(inp.value);
    });
  });
}

// ---------- Pairing Handler (#pair=...) for Pixel 9a (#8) ----------

async function applyPairingObject(obj, { preferRemote = true, syncAfter = true } = {}) {
  if (!obj || typeof obj !== 'object') throw new Error('Ungültige Kopplungsdaten.');
  if (obj.gt) store.secrets.githubToken = String(obj.gt).replace(/\s+/g, '');
  if (obj.gid) store.secrets.gistId = String(obj.gid).trim();
  store.secrets.autoSync = true;
  store.saveSecrets({ silent: true });
  if (obj.ak) {
    store.state.ai.apiKey = String(obj.ak).replace(/\s+/g, '');
    store.save({ skipSync: true, preserveTimestamp: true });
  }
  toast('Gerät gekoppelt! Lade Cloud-Daten...', 'ok');
  if (syncAfter && store.secrets.githubToken && store.secrets.gistId) {
    const res = await pullFromGist({ preferRemote });
    if (res.ok) {
      const s = res.summary || store.secrets.lastRemoteSummary;
      toast(s ? `Gekoppelt! Geladen: ${s.chk} Todos · ${s.anki} Ankis` : 'Cloud-Sync auf diesem Gerät aktiv!', 'ok');
    } else {
      toast(`Kopplung ok, aber Cloud-Laden fehlgeschlagen: ${res.error || res.reason}`, 'err');
    }
  }
}

function confirmAndApplyPairing(obj, { isPinProtected = false } = {}) {
  if (!obj || typeof obj !== 'object' || (!obj.gt && !obj.gid && !obj.ak)) {
    toast('Ungültige Kopplungsdaten.', 'err');
    return;
  }
  const hasExistingCreds = Boolean(store.secrets.githubToken || store.secrets.gistId);
  const isFreshDevice = store.state.e.length === 0 && (store.state.checklist || []).length === 0;
  const gidRaw = String(obj.gid || '').trim();
  const gidShort = gidRaw ? `${gidRaw.slice(0, 8)}…${gidRaw.slice(-4)}` : '—';
  const sameGist = Boolean(gidRaw && store.secrets.gistId && gidRaw === store.secrets.gistId);
  const includesKey = Boolean(obj.ak);

  openModal(`
    <div class="card-header">
      <h3 class="card-title">Gerät wirklich koppeln?</h3>
      <button class="icon-btn" id="pair-confirm-close">${icon('x', 15)}</button>
    </div>
    <p class="xs muted" style="margin-top:0;">
      Prüfe kurz, ob dieser Kopplungs-Code wirklich von deinem eigenen Gerät stammt (${isPinProtected ? 'PIN-entsperrt' : 'unverschlüsselter Code'}):
    </p>
    <div class="stack-sm xs" style="padding:10px 12px;border-radius:10px;background:var(--bg-elev);border:1px solid var(--border);margin-bottom:12px;">
      <div class="row-between">
        <span class="muted">Ziel-Gist-ID</span>
        <span class="mono" style="font-weight:600;">${escapeHtml(gidShort)}</span>
      </div>
      <div class="row-between">
        <span class="muted">GitHub-Token enthalten</span>
        <span>${obj.gt ? 'Ja' : 'Nein'}</span>
      </div>
      <div class="row-between">
        <span class="muted">Gemini API-Key enthalten</span>
        <span>${includesKey ? 'Ja' : 'Nein'}</span>
      </div>
    </div>
    ${hasExistingCreds ? `
      <div class="xs" style="padding:9px 11px;border-radius:10px;background:rgba(248,113,113,.12);border:1px solid rgba(248,113,113,.35);color:var(--danger);margin-bottom:12px;">
        <strong>Achtung:</strong> Auf diesem Gerät ist bereits ein GitHub-Gist konfiguriert${sameGist ? ' (gleiche Gist-ID)' : ' (<strong>andere Gist-ID!</strong>)'}. Durch Bestätigen werden die gespeicherten Zugangsdaten ersetzt.
      </div>
    ` : ''}
    ${!isFreshDevice ? `
      <p class="xs muted" style="margin-top:0;margin-bottom:12px;">
        Auf diesem Gerät liegen bereits lokale Daten (${store.state.e.length} Zeit-Einträge, ${(store.state.checklist || []).length} Todos). Wähle aus, wie die Cloud-Daten geladen werden sollen:
      </p>
      <div class="row" style="justify-content:flex-end;gap:8px;flex-wrap:wrap;">
        <button type="button" class="btn btn-sm" id="pair-cancel">Abbrechen</button>
        <button type="button" class="btn btn-sm" id="pair-merge">Zusammenführen & syncen</button>
        <button type="button" class="btn btn-primary btn-sm" id="pair-remote">Cloud laden (lokal ersetzen)</button>
      </div>
    ` : `
      <div class="row" style="justify-content:flex-end;gap:8px;flex-wrap:wrap;">
        <button type="button" class="btn btn-sm" id="pair-cancel">Abbrechen</button>
        <button type="button" class="btn btn-primary btn-sm" id="pair-remote">Bestätigen & Cloud laden</button>
      </div>
    `}
  `, (modalEl) => {
    modalEl.querySelector('#pair-confirm-close')?.addEventListener('click', closeModal);
    modalEl.querySelector('#pair-cancel')?.addEventListener('click', () => {
      closeModal();
      toast('Kopplung abgebrochen.');
    });
    modalEl.querySelector('#pair-remote')?.addEventListener('click', async () => {
      closeModal();
      try {
        await applyPairingObject(obj, { preferRemote: true, syncAfter: true });
      } catch (err) {
        toast(err.message, 'err');
      }
    });
    modalEl.querySelector('#pair-merge')?.addEventListener('click', async () => {
      closeModal();
      try {
        await applyPairingObject(obj, { preferRemote: false, syncAfter: true });
      } catch (err) {
        toast(err.message, 'err');
      }
    });
  });
}

function handlePairingCodeFlow(code) {
  const needPin = isPinProtectedPairingCode(code);
  if (!needPin) {
    decodePairingCode(code)
      .then((obj) => confirmAndApplyPairing(obj, { isPinProtected: false }))
      .catch((err) => toast(err.message, 'err'));
    return;
  }
  openModal(`
    <div class="card-header">
      <h3 class="card-title">Gerät koppeln (PIN-geschützt)</h3>
      <button class="icon-btn" id="m-close">${icon('x', 15)}</button>
    </div>
    <p class="xs muted" style="margin-top:0;">Gib die PIN ein, die du beim Erstellen des QR-Codes am Laptop vergeben hast.</p>
    <form id="pair-pin-form" class="stack">
      <input type="password" id="pair-pin-inp" class="input mono" placeholder="PIN" autofocus required />
      <div class="row" style="justify-content:flex-end;">
        <button type="submit" class="btn btn-primary btn-sm">Entsperren</button>
      </div>
    </form>
  `, (modalEl) => {
    modalEl.querySelector('#m-close')?.addEventListener('click', closeModal);
    modalEl.querySelector('#pair-pin-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const obj = await decodePairingCode(code, modalEl.querySelector('#pair-pin-inp').value);
        closeModal();
        confirmAndApplyPairing(obj, { isPinProtected: true });
      } catch (err) {
        toast(err.message, 'err');
      }
    });
  });
}

function checkUrlPairingHash() {
  const hash = location.hash || '';
  if (!hash.startsWith('#pair=')) return;
  const code = decodeURIComponent(hash.slice(6));
  history.replaceState(null, '', location.pathname + location.search);
  if (code) setTimeout(() => handlePairingCodeFlow(code), 80);
}

// ---------- Theme, Sync Pills & Navigation ----------

function applyTheme(mode) {
  const root = document.documentElement;
  const eff = mode || 'dark';
  root.setAttribute('data-theme', eff);
  const icoName = eff === 'light' ? 'sun' : 'moon';
  ['theme-toggle-desktop', 'theme-toggle-mobile'].forEach((id) => {
    const btn = document.getElementById(id);
    if (btn) btn.innerHTML = icon(icoName, 15);
  });
}

function cycleTheme() {
  const order = ['dark', 'light', 'auto'];
  const idx = order.indexOf(store.state.theme || 'dark');
  store.state.theme = order[(idx + 1) % order.length];
  applyTheme(store.state.theme);
  store.save({ skipSync: true });
  const labels = { dark: 'Schwarz', light: 'Hell', auto: 'System' };
  toast(`Design: ${labels[store.state.theme]}`);
}

function updateSyncPills() {
  const st = store.secrets.lastSyncStatus || 'local';
  const configured = isGistConfigured() && Boolean(store.secrets.gistId);
  const label = !configured ? 'Lokal' : st === 'syncing' ? 'Synct...' : st === 'err' ? 'Sync-Fehler' : 'Cloud OK';

  ['sync-pill-desktop', 'sync-pill-mobile'].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.className = `sync-pill ${id.includes('mobile') ? 'compact' : ''} ${configured ? st : ''}`;
    const txt = el.querySelector('.sync-text');
    if (txt) txt.textContent = label;
  });
}

function renderBanners() {
  const banners = [];
  const sevenDaysMs = 7 * 24 * 3600 * 1000;
  const hasData = store.state.e.length > 0;
  const backupStale = !store.state.lb || (Date.now() - store.state.lb > sevenDaysMs);
  const cloudActive = isGistConfigured() && Boolean(store.secrets.gistId);

  if (store.lastStorageError) {
    banners.push(`
      <div class="banner warn" style="border-color:var(--danger);color:var(--danger);">
        <span><strong>Speicher-Warnung:</strong> ${escapeHtml(store.lastStorageError)}</span>
        <button class="btn btn-xs btn-primary" id="banner-storage-go">Backup</button>
      </div>
    `);
  }

  if (hasData && backupStale && !cloudActive) {
    banners.push(`
      <div class="banner warn">
        <span>Letztes Backup älter als 7 Tage (Cloud-Sync ist noch aus).</span>
        <button class="btn btn-xs btn-primary" id="banner-backup-go">Backup / Sync</button>
      </div>
    `);
  }

  bannersRoot.innerHTML = banners.join('');
  document.getElementById('banner-backup-go')?.addEventListener('click', () => {
    navigate('more', { subtab: 'settings' });
  });
  document.getElementById('banner-storage-go')?.addEventListener('click', () => {
    navigate('more', { subtab: 'settings' });
  });
}

function navigate(tab, opts = {}) {
  if (!TABS.includes(tab)) return;
  if (currentTab === 'today' && tab !== 'today') cleanupTodayView();
  currentTab = tab;
  if (tab === 'more' && opts.subtab) setMoreSubtab(opts.subtab);
  if (tab === 'planner' && opts.autoAudit) queuePlanAudit();
  if (tab === 'planner' && opts.autoReview) queueWeeklyReview();

  document.querySelectorAll('[data-tab]').forEach((el) => {
    el.classList.toggle('active', el.getAttribute('data-tab') === tab);
  });
  if (mobileTitle) mobileTitle.textContent = TAB_TITLES[tab];

  renderCurrentView();
  window.scrollTo({ top: 0, behavior: 'instant' });
}

function renderCurrentView({ preserveDrafts = false } = {}) {
  const draftSnap = preserveDrafts ? captureViewDrafts() : null;
  updateSyncPills();
  renderBanners();
  const ctx = {
    toast,
    navigate,
    openModal,
    closeModal,
    applyTheme,
    promptLogFromChecklist,
    handlePairingCodeFlow
  };

  if (currentTab === 'today') renderTodayView(viewRoot, ctx);
  else if (currentTab === 'week') renderWeekView(viewRoot, ctx);
  else if (currentTab === 'planner') renderPlannerView(viewRoot, ctx);
  else if (currentTab === 'stats') renderStatsView(viewRoot, ctx);
  else if (currentTab === 'more') renderMoreView(viewRoot, ctx);

  if (draftSnap) restoreViewDrafts(draftSnap);
}

// Navigation & Keyboard Shortcuts (1-5 switch tabs, N focuses quick add, Strg+Z undoes)
document.querySelectorAll('[data-tab]').forEach((btn) => {
  btn.addEventListener('click', () => navigate(btn.getAttribute('data-tab')));
});

document.addEventListener('keydown', (e) => {
  const inInput = e.target.matches('input, textarea, select');
  if (!inInput && (e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z') {
    if (store.canUndo()) {
      e.preventDefault();
      const undone = store.undo();
      if (undone) toast(`Rückgängig: ${undone}`, 'ok');
    }
    return;
  }
  if (inInput || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === 'Escape' && !modalRoot.classList.contains('hidden')) { closeModal(); return; }
  if (['1', '2', '3', '4', '5'].includes(e.key)) {
    navigate(TABS[Number(e.key) - 1]);
  } else if (e.key.toLowerCase() === 'n' && currentTab === 'today') {
    e.preventDefault();
    document.getElementById('tchk-title')?.focus();
  }
});

document.getElementById('theme-toggle-desktop')?.addEventListener('click', cycleTheme);
document.getElementById('theme-toggle-mobile')?.addEventListener('click', cycleTheme);

['sync-pill-desktop', 'sync-pill-mobile'].forEach((id) => {
  document.getElementById(id)?.addEventListener('click', async () => {
    if (!isGistConfigured()) { navigate('more', { subtab: 'settings' }); return; }
    const res = await syncNow();
    if (res.ok) {
      const s = res.summary || store.secrets.lastRemoteSummary;
      const info = s ? ` (Gist: ${s.chk} Todos · ${s.anki} Ankis)` : '';
      toast(`Sync OK${info}`, 'ok');
    } else {
      toast(`Sync-Fehler: ${res.error || res.reason}`, 'err');
    }
  });
});

// Touch swipe between tabs on mobile (strict horizontal threshold + ignore interactive rows)
let touchStartX = 0;
let touchStartY = 0;
viewRoot.addEventListener('touchstart', (e) => {
  if (e.touches.length !== 1) return;
  touchStartX = e.touches[0].clientX;
  touchStartY = e.touches[0].clientY;
}, { passive: true });

viewRoot.addEventListener('touchend', (e) => {
  if (!e.changedTouches.length) return;
  const dx = e.changedTouches[0].clientX - touchStartX;
  const dy = e.changedTouches[0].clientY - touchStartY;
  if (Math.abs(dx) <= 95 || Math.abs(dy) >= 35) return;
  if (e.target.closest('.chart-box, .heatmap-wrap, .chip-row, .segmented, .quick-dur-chips, input, textarea, select')) return;

  const idx = TABS.indexOf(currentTab);
  if (dx < 0 && idx < TABS.length - 1) navigate(TABS[idx + 1]);
  else if (dx > 0 && idx > 0) navigate(TABS[idx - 1]);
}, { passive: true });

store.setReconcileHook(reconcileBacklogStatus);
store.onStorageError((msg, severity) => {
  renderBanners();
  toast(msg, severity === 'warn' ? '' : 'err');
});

store.subscribe((state, meta = {}) => {
  // Typing & modal protection: defer background-sync re-renders while user is editing an input, modal is open, or window is blurred (Alt-Tab)!
  if (meta?.fromBackgroundSync && (isUserActivelyEditing() || !document.hasFocus())) {
    deferredRender = true;
    updateSyncPills();
    renderBanners();
    return;
  }
  deferredRender = false;
  renderCurrentView({ preserveDrafts: Boolean(meta?.fromBackgroundSync) });
});

document.addEventListener('focusout', () => {
  if (!deferredRender) return;
  setTimeout(flushDeferredRenderIfReady, 150);
});

window.addEventListener('focus', () => {
  if (!deferredRender) return;
  setTimeout(flushDeferredRenderIfReady, 150);
});

store.onSyncTrigger(() => scheduleAutoSync());
onSyncStatusChange(() => updateSyncPills());

const expiredOnBoot = store.checkExpiredTimer();
if (expiredOnBoot) toast(expiredOnBoot.message, 'ok');

if (store.state.autoLogLectures) syncRecentLecturesToProductive(toDateStr(), { save: true });

setInterval(() => {
  const exp = store.checkExpiredTimer();
  if (exp) toast(exp.message, 'ok');
  if (store.state.autoLogLectures) syncDayLecturesToProductive(toDateStr(), { save: true });
}, 30000);

async function backgroundSync({ showToast = false } = {}) {
  if (isGistConfigured() && store.secrets.gistId) {
    const res = await syncNow({ fromBackgroundSync: true });
    if (showToast && res.ok && (res.updatedState || res.updatedIcs)) {
      toast(res.updatedIcs ? 'KIT-Kalender & Cloud-Daten aktualisiert.' : 'Cloud-Daten synchronisiert.', 'ok');
    } else if (showToast && !res.ok && res.error) {
      toast(`Cloud-Sync fehlgeschlagen: ${res.error}`, 'err');
    }
  }
}

window.addEventListener('online', () => {
  backgroundSync({ showToast: true });
});

let swReg = null;
const hadSwController = Boolean('serviceWorker' in navigator && navigator.serviceWorker.controller);
let swReloading = false;

// Periodic background sync every 45s while app is open (keeps Laptop <-> Pixel 9a in sync without re-rendering if unchanged)
setInterval(() => {
  if (document.visibilityState === 'visible') {
    backgroundSync({ showToast: false });
  }
}, 45000);

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    flushPendingSync();
  } else if (document.visibilityState === 'visible') {
    const exp = store.checkExpiredTimer();
    if (exp) toast(exp.message, 'ok');
    if (swReg) swReg.update().catch(() => {});
    backgroundSync({ showToast: true });
  }
});

window.addEventListener('pagehide', () => {
  flushPendingSync();
});

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadSwController && !swReloading) {
      swReloading = true;
      location.reload();
    }
  });
  navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' })
    .then((reg) => {
      swReg = reg;
      reg.update().catch(() => {});
    })
    .catch(() => {});
}

applyTheme(store.state.theme || 'dark');
renderCurrentView();
checkUrlPairingHash();
backgroundSync({ showToast: true });

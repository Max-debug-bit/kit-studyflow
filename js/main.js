// Main bootstrap: monochrome icons, keyboard shortcuts (1-5, N, Strg+Z), Undo Toast,
// Checklist->Log floating bar (#1), Pixel 9a #pair= QR onboarding (#8), auto-lecture sync & PWA SW

import { store, toDateStr, toTimeStr } from './store.js';
import { scheduleAutoSync, flushPendingSync, syncNow, pullFromGist, isGistConfigured, onSyncStatusChange } from './sync.js';
import { syncDayLecturesToProductive } from './checklist.js';
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
let quickLogTimer = null;

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
}

// ---------- Checklist -> Lernzeit-Brücke (#1, without Timer!) ----------

function inferMetaFromChecklistItem(item) {
  const title = item.title || '';
  const lower = title.toLowerCase();
  const kind = item.kind === 'a' || /\banki\b/.test(lower) ? 'a' : item.kind === 'p' ? 'p' : 'l';

  let act = '';
  if (kind === 'a') act = 'anki';
  else if (/video|vl-video/.test(lower)) act = 'video';
  else if (/\bha\b|hausaufgabe|übung/.test(lower)) act = 'homework';
  else if (/nacharbeit|folien|ankis?\s+(für|von|erstellen)/.test(lower)) act = 'review';
  else if (/klausur|altklausur/.test(lower)) act = 'exam';

  let mod = item.moduleId || '';
  if (!mod) {
    const mods = Object.values(store.state.modules || {});
    const keywords = [
      { re: /\bhm\b|höhere math/, match: 'hm' },
      { re: /\btm\b|mechanik/, match: 'tm' },
      { re: /\bmkl\b|konstruktion/, match: 'mkl' },
      { re: /\bwk\b|werkstoff/, match: 'wk' },
      { re: /\bft\b|fertigung/, match: 'ft' }
    ];
    for (const kw of keywords) {
      if (kw.re.test(lower)) {
        const preferredType = act === 'homework' ? 'Ü' : 'V';
        const hit = mods.find((m) => m.shortName.toLowerCase().includes(kw.match) && m.type === preferredType)
                 || mods.find((m) => m.shortName.toLowerCase().includes(kw.match));
        if (hit) { mod = hit.id; break; }
      }
    }
  }

  let estMin = item.estMin || 0;
  if (!estMin) {
    if (kind === 'a') estMin = store.state.anki.minDailyAnkiMin || 30;
    else if (act === 'video') estMin = (mod && store.state.modules[mod]?.videoStudyMinutes) || 150;
    else if (act === 'review') estMin = (mod && store.state.modules[mod]?.liveReviewMinutes) || 75;
    else estMin = 60;
  }

  return { kind, act, mod, estMin };
}

function promptLogFromChecklist(item) {
  document.getElementById('quick-log-bar')?.remove();
  clearTimeout(quickLogTimer);
  if (!item || !item.done) return;

  const meta = inferMetaFromChecklistItem(item);
  const today = toDateStr();
  const before = store.getDayBreakdown(today);
  const kindLabels = { l: 'Lernzeit', a: 'Anki-Lernzeit', p: 'Vorlesung / Produktiv' };
  const escHtml = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  // Default to asking real task duration ('add'), with 1-click switch to Focus-Friend daily total ('total').
  // Input ALWAYS starts EMPTY — never blindly assumes the estimated duration!
  let logMode = 'add';
  let activeKind = meta.kind;
  const moduleOpts = Object.values(store.state.modules || {})
    .map((m) => `<option value="${escHtml(m.id)}" ${m.id === meta.mod ? 'selected' : ''}>${escHtml(m.shortName)}</option>`)
    .join('');

  openModal(`
    <div class="card-header">
      <h3 class="card-title">${icon('check', 15)} Wie lange hat das gedauert?</h3>
      <button class="icon-btn" id="qlm-close" type="button">${icon('x', 15)}</button>
    </div>
    <div class="small" style="font-weight:620;margin-bottom:4px;">${escHtml(item.title)}</div>
    <div class="xs muted" style="margin-bottom:12px;">
      ${item.estMin > 0 ? `Plan-Schätzung war ~${item.estMin} min — trage deine echte Dauer ein (wird nicht blind übernommen).` : 'Trage ein, wie viele Minuten du wirklich dafür gebraucht hast.'}
    </div>
    <form id="qlm-form" class="stack">
      <div class="row-between" style="gap:8px;">
        <div class="segmented" title="Dauer = Minuten dieser Aufgabe · Focus-Friend Stand = Gesamtwert aus Focus Friend">
          <button type="button" data-qlm="add" class="active">Dauer (min)</button>
          <button type="button" data-qlm="total">Focus-Friend Stand</button>
        </div>
        <select id="qlm-kind" class="input" style="width:auto;padding:5px 8px;font-size:0.8rem;">
          <option value="l" ${activeKind === 'l' ? 'selected' : ''}>Lernzeit</option>
          <option value="a" ${activeKind === 'a' ? 'selected' : ''}>Anki-Lernzeit</option>
          <option value="p" ${activeKind === 'p' ? 'selected' : ''}>Vorlesung / Produktiv</option>
        </select>
      </div>

      <div class="field">
        <label id="qlm-min-label">Echte Dauer dieser Aufgabe (Minuten)</label>
        <input type="number" id="qlm-min" class="input mono" min="1" max="1440" placeholder="Minuten eingeben, z. B. 45" autofocus required />
        <div class="xs mono muted" id="qlm-preview" style="margin-top:2px;"></div>
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

      <div class="row-between" style="margin-top:4px;">
        <button type="button" class="btn btn-sm" id="qlm-skip">Ohne Zeit abhaken</button>
        <button type="submit" class="btn btn-primary btn-sm" id="qlm-save">${icon('check', 13)} Zeit speichern</button>
      </div>
    </form>
  `, (modalEl) => {
    const inp = modalEl.querySelector('#qlm-min');
    const lbl = modalEl.querySelector('#qlm-min-label');
    const prevEl = modalEl.querySelector('#qlm-preview');
    const kindSel = modalEl.querySelector('#qlm-kind');
    const actSel = modalEl.querySelector('#qlm-act');
    let lastLearnAct = meta.act && meta.act !== 'anki' ? meta.act : '';

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
    };

    const refreshPreview = () => {
      const curMin = before[activeKind] || 0;
      const val = Math.round(Number(inp.value) || 0);
      if (logMode === 'add') {
        lbl.textContent = 'Echte Dauer dieser Aufgabe (Minuten)';
        inp.placeholder = 'Minuten eingeben, z. B. 45';
        if (val > 0) {
          prevEl.textContent = `Neuer Tagesstand ${kindLabels[activeKind]}: ${curMin + val} min (+${val} min)`;
          prevEl.style.color = 'var(--kit)';
        } else {
          prevEl.textContent = `Aktueller Tagesstand ${kindLabels[activeKind]}: ${curMin} min`;
          prevEl.style.color = 'var(--text-soft)';
        }
      } else {
        lbl.textContent = `Focus-Friend Gesamtstand heute (${kindLabels[activeKind]})`;
        inp.placeholder = `Aktuell ${curMin} min — neuen Gesamtstand abtippen`;
        if (val > 0) {
          const diff = val - curMin;
          prevEl.textContent = diff > 0
            ? `Block-Dauer: +${diff} min (vorher ${curMin} min → neu ${val} min)`
            : `Wert ≤ aktueller Stand (${curMin} min)`;
          prevEl.style.color = diff > 0 ? 'var(--kit)' : 'var(--danger)';
        } else {
          prevEl.textContent = `Aktueller Stand: ${curMin} min`;
          prevEl.style.color = 'var(--text-soft)';
        }
      }
    };

    syncActLock();
    refreshPreview();
    setTimeout(() => inp?.focus(), 30);

    inp.addEventListener('input', refreshPreview);
    kindSel.addEventListener('change', () => { syncActLock(); refreshPreview(); });

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
      const val = Math.round(Number(inp.value) || 0);
      if (val <= 0) {
        toast('Bitte gib eine echte Minutenzahl ein (oder klicke „Ohne Zeit abhaken“).', 'err');
        inp.focus();
        return;
      }
      const curMin = before[activeKind] || 0;
      let totalToRecord;
      let sessionMin;
      if (logMode === 'total') {
        totalToRecord = val;
        sessionMin = val > curMin ? val - curMin : val;
      } else {
        sessionMin = val;
        totalToRecord = store.state.mode === 'sum' ? val : curMin + val;
      }
      const finalAct = activeKind === 'a' ? 'anki' : activeKind === 'p' ? '' : actSel.value;
      const res = store.addEntry({
        d: today,
        t: toTimeStr(),
        k: activeKind,
        m: totalToRecord,
        mod: modalEl.querySelector('#qlm-mod').value,
        act: finalAct,
        note: item.title,
        sessionMin
      });
      closeModal();
      toast(
        res.ok
          ? (logMode === 'total'
              ? `Stand ${totalToRecord} min (+${sessionMin} min) für „${item.title}“ gespeichert.`
              : `+${sessionMin} min für „${item.title}“ gespeichert (Stand: ${totalToRecord} min).`)
          : res.message,
        res.ok ? 'ok' : 'err'
      );
    });
  });
}

// ---------- Pairing Handler (#pair=...) for Pixel 9a (#8) ----------

async function applyPairingObject(obj) {
  if (!obj || typeof obj !== 'object') throw new Error('Ungültige Kopplungsdaten.');
  if (obj.gt) store.secrets.githubToken = obj.gt;
  if (obj.gid) store.secrets.gistId = obj.gid;
  store.secrets.autoSync = true;
  store.saveSecrets();
  if (obj.ak) {
    store.state.ai.apiKey = obj.ak;
    store.save({ skipSync: true });
  }
  toast('Gerät gekoppelt! Lade Cloud-Daten...', 'ok');
  if (store.secrets.githubToken && store.secrets.gistId) {
    const res = await pullFromGist({ preferRemote: false });
    if (res.ok) toast('Cloud-Sync auf diesem Gerät aktiv!', 'ok');
  }
}

function handlePairingCodeFlow(code) {
  const needPin = isPinProtectedPairingCode(code);
  if (!needPin) {
    decodePairingCode(code).then(applyPairingObject).catch((err) => toast(err.message, 'err'));
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
        <button type="submit" class="btn btn-primary btn-sm">Entsperren & koppeln</button>
      </div>
    </form>
  `, (modalEl) => {
    modalEl.querySelector('#m-close')?.addEventListener('click', closeModal);
    modalEl.querySelector('#pair-pin-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const obj = await decodePairingCode(code, modalEl.querySelector('#pair-pin-inp').value);
        closeModal();
        await applyPairingObject(obj);
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

function renderCurrentView() {
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
    if (res.ok) toast('Mit GitHub Gist synchronisiert.', 'ok');
    else toast(`Sync-Fehler: ${res.error || res.reason}`, 'err');
  });
});

// Touch swipe between tabs on mobile
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
  if (Math.abs(dx) < 75 || Math.abs(dy) > Math.abs(dx) * 0.6) return;
  if (e.target.closest('.chart-box, .heatmap-wrap, input, textarea, select')) return;

  const idx = TABS.indexOf(currentTab);
  if (dx < 0 && idx < TABS.length - 1) navigate(TABS[idx + 1]);
  else if (dx > 0 && idx > 0) navigate(TABS[idx - 1]);
}, { passive: true });

// Diagnostics
let lastBeat = performance.now();
setInterval(() => {
  const now = performance.now();
  const delta = now - lastBeat;
  lastBeat = now;
  const lag = delta - 1000;
  if (delta > (store.state.dg.tmax || 0) && delta < 10000) store.state.dg.tmax = Number(delta.toFixed(1));
  if (lag > 250 && document.visibilityState === 'visible') {
    store.state.dg.n = (store.state.dg.n || 0) + 1;
    if (lag > (store.state.dg.max || 0)) store.state.dg.max = Math.round(lag);
    store.state.dg.at = Date.now();
  }
}, 1000);

store.subscribe(() => renderCurrentView());
store.onSyncTrigger(() => scheduleAutoSync());
onSyncStatusChange(() => updateSyncPills());

const expiredOnBoot = store.checkExpiredTimer();
if (expiredOnBoot) toast(expiredOnBoot.message, 'ok');

if (store.state.autoLogLectures) syncDayLecturesToProductive(toDateStr(), { save: true });

setInterval(() => {
  const exp = store.checkExpiredTimer();
  if (exp) toast(exp.message, 'ok');
  if (store.state.autoLogLectures) syncDayLecturesToProductive(toDateStr(), { save: true });
}, 30000);

async function backgroundSync({ showToast = false } = {}) {
  if (isGistConfigured() && store.secrets.gistId) {
    const res = await syncNow();
    if (showToast && res.ok && (res.updatedState || res.updatedIcs)) {
      toast(res.updatedIcs ? 'KIT-Kalender & Cloud-Daten aktualisiert.' : 'Cloud-Daten synchronisiert.', 'ok');
    }
  }
}

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
    backgroundSync({ showToast: true });
  }
});

window.addEventListener('pagehide', () => {
  flushPendingSync();
});

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

applyTheme(store.state.theme || 'dark');
renderCurrentView();
checkUrlPairingHash();
backgroundSync({ showToast: true });

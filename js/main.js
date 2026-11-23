// Main bootstrap: monochrome icons, keyboard shortcuts (1-5, N, Strg+Z), Undo Toast,
// Checklist->Log floating bar (#1), Pixel 9a #pair= QR onboarding (#8), auto-lecture sync & PWA SW

import { store, toDateStr, toTimeStr } from './store.js';
import { scheduleAutoSync, syncNow, pullFromGist, isGistConfigured } from './sync.js';
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
  const currentKindMin = before[meta.kind] || 0;
  // Default to Focus-Friend total-stand mode when mode === 'max' or 'last' (#1)
  let logMode = store.state.mode === 'sum' ? 'add' : 'total';

  const bar = document.createElement('div');
  bar.id = 'quick-log-bar';
  bar.className = 'quick-log-bar';

  const modLabel = meta.mod && store.state.modules[meta.mod] ? store.state.modules[meta.mod].shortName : '';
  const initialVal = logMode === 'total' ? currentKindMin + meta.estMin : meta.estMin;

  bar.innerHTML = `
    <div style="flex:1;min-width:160px;">
      <div class="xs muted">
        ${meta.kind === 'a' ? 'Anki' : 'Focus-Friend'} loggen${modLabel ? ` · ${modLabel}` : ''}
        <span id="qlb-delta" class="mono" style="color:var(--kit);margin-left:4px;"></span>
      </div>
      <div class="small" style="font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${item.title.replace(/</g, '&lt;')}</div>
    </div>
    <div class="row" style="gap:6px;flex-wrap:nowrap;">
      <div class="segmented" style="padding:2px;" title="Stand = Gesamtstand aus Focus Friend abtippen · +Min = Block-Dauer addieren">
        <button type="button" data-qlm="total" class="${logMode === 'total' ? 'active' : ''}" style="padding:3px 7px;font-size:0.72rem;">Stand</button>
        <button type="button" data-qlm="add" class="${logMode === 'add' ? 'active' : ''}" style="padding:3px 7px;font-size:0.72rem;">+Min</button>
      </div>
      <input type="number" id="qlb-min" class="input mono" style="width:76px;padding:5px 8px;" min="1" max="1440" value="${initialVal}" />
      <button class="btn btn-primary btn-sm" id="qlb-save">Loggen</button>
      <button class="btn btn-xs btn-ghost" id="qlb-close">${icon('x', 13)}</button>
    </div>
  `;
  document.body.appendChild(bar);

  const inp = bar.querySelector('#qlb-min');
  const deltaEl = bar.querySelector('#qlb-delta');

  const refreshDelta = () => {
    const val = Math.round(Number(inp.value) || 0);
    if (logMode === 'total') {
      const diff = val - currentKindMin;
      deltaEl.textContent = diff > 0
        ? `(+${diff} min Block · vorher ${currentKindMin}m)`
        : `(≤ aktueller Stand ${currentKindMin}m)`;
      deltaEl.style.color = diff > 0 ? 'var(--kit)' : 'var(--text-soft)';
    } else {
      deltaEl.textContent = `(neuer Stand: ${currentKindMin + val} min)`;
      deltaEl.style.color = 'var(--kit)';
    }
  };
  refreshDelta();
  inp.addEventListener('input', refreshDelta);

  bar.querySelectorAll('[data-qlm]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const next = btn.getAttribute('data-qlm');
      if (next === logMode) return;
      logMode = next;
      bar.querySelectorAll('[data-qlm]').forEach((b) => b.classList.toggle('active', b === btn));
      inp.value = logMode === 'total' ? currentKindMin + meta.estMin : meta.estMin;
      refreshDelta();
    });
  });

  const scheduleHide = () => {
    clearTimeout(quickLogTimer);
    quickLogTimer = setTimeout(() => bar.remove(), 11000);
  };
  scheduleHide();

  bar.addEventListener('pointerenter', () => clearTimeout(quickLogTimer));
  bar.addEventListener('focusin', () => clearTimeout(quickLogTimer));
  bar.addEventListener('pointerleave', scheduleHide);

  bar.querySelector('#qlb-close')?.addEventListener('click', () => {
    clearTimeout(quickLogTimer);
    bar.remove();
  });

  bar.querySelector('#qlb-save')?.addEventListener('click', () => {
    const val = Math.max(1, Math.round(Number(inp.value) || 0));
    let totalToRecord, sessionMin;
    if (logMode === 'total') {
      totalToRecord = val;
      sessionMin = val > currentKindMin ? val - currentKindMin : val;
    } else {
      sessionMin = val;
      totalToRecord = store.state.mode === 'sum' ? val : currentKindMin + val;
    }
    const res = store.addEntry({
      d: today,
      t: toTimeStr(),
      k: meta.kind,
      m: totalToRecord,
      mod: meta.mod,
      act: meta.act,
      note: item.title,
      sessionMin
    });
    clearTimeout(quickLogTimer);
    bar.remove();
    toast(
      res.ok
        ? (logMode === 'total' ? `Stand ${totalToRecord} min (+${sessionMin} min) für „${item.title}“ geloggt.` : `+${sessionMin} min für „${item.title}“ geloggt.`)
        : res.message,
      res.ok ? 'ok' : 'err'
    );
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

const expiredOnBoot = store.checkExpiredTimer();
if (expiredOnBoot) toast(expiredOnBoot.message, 'ok');

if (store.state.autoLogLectures) syncDayLecturesToProductive(toDateStr(), { save: true });

setInterval(() => {
  const exp = store.checkExpiredTimer();
  if (exp) toast(exp.message, 'ok');
  if (store.state.autoLogLectures) syncDayLecturesToProductive(toDateStr(), { save: true });
}, 30000);

async function backgroundPull() {
  if (isGistConfigured() && store.secrets.gistId) {
    const res = await pullFromGist({ preferRemote: false });
    if (res.ok && (res.updatedState || res.updatedIcs)) {
      toast(res.updatedIcs ? 'KIT-Kalender & Cloud-Daten aktualisiert.' : 'Cloud-Daten synchronisiert.', 'ok');
    }
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    const exp = store.checkExpiredTimer();
    if (exp) toast(exp.message, 'ok');
    backgroundPull();
  }
});

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

applyTheme(store.state.theme || 'dark');
renderCurrentView();
checkUrlPairingHash();
backgroundPull();

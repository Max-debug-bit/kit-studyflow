// Central reactive store for KIT StudyFlow (100% compatible with Fokus-Tracker backup JSON)

const STORAGE_KEY = 'kit_studyflow_state_v1';
const SECRETS_KEY = 'kit_studyflow_secrets_v1';

export const HALF_LIFE_HOURS = 5;

export const LEVELS = [
  { name: 'Starter', minHours: 0 },
  { name: 'Lehrling', minHours: 5 },
  { name: 'Dranbleiber', minHours: 15 },
  { name: 'Routine-Profi', minHours: 35 },
  { name: 'Deep-Worker', minHours: 75 },
  { name: 'Studien-Maschine', minHours: 150 },
  { name: 'Fokus-Meister', minHours: 300 },
  { name: 'Fokus-Gott', minHours: 500 }
];

export const WEEKDAYS_DE = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
export const WEEKDAYS_MON = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

export const DEFAULT_TASK_CATALOG = [
  { id: 'cat_hm_video', subject: 'HM I', title: 'HM: VL-Video durcharbeiten (inkl. Pausieren)', act: 'video', kind: 'l', defaultMin: 110, notes: 'Video-Modus, ohne Ankis', source: 'default' },
  { id: 'cat_hm_ha', subject: 'HM I', title: 'HM: Hausaufgabe / Übungsblatt (Verständnis)', act: 'homework', kind: 'l', defaultMin: 120, notes: 'Ohne Abgabedruck', source: 'default' },
  { id: 'cat_hm_ueb', subject: 'HM I', title: 'HM: Übung nacharbeiten / Aufgaben rechnen', act: 'exam', kind: 'l', defaultMin: 60, notes: 'Falls in Übung was offen blieb', source: 'default' },
  { id: 'cat_tm_vl', subject: 'TM I', title: 'TM: VL nacharbeiten + Ankis erstellen', act: 'review', kind: 'l', defaultMin: 45, notes: 'Nach Live-VL', source: 'default' },
  { id: 'cat_tm_ha', subject: 'TM I', title: 'TM: Hausaufgabe / Aufgabenblatt (Verständnis)', act: 'homework', kind: 'l', defaultMin: 120, notes: 'Ohne Abgabedruck', source: 'default' },
  { id: 'cat_tm_tut', subject: 'TM I', title: 'TM: Tutorium / Aufgaben nachrechnen', act: 'exam', kind: 'l', defaultMin: 60, notes: 'Aktiv rechnen', source: 'default' },
  { id: 'cat_mkl_vl', subject: 'MKL A', title: 'MKL: VL nacharbeiten + Ankis erstellen', act: 'review', kind: 'l', defaultMin: 75, notes: 'Nur nach Live-VL', source: 'default' },
  { id: 'cat_mkl_praxis', subject: 'MKL A', title: 'MKL: Zeichnen / Skizzieren / Workshop-Vorbereitung', act: 'homework', kind: 'l', defaultMin: 90, notes: 'Praxis / Konstruktion', source: 'default' },
  { id: 'cat_wk_vl', subject: 'WK I', title: 'WK: VL nacharbeiten + Ankis erstellen', act: 'review', kind: 'l', defaultMin: 75, notes: 'Folien + Karten', source: 'default' },
  { id: 'cat_ft_vl', subject: 'FT', title: 'FT: VL nacharbeiten + Ankis erstellen', act: 'review', kind: 'l', defaultMin: 60, notes: 'Folien + Karten', source: 'default' },
  { id: 'cat_anki_create', subject: 'Anki', title: 'Ankis nachholen / erstellen (eine Runde)', act: 'review', kind: 'l', defaultMin: 45, notes: 'Karten schreiben (Reviews laufen dynamisch)', source: 'default' },
  { id: 'cat_exam', subject: 'Klausur', title: 'Altklausur / Übungsblock rechnen', act: 'exam', kind: 'l', defaultMin: 90, notes: 'Aktives Üben', source: 'default' },
  { id: 'cat_summary', subject: 'Klausur', title: 'Zusammenfassung / Formelsammlung schreiben', act: 'review', kind: 'l', defaultMin: 60, notes: 'Überblick bauen', source: 'default' },
  { id: 'cat_reset', subject: 'Orga', title: 'Einstieg / Folien sichten / Orga', act: '', kind: 'l', defaultMin: 30, notes: 'Niedrige Hürde an müden Tagen', source: 'default' },
  { id: 'cat_spanish', subject: 'Sprache', title: 'Spanisch lernen', act: '', kind: 'l', defaultMin: 30, notes: 'Optional', source: 'default' }
];

export function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function isValidIsoDate(str) {
  if (typeof str !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(str)) return false;
  const [y, m, d] = str.split('-').map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

export function isValidTimeStr(str) {
  return typeof str === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(str.trim());
}

export function isAnkiDeckExcluded(fullName = '', shortName = '', excludedDecks = []) {
  if (!Array.isArray(excludedDecks) || !excludedDecks.length) return false;
  const path = String(fullName || shortName || '');
  const leaf = String(shortName || path.split('::').pop() || '');
  for (const ex of excludedDecks) {
    if (!ex) continue;
    if (path === ex || leaf === ex || path.startsWith(`${ex}::`)) return true;
  }
  return false;
}

export function filterLeafAnkiDecks(decks = [], excludedDecks = []) {
  if (!Array.isArray(decks) || !decks.length) return [];
  const fullPaths = new Set(decks.map((d) => d?.fullName || d?.name).filter(Boolean));
  return decks.filter((d) => {
    if (!d) return false;
    const path = d.fullName || d.name;
    if (!path) return false;
    if (isAnkiDeckExcluded(path, d.name, excludedDecks)) return false;
    const prefix = `${path}::`;
    for (const other of fullPaths) {
      if (other.startsWith(prefix)) return false;
    }
    return true;
  });
}

export function pad2(n) {
  return String(Math.floor(n)).padStart(2, '0');
}

export function toDateStr(date = new Date()) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

export function toTimeStr(date = new Date()) {
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

export function parseDateStr(dStr) {
  const [y, m, d] = dStr.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(dStr, delta) {
  const dt = parseDateStr(dStr);
  dt.setDate(dt.getDate() + delta);
  return toDateStr(dt);
}

export function getMondayOfWeek(dStr = toDateStr()) {
  const dt = parseDateStr(dStr);
  const dow = dt.getDay(); // 0=Sun..6=Sat
  const diff = dow === 0 ? -6 : 1 - dow;
  dt.setDate(dt.getDate() + diff);
  return toDateStr(dt);
}

export function timeToMin(tStr) {
  if (!tStr || !tStr.includes(':')) return 0;
  const [h, m] = tStr.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

export function minToTime(totalMin) {
  const wrapped = ((Math.round(totalMin) % 1440) + 1440) % 1440;
  return `${pad2(Math.floor(wrapped / 60))}:${pad2(wrapped % 60)}`;
}

export function fmtMin(min) {
  const m = Math.round(min || 0);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r === 0 ? `${h} h` : `${h} h ${r} min`;
}

export function fmtHours(min) {
  return `${((min || 0) / 60).toFixed(1)} h`;
}

export function fmtDateDE(dStr) {
  const dt = parseDateStr(dStr);
  return `${WEEKDAYS_DE[dt.getDay()]}, ${pad2(dt.getDate())}.${pad2(dt.getMonth() + 1)}.`;
}

export function fmtDateShort(dStr) {
  const [, m, d] = dStr.split('-');
  return `${d}.${m}.`;
}

export function dateTimeToMs(dStr, tStr) {
  const dt = parseDateStr(dStr);
  const [h, m] = (tStr || '00:00').split(':').map(Number);
  dt.setHours(h || 0, m || 0, 0, 0);
  return dt.getTime();
}

export function createDefaultState() {
  return {
    // Fokus-Tracker compatible core fields
    e: [],          // { id, d, t, m, k: 'l'|'a'|'p', mod? }
    goal: 120,      // Tagesziel in Minuten (180 nach Import des Backups)
    mode: 'max',    // 'max' | 'last' | 'sum'
    lb: 0,          // last backup timestamp (ms)
    w: {},          // wake times { 'YYYY-MM-DD': 'HH:MM' }
    sx: {},         // custom sleep times { 'YYYY-MM-DD': 'HH:MM' }
    sl: '23:00',    // default sleep time
    cf: [],         // caffeine { id, d, t, mg, n }
    cl: 400,        // caffeine daily limit mg
    tm: null,       // active timer object or null
    ui: {
      d_hero: true,
      d_live: true,
      d_plan: true,
      d_anki_card: false,
      d_entry_open: false,
      d_caf: false,
      d_wake: false,
      d_ent: false,
      tdt: false
    },

    // KIT StudyFlow extensions (schemaVersion 2)
    schemaVersion: 2,
    theme: 'dark',  // 'dark' (pure black) | 'light' | 'auto'
    autoLogLectures: true,
    lectureAttendance: {}, // { [uid]: 'attended' | 'skipped' }
    eventOverrides: {},    // { [uid]: 'lecture' | 'exercise' | 'cancelled' }
    restDays: {},          // { 'YYYY-MM-DD': true } manual rest days protecting streak (#1)
    ankiDoneDays: {},      // { 'YYYY-MM-DD': true|false } manual daily Anki check-off (even when cards remain)
    autopilotHandled: {},  // { [uid]: timestamp } already accepted or dismissed autopilot suggestions
    mapMeta: {},           // { [mapName]: { [key]: timestamp } } per-key conflict resolution for Gist sync
    deletedIds: {},        // { [id]: timestamp } tombstones for conflict-safe 2-way Gist merge
    customEvents: [],      // { id, title, shortName, recurrence, weekday, date, start, end, eventType, liveReviewMinutes, location, updatedAt }
    modules: {},           // { [moduleKey]: ModuleRule }
    icsRaw: '',
    icsUpdatedAt: 0,
    backlog: [],           // { id, title, moduleId?, kind: 'l'|'a'|'p', estMin, status: 'open'|'scheduled'|'overdue'|'done' }
    checklist: [],         // { id, d, timeLabel, title, kind: 'l'|'a'|'p', estMin, moduleId?, backlogId?, done, source }
    dayNotes: {},          // { 'YYYY-MM-DD': 'Uni 09:45–15:30' }
    reminders: [],         // { id, text, date?, done }
    taskCatalog: DEFAULT_TASK_CATALOG.map((x) => ({ ...x, updatedAt: 0 })), // Editable & auto-calibrating task blueprints for AI & user
    taskCatalogSeeded: true,
    anki: {
      mode: 'auto', // 'auto' | 'manual'
      url: 'http://127.0.0.1:8765',
      secPerCard: 24,       // legacy fallback
      secNew: 45,           // Blau (Neue Karten)
      secLearn: 30,         // Rot (Lern-/Wiederholungs-Stufe)
      secReview: 15,        // Grün (Fällige Reviews)
      minDailyAnkiMin: 30,
      lastSyncAt: 0,
      updatedAt: 0,
      manualNew: 0,         // Blau
      manualLearn: 0,       // Rot
      manualReview: 0,      // Grün
      manualDue: 0,         // legacy fallback
      autoLogTime: true,    // automatically sync today's real Anki revlog time into daily Anki entry
      decks: [],    // { name, fullName, group, due, newCards, learnCards, reviewCards }
      syncHistory: [], // [{ ts, b, r, g, tot, estMin }] — 1 point per Anki sync
      reviewByDay: {}, // { 'YYYY-MM-DD': { [deckFullName]: { sec, cards } } } from Anki revlog
      paceStats: null, // { secNewReal, cntNew, secLearnReal, cntLearn, secRevReal, cntRev }
      excludedDecks: [], // deck names/fullNames manually hidden from count & time
      excludedMeta: {}   // { [deckKey]: { excluded: boolean, ts: number } } for conflict-safe 2-way merge
    },
    planningPrefs: {
      defaultWakeFreeDay: '10:00',
      freeDayStartOffsetMin: 45,
      sundayFree: true,
      sundayRestProtectsStreak: true,
      restDayMinMinutes: 30
    },
    ai: {
      apiKey: '',
      syncApiKeyInGist: false,
      model: 'gemini-3.8-flash',
      lastWorkingModel: '',
      energyMode: 'normal', // 'reset' | 'normal' | 'fokus'
      rhythmNotes: '',      // Flexible, soft weekly rhythm guidelines evolved with Gemini in Weekly Review
      chat: [],
      studyNotes: 'Maschinenbau am KIT (1. Semester). HM-Vorlesungen schaue ich als Video (Richtwert laut Aufgaben-Katalog / Modul-Regeln). Nach Live-Vorlesungen in MKL, WK, FT und TM arbeite ich nach & erstelle Ankis; Nacharbeit bei Übungen richtet sich exakt nach den hinterlegten Modul-Regeln. HM- und TM-Hausaufgaben geben andere für mich ab – ich bearbeite sie rein fürs Verständnis ohne Abgabedruck.'
    },
    updatedAt: Date.now()
  };
}

export function createDefaultSecrets() {
  return {
    githubToken: '',
    gistId: '',
    publicAppUrl: '',        // Optional GitHub Pages URL for QR pairing when running locally on 127.0.0.1
    autoSync: true,
    lastSyncAt: 0,
    lastSyncStatus: 'local', // 'local' | 'ok' | 'syncing' | 'err'
    lastSyncError: '',
    lastArchiveWeek: '',     // e.g. '2026-KW48' for weekly Gist snapshots (#8)
    lastRemoteSummary: null  // { gistIdShort, e, chk, bl, ov, anki, syncedAt, action }
  };
}

class Store {
  constructor() {
    this.state = this._loadState();
    this.secrets = this._loadSecrets();
    this.listeners = new Set();
    this._syncHooks = new Set();
    this._storageErrorListeners = new Set();
    this._reconcileHook = null;
    this._entriesByDate = null;
    this._dirtySync = false;
    this.lastStorageError = '';
    this._undoStack = []; // In-memory snapshots for Strg+Z / Undo Toast (#7)
  }

  setReconcileHook(fn) {
    this._reconcileHook = typeof fn === 'function' ? fn : null;
  }

  onStorageError(fn) {
    this._storageErrorListeners.add(fn);
    return () => this._storageErrorListeners.delete(fn);
  }

  _notifyStorageError(message, severity = 'err') {
    this._storageErrorListeners.forEach((fn) => {
      try { fn(message, severity); } catch { /* ignore */ }
    });
  }

  invalidateCaches() {
    this._entriesByDate = null;
  }

  pushUndo(label = 'Aktion') {
    try {
      this._undoStack.push({ label, snapshot: JSON.stringify(this.state), ts: Date.now() });
      if (this._undoStack.length > 8) this._undoStack.shift();
    } catch { /* ignore */ }
  }

  canUndo() {
    return this._undoStack.length > 0;
  }

  undo() {
    const item = this._undoStack.pop();
    if (!item) return null;
    try {
      const prevState = this.state;
      const restored = this._mergeDefaults(JSON.parse(item.snapshot));
      const nowTs = Date.now();
      const deletedIds = { ...(prevState.deletedIds || {}), ...(restored.deletedIds || {}) };

      // Keep multi-device Gist sync consistent after undo:
      // - Restored or modified items get fresh updatedAt & are cleared from deletedIds
      // - Items present before undo but absent after undo get tombstoned so Cloud won't resurrect them
      const arrayFields = ['e', 'cf', 'checklist', 'backlog', 'reminders', 'customEvents', 'taskCatalog'];
      for (const field of arrayFields) {
        const prevMap = new Map((prevState[field] || []).filter((x) => x && x.id !== undefined).map((x) => [String(x.id), x]));
        const nextMap = new Map((restored[field] || []).filter((x) => x && x.id !== undefined).map((x) => [String(x.id), x]));

        for (const [id, nextItem] of nextMap.entries()) {
          const prevItem = prevMap.get(id);
          if (!prevItem || JSON.stringify(prevItem) !== JSON.stringify(nextItem)) {
            nextItem.updatedAt = nowTs;
          }
          delete deletedIds[id];
        }
        for (const id of prevMap.keys()) {
          if (!nextMap.has(id)) {
            deletedIds[id] = nowTs;
          }
        }
      }

      // Bump mapMeta for any map key changed, restored, or removed by undo
      const mapFields = ['w', 'sx', 'dayNotes', 'eventOverrides', 'lectureAttendance', 'restDays', 'ankiDoneDays', 'modules'];
      if (!restored.mapMeta) restored.mapMeta = {};
      for (const mapName of mapFields) {
        const prevObj = prevState[mapName] || {};
        const nextObj = restored[mapName] || {};
        const allKeys = new Set([...Object.keys(prevObj), ...Object.keys(nextObj)]);
        for (const k of allKeys) {
          if (JSON.stringify(prevObj[k]) !== JSON.stringify(nextObj[k])) {
            if (!restored.mapMeta[mapName]) restored.mapMeta[mapName] = {};
            restored.mapMeta[mapName][String(k)] = nowTs;
            if (mapName === 'modules') {
              if (nextObj[k] !== undefined) delete deletedIds[`mod_${k}`];
              else deletedIds[`mod_${k}`] = nowTs;
            }
          }
        }
      }

      restored.deletedIds = deletedIds;
      restored.updatedAt = nowTs;
      this.state = restored;
      this.invalidateCaches();
      if (this._reconcileHook) this._reconcileHook({ todayStr: toDateStr() });
      this.save();
      return item.label;
    } catch {
      return null;
    }
  }

  _loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return createDefaultState();
      const parsed = JSON.parse(raw);
      return this._mergeDefaults(parsed);
    } catch {
      return createDefaultState();
    }
  }

  _loadSecrets() {
    try {
      const raw = localStorage.getItem(SECRETS_KEY);
      if (!raw) return createDefaultSecrets();
      return { ...createDefaultSecrets(), ...JSON.parse(raw) };
    } catch {
      return createDefaultSecrets();
    }
  }

  _mergeDefaults(data) {
    const def = createDefaultState();
    const merged = {
      ...def,
      ...data,
      ui: { ...def.ui, ...(data.ui || {}) },
      anki: { ...def.anki, ...(data.anki || {}) },
      planningPrefs: { ...def.planningPrefs, ...(data.planningPrefs || {}) },
      ai: { ...def.ai, ...(data.ai || {}) },
      w: { ...(data.w || {}) },
      sx: { ...(data.sx || {}) },
      modules: { ...(data.modules || {}) },
      lectureAttendance: { ...(data.lectureAttendance || {}) },
      eventOverrides: { ...(data.eventOverrides || {}) },
      restDays: { ...(data.restDays || {}) },
      ankiDoneDays: { ...(data.ankiDoneDays || {}) },
      autopilotHandled: { ...(data.autopilotHandled || {}) },
      mapMeta: JSON.parse(JSON.stringify(data.mapMeta || {})),
      deletedIds: { ...(data.deletedIds || {}) },
      dayNotes: { ...(data.dayNotes || {}) },
      e: Array.isArray(data.e) ? data.e : [],
      cf: Array.isArray(data.cf) ? data.cf : [],
      backlog: Array.isArray(data.backlog) ? data.backlog : [],
      customEvents: Array.isArray(data.customEvents) ? data.customEvents : [],
      checklist: Array.isArray(data.checklist) ? data.checklist : [],
      reminders: Array.isArray(data.reminders) ? data.reminders : [],
      taskCatalog: Array.isArray(data.taskCatalog) && data.taskCatalog.length > 0
        ? data.taskCatalog
        : data.taskCatalogSeeded
          ? (Array.isArray(data.taskCatalog) ? data.taskCatalog : [])
          : DEFAULT_TASK_CATALOG
              .filter((x) => !data.deletedIds?.[x.id])
              .map((x) => ({ ...x, updatedAt: 0 })),
      taskCatalogSeeded: true
    };
    // Tolerantly strip removed legacy fields if present in older backups or localStorage
    delete merged.dg;
    delete merged.planBlocks;
    delete merged.tasks;
    if (merged.anki) {
      delete merged.anki.todayMinutes;
      if (!Array.isArray(merged.anki.syncHistory)) merged.anki.syncHistory = [];
      if (!merged.anki.reviewByDay || typeof merged.anki.reviewByDay !== 'object') merged.anki.reviewByDay = {};
      if (merged.anki.autoLogTime === undefined) merged.anki.autoLogTime = true;
    }
    return this._migrateState(merged, Number(data?.schemaVersion || 1));
  }

  _migrateState(state, fromVersion) {
    // One-time v1 -> v2 migration: clean module rules without touching user focus entries/checklists/keys
    if (fromVersion < 2) {
      for (const key of Object.keys(state.modules || {})) {
        const m = state.modules[key];
        if (!m) continue;
        const idStr = String(m.id || key || '');
        const labelStr = `${m.shortName || ''} ${m.name || ''}`;
        const isExercise =
          m.type === 'Ü' ||
          m.type === 'T' ||
          /_(Ü|T)$/i.test(idStr) ||
          /\((Ü|T)\)|\bübung|\btutorium/i.test(labelStr);
        const isHm =
          m.code === '0131000' ||
          m.code === '0131100' ||
          idStr.startsWith('0131000') ||
          idStr.startsWith('0131100') ||
          /\bhm\b|höhere mathematik/i.test(labelStr);
        const isTm =
          m.code === '2161245' ||
          m.code === '2161246' ||
          idStr.startsWith('216124') ||
          /\btm\b|technische mechanik/i.test(labelStr);

        if (isExercise) {
          m.createsAnki = false;
          m.liveReviewMinutes = 0;
          m.videoStudyMinutes = 0;
          m.studyMinutes = 0;
          if (isHm || isTm) {
            m.triggersHomework = true;
            m.homeworkMode = m.homeworkMode || 'understanding';
          } else {
            m.triggersHomework = Boolean(m.triggersHomework);
          }
        } else {
          // Lecture (V)
          const oldMin = Number(m.studyMinutes) || 165;
          m.videoStudyMinutes = m.videoStudyMinutes ?? oldMin;
          if (isHm) {
            m.attendance = 'video';
            m.createsAnki = false;
            m.liveReviewMinutes = 0;
          } else {
            m.liveReviewMinutes = m.liveReviewMinutes ?? 75;
          }
          m.triggersHomework = Boolean(m.triggersHomework);
        }
      }
      state.schemaVersion = 2;
    }

    // Ensure every module always has v2 fields populated safely
    for (const key of Object.keys(state.modules || {})) {
      const m = state.modules[key];
      if (!m) continue;
      if (m.liveReviewMinutes === undefined) m.liveReviewMinutes = m.type === 'Ü' ? 0 : 75;
      if (m.videoStudyMinutes === undefined) m.videoStudyMinutes = m.studyMinutes ?? (m.type === 'Ü' ? 0 : 110);
      if (m.triggersHomework === undefined) m.triggersHomework = false;
      if (!m.homeworkMode) m.homeworkMode = 'understanding';
    }

    // Automatically remove outdated default sentence from studyNotes so Gemini never ignores exercise review minutes
    if (state.ai && typeof state.ai.studyNotes === 'string') {
      state.ai.studyNotes = state.ai.studyNotes
        .replace(/;\s*nach Übungen fällt keine Nacharbeit an/gi, '; Nacharbeit bei Übungen richtet sich exakt nach den hinterlegten Modul-Regeln')
        .replace(/nach Übungen fällt keine Nacharbeit an\.?/gi, 'Nacharbeit bei Übungen richtet sich exakt nach den hinterlegten Modul-Regeln.')
        .replace(/\(ca\.\s*150[–-]180\s*Min\.\s*mit Pausieren\)/gi, '(Richtwert laut Aufgaben-Katalog / Modul-Regeln)');
    }

    return state;
  }

  _pruneOldMetadata(maxAgeDays = 90) {
    const cutoff = Date.now() - maxAgeDays * 24 * 3600 * 1000;
    if (this.state.autopilotHandled && typeof this.state.autopilotHandled === 'object') {
      for (const k of Object.keys(this.state.autopilotHandled)) {
        const ts = Number(this.state.autopilotHandled[k]) || 0;
        if (ts > 0 && ts < cutoff) delete this.state.autopilotHandled[k];
      }
    }
    if (this.state.mapMeta && typeof this.state.mapMeta === 'object') {
      for (const mapName of Object.keys(this.state.mapMeta)) {
        if (mapName === 'modules') continue; // Keep persistent module config timestamps
        const bucket = this.state.mapMeta[mapName];
        if (!bucket || typeof bucket !== 'object') continue;
        for (const k of Object.keys(bucket)) {
          const ts = Number(bucket[k]) || 0;
          if (ts > 0 && ts < cutoff) delete bucket[k];
        }
        if (Object.keys(bucket).length === 0) delete this.state.mapMeta[mapName];
      }
    }
  }

  _trimOldChatProposals(keepFullProposals = 5) {
    const chat = this.state.ai?.chat;
    if (!Array.isArray(chat) || chat.length <= keepFullProposals) return false;
    let trimmed = false;
    const cutoffIdx = chat.length - keepFullProposals;
    for (let i = 0; i < cutoffIdx; i++) {
      if (chat[i] && chat[i].proposal) {
        delete chat[i].proposal;
        trimmed = true;
      }
    }
    return trimmed;
  }

  save({ skipSync = false, silent = false, preserveTimestamp = false, fromBackgroundSync = false } = {}) {
    if (!preserveTimestamp) this.state.updatedAt = Date.now();
    this.invalidateCaches();
    this._pruneOldMetadata(90);
    this._trimOldChatProposals(5);

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
      this.lastStorageError = '';
    } catch (err) {
      console.error('Speichern fehlgeschlagen:', err);
      // Emergency trim of bulky chat payloads & retry once
      let recovered = false;
      try {
        if (Array.isArray(this.state.ai?.chat) && this.state.ai.chat.length > 0) {
          this.state.ai.chat = this.state.ai.chat.slice(-10).map((m, idx, arr) => {
            if (idx < arr.length - 2 && m?.proposal) {
              const copy = { ...m };
              delete copy.proposal;
              return copy;
            }
            return m;
          });
        }
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
        recovered = true;
        this.lastStorageError = '';
        this._notifyStorageError('Lokaler Speicher war fast voll – ältere KI-Chat-Vorschläge wurden automatisch gekürzt.', 'warn');
      } catch (retryErr) {
        console.error('Speichern auch nach Bereinigung fehlgeschlagen:', retryErr);
      }
      if (!recovered) {
        const isQuota = err?.name === 'QuotaExceededError' || err?.code === 22;
        this.lastStorageError = isQuota
          ? 'Lokaler Speicher (localStorage) ist voll! Neue Änderungen werden nicht dauerhaft gespeichert. Bitte Backup exportieren oder KI-Chat leeren.'
          : `Speichern fehlgeschlagen (${err?.message || 'Speicherfehler'}). Änderungen könnten beim Neuladen verloren gehen.`;
        this._notifyStorageError(this.lastStorageError, 'err');
      }
    }

    if (!silent) this.emit({ fromBackgroundSync });
    if (!skipSync) {
      this._syncHooks.forEach((fn) => fn());
    }
  }

  touchMapKey(mapName, key) {
    if (!this.state.mapMeta) this.state.mapMeta = {};
    if (!this.state.mapMeta[mapName]) this.state.mapMeta[mapName] = {};
    this.state.mapMeta[mapName][String(key)] = Date.now();
  }

  saveSecrets({ silent = false } = {}) {
    try {
      localStorage.setItem(SECRETS_KEY, JSON.stringify(this.secrets));
    } catch (err) {
      console.error('Secrets speichern fehlgeschlagen:', err);
      const msg = err?.name === 'QuotaExceededError' || err?.code === 22
        ? 'Speicher voll: Zugangsdaten/Sync-Einstellungen konnten nicht im Browser gespeichert werden.'
        : `Zugangsdaten konnten nicht gespeichert werden (${err?.message || 'Fehler'}).`;
      this.lastStorageError = msg;
      this._notifyStorageError(msg, 'err');
    }
    if (!silent) this.emit();
  }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  onSyncTrigger(fn) {
    this._syncHooks.add(fn);
    return () => this._syncHooks.delete(fn);
  }

  emit(meta = {}) {
    this.listeners.forEach((fn) => {
      try { fn(this.state, meta); } catch (e) { console.error(e); }
    });
  }

  // ---------- Counting Rules (with O(1) Date Index Cache) ----------

  getEntriesForDate(dStr) {
    if (!this._entriesByDate) {
      const idx = new Map();
      for (const x of (this.state.e || [])) {
        if (!x || !x.d) continue;
        let arr = idx.get(x.d);
        if (!arr) { arr = []; idx.set(x.d, arr); }
        arr.push(x);
      }
      this._entriesByDate = idx;
    }
    return this._entriesByDate.get(dStr) || [];
  }

  getDayBreakdown(dStr, modeOverride = null) {
    const mode = modeOverride || this.state.mode || 'max';
    const dayEntries = this.getEntriesForDate(dStr);
    const countingIds = new Set();
    const values = { l: 0, a: 0, p: 0 };

    for (const kind of ['l', 'a', 'p']) {
      const list = dayEntries.filter((x) => x.k === kind);
      if (!list.length) continue;

      if (mode === 'sum') {
        let sum = 0;
        for (const item of list) {
          sum += Number(item.m) || 0;
          countingIds.add(item.id);
        }
        values[kind] = sum;
      } else if (mode === 'last') {
        const sorted = [...list].sort((a, b) => {
          const cmp = (a.t || '').localeCompare(b.t || '');
          return cmp !== 0 ? cmp : (a.id - b.id);
        });
        const winner = sorted[sorted.length - 1];
        values[kind] = Number(winner.m) || 0;
        countingIds.add(winner.id);
      } else {
        // 'max'
        let winner = list[0];
        for (const item of list) {
          if ((Number(item.m) || 0) > (Number(winner.m) || 0)) {
            winner = item;
          } else if ((Number(item.m) || 0) === (Number(winner.m) || 0) && item.id > winner.id) {
            winner = item;
          }
        }
        values[kind] = Number(winner.m) || 0;
        countingIds.add(winner.id);
      }
    }

    const learnTotal = values.l + values.a;
    const total = learnTotal + values.p;
    return { ...values, learnTotal, total, countingIds };
  }

  markDeleted(id) {
    if (!id) return;
    if (!this.state.deletedIds) this.state.deletedIds = {};
    this.state.deletedIds[String(id)] = Date.now();
    // Prune tombstones older than 45 days
    const cutoff = Date.now() - 45 * 24 * 3600 * 1000;
    for (const k of Object.keys(this.state.deletedIds)) {
      if (this.state.deletedIds[k] < cutoff) delete this.state.deletedIds[k];
    }
  }

  addEntry({ d, t, m, k, mod = '', act = '', note = '', sessionMin = 0, catalogId = '', save = true }) {
    const minutes = Math.round(Number(m) || 0);
    if (minutes <= 0) return { ok: false, message: 'Bitte mindestens 1 Minute eingeben.' };
    const dateStr = d || toDateStr();
    const timeStr = t || toTimeStr();
    const before = this.getDayBreakdown(dateStr);

    // Compute real block duration for calibration (handles running-total 'max' mode cleanly!)
    let realBlockMin = Math.round(Number(sessionMin) || 0);
    if (realBlockMin <= 0) {
      if (this.state.mode === 'sum') realBlockMin = minutes;
      else realBlockMin = minutes > before[k || 'l'] ? minutes - before[k || 'l'] : minutes;
    }

    const resolvedCatalogId = catalogId || (k !== 'p' ? (this.matchCatalogItemForText(note, act, mod)?.id || '') : '');
    const entry = {
      id: Date.now() + Math.floor(Math.random() * 100),
      d: dateStr,
      t: timeStr,
      m: minutes,
      k: k || 'l',
      updatedAt: Date.now()
    };
    if (mod) entry.mod = mod;
    if (act) entry.act = act; // 'video' | 'review' | 'homework' | 'anki' | 'exam' | 'other'
    if (resolvedCatalogId) entry.catalogId = resolvedCatalogId;
    if (note && note.trim()) entry.note = note.trim();
    if (realBlockMin > 0 && (mod || act || resolvedCatalogId || (note && note.trim()))) entry.blockMin = realBlockMin;

    this.state.e.push(entry);
    this.invalidateCaches();
    const after = this.getDayBreakdown(dateStr);
    if (save) this.save();

    const kindNames = { l: 'Lernzeit', a: 'Anki-Lernzeit', p: 'Vorlesung / Produktiv' };
    const counts = after.countingIds.has(entry.id);
    const changed = after[entry.k] !== before[entry.k];

    let message;
    if (changed) {
      message = `${kindNames[entry.k]} für ${fmtDateShort(dateStr)} aktualisiert: ${fmtMin(before[entry.k])} → ${fmtMin(after[entry.k])}.`;
    } else if (!counts) {
      message = `Eingetragen (${fmtMin(minutes)}), zählt aber nach Regel „${this.getModeLabel()}“ nicht (Tageswert bleibt ${fmtMin(after[entry.k])}).`;
    } else {
      message = `Eingetragen (${fmtMin(minutes)}), Tageswert unverändert (${fmtMin(after[entry.k])}).`;
    }

    return { ok: true, entry, counts, changed, message };
  }

  deleteEntry(id) {
    this.pushUndo('Eintrag gelöscht');
    this.markDeleted(id);
    this.state.e = this.state.e.filter((x) => x.id !== id);
    this.save();
  }

  getModeLabel(m = this.state.mode) {
    if (m === 'sum') return 'Alles addieren';
    if (m === 'last') return 'Letzter Eintrag';
    return 'Höchster Wert';
  }

  // ---------- Wake / Sleep & Live Ratios ----------

  getSleepTimeStr(dStr) {
    return this.state.sx[dStr] || this.state.sl || '23:00';
  }

  getAwakeSpan(dStr, nowDate = new Date()) {
    const wakeStr = this.state.w[dStr];
    if (!wakeStr) return null;
    const sleepStr = this.getSleepTimeStr(dStr);
    const wakeMin = timeToMin(wakeStr);
    let sleepMin = timeToMin(sleepStr);
    if (sleepMin <= wakeMin) sleepMin += 1440; // past midnight

    const totalAwakeMin = Math.max(1, sleepMin - wakeMin);
    const todayStr = toDateStr(nowDate);
    let elapsedMin = totalAwakeMin;
    let nowMin = sleepMin;

    if (dStr === todayStr) {
      nowMin = nowDate.getHours() * 60 + nowDate.getMinutes() + nowDate.getSeconds() / 60;
      if (sleepMin > 1440 && nowMin <= (sleepMin - 1440)) nowMin += 1440;
      elapsedMin = Math.max(1, Math.min(totalAwakeMin, Math.max(0, nowMin - wakeMin)));
    }

    return { wakeStr, sleepStr, wakeMin, sleepMin, nowMin, elapsedMin, totalAwakeMin };
  }

  getLiveRatio(dStr = toDateStr(), nowDate = new Date()) {
    const span = this.getAwakeSpan(dStr, nowDate);
    const day = this.getDayBreakdown(dStr);
    if (!span) return { hasWake: false, day };

    const learnPct = Math.min(100, (day.learnTotal / span.elapsedMin) * 100);
    const ankiPct = Math.min(100, (day.a / span.elapsedMin) * 100);
    const prodPct = Math.min(100, (day.p / span.elapsedMin) * 100);
    const bothPct = Math.min(100, (day.total / span.elapsedMin) * 100);

    const endLearnPct = Math.min(100, (day.learnTotal / span.totalAwakeMin) * 100);
    const endProdPct = Math.min(100, (day.p / span.totalAwakeMin) * 100);
    const endBothPct = Math.min(100, (day.total / span.totalAwakeMin) * 100);

    return {
      hasWake: true,
      span,
      day,
      learnPct,
      ankiPct,
      prodPct,
      bothPct,
      endLearnPct,
      endProdPct,
      endBothPct
    };
  }

  setWakeTime(dStr, tStr) {
    if (dStr > toDateStr()) return false;
    if (!tStr) delete this.state.w[dStr];
    else this.state.w[dStr] = tStr;
    this.touchMapKey('w', dStr);
    this.save();
    return true;
  }

  setSleepTime(dStr, tStr) {
    if (dStr > toDateStr()) return false;
    if (!tStr) delete this.state.sx[dStr];
    else this.state.sx[dStr] = tStr;
    this.touchMapKey('sx', dStr);
    this.save();
    return true;
  }

  // ---------- Caffeine ----------

  addCaffeine({ d, t, mg, n = 'Koffein' }) {
    const amount = Math.round(Number(mg) || 0);
    if (amount <= 0) return null;
    const item = {
      id: Date.now() + Math.floor(Math.random() * 100),
      d: d || toDateStr(),
      t: t || toTimeStr(),
      mg: amount,
      n: (n || 'Koffein').trim(),
      updatedAt: Date.now()
    };
    this.state.cf.push(item);
    this.save();
    return item;
  }

  deleteCaffeine(id) {
    this.pushUndo('Koffein gelöscht');
    this.markDeleted(id);
    this.state.cf = this.state.cf.filter((x) => x.id !== id);
    this.save();
  }

  getCaffeineAtMs(targetMs) {
    const windowMs = 48 * 3600 * 1000;
    const halfLifeMs = HALF_LIFE_HOURS * 3600 * 1000;
    let total = 0;
    for (const item of this.state.cf) {
      const tMs = dateTimeToMs(item.d, item.t);
      if (tMs <= targetMs && targetMs - tMs <= windowMs) {
        total += (Number(item.mg) || 0) * Math.pow(0.5, (targetMs - tMs) / halfLifeMs);
      }
    }
    return total;
  }

  getCaffeineTodaySummary(nowDate = new Date()) {
    const today = toDateStr(nowDate);
    const nowMs = nowDate.getTime();
    const todayItems = this.state.cf.filter((x) => x.d === today);
    const todayMg = todayItems.reduce((s, x) => s + (Number(x.mg) || 0), 0);
    const currentMg = this.getCaffeineAtMs(nowMs);

    const sleepStr = this.getSleepTimeStr(today);
    let sleepMs = dateTimeToMs(today, sleepStr);
    const wakeStr = this.state.w[today] || '08:00';
    if (timeToMin(sleepStr) <= timeToMin(wakeStr)) {
      sleepMs += 24 * 3600 * 1000;
    }
    const sleepMg = this.getCaffeineAtMs(sleepMs);

    // Find when caffeine drops below 50mg (search forward in 5-min steps up to 36h)
    let under50Str = 'Jetzt schon < 50 mg';
    if (currentMg >= 50) {
      let found = null;
      for (let step = 5; step <= 36 * 60; step += 5) {
        const probeMs = nowMs + step * 60 * 1000;
        if (this.getCaffeineAtMs(probeMs) < 50) {
          const dt = new Date(probeMs);
          const sameDay = toDateStr(dt) === today;
          under50Str = sameDay ? `${toTimeStr(dt)} Uhr` : `Morgen ${toTimeStr(dt)} Uhr`;
          found = true;
          break;
        }
      }
      if (!found) under50Str = '> 36 h';
    }

    // Build curve from 06:00 (or wake time) to sleep + 2h
    const startH = Math.min(8, Math.floor(timeToMin(wakeStr) / 60));
    const startMs = dateTimeToMs(today, `${pad2(startH)}:00`);
    const endMs = Math.max(sleepMs + 2 * 3600 * 1000, nowMs + 6 * 3600 * 1000);
    const points = [];
    const stepMs = 15 * 60 * 1000;
    for (let ms = startMs; ms <= endMs; ms += stepMs) {
      points.push({ ms, mg: this.getCaffeineAtMs(ms) });
    }

    return { todayMg, currentMg, sleepMg, sleepMs, nowMs, under50Str, points, todayItems };
  }

  // ---------- Timer ----------

  startTimer({ mode = 'countdown', kind = 'l', durationMin = 45, planBlockId = null, mod = '', note = '', act = '', catalogId = '' }) {
    this.state.tm = {
      running: true,
      mode,
      kind,
      startedAt: Date.now(),
      durationSec: mode === 'countdown' ? Math.max(60, Math.round(durationMin * 60)) : 0,
      planBlockId,
      mod: mod || '',
      note: (note || '').trim(),
      act: act || '',
      catalogId: catalogId || ''
    };
    this.state.ui.tdt = true; // auto-open timer panel
    this.save();
  }

  getTimerStatus(nowMs = Date.now()) {
    const tm = this.state.tm;
    if (!tm || !tm.running) return null;
    const elapsedSec = Math.max(0, Math.floor((nowMs - tm.startedAt) / 1000));
    if (tm.mode === 'countdown') {
      const remainingSec = Math.max(0, tm.durationSec - elapsedSec);
      const expired = elapsedSec >= tm.durationSec;
      return { ...tm, elapsedSec, remainingSec, expired };
    }
    return { ...tm, elapsedSec, remainingSec: 0, expired: false };
  }

  checkExpiredTimer() {
    const st = this.getTimerStatus();
    if (st && st.expired) {
      return this.stopAndSaveTimer({ fromExpiry: true });
    }
    return null;
  }

  stopAndSaveTimer({ fromExpiry = false } = {}) {
    const st = this.getTimerStatus();
    if (!st) return null;

    const saveSec = st.mode === 'countdown' && fromExpiry ? st.durationSec : st.elapsedSec;
    const minutes = Math.round(saveSec / 60);
    const startedDate = new Date(st.startedAt || Date.now());
    const finishedAt = st.mode === 'countdown' && fromExpiry
      ? new Date(st.startedAt + st.durationSec * 1000)
      : new Date();
    // If timer started late evening and finished shortly past midnight (< 04:00), attribute to the study day it started
    const startedDay = toDateStr(startedDate);
    const finishedDay = toDateStr(finishedAt);
    const dStr = (startedDay !== finishedDay && finishedAt.getHours() < 4) ? startedDay : finishedDay;
    const tStr = toTimeStr(finishedAt);

    this.state.tm = null;

    if (minutes < 1) {
      this.save();
      return { saved: false, message: 'Timer unter 30 Sekunden – nichts gespeichert.' };
    }

    // Spec: "Die Timer-Zeit wird zum bisherigen Tageswert addiert."
    const before = this.getDayBreakdown(dStr);
    const newVal = this.state.mode === 'sum' ? minutes : before[st.kind] + minutes;
    const finalAct = st.kind === 'a' ? 'anki' : st.kind === 'p' ? '' : (st.act || '');
    const added = this.addEntry({
      d: dStr,
      t: tStr,
      m: newVal,
      k: st.kind,
      mod: st.mod || '',
      act: finalAct,
      note: st.note || '',
      catalogId: st.kind === 'a' ? '' : (st.catalogId || ''),
      sessionMin: minutes,
      save: false
    });
    if (added?.entry && !added.entry.blockMin) {
      added.entry.blockMin = minutes;
    }

    if (st.planBlockId) {
      const nowTs = Date.now();
      const chk = this.state.checklist.find((c) => c.id === st.planBlockId);
      if (chk) { chk.done = true; chk.updatedAt = nowTs; }
      if (this._reconcileHook) this._reconcileHook({ todayStr: toDateStr() });
    }

    this.save();
    return {
      saved: true,
      minutes,
      kind: st.kind,
      fromExpiry,
      message: fromExpiry
        ? `Countdown beendet! +${fmtMin(minutes)} automatisch gespeichert.`
        : `Timer gespeichert: +${fmtMin(minutes)} zum heutigen Tageswert addiert.`
    };
  }

  discardTimer() {
    this.state.tm = null;
    this.save();
  }

  // ---------- Statistics & Achievements ----------

  getAllActiveDates() {
    const set = new Set();
    for (const x of this.state.e) set.add(x.d);
    return Array.from(set).sort();
  }

  isRestDay(dStr) {
    if (this.state.restDays && this.state.restDays[dStr] === true) return true;
    if (this.state.restDays && this.state.restDays[dStr] === false) return false;
    const sunProtect = this.state.planningPrefs?.sundayRestProtectsStreak !== false;
    return sunProtect && parseDateStr(dStr).getDay() === 0;
  }

  toggleRestDay(dStr = toDateStr()) {
    if (!this.state.restDays) this.state.restDays = {};
    const next = !this.isRestDay(dStr);
    this.state.restDays[dStr] = next;
    this.touchMapKey('restDays', dStr);
    this.save();
    return next;
  }

  isAnkiDoneDay(dStr = toDateStr(), totalDue = null) {
    const explicit = this.state.ankiDoneDays?.[dStr];
    if (explicit !== undefined) return Boolean(explicit);
    if (totalDue === 0 && this.getDayBreakdown(dStr).a > 0) return true;
    return false;
  }

  setAnkiDoneDay(dStr = toDateStr(), done = true) {
    if (!this.state.ankiDoneDays) this.state.ankiDoneDays = {};
    this.state.ankiDoneDays[dStr] = Boolean(done);
    this.touchMapKey('ankiDoneDays', dStr);
    this.save();
    return Boolean(done);
  }

  getGoalForDay(dStr = toDateStr()) {
    if (this.isRestDay(dStr)) {
      return Math.max(0, Number(this.state.planningPrefs?.restDayMinMinutes ?? 30));
    }
    return this.state.goal || 120;
  }

  getStreakStats(todayStr = toDateStr()) {
    const goal = this.state.goal || 120;
    const restMin = Math.max(0, Number(this.state.planningPrefs?.restDayMinMinutes ?? 30));
    const dates = this.getAllActiveDates();
    const goalDays = new Set();
    for (const d of dates) {
      const target = this.isRestDay(d) ? restMin : goal;
      const learn = this.getDayBreakdown(d).learnTotal;
      if (target > 0 ? learn >= target : learn > 0) goalDays.add(d);
    }

    // Current streak: rest days without learning FREEZE the streak instead of breaking it!
    let current = 0;
    let cursor = todayStr;
    if (!goalDays.has(todayStr)) {
      // Today not yet reached -> check starting from yesterday
      cursor = addDays(todayStr, -1);
    }
    let guard = 0;
    while (guard < 730) {
      if (goalDays.has(cursor)) {
        current++;
        cursor = addDays(cursor, -1);
      } else if (this.isRestDay(cursor)) {
        // Freeze streak over protected rest day (only if an earlier active day exists)
        const prev = addDays(cursor, -1);
        if (dates.length && prev >= dates[0]) {
          cursor = prev;
        } else {
          break;
        }
      } else {
        break;
      }
      guard++;
    }

    // Longest streak (allowing protected rest days to bridge without breaking)
    let longest = 0;
    if (dates.length) {
      let run = 0;
      let dCur = dates[0];
      let g2 = 0;
      while (dCur <= todayStr && g2 < 1500) {
        if (goalDays.has(dCur)) {
          run++;
          if (run > longest) longest = run;
        } else if (!this.isRestDay(dCur)) {
          run = 0;
        }
        dCur = addDays(dCur, 1);
        g2++;
      }
    }

    return { current, longest, goalDayCount: goalDays.size, goalDays };
  }

  getOverallStats() {
    const todayStr = toDateStr();
    const dates = this.getAllActiveDates();
    let totalLearn = 0;
    let totalAnki = 0;
    let totalProd = 0;
    let activeLearnDays = 0;
    let recordDay = { d: null, min: 0 };
    const dailyLearnValues = [];
    let weekendActiveDays = 0;
    let hasSat = false;
    let hasSun = false;

    for (const d of dates) {
      const b = this.getDayBreakdown(d);
      totalLearn += b.learnTotal;
      totalAnki += b.a;
      totalProd += b.p;
      if (b.learnTotal > 0) {
        activeLearnDays++;
        dailyLearnValues.push(b.learnTotal);
        if (b.learnTotal > recordDay.min) recordDay = { d, min: b.learnTotal };
        const dow = parseDateStr(d).getDay();
        if (dow === 6) { hasSat = true; weekendActiveDays++; }
        if (dow === 0) { hasSun = true; weekendActiveDays++; }
      }
    }

    const avgActive = activeLearnDays ? totalLearn / activeLearnDays : 0;
    const sortedVals = [...dailyLearnValues].sort((a, b) => a - b);
    const median = sortedVals.length
      ? (sortedVals.length % 2 === 1
          ? sortedVals[Math.floor(sortedVals.length / 2)]
          : (sortedVals[sortedVals.length / 2 - 1] + sortedVals[sortedVals.length / 2]) / 2)
      : 0;

    const streaks = this.getStreakStats(todayStr);
    const goalRate = activeLearnDays ? (streaks.goalDayCount / activeLearnDays) * 100 : 0;

    // This week & last week
    const monThis = getMondayOfWeek(todayStr);
    const monLast = addDays(monThis, -7);
    let thisWeek = 0;
    let lastWeek = 0;
    for (let i = 0; i < 7; i++) {
      thisWeek += this.getDayBreakdown(addDays(monThis, i)).learnTotal;
      lastWeek += this.getDayBreakdown(addDays(monLast, i)).learnTotal;
    }

    // Last 30 days avg
    let sum30 = 0;
    for (let i = 0; i < 30; i++) {
      sum30 += this.getDayBreakdown(addDays(todayStr, -i)).learnTotal;
    }
    const avg30 = sum30 / 30;

    // This month
    const monthPrefix = todayStr.slice(0, 7);
    const dayOfMonth = Number(todayStr.slice(8, 10));
    const daysInMonth = new Date(Number(todayStr.slice(0, 4)), Number(todayStr.slice(5, 7)), 0).getDate();
    let thisMonth = 0;
    for (const d of dates) {
      if (d.startsWith(monthPrefix)) thisMonth += this.getDayBreakdown(d).learnTotal;
    }
    const monthProjection = dayOfMonth > 0 ? (thisMonth / dayOfMonth) * daysInMonth : 0;

    // Weekday averages (including days without learning since first entry)
    const weekdaySums = [0, 0, 0, 0, 0, 0, 0]; // Mo..So
    const weekdayCounts = [0, 0, 0, 0, 0, 0, 0];
    if (dates.length) {
      const startD = dates[0];
      let cur = startD;
      let guard = 0;
      while (cur <= todayStr && guard < 1500) {
        const dow = parseDateStr(cur).getDay();
        const idx = dow === 0 ? 6 : dow - 1;
        weekdaySums[idx] += this.getDayBreakdown(cur).learnTotal;
        weekdayCounts[idx]++;
        cur = addDays(cur, 1);
        guard++;
      }
    }
    const weekdayAvgs = weekdaySums.map((s, i) => (weekdayCounts[i] ? s / weekdayCounts[i] : 0));

    // Entry hours distribution (0..23)
    const hourCounts = new Array(24).fill(0);
    for (const x of this.state.e) {
      if (x.t && x.t.includes(':')) {
        const h = Number(x.t.split(':')[0]);
        if (h >= 0 && h < 24) hourCounts[h]++;
      }
    }
    let peakHour = -1;
    let peakHourCount = 0;
    hourCounts.forEach((c, h) => {
      if (c > peakHourCount) { peakHourCount = c; peakHour = h; }
    });

    // Wake-time analytics (all days with wake time)
    const wakeDates = Object.keys(this.state.w).filter((d) => d <= todayStr).sort();
    let wakeTotalMin = 0;
    let wakeLearnMin = 0;
    let wakeAnkiMin = 0;
    let wakeProdMin = 0;
    const nowDate = new Date();
    for (const d of wakeDates) {
      const sp = this.getAwakeSpan(d, nowDate);
      if (!sp) continue;
      const b = this.getDayBreakdown(d);
      wakeTotalMin += sp.elapsedMin;
      wakeLearnMin += b.learnTotal;
      wakeAnkiMin += b.a;
      wakeProdMin += b.p;
    }

    // Caffeine analytics
    const cafByDay = {};
    for (const c of this.state.cf) {
      cafByDay[c.d] = (cafByDay[c.d] || 0) + (Number(c.mg) || 0);
    }
    const cafDays = Object.keys(cafByDay).filter((d) => cafByDay[d] > 0);
    const cafAvgOnDays = cafDays.length
      ? cafDays.reduce((s, d) => s + cafByDay[d], 0) / cafDays.length
      : 0;
    let cafMaxDay = { d: null, mg: 0 };
    for (const d of cafDays) {
      if (cafByDay[d] > cafMaxDay.mg) cafMaxDay = { d, mg: cafByDay[d] };
    }

    // Learning on days with vs without caffeine (across all tracked dates with either learning or wake time)
    const allTrackedDays = Array.from(new Set([...dates, ...wakeDates, ...cafDays])).filter((d) => d <= todayStr);
    const withCafLearn = [];
    const withoutCafLearn = [];
    for (const d of allTrackedDays) {
      const lm = this.getDayBreakdown(d).learnTotal;
      if ((cafByDay[d] || 0) > 0) withCafLearn.push(lm);
      else withoutCafLearn.push(lm);
    }

    // Levels & Badges
    const totalHours = totalLearn / 60;
    let levelIdx = 0;
    for (let i = 0; i < LEVELS.length; i++) {
      if (totalHours >= LEVELS[i].minHours) levelIdx = i;
    }
    const level = LEVELS[levelIdx];
    const nextLevel = LEVELS[levelIdx + 1] || null;
    const levelProgress = nextLevel
      ? Math.min(100, ((totalHours - level.minHours) / (nextLevel.minHours - level.minHours)) * 100)
      : 100;

    // Healthy rhythm weeks: >= 3 active study days (>= 50% goal or >= 60m) AND >= 1 rest/recovery day
    const weekMap = {};
    const restMax = Math.max(0, Number(this.state.planningPrefs?.restDayMinMinutes ?? 30));
    const activeThresh = Math.min(60, Math.round((this.state.goal || 120) * 0.5));
    for (const d of dates) {
      const mon = getMondayOfWeek(d);
      if (!weekMap[mon]) weekMap[mon] = { activeDays: 0, hasRest: false };
      const b = this.getDayBreakdown(d);
      if (b.learnTotal >= activeThresh && !this.isRestDay(d)) weekMap[mon].activeDays++;
    }
    let healthyWeeks = 0;
    for (const [mon, info] of Object.entries(weekMap)) {
      let hasRecoveryDay = false;
      for (let i = 0; i < 7; i++) {
        const wdDate = addDays(mon, i);
        if (wdDate > todayStr) continue;
        const b = this.getDayBreakdown(wdDate);
        if (this.isRestDay(wdDate) || b.learnTotal <= restMax) {
          hasRecoveryDay = true;
          break;
        }
      }
      if (info.activeDays >= 3 && hasRecoveryDay) healthyWeeks++;
    }

    const badges = [
      { id: 'first', ico: 'check', name: 'Erster Eintrag', desc: 'Den Grundstein gelegt', unlocked: this.state.e.length >= 1 },
      { id: 'goal1', ico: 'target', name: 'Tagesziel erreicht', desc: 'Mind. 1x Tagesziel geschafft', unlocked: streaks.goalDayCount >= 1 },
      { id: 's3', ico: 'flame', name: '3 Tage in Folge', desc: '3er-Serie erreicht', unlocked: streaks.longest >= 3 },
      { id: 's7', ico: 'flame', name: '7 Tage in Folge', desc: 'Eine ganze Woche am Stück', unlocked: streaks.longest >= 7 },
      { id: '3h', ico: 'clock', name: '3-Stunden-Tag', desc: '180 min Lernen an einem Tag', unlocked: recordDay.min >= 180 },
      { id: '10h', ico: 'award', name: '10 Stunden gesamt', desc: 'Die ersten 10 h sind im Kasten', unlocked: totalHours >= 10 },
      { id: '50h', ico: 'award', name: '50 Stunden gesamt', desc: '50 Stunden Fokus-Lernzeit', unlocked: totalHours >= 50 },
      { id: '100h', ico: 'award', name: '100 Stunden gesamt', desc: 'Dreistellig – starke Konstanz', unlocked: totalHours >= 100 },
      { id: 'goal10', ico: 'target', name: '10x Ziel erreicht', desc: '10 Tage am Tagesziel', unlocked: streaks.goalDayCount >= 10 },
      { id: 'rhythm', ico: 'calendar', name: 'Gesunder Rhythmus', desc: 'Mind. 2 Wochen im Takt inkl. Ruhetag', unlocked: healthyWeeks >= 2 },
      { id: 'days30', ico: 'activity', name: '30 aktive Tage', desc: 'An 30 verschiedenen Tagen gelernt', unlocked: activeLearnDays >= 30 },
      { id: 'anki10', ico: 'layers', name: '10 Stunden Anki', desc: '600 min Anki-Lernzeit gesamt', unlocked: totalAnki >= 600 }
    ];

    return {
      totalLearn,
      totalAnki,
      totalProd,
      activeLearnDays,
      avgActive,
      median,
      recordDay,
      streaks,
      goalRate,
      thisWeek,
      lastWeek,
      avg30,
      thisMonth,
      monthProjection,
      weekdayAvgs,
      hourCounts,
      peakHour,
      wakeStats: {
        dayCount: wakeDates.length,
        wakeTotalMin,
        wakeLearnMin,
        wakeAnkiMin,
        wakeProdMin,
        avgWakeMin: wakeDates.length ? wakeTotalMin / wakeDates.length : 0,
        learnQuote: wakeTotalMin ? (wakeLearnMin / wakeTotalMin) * 100 : 0,
        bothQuote: wakeTotalMin ? ((wakeLearnMin + wakeProdMin) / wakeTotalMin) * 100 : 0
      },
      cafStats: {
        cafByDay,
        cafDayCount: cafDays.length,
        cafAvgOnDays,
        cafMaxDay,
        withCafAvg: withCafLearn.length ? withCafLearn.reduce((a, b) => a + b, 0) / withCafLearn.length : 0,
        withoutCafAvg: withoutCafLearn.length ? withoutCafLearn.reduce((a, b) => a + b, 0) / withoutCafLearn.length : 0,
        withCafCount: withCafLearn.length,
        withoutCafCount: withoutCafLearn.length
      },
      level,
      nextLevel,
      levelIdx,
      levelProgress,
      badges
    };
  }

  // ---------- Learning Calibration (#8) & Subtle 7-Day Load Indicator (#6) ----------

  getCalibrationSummary() {
    // Group tagged entries with real single-session duration (blockMin or sum-mode m) by (mod + act)
    const buckets = {};
    const recentSessions = [];

    const sorted = [...this.state.e]
      .filter((x) => x.k === 'l' || x.k === 'a')
      .sort((a, b) => (b.d + (b.t || '')).localeCompare(a.d + (a.t || '')) || b.id - a.id);

    for (const x of sorted) {
      // Never blindly treat cumulative 'max' totals without blockMin as single-task durations!
      const realDur = Number(x.blockMin || (this.state.mode === 'sum' ? x.m : 0) || 0);
      const displayDur = realDur > 0 ? realDur : Number(x.m || 0);
      if (displayDur <= 0) continue;
      if (x.mod || x.act || x.note) {
        const modObj = x.mod ? this.state.modules[x.mod] : null;
        if (recentSessions.length < 12) {
          recentSessions.push({
            d: x.d,
            t: x.t || '',
            dauerMin: displayDur,
            art: x.k === 'a' ? 'anki' : 'lernen',
            fach: modObj ? modObj.shortName : (x.mod || ''),
            taetigkeit: x.act || '',
            was: x.note || ''
          });
        }
      }

      if (x.mod && realDur >= 10 && realDur <= 420) {
        const actKey = x.act || (this.state.modules[x.mod]?.attendance === 'video' ? 'video' : 'review');
        const key = `${x.mod}::${actKey}`;
        if (!buckets[key]) buckets[key] = { modId: x.mod, act: actKey, samples: [] };
        buckets[key].samples.push(realDur);
      }
    }

    const byModule = Object.values(buckets).map((b) => {
      const mod = this.state.modules[b.modId];
      const avgMin = Math.round(b.samples.reduce((s, v) => s + v, 0) / b.samples.length);
      const upperMin = this._calcUpperEndMin(b.samples);
      const currentRuleMin = b.act === 'video'
        ? (mod?.videoStudyMinutes ?? 110)
        : (mod?.liveReviewMinutes ?? 75);
      const diff = upperMin - currentRuleMin;
      return {
        modId: b.modId,
        fach: mod?.shortName || b.modId,
        taetigkeit: b.act,
        anzahl: b.samples.length,
        p75Min: upperMin,
        echterSchnittMin: avgMin,
        regelMin: currentRuleMin,
        suggestAdjust: b.samples.length >= 2 && Math.abs(diff) >= 15
      };
    });

    return { recentSessions, byModule };
  }

  // 75th percentile (upper-end buffer, rounded up to 5-min step) so auto-calibration protects against time pressure
  _calcUpperEndMin(samples = []) {
    if (!samples.length) return 0;
    const sorted = [...samples].sort((a, b) => a - b);
    if (sorted.length === 1) return Math.ceil(sorted[0] / 5) * 5;
    const pos = 0.75 * (sorted.length - 1);
    const lo = Math.floor(pos);
    const hi = Math.ceil(pos);
    const raw = sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
    return Math.ceil(raw / 5) * 5;
  }

  // ---------- Self-Calibrating Task Catalog (Bausteine für KI & Nutzer) ----------

  _subjectTagFromText(text = '', modId = '') {
    const mod = modId ? this.state.modules?.[modId] : null;
    const hay = `${text || ''} ${mod?.shortName || ''} ${mod?.name || ''} ${mod?.subjectGroup || ''}`.toLowerCase();
    if (/\bhm\b|höhere math|mathe/.test(hay)) return 'hm';
    if (/\btm\b|mechanik/.test(hay)) return 'tm';
    if (/\bmkl\b|konstruktion/.test(hay)) return 'mkl';
    if (/\bwk\b|werkstoff/.test(hay)) return 'wk';
    if (/\bft\b|fertigung/.test(hay)) return 'ft';
    if (/spanisch/.test(hay)) return 'spanisch';
    if (/altklausur|klausur/.test(hay)) return 'klausur';
    if (/zusammenfassung|formelsammlung/.test(hay)) return 'summary';
    if (/anki/.test(hay)) return 'anki';
    return '';
  }

  matchCatalogItemForText(title = '', act = '', modId = '') {
    const catalog = this.state.taskCatalog || [];
    if (!catalog.length) return null;
    const lowTitle = String(title || '').toLowerCase().trim();
    if (!lowTitle && !act && !modId) return null;

    // 1. Exact or very close title match
    const exact = catalog.find((c) => c.title.toLowerCase() === lowTitle);
    if (exact) return exact;

    const subjTag = this._subjectTagFromText(lowTitle, modId);
    const inferredAct = act || (
      /video|vl-video/.test(lowTitle) ? 'video' :
      /\bha\b|hausaufgabe|übungsblatt|aufgabenblatt/.test(lowTitle) ? 'homework' :
      /zeichnen|skizzier|cad|workshop/.test(lowTitle) ? 'homework' :
      /altklausur|klausur|tutorium|übung.*nacharbeit|aufgaben.*rechnen/.test(lowTitle) ? 'exam' :
      /nacharbeit|folien|ankis?.*erstellen|ankis?.*nachholen|zusammenfassung|formelsammlung/.test(lowTitle) ? 'review' :
      ''
    );

    let best = null;
    let bestScore = 0;

    for (const c of catalog) {
      let score = 0;
      const cSubj = this._subjectTagFromText(`${c.subject} ${c.title}`, '');
      const cLow = c.title.toLowerCase();

      if (subjTag && cSubj && subjTag === cSubj) score += 5;
      else if (subjTag && cSubj && subjTag !== cSubj) continue;

      if (inferredAct && c.act && inferredAct === c.act) score += 3;
      if (lowTitle.includes('video') && cLow.includes('video')) score += 4;
      if ((lowTitle.includes('hausaufgabe') || /\bha\b/.test(lowTitle)) && (cLow.includes('hausaufgabe') || cLow.includes('übungsblatt') || cLow.includes('aufgabenblatt'))) score += 4;
      if ((lowTitle.includes('tutorium') || lowTitle.includes('übung')) && (cLow.includes('tutorium') || cLow.includes('übung'))) score += 3;
      if (lowTitle.includes('zeichnen') && cLow.includes('zeichnen')) score += 4;
      if (lowTitle.includes('altklausur') && cLow.includes('altklausur')) score += 4;
      if ((lowTitle.includes('zusammenfassung') || lowTitle.includes('formelsammlung')) && (cLow.includes('zusammenfassung') || cLow.includes('formelsammlung'))) score += 4;
      if (lowTitle.includes('spanisch') && cLow.includes('spanisch')) score += 5;
      if (lowTitle.includes('anki') && (lowTitle.includes('erstellen') || lowTitle.includes('nachholen')) && cLow.includes('anki')) score += 3;

      if (score > bestScore) {
        bestScore = score;
        best = c;
      }
    }

    return bestScore >= 5 ? best : null;
  }

  getCalibratedTaskCatalog() {
    const catalog = this.state.taskCatalog || [];
    const samplesById = {};
    for (const c of catalog) samplesById[c.id] = [];

    for (const x of (this.state.e || [])) {
      if (x.k !== 'l' && x.k !== 'a') continue;
      // Only count actual per-task durations (blockMin or sum-mode m)
      const dur = Number(x.blockMin || (this.state.mode === 'sum' ? x.m : 0) || 0);
      if (dur < 10 || dur > 420) continue;

      let cid = x.catalogId && samplesById[x.catalogId] ? x.catalogId : '';
      if (!cid && (x.note || x.mod || x.act)) {
        const hit = this.matchCatalogItemForText(x.note || '', x.act || '', x.mod || '');
        if (hit && samplesById[hit.id]) cid = hit.id;
      }
      if (cid) samplesById[cid].push(dur);
    }

    return catalog.map((c) => {
      const samples = samplesById[c.id] || [];
      const sampleCount = samples.length;
      const avgRealMin = sampleCount > 0
        ? Math.round(samples.reduce((s, v) => s + v, 0) / sampleCount)
        : 0;
      const upperRealMin = sampleCount > 0 ? this._calcUpperEndMin(samples) : 0;
      const calibrated = sampleCount >= 2;
      const effectiveMin = calibrated ? upperRealMin : Math.max(5, Number(c.defaultMin) || 45);
      return {
        ...c,
        sampleCount,
        avgRealMin,
        upperRealMin,
        calibrated,
        effectiveMin
      };
    });
  }

  upsertTaskCatalogItem({ id = '', subject = '', title = '', act = '', kind = 'l', defaultMin = 60, notes = '', source = 'user' }) {
    const cleanTitle = String(title || '').trim();
    if (!cleanTitle) return null;
    if (!Array.isArray(this.state.taskCatalog)) this.state.taskCatalog = [];
    const dur = Math.max(5, Math.min(480, Math.round(Number(defaultMin) || 45)));
    const existing = id ? this.state.taskCatalog.find((c) => c.id === id) : null;
    if (existing) {
      existing.subject = String(subject || '').trim() || existing.subject || 'Allgemein';
      existing.title = cleanTitle;
      existing.act = act || '';
      existing.kind = ['l', 'a', 'p'].includes(kind) ? kind : 'l';
      existing.defaultMin = dur;
      existing.notes = String(notes || '').trim();
      existing.updatedAt = Date.now();
      this.save();
      return existing;
    }
    const item = {
      id: `cat_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      subject: String(subject || '').trim() || 'Allgemein',
      title: cleanTitle,
      act: act || '',
      kind: ['l', 'a', 'p'].includes(kind) ? kind : 'l',
      defaultMin: dur,
      notes: String(notes || '').trim(),
      source,
      updatedAt: Date.now()
    };
    this.state.taskCatalog.push(item);
    this.save();
    return item;
  }

  deleteTaskCatalogItem(id) {
    if (!id) return;
    this.pushUndo('Katalog-Baustein gelöscht');
    this.markDeleted(id);
    this.state.taskCatalog = (this.state.taskCatalog || []).filter((c) => c.id !== id);
    this.save();
  }

  // AI-safe ADD-ONLY helper: AI can suggest/add new blueprints, NEVER delete or overwrite existing ones!
  addCatalogItemsFromAi(rawItems = []) {
    if (!Array.isArray(rawItems) || !rawItems.length) return 0;
    if (!Array.isArray(this.state.taskCatalog)) this.state.taskCatalog = [];
    const existingTitles = new Set(this.state.taskCatalog.map((c) => c.title.toLowerCase().trim()));
    let added = 0;
    const nowTs = Date.now();
    for (const raw of rawItems) {
      const title = String(raw?.title || '').trim();
      if (!title || existingTitles.has(title.toLowerCase())) continue;
      const dur = Math.max(10, Math.min(480, Math.round(Number(raw.defaultMin || raw.estMin) || 60)));
      this.state.taskCatalog.push({
        id: `cat_ai_${nowTs}_${added}_${Math.random().toString(36).slice(2, 5)}`,
        subject: String(raw.subject || raw.fach || 'Allgemein').trim(),
        title,
        act: ['video', 'review', 'homework', 'exam', ''].includes(raw.act) ? raw.act : '',
        kind: ['l', 'p'].includes(raw.kind) ? raw.kind : 'l',
        defaultMin: dur,
        notes: String(raw.notes || raw.notiz || 'Von KI vorgeschlagen').trim(),
        source: 'ai',
        updatedAt: nowTs
      });
      existingTitles.add(title.toLowerCase());
      added++;
    }
    if (added > 0) this.save();
    return added;
  }

  getLoadSummary7d(todayStr = toDateStr()) {
    let learn7 = 0;
    let lec7 = 0;
    let caf7 = 0;
    let daysWithZeroFree = 0;
    let consecutiveHeavyDays = 0;
    const heavyThreshold = Math.max(120, Math.round((this.state.goal || 120) * 0.5));

    for (let i = 0; i < 7; i++) {
      const d = addDays(todayStr, -i);
      const b = this.getDayBreakdown(d);
      learn7 += b.learnTotal;
      lec7 += b.p;
      const dayTotal = b.learnTotal + b.p;
      if (dayTotal >= heavyThreshold) daysWithZeroFree++;
    }

    // Count consecutive heavy days (>= max(120 min, 50% daily goal) total) going backwards up to 21 days
    for (let i = 0; i < 21; i++) {
      const d = addDays(todayStr, -i);
      const b = this.getDayBreakdown(d);
      if (b.learnTotal + b.p >= heavyThreshold) consecutiveHeavyDays++;
      else break;
    }

    for (const c of this.state.cf) {
      if (c.d >= addDays(todayStr, -6) && c.d <= todayStr) {
        caf7 += Number(c.mg) || 0;
      }
    }

    const total7Min = learn7 + lec7;
    const total7Hours = total7Min / 60;
    let level = 'entspannt';
    let label = 'Entspannt';
    let hint = 'Gute Balance – genug Luft für reguläres Pensum.';

    if (total7Hours >= 36 || consecutiveHeavyDays >= 10) {
      level = 'hoch';
      label = 'Hohe Last';
      hint = `${total7Hours.toFixed(1)} h in 7 Tagen${consecutiveHeavyDays >= 7 ? `, ${consecutiveHeavyDays} Tage ohne Pause` : ''} – Reset-Tag lohnt sich.`;
    } else if (total7Hours >= 22 || consecutiveHeavyDays >= 6) {
      level = 'solide';
      label = 'Solide Last';
      hint = `${total7Hours.toFixed(1)} h in 7 Tagen – stabiler KIT-Rhythmus.`;
    }

    return {
      learn7Min: learn7,
      lec7Min: lec7,
      total7Min,
      total7Hours,
      caf7Mg: caf7,
      activeDays7: daysWithZeroFree,
      consecutiveDays: consecutiveHeavyDays,
      level,
      label,
      hint
    };
  }

  // ---------- Subject Balance & Realistic Time per Subject (Lernen + Echte Anki-Zeit) ----------

  getSubjectBalance({ days = 0, todayStr = toDateStr() } = {}) {
    const minDate = days > 0 ? addDays(todayStr, -(days - 1)) : '';
    const inRange = (dStr) => !minDate || (dStr >= minDate && dStr <= todayStr);
    const groups = {};

    const ensureGroup = (groupName) => {
      const key = (groupName || 'Sonstiges').trim() || 'Sonstiges';
      if (!groups[key]) {
        groups[key] = {
          subject: key,
          modIds: new Set(),
          ankiDecks: new Set(),
          focusMin: 0,
          ankiSec: 0,
          ankiReviewedCards: 0,
          sessions: 0,
          openBacklog: 0,
          chkDone: 0,
          chkTotal: 0,
          ankiNew: 0,
          ankiLearn: 0,
          ankiReview: 0
        };
      }
      return groups[key];
    };

    for (const m of Object.values(this.state.modules || {})) {
      const subj = (m.subjectGroup || m.shortName || m.name || 'Sonstiges').replace(/\s*\([^)]+\)/, '').trim();
      const g = ensureGroup(subj);
      g.modIds.add(m.id);
      if (m.ankiDeck) g.ankiDecks.add(m.ankiDeck.toLowerCase());
    }

    const matchSubjectByText = (text = '') => {
      const low = (text || '').toLowerCase();
      if (!low) return null;
      for (const g of Object.values(groups)) {
        const base = g.subject.toLowerCase();
        const shortToken = base.split(/\s+/)[0]; // e.g. 'hm', 'tm', 'mkl', 'wk', 'fertigungstechnik'
        if (low.includes(base) || (shortToken.length >= 2 && new RegExp(`\\b${shortToken.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(low))) {
          return g;
        }
        if ((base.startsWith('hm') || base.includes('mathematik')) && /\b(hm\d?|mathe|mathematik|höhere math)\b/i.test(low)) return g;
        if ((base.startsWith('tm') || base.includes('mechanik')) && /\b(tm\d?|mechanik|statik|festigkeitslehre)\b/i.test(low)) return g;
        if ((base.startsWith('mkl') || base.includes('konstruktion')) && /\b(mkl|konstruktion|maschinenkonstruktion)\b/i.test(low)) return g;
        if ((base.startsWith('ft') || base.includes('fertigung')) && /\b(ft\d?|fertigung|fertigungstechnik)\b/i.test(low)) return g;
        if ((base.startsWith('wk') || base.includes('werkstoff')) && /\b(wk\d?|werkstoff|werkstoffkunde)\b/i.test(low)) return g;
        if ((base.startsWith('info') || base.includes('informatik')) && /\b(info|informatik)\b/i.test(low)) return g;
      }
      return null;
    };

    const matchDeckToGroup = (fullName = '', shortName = '') => {
      const dFullLow = (fullName || '').toLowerCase();
      const dLow = (shortName || '').toLowerCase();
      const explicit = Object.values(groups).find((g) => {
        for (const ad of g.ankiDecks) {
          if (dFullLow === ad || dLow === ad || (dFullLow && dFullLow.startsWith(`${ad}::`))) return true;
        }
        return false;
      });
      if (explicit) return explicit;
      const byText = matchSubjectByText(fullName) || matchSubjectByText(shortName);
      if (byText) return byText;

      // Fallback: derive clean subject name from deck hierarchy so 100 % of non-excluded Anki study time is visible
      const rawParts = (fullName || shortName || '').split('::').map((p) => p.trim()).filter(Boolean);
      const genericRe = /^(studium|kit|uni|maschinenbau|mach|bachelor|1\.\s*sem(?:ester)?|2\.\s*sem(?:ester)?|ws\s*\d+|ss\s*\d+|anker|karten)$/i;
      const meaningful = rawParts.find((p) => !genericRe.test(p)) || rawParts[rawParts.length - 1] || 'Anki (Sonstiges)';
      return ensureGroup(meaningful);
    };

    const excludedDecks = this.state.anki?.excludedDecks || [];
    const reviewByDay = this.state.anki?.reviewByDay || {};

    // 1. Aggregate real Anki review time per deck & day directly from Anki's revlog
    for (const [d, dayDecks] of Object.entries(reviewByDay)) {
      if (!inRange(d) || !dayDecks || typeof dayDecks !== 'object') continue;
      for (const [fullName, stat] of Object.entries(dayDecks)) {
        if (!stat) continue;
        const sec = Number(stat.sec) || 0;
        const cards = Number(stat.cards) || 0;
        if (sec <= 0 && cards <= 0) continue;
        const parts = fullName.split('::');
        const shortName = parts[parts.length - 1] || fullName;
        if (isAnkiDeckExcluded(fullName, shortName, excludedDecks)) continue;
        const target = matchDeckToGroup(fullName, shortName);
        if (target) {
          target.ankiSec += sec;
          target.ankiReviewedCards += cards;
        }
      }
    }

    // 2. Aggregate tracked non-Anki learning time (k === 'l') + fallback subject-tagged Anki on days without revlog
    const learnCountByDay = {};
    for (const x of this.state.e) {
      if (x.k === 'l') learnCountByDay[x.d] = (learnCountByDay[x.d] || 0) + 1;
    }

    for (const x of this.state.e) {
      if (!inRange(x.d)) continue;
      if (x.k !== 'l' && x.k !== 'a') continue;
      if (x.autoAnki) continue; // Already covered with per-deck precision via reviewByDay!

      let dur = Number(x.blockMin || 0);
      if (dur <= 0) {
        if (this.state.mode === 'sum' || (x.k === 'l' && learnCountByDay[x.d] === 1)) {
          dur = Number(x.m) || 0;
        }
      }
      if (dur <= 0) continue;

      let target = null;
      if (x.mod) {
        target = Object.values(groups).find((g) => g.modIds.has(x.mod)) || null;
      }
      if (!target && x.note) target = matchSubjectByText(x.note);
      if (!target) continue;

      if (x.k === 'l') {
        target.focusMin += dur;
        target.sessions++;
      } else if (x.k === 'a' && !reviewByDay[x.d]) {
        // Fallback only for days before AnkiConnect revlog existed
        target.ankiSec += dur * 60;
      }
    }

    // 3. Open/overdue backlog per subject
    for (const b of (this.state.backlog || [])) {
      if (b.status === 'done') continue;
      let target = b.moduleId ? Object.values(groups).find((g) => g.modIds.has(b.moduleId)) : null;
      if (!target) target = matchSubjectByText(b.title);
      if (target) target.openBacklog++;
    }

    // 4. Checklist completion per subject
    for (const c of (this.state.checklist || [])) {
      if (!inRange(c.d) && days > 0) continue;
      let target = c.moduleId ? Object.values(groups).find((g) => g.modIds.has(c.moduleId)) : null;
      if (!target) target = matchSubjectByText(c.title);
      if (target) {
        target.chkTotal++;
        if (c.done) target.chkDone++;
      }
    }

    // 5. Current due Anki cards per subject (leaf & non-excluded)
    const activeLeafDecks = filterLeafAnkiDecks(this.state.anki?.decks || [], excludedDecks);
    for (const d of activeLeafDecks) {
      const target = matchDeckToGroup(d.fullName || d.name, d.name);
      if (target) {
        target.ankiNew += Number(d.newCards) || 0;
        target.ankiLearn += Number(d.learnCards) || 0;
        target.ankiReview += Number(d.reviewCards) || 0;
      }
    }

    return Object.values(groups)
      .map((g) => {
        const focusMin = Math.round(g.focusMin);
        const ankiMin = Math.round(g.ankiSec / 60);
        const learnMin = focusMin + ankiMin;
        return {
          subject: g.subject,
          modIds: Array.from(g.modIds),
          focusMin,
          ankiMin,
          learnMin,
          ankiReviewedCards: g.ankiReviewedCards,
          ankiAvgSec: g.ankiReviewedCards > 0 ? Math.round(g.ankiSec / g.ankiReviewedCards) : 0,
          sessions: g.sessions,
          openBacklog: g.openBacklog,
          chkDone: g.chkDone,
          chkTotal: g.chkTotal,
          ankiNew: g.ankiNew,
          ankiLearn: g.ankiLearn,
          ankiReview: g.ankiReview,
          ankiTotal: g.ankiNew + g.ankiLearn + g.ankiReview
        };
      })
      .filter((s) => s.modIds.length > 0 || s.learnMin > 0 || s.ankiTotal > 0 || s.openBacklog > 0 || s.chkTotal > 0)
      .sort((a, b) => b.learnMin - a.learnMin || b.openBacklog - a.openBacklog || a.subject.localeCompare(b.subject));
  }

  // ---------- Personal Learning Patterns / Bio-Code (#7) ----------

  getPersonalPatterns(todayStr = toDateStr()) {
    const nowDate = new Date();
    const allDates = Array.from(new Set([...this.getAllActiveDates(), ...Object.keys(this.state.w || {})]))
      .filter((d) => d <= todayStr)
      .sort();

    // 1. Early (< 09:30) vs Late (>= 09:30) wake-up
    const earlyLearn = [], earlyQuote = [];
    const lateLearn = [], lateQuote = [];
    for (const d of Object.keys(this.state.w || {})) {
      if (d > todayStr) continue;
      const wMin = timeToMin(this.state.w[d]);
      const sp = this.getAwakeSpan(d, nowDate);
      if (d === todayStr && (!sp || sp.elapsedMin < 60)) continue;
      const b = this.getDayBreakdown(d);
      const q = sp && sp.elapsedMin > 0 ? Math.min(100, (b.learnTotal / sp.elapsedMin) * 100) : 0;
      if (wMin < 9 * 60 + 30) {
        earlyLearn.push(b.learnTotal);
        earlyQuote.push(q);
      } else {
        lateLearn.push(b.learnTotal);
        lateQuote.push(q);
      }
    }

    // 2. Learning capacity by Uni Lecture Load (0 VL vs 1-2 VL vs 3+ VL based on p minutes)
    const cap0 = [], cap12 = [], cap3p = [];
    for (const d of allDates) {
      const b = this.getDayBreakdown(d);
      if (b.learnTotal === 0 && b.p === 0) continue;
      if (b.p === 0) cap0.push(b.learnTotal);
      else if (b.p <= 180) cap12.push(b.learnTotal);
      else cap3p.push(b.learnTotal);
    }

    // 3. Late caffeine (>= 15:00) vs Next-day wake-up time
    const lateCafDays = new Set();
    for (const c of (this.state.cf || [])) {
      if (timeToMin(c.t) >= 15 * 60 && (Number(c.mg) || 0) > 0) lateCafDays.add(c.d);
    }
    const nextWakeWithLateCaf = [];
    const nextWakeWithoutLateCaf = [];
    for (const d of Object.keys(this.state.w || {})) {
      if (d > todayStr) continue;
      const prevDay = addDays(d, -1);
      const wMin = timeToMin(this.state.w[d]);
      if (lateCafDays.has(prevDay)) nextWakeWithLateCaf.push(wMin);
      else if (this.state.w[prevDay] || this.getDayBreakdown(prevDay).total > 0) nextWakeWithoutLateCaf.push(wMin);
    }

    const avg = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);

    return {
      wakeCompare: {
        ready: earlyLearn.length >= 2 && lateLearn.length >= 2,
        earlyCount: earlyLearn.length,
        earlyAvgMin: Math.round(avg(earlyLearn)),
        earlyAvgQuote: Number(avg(earlyQuote).toFixed(1)),
        lateCount: lateLearn.length,
        lateAvgMin: Math.round(avg(lateLearn)),
        lateAvgQuote: Number(avg(lateQuote).toFixed(1))
      },
      capacityByUniLoad: {
        freeDaysCount: cap0.length,
        freeDaysAvgMin: Math.round(avg(cap0)),
        mediumUniCount: cap12.length,
        mediumUniAvgMin: Math.round(avg(cap12)),
        heavyUniCount: cap3p.length,
        heavyUniAvgMin: Math.round(avg(cap3p))
      },
      lateCaffeineWake: {
        ready: nextWakeWithLateCaf.length >= 2 && nextWakeWithoutLateCaf.length >= 2,
        withCount: nextWakeWithLateCaf.length,
        withAvgWake: nextWakeWithLateCaf.length ? minToTime(avg(nextWakeWithLateCaf)) : '',
        withoutCount: nextWakeWithoutLateCaf.length,
        withoutAvgWake: nextWakeWithoutLateCaf.length ? minToTime(avg(nextWakeWithoutLateCaf)) : ''
      }
    };
  }

  // ---------- Records & Milestones (#3) + Markdown Study Report (#6) ----------

  getRecordsAndMilestones(todayStr = toDateStr(), overallStats = null) {
    const nowDate = new Date();
    const dates = this.getAllActiveDates().filter((d) => d <= todayStr);
    const st = overallStats || this.getOverallStats();

    // Best week (Monday-Sunday)
    const weekTotals = {};
    const monthTotals = {};
    for (const d of dates) {
      const m = this.getDayBreakdown(d).learnTotal;
      if (m <= 0) continue;
      const mon = getMondayOfWeek(d);
      weekTotals[mon] = (weekTotals[mon] || 0) + m;
      const ym = d.slice(0, 7);
      monthTotals[ym] = (monthTotals[ym] || 0) + m;
    }

    let bestWeek = { mon: null, min: 0 };
    for (const [mon, min] of Object.entries(weekTotals)) {
      if (min > bestWeek.min) bestWeek = { mon, min };
    }
    const thisMon = getMondayOfWeek(todayStr);
    const thisWeekMin = weekTotals[thisMon] || 0;
    const isCurrentBestWeek = bestWeek.mon === thisMon && thisWeekMin > 0;
    const toBeatWeekMin = bestWeek.min > thisWeekMin ? (bestWeek.min - thisWeekMin + 1) : 0;

    let bestMonth = { ym: null, min: 0 };
    for (const [ym, min] of Object.entries(monthTotals)) {
      if (min > bestMonth.min) bestMonth = { ym, min };
    }

    // Best wake-time learning quote day (skip today if < 60 min awake)
    let bestQuote = { d: null, pct: 0, learnMin: 0, awakeMin: 0 };
    for (const d of Object.keys(this.state.w || {})) {
      if (d > todayStr) continue;
      const sp = this.getAwakeSpan(d, nowDate);
      if (!sp || (d === todayStr && sp.elapsedMin < 60)) continue;
      const b = this.getDayBreakdown(d);
      const pct = Math.min(100, (b.learnTotal / sp.elapsedMin) * 100);
      if (pct > bestQuote.pct) {
        bestQuote = { d, pct: Number(pct.toFixed(1)), learnMin: b.learnTotal, awakeMin: Math.round(sp.elapsedMin) };
      }
    }

    // Next round hour milestone
    const stepsH = [10, 25, 50, 75, 100, 150, 200, 300, 500, 750, 1000, 1500, 2000];
    const totalHours = st.totalLearn / 60;
    let nextMilestoneH = stepsH.find((h) => h > totalHours) || Math.ceil((totalHours + 100) / 100) * 100;
    const prevIdx = stepsH.indexOf(nextMilestoneH) - 1;
    const prevMilestoneH = prevIdx >= 0 ? stepsH[prevIdx] : 0;
    const remainingMin = Math.max(0, Math.round(nextMilestoneH * 60 - st.totalLearn));
    const milestonePct = Math.min(100, ((totalHours - prevMilestoneH) / Math.max(1, nextMilestoneH - prevMilestoneH)) * 100);

    return {
      bestWeek,
      thisWeekMin,
      isCurrentBestWeek,
      toBeatWeekMin,
      bestMonth,
      bestQuote,
      nextMilestoneH,
      prevMilestoneH,
      remainingMin,
      milestonePct
    };
  }

  buildMarkdownStudyReport(todayStr = toDateStr()) {
    const st = this.getOverallStats();
    const rec = this.getRecordsAndMilestones(todayStr);
    const subj = this.getSubjectBalance();
    const pat = this.getPersonalPatterns(todayStr);
    const load7 = this.getLoadSummary7d(todayStr);
    const openBacklog = (this.state.backlog || []).filter((b) => b.status !== 'done');
    const weekDiff = st.thisWeek - st.lastWeek;

    const lines = [
      `# KIT StudyFlow – Studienbericht (${fmtDateShort(todayStr)})`,
      '',
      '## 1. Kern-Kennzahlen',
      `- **Lernzeit gesamt:** ${fmtHours(st.totalLearn)} (davon Anki: ${fmtMin(st.totalAnki)})`,
      `- **Vorlesung / Produktiv gesamt:** ${fmtHours(st.totalProd)} (~${(st.totalProd / 90).toFixed(1)} VL-Blöcke)`,
      `- **Diese Woche:** ${fmtMin(st.thisWeek)} (${weekDiff >= 0 ? '+' : ''}${fmtMin(weekDiff)} vs. letzte Woche)`,
      `- **Aktive Tage:** ${st.activeLearnDays} · **Ø aktiv:** ${fmtMin(st.avgActive)} · **Median:** ${fmtMin(st.median)}`,
      `- **Serie:** aktuell ${st.streaks.current} Tage (Rekord: ${st.streaks.longest} Tage · Zielquote: ${st.goalRate.toFixed(0)} %)`,
      `- **Wachzeit-Quote:** Lernen ${st.wakeStats.learnQuote.toFixed(1)} % · Zusammen inkl. VL ${st.wakeStats.bothQuote.toFixed(1)} %`,
      `- **7-Tage-Belastung:** ${load7.total7Hours.toFixed(1)} h (${load7.label}, ${load7.consecutiveDays} Tage am Stück)`,
      '',
      '## 2. Rekorde & Meilenstein',
      `- **Rekordtag:** ${fmtMin(st.recordDay.min)}${st.recordDay.d ? ` (${fmtDateShort(st.recordDay.d)})` : ''}`,
      `- **Stärkste Woche:** ${fmtMin(rec.bestWeek.min)}${rec.bestWeek.mon ? ` (ab ${fmtDateShort(rec.bestWeek.mon)})` : ''}`,
      `- **Höchste Tages-Quote:** ${rec.bestQuote.pct} %${rec.bestQuote.d ? ` (${fmtDateShort(rec.bestQuote.d)})` : ''}`,
      `- **Nächster Meilenstein:** ${rec.nextMilestoneH} h (noch ${fmtMin(rec.remainingMin)})`,
      ''
    ];

    if (subj.length) {
      lines.push(
        '## 3. Investierte Zeit pro Fach (Lernen + Anki)',
        '| Fach | Gesamt | Lernen | Anki (echt) | Offener Rückstand | Checkliste | Anki fällig (B/R/G) |',
        '| :--- | :---: | :---: | :---: | :---: | :---: | :---: |'
      );
      for (const s of subj) {
        lines.push(`| ${s.subject} | ${fmtMin(s.learnMin)} | ${fmtMin(s.focusMin)} | ${fmtMin(s.ankiMin)}${s.ankiReviewedCards > 0 ? ` (${s.ankiReviewedCards} K.)` : ''} | ${s.openBacklog} | ${s.chkDone}/${s.chkTotal} | ${s.ankiTotal > 0 ? `${s.ankiNew}/${s.ankiLearn}/${s.ankiReview}` : '–'} |`);
      }
      lines.push('');
    }

    lines.push(
      '## 4. Persönliche Lern-Muster',
      `- **Kapazität nach Uni-Last:** Freie Tage Ø ${fmtMin(pat.capacityByUniLoad.freeDaysAvgMin)} (${pat.capacityByUniLoad.freeDaysCount}T) · 1–2 VL Ø ${fmtMin(pat.capacityByUniLoad.mediumUniAvgMin)} (${pat.capacityByUniLoad.mediumUniCount}T) · 3+ VL Ø ${fmtMin(pat.capacityByUniLoad.heavyUniAvgMin)} (${pat.capacityByUniLoad.heavyUniCount}T)`,
      pat.wakeCompare.ready
        ? `- **Aufwachzeit:** Früh (<09:30) Ø ${fmtMin(pat.wakeCompare.earlyAvgMin)} (${pat.wakeCompare.earlyAvgQuote} %) vs. Spät (≥09:30) Ø ${fmtMin(pat.wakeCompare.lateAvgMin)} (${pat.wakeCompare.lateAvgQuote} %)`
        : '- **Aufwachzeit:** Noch zu wenig Vergleichstage.',
      st.cafStats.withCafCount >= 2 && st.cafStats.withoutCafCount >= 2
        ? `- **Koffein:** Mit Koffein Ø ${fmtMin(st.cafStats.withCafAvg)} vs. Ohne Ø ${fmtMin(st.cafStats.withoutCafAvg)}`
        : '- **Koffein:** Noch zu wenig Vergleichstage.',
      ''
    );

    if (openBacklog.length) {
      lines.push('## 5. Offener Rückstand');
      for (const b of openBacklog) lines.push(`- [${b.status}] ${b.title} (~${fmtMin(b.estMin)})`);
      lines.push('');
    }

    if (this.state.ai?.rhythmNotes) {
      lines.push('## 6. Aktuelle Rhythmus-Orientierung', this.state.ai.rhythmNotes, '');
    }

    return lines.join('\n');
  }

  // ---------- Backup Import / Export (1:1 Fokus-Tracker compatible!) ----------

  exportBackupJSON({ includeApiKey = true } = {}) {
    this.state.lb = Date.now();
    this.save({ skipSync: true, silent: true });
    const clone = JSON.parse(JSON.stringify(this.state));
    if (!includeApiKey && clone.ai) clone.ai.apiKey = '';
    return JSON.stringify(clone, null, 2);
  }

  importBackupJSON(jsonText, strategy = 'replace', { skipSync = false } = {}) {
    const parsed = JSON.parse(jsonText);
    if (!parsed || typeof parsed !== 'object') {
      throw new Error('Ungültiges JSON-Backup.');
    }
    if (!Array.isArray(parsed.e) && !parsed.w && !parsed.cf && !Array.isArray(parsed.checklist) && !Array.isArray(parsed.planBlocks)) {
      throw new Error('Datei enthält keine erkennbaren Fokus-Tracker- oder Planer-Daten.');
    }

    if (strategy === 'replace') {
      const prev = this.state;
      const merged = this._mergeDefaults(parsed);
      // Preserve ALL StudyFlow v16 extensions when importing a pure Fokus-Tracker backup
      if (!parsed.ai) {
        merged.ai = JSON.parse(JSON.stringify(prev.ai || merged.ai));
      } else if (!parsed.ai.apiKey && prev.ai?.apiKey) {
        merged.ai.apiKey = prev.ai.apiKey;
      }
      if (!parsed.modules && Object.keys(prev.modules || {}).length) merged.modules = JSON.parse(JSON.stringify(prev.modules));
      if (!parsed.icsRaw && prev.icsRaw) { merged.icsRaw = prev.icsRaw; merged.icsUpdatedAt = prev.icsUpdatedAt || 0; }
      if (!parsed.checklist && (prev.checklist || []).length) merged.checklist = JSON.parse(JSON.stringify(prev.checklist));
      if (!parsed.backlog && (prev.backlog || []).length) merged.backlog = JSON.parse(JSON.stringify(prev.backlog));
      if (!parsed.customEvents && (prev.customEvents || []).length) merged.customEvents = JSON.parse(JSON.stringify(prev.customEvents));
      if (!parsed.eventOverrides && Object.keys(prev.eventOverrides || {}).length) merged.eventOverrides = { ...prev.eventOverrides };
      if (!parsed.dayNotes && Object.keys(prev.dayNotes || {}).length) merged.dayNotes = { ...prev.dayNotes };
      if (!parsed.reminders && (prev.reminders || []).length) merged.reminders = JSON.parse(JSON.stringify(prev.reminders));
      if (!parsed.taskCatalog && (prev.taskCatalog || []).length) {
        merged.taskCatalog = JSON.parse(JSON.stringify(prev.taskCatalog));
        merged.taskCatalogSeeded = Boolean(prev.taskCatalogSeeded);
      }
      if (!parsed.restDays && Object.keys(prev.restDays || {}).length) merged.restDays = { ...prev.restDays };
      if (!parsed.ankiDoneDays && Object.keys(prev.ankiDoneDays || {}).length) merged.ankiDoneDays = { ...prev.ankiDoneDays };
      if (!parsed.lectureAttendance && Object.keys(prev.lectureAttendance || {}).length) merged.lectureAttendance = { ...prev.lectureAttendance };
      if (!parsed.anki && prev.anki) merged.anki = JSON.parse(JSON.stringify(prev.anki));
      if (!parsed.planningPrefs && prev.planningPrefs) merged.planningPrefs = { ...prev.planningPrefs };
      if (!parsed.autopilotHandled && Object.keys(prev.autopilotHandled || {}).length) merged.autopilotHandled = { ...prev.autopilotHandled };
      if (!parsed.mapMeta && Object.keys(prev.mapMeta || {}).length) merged.mapMeta = JSON.parse(JSON.stringify(prev.mapMeta));
      if (!parsed.deletedIds && Object.keys(prev.deletedIds || {}).length) merged.deletedIds = { ...prev.deletedIds };
      if (parsed.autoLogLectures === undefined && prev.autoLogLectures !== undefined) merged.autoLogLectures = prev.autoLogLectures;
      if (!parsed.theme && prev.theme) merged.theme = prev.theme;
      merged.lb = Date.now();
      merged.updatedAt = Date.now();
      this.state = merged;
    } else {
      // Merge mode (all v16 collections & timestamped maps)
      const nowTs = Date.now();
      const existingE = new Set(this.state.e.map((x) => `${x.id}|${x.d}|${x.t}|${x.m}|${x.k}`));
      for (const item of (parsed.e || [])) {
        const sig = `${item.id}|${item.d}|${item.t}|${item.m}|${item.k}`;
        if (!existingE.has(sig)) this.state.e.push({ ...item, updatedAt: item.updatedAt || nowTs });
      }
      const existingCf = new Set(this.state.cf.map((x) => `${x.id}|${x.d}|${x.t}|${x.mg}`));
      for (const item of (parsed.cf || [])) {
        const sig = `${item.id}|${item.d}|${item.t}|${item.mg}`;
        if (!existingCf.has(sig)) this.state.cf.push({ ...item, updatedAt: item.updatedAt || nowTs });
      }

      const mergeMapWithMeta = (mapName, incoming) => {
        if (!incoming || typeof incoming !== 'object') return;
        if (!this.state[mapName]) this.state[mapName] = {};
        for (const [k, v] of Object.entries(incoming)) {
          if (v === undefined) continue;
          this.state[mapName][k] = v;
          this.touchMapKey(mapName, k);
        }
      };

      mergeMapWithMeta('w', parsed.w);
      mergeMapWithMeta('sx', parsed.sx);
      mergeMapWithMeta('modules', parsed.modules);
      mergeMapWithMeta('dayNotes', parsed.dayNotes);
      mergeMapWithMeta('eventOverrides', parsed.eventOverrides);
      mergeMapWithMeta('restDays', parsed.restDays);
      mergeMapWithMeta('ankiDoneDays', parsed.ankiDoneDays);
      mergeMapWithMeta('lectureAttendance', parsed.lectureAttendance);

      if (parsed.autopilotHandled && typeof parsed.autopilotHandled === 'object') {
        this.state.autopilotHandled = { ...(this.state.autopilotHandled || {}), ...parsed.autopilotHandled };
      }
      if (parsed.goal) this.state.goal = parsed.goal;
      if (parsed.mode) this.state.mode = parsed.mode;
      if (parsed.sl) this.state.sl = parsed.sl;
      if (parsed.cl) this.state.cl = parsed.cl;
      if (parsed.planningPrefs && typeof parsed.planningPrefs === 'object') {
        this.state.planningPrefs = { ...(this.state.planningPrefs || {}), ...parsed.planningPrefs };
      }
      if (parsed.anki && typeof parsed.anki === 'object') {
        const curDecks = this.state.anki?.decks || [];
        if (!curDecks.length && Array.isArray(parsed.anki.decks) && parsed.anki.decks.length) {
          this.state.anki = { ...(this.state.anki || {}), ...parsed.anki, updatedAt: nowTs };
        }
      }

      const mergeListById = (field) => {
        if (!Array.isArray(parsed[field])) return;
        if (!Array.isArray(this.state[field])) this.state[field] = [];
        const ids = new Set(this.state[field].map((x) => x.id));
        for (const item of parsed[field]) {
          if (item && !ids.has(item.id)) {
            this.state[field].push({ ...item, updatedAt: item.updatedAt || nowTs });
            ids.add(item.id);
          }
        }
      };
      ['checklist', 'backlog', 'customEvents', 'reminders', 'taskCatalog'].forEach(mergeListById);

      if (parsed.icsRaw && !this.state.icsRaw) {
        this.state.icsRaw = parsed.icsRaw;
        this.state.icsUpdatedAt = parsed.icsUpdatedAt || nowTs;
      }
      this.state.lb = nowTs;
    }

    this.invalidateCaches();
    if (this._reconcileHook) this._reconcileHook({ todayStr: toDateStr() });
    this.save({ skipSync });
    return {
      entries: this.state.e.length,
      wakes: Object.keys(this.state.w).length,
      caffeine: this.state.cf.length
    };
  }

  wipeAllData({ skipSync = false } = {}) {
    this.pushUndo('Alle Daten gelöscht');
    this.state = createDefaultState();
    this.invalidateCaches();
    this.save({ skipSync });
  }
}

export const store = new Store();

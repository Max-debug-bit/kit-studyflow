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
      d_anki: true,
      d_entry: true,
      dgc: true,
      d_caf: false,
      d_wake: false,
      d_ent: false,
      tdt: false
    },
    dg: { n: 0, max: 0, at: 0, tmax: 0 },

    // KIT StudyFlow extensions (schemaVersion 2)
    schemaVersion: 2,
    theme: 'dark',  // 'dark' (pure black) | 'light' | 'auto'
    autoLogLectures: true,
    lectureAttendance: {}, // { [uid]: 'attended' | 'skipped' }
    eventOverrides: {},    // { [uid]: 'lecture' | 'exercise' | 'cancelled' }
    restDays: {},          // { 'YYYY-MM-DD': true } manual rest days protecting streak (#1)
    autopilotHandled: {},  // { [uid]: timestamp } already accepted or dismissed autopilot suggestions
    deletedIds: {},        // { [id]: timestamp } tombstones for conflict-safe 2-way Gist merge
    customEvents: [],      // { id, title, shortName, recurrence, weekday, date, start, end, eventType, liveReviewMinutes, location, updatedAt }
    modules: {},           // { [moduleKey]: ModuleRule }
    icsRaw: '',
    icsUpdatedAt: 0,
    backlog: [],           // { id, title, moduleId?, kind: 'l'|'a'|'p', estMin, status: 'open'|'scheduled'|'overdue'|'done' }
    checklist: [],         // { id, d, timeLabel, title, kind: 'l'|'a'|'p', estMin, moduleId?, backlogId?, done, source }
    dayNotes: {},          // { 'YYYY-MM-DD': 'Uni 09:45–15:30' }
    reminders: [],         // { id, text, date?, done }
    planBlocks: [],        // Legacy / optional calendar blocks
    tasks: [],             // Assignments / Deadlines
    anki: {
      mode: 'auto', // 'auto' | 'manual'
      url: 'http://127.0.0.1:8765',
      secPerCard: 24,       // legacy fallback
      secNew: 45,           // Blau (Neue Karten)
      secLearn: 30,         // Rot (Lern-/Wiederholungs-Stufe)
      secReview: 15,        // Grün (Fällige Reviews)
      minDailyAnkiMin: 30,
      lastSyncAt: 0,
      manualNew: 0,         // Blau
      manualLearn: 0,       // Rot
      manualReview: 0,      // Grün
      manualDue: 0,         // legacy fallback
      todayMinutes: 0,
      decks: []     // { name, due, newCards, learnCards, reviewCards }
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
      syncApiKeyInGist: true,
      model: 'gemini-3.8-flash',
      energyMode: 'normal', // 'reset' | 'normal' | 'fokus'
      rhythmNotes: '',      // Flexible, soft weekly rhythm guidelines evolved with Gemini in Weekly Review
      chat: [],
      studyNotes: 'Maschinenbau am KIT (1. Semester). HM-Vorlesungen schaue ich als Video (ca. 150–180 Min. mit Pausieren). Nach Live-Vorlesungen in MKL, WK, FT und TM arbeite ich nach & erstelle Ankis (ca. 60–90 Min.); nach Übungen fällt keine Nacharbeit an. HM- und TM-Hausaufgaben geben andere für mich ab – ich bearbeite sie rein fürs Verständnis ohne Abgabedruck.'
    },
    updatedAt: Date.now()
  };
}

export function createDefaultSecrets() {
  return {
    githubToken: '',
    gistId: '',
    autoSync: true,
    lastSyncAt: 0,
    lastSyncStatus: 'local', // 'local' | 'ok' | 'syncing' | 'err'
    lastSyncError: '',
    lastArchiveWeek: ''      // e.g. '2026-KW48' for weekly Gist snapshots (#8)
  };
}

class Store {
  constructor() {
    this.state = this._loadState();
    this.secrets = this._loadSecrets();
    this.listeners = new Set();
    this._syncHooks = new Set();
    this._dirtySync = false;
    this._undoStack = []; // In-memory snapshots for Strg+Z / Undo Toast (#7)
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
      this.state = this._mergeDefaults(JSON.parse(item.snapshot));
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
      dg: { ...def.dg, ...(data.dg || {}) },
      anki: { ...def.anki, ...(data.anki || {}) },
      planningPrefs: { ...def.planningPrefs, ...(data.planningPrefs || {}) },
      ai: { ...def.ai, ...(data.ai || {}) },
      w: { ...(data.w || {}) },
      sx: { ...(data.sx || {}) },
      modules: { ...(data.modules || {}) },
      lectureAttendance: { ...(data.lectureAttendance || {}) },
      eventOverrides: { ...(data.eventOverrides || {}) },
      restDays: { ...(data.restDays || {}) },
      autopilotHandled: { ...(data.autopilotHandled || {}) },
      deletedIds: { ...(data.deletedIds || {}) },
      dayNotes: { ...(data.dayNotes || {}) },
      e: Array.isArray(data.e) ? data.e : [],
      cf: Array.isArray(data.cf) ? data.cf : [],
      backlog: Array.isArray(data.backlog) ? data.backlog : [],
      customEvents: Array.isArray(data.customEvents) ? data.customEvents : [],
      checklist: Array.isArray(data.checklist) ? data.checklist : [],
      reminders: Array.isArray(data.reminders) ? data.reminders : [],
      planBlocks: Array.isArray(data.planBlocks) ? data.planBlocks : [],
      tasks: Array.isArray(data.tasks) ? data.tasks : []
    };
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
      if (m.videoStudyMinutes === undefined) m.videoStudyMinutes = m.studyMinutes ?? (m.type === 'Ü' ? 0 : 165);
      if (m.triggersHomework === undefined) m.triggersHomework = false;
      if (!m.homeworkMode) m.homeworkMode = 'understanding';
    }

    return state;
  }

  save({ skipSync = false, silent = false } = {}) {
    this.state.updatedAt = Date.now();
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
    } catch (err) {
      console.error('Speichern fehlgeschlagen:', err);
    }
    if (!silent) this.emit();
    if (!skipSync) {
      this._syncHooks.forEach((fn) => fn());
    }
  }

  saveSecrets({ silent = false } = {}) {
    try {
      localStorage.setItem(SECRETS_KEY, JSON.stringify(this.secrets));
    } catch (err) {
      console.error('Secrets speichern fehlgeschlagen:', err);
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

  emit() {
    this.listeners.forEach((fn) => {
      try { fn(this.state); } catch (e) { console.error(e); }
    });
  }

  // ---------- Counting Rules ----------

  getDayBreakdown(dStr, modeOverride = null) {
    const mode = modeOverride || this.state.mode || 'max';
    const dayEntries = this.state.e.filter((x) => x.d === dStr);
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

  addEntry({ d, t, m, k, mod = '', act = '', note = '', sessionMin = 0 }) {
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

    const entry = {
      id: Date.now() + Math.floor(Math.random() * 100),
      d: dateStr,
      t: timeStr,
      m: minutes,
      k: k || 'l'
    };
    if (mod) entry.mod = mod;
    if (act) entry.act = act; // 'video' | 'review' | 'homework' | 'anki' | 'exam' | 'other'
    if (note && note.trim()) entry.note = note.trim();
    if (realBlockMin > 0 && (mod || act || (note && note.trim()))) entry.blockMin = realBlockMin;

    this.state.e.push(entry);
    const after = this.getDayBreakdown(dateStr);
    this.save();

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
      if (nowMin < wakeMin && sleepMin > 1440) nowMin += 1440;
      elapsedMin = Math.max(1, Math.min(totalAwakeMin, nowMin - wakeMin));
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
    this.save();
    return true;
  }

  setSleepTime(dStr, tStr) {
    if (dStr > toDateStr()) return false;
    if (!tStr) delete this.state.sx[dStr];
    else this.state.sx[dStr] = tStr;
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
      n: (n || 'Koffein').trim()
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

  startTimer({ mode = 'countdown', kind = 'l', durationMin = 45, planBlockId = null, mod = '' }) {
    this.state.tm = {
      running: true,
      mode,
      kind,
      startedAt: Date.now(),
      durationSec: mode === 'countdown' ? Math.max(60, Math.round(durationMin * 60)) : 0,
      planBlockId,
      mod
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
    const minutes = Math.floor(saveSec / 60);
    const finishedAt = st.mode === 'countdown' && fromExpiry
      ? new Date(st.startedAt + st.durationSec * 1000)
      : new Date();
    const dStr = toDateStr(finishedAt);
    const tStr = toTimeStr(finishedAt);

    this.state.tm = null;

    if (minutes < 1) {
      this.save();
      return { saved: false, message: 'Timer unter 1 Minute – nichts gespeichert.' };
    }

    // Spec: "Die Timer-Zeit wird zum bisherigen Tageswert addiert."
    const before = this.getDayBreakdown(dStr);
    const newVal = this.state.mode === 'sum' ? minutes : before[st.kind] + minutes;
    const entry = {
      id: Date.now() + Math.floor(Math.random() * 100),
      d: dStr,
      t: tStr,
      m: newVal,
      k: st.kind
    };
    if (st.mod) entry.mod = st.mod;
    entry.blockMin = minutes;
    if (st.note) entry.note = st.note;
    if (st.act) entry.act = st.act;
    this.state.e.push(entry);

    if (st.planBlockId) {
      const blk = this.state.planBlocks.find((b) => b.id === st.planBlockId);
      if (blk) blk.done = true;
      const chk = this.state.checklist.find((c) => c.id === st.planBlockId);
      if (chk) chk.done = true;
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
    this.save();
    return next;
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
      { id: 'weekend', ico: 'calendar', name: 'Wochenend-Krieger', desc: 'Samstag & Sonntag gelernt', unlocked: (hasSat && hasSun) || weekendActiveDays >= 2 },
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
    // Group tagged entries with blockMin/m by (mod + act) to compute real averages
    const buckets = {};
    const recentSessions = [];

    const sorted = [...this.state.e]
      .filter((x) => x.k === 'l' || x.k === 'a')
      .sort((a, b) => (b.d + (b.t || '')).localeCompare(a.d + (a.t || '')) || b.id - a.id);

    for (const x of sorted) {
      const dur = Number(x.blockMin || x.m || 0);
      if (dur <= 0) continue;
      if (x.mod || x.act || x.note) {
        const modObj = x.mod ? this.state.modules[x.mod] : null;
        if (recentSessions.length < 12) {
          recentSessions.push({
            d: x.d,
            t: x.t || '',
            dauerMin: dur,
            art: x.k === 'a' ? 'anki' : 'lernen',
            fach: modObj ? modObj.shortName : (x.mod || ''),
            taetigkeit: x.act || '',
            was: x.note || ''
          });
        }
      }

      if (x.mod && dur >= 10) {
        const actKey = x.act || (this.state.modules[x.mod]?.attendance === 'video' ? 'video' : 'review');
        const key = `${x.mod}::${actKey}`;
        if (!buckets[key]) buckets[key] = { modId: x.mod, act: actKey, samples: [] };
        buckets[key].samples.push(dur);
      }
    }

    const byModule = Object.values(buckets).map((b) => {
      const mod = this.state.modules[b.modId];
      const avgMin = Math.round(b.samples.reduce((s, v) => s + v, 0) / b.samples.length);
      const currentRuleMin = b.act === 'video'
        ? (mod?.videoStudyMinutes ?? 165)
        : (mod?.liveReviewMinutes ?? 75);
      const diff = avgMin - currentRuleMin;
      return {
        modId: b.modId,
        fach: mod?.shortName || b.modId,
        taetigkeit: b.act,
        anzahl: b.samples.length,
        durchschnittMin: avgMin,
        regelMin: currentRuleMin,
        suggestAdjust: b.samples.length >= 2 && Math.abs(diff) >= 15
      };
    });

    return { recentSessions, byModule };
  }

  getLoadSummary7d(todayStr = toDateStr()) {
    let learn7 = 0;
    let lec7 = 0;
    let caf7 = 0;
    let daysWithZeroFree = 0;
    let consecutiveHeavyDays = 0;

    for (let i = 0; i < 7; i++) {
      const d = addDays(todayStr, -i);
      const b = this.getDayBreakdown(d);
      learn7 += b.learnTotal;
      lec7 += b.p;
      const dayTotal = b.learnTotal + b.p;
      if (dayTotal >= 60) daysWithZeroFree++;
    }

    // Count consecutive active days (>= 60 min total) going backwards up to 21 days
    for (let i = 0; i < 21; i++) {
      const d = addDays(todayStr, -i);
      const b = this.getDayBreakdown(d);
      if (b.learnTotal + b.p >= 60) consecutiveHeavyDays++;
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

  // ---------- Subject Balance Board (#3) ----------

  getSubjectBalance() {
    const groups = {};
    const ensureGroup = (groupName) => {
      const key = groupName.trim();
      if (!groups[key]) {
        groups[key] = {
          subject: key,
          modIds: new Set(),
          ankiDecks: new Set(),
          learnMin: 0,
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
      const low = text.toLowerCase();
      for (const g of Object.values(groups)) {
        const base = g.subject.toLowerCase();
        const shortToken = base.split(/\s+/)[0]; // e.g. 'hm', 'tm', 'mkl', 'wk', 'fertigungstechnik'
        if (low.includes(base) || (shortToken.length >= 2 && new RegExp(`\\b${shortToken.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(low))) {
          return g;
        }
        if (base.includes('fertigung') && /\bft\b/i.test(low)) return g;
        if (base.includes('werkstoff') && /\bwk\b/i.test(low)) return g;
      }
      return null;
    };

    // Aggregate tracked learning time per subject (using blockMin when available so 'max' deltas are accurate!)
    for (const x of this.state.e) {
      if (x.k !== 'l' && x.k !== 'a') continue;
      let target = null;
      if (x.mod) {
        target = Object.values(groups).find((g) => g.modIds.has(x.mod)) || null;
      }
      if (!target && x.note) target = matchSubjectByText(x.note);
      if (target) {
        target.learnMin += Number(x.blockMin || x.m || 0);
        target.sessions++;
      }
    }

    // Open/overdue backlog per subject
    for (const b of (this.state.backlog || [])) {
      if (b.status === 'done') continue;
      let target = b.moduleId ? Object.values(groups).find((g) => g.modIds.has(b.moduleId)) : null;
      if (!target) target = matchSubjectByText(b.title);
      if (target) target.openBacklog++;
    }

    // Checklist completion per subject
    for (const c of (this.state.checklist || [])) {
      let target = c.moduleId ? Object.values(groups).find((g) => g.modIds.has(c.moduleId)) : null;
      if (!target) target = matchSubjectByText(c.title);
      if (target) {
        target.chkTotal++;
        if (c.done) target.chkDone++;
      }
    }

    // Match Anki decks if synced
    for (const d of (this.state.anki?.decks || [])) {
      const dLow = (d.name || '').toLowerCase();
      let target = Object.values(groups).find((g) => g.ankiDecks.has(dLow)) || matchSubjectByText(d.name);
      if (target) {
        target.ankiNew += Number(d.newCards) || 0;
        target.ankiLearn += Number(d.learnCards) || 0;
        target.ankiReview += Number(d.reviewCards) || 0;
      }
    }

    return Object.values(groups)
      .map((g) => ({
        subject: g.subject,
        learnMin: Math.round(g.learnMin),
        sessions: g.sessions,
        openBacklog: g.openBacklog,
        chkDone: g.chkDone,
        chkTotal: g.chkTotal,
        ankiNew: g.ankiNew,
        ankiLearn: g.ankiLearn,
        ankiReview: g.ankiReview,
        ankiTotal: g.ankiNew + g.ankiLearn + g.ankiReview
      }))
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

  getRecordsAndMilestones(todayStr = toDateStr()) {
    const nowDate = new Date();
    const dates = this.getAllActiveDates().filter((d) => d <= todayStr);
    const st = this.getOverallStats();

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
        '## 3. Fach-Balance',
        '| Fach | Lernzeit | Offener Rückstand | Checkliste | Anki (B/R/G) |',
        '| :--- | :---: | :---: | :---: | :---: |'
      );
      for (const s of subj) {
        lines.push(`| ${s.subject} | ${fmtMin(s.learnMin)} | ${s.openBacklog} | ${s.chkDone}/${s.chkTotal} | ${s.ankiTotal > 0 ? `${s.ankiNew}/${s.ankiLearn}/${s.ankiReview}` : '–'} |`);
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

  importBackupJSON(jsonText, strategy = 'replace') {
    const parsed = JSON.parse(jsonText);
    if (!parsed || typeof parsed !== 'object') {
      throw new Error('Ungültiges JSON-Backup.');
    }
    if (!Array.isArray(parsed.e) && !parsed.w && !parsed.cf && !parsed.planBlocks) {
      throw new Error('Datei enthält keine erkennbaren Fokus-Tracker- oder Planer-Daten.');
    }

    if (strategy === 'replace') {
      const keepAiKey = this.state.ai?.apiKey || '';
      const keepModules = this.state.modules || {};
      const keepIcs = this.state.icsRaw || '';
      const keepChecklist = this.state.checklist || [];
      const keepBacklog = this.state.backlog || [];
      const keepCustomEvents = this.state.customEvents || [];
      const keepEventOverrides = this.state.eventOverrides || {};
      const keepDayNotes = this.state.dayNotes || {};
      const keepReminders = this.state.reminders || [];
      const merged = this._mergeDefaults(parsed);
      // Preserve StudyFlow-specific settings if importing a pure Fokus-Tracker backup
      if (!parsed.ai && keepAiKey) merged.ai.apiKey = keepAiKey;
      if (!parsed.modules && Object.keys(keepModules).length) merged.modules = keepModules;
      if (!parsed.icsRaw && keepIcs) merged.icsRaw = keepIcs;
      if (!parsed.checklist && keepChecklist.length) merged.checklist = keepChecklist;
      if (!parsed.backlog && keepBacklog.length) merged.backlog = keepBacklog;
      if (!parsed.customEvents && keepCustomEvents.length) merged.customEvents = keepCustomEvents;
      if (!parsed.eventOverrides && Object.keys(keepEventOverrides).length) merged.eventOverrides = keepEventOverrides;
      if (!parsed.dayNotes && Object.keys(keepDayNotes).length) merged.dayNotes = keepDayNotes;
      if (!parsed.reminders && keepReminders.length) merged.reminders = keepReminders;
      merged.lb = Date.now();
      this.state = merged;
    } else {
      // Merge mode
      const existingE = new Set(this.state.e.map((x) => `${x.id}|${x.d}|${x.t}|${x.m}|${x.k}`));
      for (const item of (parsed.e || [])) {
        const sig = `${item.id}|${item.d}|${item.t}|${item.m}|${item.k}`;
        if (!existingE.has(sig)) this.state.e.push(item);
      }
      const existingCf = new Set(this.state.cf.map((x) => `${x.id}|${x.d}|${x.t}|${x.mg}`));
      for (const item of (parsed.cf || [])) {
        const sig = `${item.id}|${item.d}|${item.t}|${item.mg}`;
        if (!existingCf.has(sig)) this.state.cf.push(item);
      }
      this.state.w = { ...this.state.w, ...(parsed.w || {}) };
      this.state.sx = { ...this.state.sx, ...(parsed.sx || {}) };
      if (parsed.goal) this.state.goal = parsed.goal;
      if (parsed.mode) this.state.mode = parsed.mode;
      if (parsed.sl) this.state.sl = parsed.sl;
      if (parsed.cl) this.state.cl = parsed.cl;
      if (parsed.modules) this.state.modules = { ...this.state.modules, ...parsed.modules };
      if (Array.isArray(parsed.planBlocks)) {
        const ids = new Set(this.state.planBlocks.map((b) => b.id));
        for (const b of parsed.planBlocks) if (!ids.has(b.id)) this.state.planBlocks.push(b);
      }
      if (Array.isArray(parsed.tasks)) {
        const ids = new Set(this.state.tasks.map((t) => t.id));
        for (const t of parsed.tasks) if (!ids.has(t.id)) this.state.tasks.push(t);
      }
      if (Array.isArray(parsed.checklist)) {
        const ids = new Set(this.state.checklist.map((c) => c.id));
        for (const c of parsed.checklist) if (!ids.has(c.id)) this.state.checklist.push(c);
      }
      if (parsed.dayNotes) this.state.dayNotes = { ...this.state.dayNotes, ...parsed.dayNotes };
      if (Array.isArray(parsed.backlog)) {
        const ids = new Set(this.state.backlog.map((b) => b.id));
        for (const b of parsed.backlog) if (!ids.has(b.id)) this.state.backlog.push(b);
      }
      if (Array.isArray(parsed.customEvents)) {
        const ids = new Set(this.state.customEvents.map((c) => c.id));
        for (const c of parsed.customEvents) if (!ids.has(c.id)) this.state.customEvents.push(c);
      }
      if (parsed.eventOverrides) this.state.eventOverrides = { ...this.state.eventOverrides, ...parsed.eventOverrides };
      if (Array.isArray(parsed.reminders)) {
        const ids = new Set(this.state.reminders.map((r) => r.id));
        for (const r of parsed.reminders) if (!ids.has(r.id)) this.state.reminders.push(r);
      }
      if (parsed.icsRaw && !this.state.icsRaw) this.state.icsRaw = parsed.icsRaw;
      this.state.lb = Date.now();
    }

    this.save();
    return {
      entries: this.state.e.length,
      wakes: Object.keys(this.state.w).length,
      caffeine: this.state.cf.length
    };
  }

  wipeAllData() {
    this.pushUndo('Alle Daten gelöscht');
    this.state = createDefaultState();
    this.save();
  }
}

export const store = new Store();

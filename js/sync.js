// Private GitHub Gist 2-Way Field-Level Merge Sync (#11)
// Merges entries, caffeine, checklist, backlog, reminders, customEvents, maps & tombstones
// so simultaneous offline edits on Win 11 Firefox & Pixel 9a Chrome NEVER overwrite each other!

import { store, toDateStr } from './store.js';
import { syncModulesFromIcs } from './ics.js';
import { reconcileBacklogStatus, syncDayLecturesToProductive } from './checklist.js';

const STATE_FILENAME = 'kit-studyflow-state.json';
const ICS_FILENAME = 'kit-calendar.ics';
const ARCHIVE_PREFIX = 'archive-';
const MAX_WEEKLY_ARCHIVES = 4;

export function getIsoWeekKey(date = new Date()) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-KW${String(weekNo).padStart(2, '0')}`;
}

let debounceTimer = null;
let isSyncing = false;
let pendingLocalChange = false;
let syncQueued = false;
const statusListeners = new Set();

export function onSyncStatusChange(fn) {
  statusListeners.add(fn);
  return () => statusListeners.delete(fn);
}

export function normalizeGistId(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  // Allow users to paste full gist.github.com URLs cleanly
  const m = /gist\.github\.com\/(?:[^/\s]+\/)?([a-f0-9]{16,64})/i.exec(s);
  if (m) return m[1];
  return s.replace(/\s+/g, '');
}

function cleanToken(raw) {
  return String(raw || '').replace(/\s+/g, '');
}

function authHeaders(token, { withContentType = true } = {}) {
  const h = {
    Authorization: `Bearer ${cleanToken(token)}`,
    Accept: 'application/vnd.github+json'
  };
  if (withContentType) h['Content-Type'] = 'application/json';
  return h;
}

export function isGistConfigured() {
  return Boolean(cleanToken(store.secrets.githubToken).length > 10);
}

function summarizeStateCounts(sRaw) {
  const s = sRaw || {};
  const excluded = new Set(Array.isArray(s.anki?.excludedDecks) ? s.anki.excludedDecks : []);
  const decks = (Array.isArray(s.anki?.decks) ? s.anki.decks : [])
    .filter((d) => d && !excluded.has(d.fullName || d.name) && !excluded.has(d.name));
  const deckDue = decks.reduce((sum, d) => sum + (Number(d?.due) || 0), 0);
  const manualDue = (Number(s.anki?.manualNew) || 0) + (Number(s.anki?.manualLearn) || 0) + (Number(s.anki?.manualReview) || 0);
  return {
    e: Array.isArray(s.e) ? s.e.length : 0,
    chk: Array.isArray(s.checklist) ? s.checklist.length : 0,
    bl: Array.isArray(s.backlog) ? s.backlog.length : 0,
    ov: s.eventOverrides ? Object.keys(s.eventOverrides).length : 0,
    anki: deckDue || manualDue || (Number(s.anki?.manualDue) || 0)
  };
}

function recordRemoteSummary(stateObj, gistId, action) {
  const counts = summarizeStateCounts(stateObj);
  store.secrets.lastRemoteSummary = {
    ...counts,
    gistIdShort: normalizeGistId(gistId).slice(0, 8),
    syncedAt: Date.now(),
    action
  };
}

async function readHttpErrorDetail(res) {
  let detail = '';
  try {
    const txt = await res.text();
    try {
      const j = JSON.parse(txt);
      detail = j?.message || txt.slice(0, 140);
    } catch {
      detail = txt.slice(0, 140);
    }
  } catch { /* ignore */ }
  return detail ? `HTTP ${res.status}: ${detail}` : `HTTP ${res.status}`;
}

function buildSyncPayload({ stripIcs = false } = {}) {
  const clone = JSON.parse(JSON.stringify(store.state));
  if (!clone.ai?.syncApiKeyInGist && clone.ai) {
    clone.ai.apiKey = '';
  }
  if (stripIcs) {
    clone.icsRaw = '';
  }
  return clone;
}

function canonicalSyncSig(stateRaw) {
  const s = store._mergeDefaults(stateRaw || {});
  const clone = JSON.parse(JSON.stringify(s));
  delete clone.updatedAt;
  delete clone.dg;
  delete clone.ui;
  if (clone.ai) delete clone.ai.apiKey;
  return JSON.stringify(clone);
}

// ---------- Conflict-Safe 2-Way Field-Level Merge ----------

export function mergeStates(localRaw, remoteRaw) {
  const local = store._mergeDefaults(localRaw || {});
  const remote = store._mergeDefaults(remoteRaw || {});
  const remoteNewer = (remote.updatedAt || 0) >= (local.updatedAt || 0);
  const primary = remoteNewer ? remote : local;
  const secondary = remoteNewer ? local : remote;

  // 1. Union of tombstones (keep newest deletion timestamp per id)
  const deletedIds = { ...(secondary.deletedIds || {}), ...(primary.deletedIds || {}) };
  for (const k of Object.keys(local.deletedIds || {})) {
    deletedIds[k] = Math.max(deletedIds[k] || 0, local.deletedIds[k] || 0);
  }
  for (const k of Object.keys(remote.deletedIds || {})) {
    deletedIds[k] = Math.max(deletedIds[k] || 0, remote.deletedIds[k] || 0);
  }

  const isDeleted = (id, itemUpdatedAt = 0) => {
    const delTs = deletedIds[String(id)];
    return Boolean(delTs && delTs >= (itemUpdatedAt || 0));
  };

  // 2. Append-only collections merged by ID (e, cf)
  const mergeByIdAppend = (aList = [], bList = []) => {
    const map = new Map();
    for (const item of [...bList, ...aList]) {
      if (!item || item.id === undefined) continue;
      if (isDeleted(item.id, item.updatedAt || 0)) continue;
      const prev = map.get(String(item.id));
      if (!prev || (item.updatedAt || 0) >= (prev.updatedAt || 0)) {
        map.set(String(item.id), item);
      }
    }
    return Array.from(map.values());
  };

  // 3. Mutable entity collections merged by ID + item.updatedAt (checklist, backlog, reminders, customEvents, tasks, planBlocks)
  const mergeMutableById = (localList = [], remoteList = []) => {
    const map = new Map();
    const put = (item, isRemote) => {
      if (!item) return;
      const key = item.id ? String(item.id) : `${item.d || ''}|${item.title || item.text || ''}`;
      if (!key || key === '|') return;
      if (isDeleted(key, item.updatedAt || 0)) return;
      const prev = map.get(key);
      if (!prev) {
        map.set(key, { ...item, id: item.id || key });
        return;
      }
      const prevTs = prev.updatedAt || 0;
      const curTs = item.updatedAt || 0;
      if (curTs > prevTs) {
        map.set(key, { ...item, id: item.id || key });
      } else if (curTs === prevTs) {
        // Same timestamp tie-breaker: prefer completed checkmarks & primary device
        const winner = isRemote === remoteNewer ? { ...item, id: item.id || key } : { ...prev };
        if (prev.done || item.done) winner.done = Boolean(prev.done || item.done);
        map.set(key, winner);
      }
    };
    localList.forEach((x) => put(x, false));
    remoteList.forEach((x) => put(x, true));
    return Array.from(map.values());
  };

  // 4. Per-key timestamped maps (supports edits AND deletions across devices without global updatedAt clobbering)
  const mergedMapMeta = {};
  const mergeTimestampedMap = (mapName) => {
    const lMap = local[mapName] || {};
    const rMap = remote[mapName] || {};
    const lMeta = local.mapMeta?.[mapName] || {};
    const rMeta = remote.mapMeta?.[mapName] || {};
    const out = {};
    const outMeta = {};
    const keys = new Set([
      ...Object.keys(lMap),
      ...Object.keys(rMap),
      ...Object.keys(lMeta),
      ...Object.keys(rMeta)
    ]);

    for (const k of keys) {
      const lHas = Object.prototype.hasOwnProperty.call(lMap, k) && lMap[k] !== undefined;
      const rHas = Object.prototype.hasOwnProperty.call(rMap, k) && rMap[k] !== undefined;
      const lExplicit = lMeta[k] || 0;
      const rExplicit = rMeta[k] || 0;

      let winner;
      if (lExplicit || rExplicit) {
        const lTs = lExplicit || (lHas ? (local.updatedAt || 1) : 0);
        const rTs = rExplicit || (rHas ? (remote.updatedAt || 1) : 0);
        if (lTs > rTs) winner = 'local';
        else if (rTs > lTs) winner = 'remote';
        else winner = remoteNewer ? 'remote' : 'local';
        outMeta[k] = Math.max(lExplicit, rExplicit);
      } else {
        if (lHas && !rHas) winner = 'local';
        else if (rHas && !lHas) winner = 'remote';
        else winner = remoteNewer ? 'remote' : 'local';
      }

      const val = winner === 'local' ? lMap[k] : rMap[k];
      if (val !== undefined) out[k] = val;
    }

    if (Object.keys(outMeta).length) mergedMapMeta[mapName] = outMeta;
    return out;
  };

  // Simple union map (monotonic flags like autopilotHandled)
  const mergeMap = (secMap = {}, priMap = {}) => ({ ...secMap, ...priMap });

  // 5. Smart Anki merge by dedicated anki.updatedAt / anki.lastSyncAt (never wiped by mobile's empty default decks)
  const mergeAnki = (lAnki = {}, rAnki = {}) => {
    const lSync = lAnki.lastSyncAt || 0;
    const rSync = rAnki.lastSyncAt || 0;
    const lTs = Math.max(lAnki.updatedAt || 0, lSync);
    const rTs = Math.max(rAnki.updatedAt || 0, rSync);

    const lHasDecks = Array.isArray(lAnki.decks) && lAnki.decks.length > 0;
    const rHasDecks = Array.isArray(rAnki.decks) && rAnki.decks.length > 0;
    const lHasManual = (lAnki.manualNew || 0) + (lAnki.manualLearn || 0) + (lAnki.manualReview || 0) + (lAnki.manualDue || 0) > 0;
    const rHasManual = (rAnki.manualNew || 0) + (rAnki.manualLearn || 0) + (rAnki.manualReview || 0) + (rAnki.manualDue || 0) > 0;

    let pickRemote;
    if (rTs !== lTs) pickRemote = rTs > lTs;
    else if (rHasDecks !== lHasDecks) pickRemote = rHasDecks;
    else if (rHasManual !== lHasManual) pickRemote = rHasManual;
    else pickRemote = remoteNewer;

    const win = pickRemote ? rAnki : lAnki;
    const lose = pickRemote ? lAnki : rAnki;
    const merged = { ...lose, ...win };

    // Always keep the freshest real AnkiConnect deck snapshot
    if (rSync > lSync || (rHasDecks && !lHasDecks && rSync >= lSync)) {
      merged.decks = rAnki.decks;
      merged.lastSyncAt = rSync;
      if (rAnki.todayMinutes !== undefined) merged.todayMinutes = rAnki.todayMinutes;
    } else if (lSync > rSync || (lHasDecks && !rHasDecks && lSync >= rSync)) {
      merged.decks = lAnki.decks;
      merged.lastSyncAt = lSync;
      if (lAnki.todayMinutes !== undefined) merged.todayMinutes = lAnki.todayMinutes;
    }

    merged.updatedAt = Math.max(lTs, rTs);
    return merged;
  };

  // Merge modules per-key via mapMeta + tombstone support
  const modulesRaw = mergeTimestampedMap('modules');
  const modules = {};
  for (const k of Object.keys(modulesRaw)) {
    if (isDeleted(`mod_${k}`, mergedMapMeta.modules?.[k] || 0)) continue;
    if (modulesRaw[k] && typeof modulesRaw[k] === 'object') {
      modules[k] = modulesRaw[k];
    }
  }

  // Merge AI chat by message timestamp+role (respecting chatClearedAt) & keep local Gemini API key if remote stripped it
  const chatClearedAt = Math.max(local.ai?.chatClearedAt || 0, remote.ai?.chatClearedAt || 0);
  const chatMap = new Map();
  for (const m of [...(secondary.ai?.chat || []), ...(primary.ai?.chat || [])]) {
    if (!m || !m.text) continue;
    if (chatClearedAt && (m.ts || 0) <= chatClearedAt) continue;
    const key = `${m.ts || 0}|${m.role}|${String(m.text).slice(0, 60)}`;
    const prev = chatMap.get(key);
    chatMap.set(key, prev ? { ...prev, ...m, applied: Boolean(prev.applied || m.applied), rhythmApplied: Boolean(prev.rhythmApplied || m.rhythmApplied) } : { ...m });
  }
  const mergedChat = Array.from(chatMap.values())
    .sort((a, b) => (a.ts || 0) - (b.ts || 0))
    .slice(-30);

  const mergedAi = {
    ...secondary.ai,
    ...primary.ai,
    apiKey: primary.ai?.apiKey || secondary.ai?.apiKey || '',
    chatClearedAt,
    chat: mergedChat
  };

  // Keep whichever ICS is fresher
  const useRemoteIcs = (remote.icsUpdatedAt || 0) >= (local.icsUpdatedAt || 0);

  const result = {
    ...primary,
    schemaVersion: Math.max(local.schemaVersion || 2, remote.schemaVersion || 2, 2),
    e: mergeByIdAppend(primary.e, secondary.e),
    cf: mergeByIdAppend(primary.cf, secondary.cf),
    w: mergeTimestampedMap('w'),
    sx: mergeTimestampedMap('sx'),
    lectureAttendance: mergeTimestampedMap('lectureAttendance'),
    eventOverrides: mergeTimestampedMap('eventOverrides'),
    restDays: mergeTimestampedMap('restDays'),
    ankiDoneDays: mergeTimestampedMap('ankiDoneDays'),
    autopilotHandled: mergeMap(secondary.autopilotHandled, primary.autopilotHandled),
    dayNotes: mergeTimestampedMap('dayNotes'),
    mapMeta: mergedMapMeta,
    modules,
    anki: mergeAnki(local.anki, remote.anki),
    backlog: mergeMutableById(local.backlog, remote.backlog),
    checklist: mergeMutableById(local.checklist, remote.checklist),
    reminders: mergeMutableById(local.reminders, remote.reminders),
    customEvents: mergeMutableById(local.customEvents, remote.customEvents),
    tasks: mergeMutableById(local.tasks, remote.tasks),
    planBlocks: mergeMutableById(local.planBlocks, remote.planBlocks),
    deletedIds,
    ai: mergedAi,
    icsRaw: useRemoteIcs ? (remote.icsRaw || local.icsRaw) : (local.icsRaw || remote.icsRaw),
    icsUpdatedAt: Math.max(local.icsUpdatedAt || 0, remote.icsUpdatedAt || 0),
    updatedAt: Math.max(local.updatedAt || 0, remote.updatedAt || 0)
  };

  return store._mergeDefaults(result);
}

export async function createPrivateGist() {
  const token = cleanToken(store.secrets.githubToken);
  if (!token) throw new Error('Bitte zuerst deinen GitHub Token eintragen.');

  setSyncStatus('syncing', '');
  const payload = buildSyncPayload();
  const res = await fetch('https://api.github.com/gists', {
    method: 'POST',
    cache: 'no-store',
    headers: authHeaders(token),
    body: JSON.stringify({
      description: 'KIT StudyFlow – Privater Cloud-Sync (Fokus-Tracker & Wochenplan)',
      public: false,
      files: {
        [STATE_FILENAME]: {
          content: JSON.stringify(payload)
        }
      }
    })
  });

  if (!res.ok) {
    const detail = await readHttpErrorDetail(res);
    setSyncStatus('err', detail);
    throw new Error(`Gist konnte nicht erstellt werden (${detail})`);
  }

  const data = await res.json();
  store.secrets.gistId = data.id;
  store.secrets.lastSyncAt = Date.now();
  pendingLocalChange = false;
  recordRemoteSummary(payload, data.id, 'Gist erstellt');
  setSyncStatus('ok', '');
  return data.id;
}

export async function pushToGist({ forceArchive = false, keepalive = false } = {}) {
  if (!isGistConfigured()) return { ok: false, reason: 'not_configured' };
  const token = cleanToken(store.secrets.githubToken);
  let gistId = normalizeGistId(store.secrets.gistId);
  if (gistId && gistId !== store.secrets.gistId) store.secrets.gistId = gistId;

  if (!gistId) {
    gistId = await createPrivateGist();
    return { ok: true, gistId, created: true };
  }

  if (isSyncing && !keepalive) return { ok: false, reason: 'busy' };
  isSyncing = true;
  setSyncStatus('syncing', '');

  try {
    const payloadObj = buildSyncPayload();
    const payloadStr = JSON.stringify(payloadObj);
    const weekKey = getIsoWeekKey();
    const shouldWriteArchive = !keepalive && (forceArchive || store.secrets.lastArchiveWeek !== weekKey);
    const filesBody = {
      [STATE_FILENAME]: { content: payloadStr }
    };

    if (shouldWriteArchive) {
      // Strip bulky raw ICS from weekly archive snapshots to keep PATCH small & reliable on mobile
      filesBody[`${ARCHIVE_PREFIX}${weekKey}.json`] = {
        content: JSON.stringify(buildSyncPayload({ stripIcs: true }))
      };
    }

    const bodyStr = JSON.stringify({ files: filesBody });
    // keepalive has a ~64KB browser payload cap; fall back to normal fetch if larger
    const useKeepalive = keepalive && bodyStr.length < 58000;

    const res = await fetch(`https://api.github.com/gists/${encodeURIComponent(gistId)}`, {
      method: 'PATCH',
      cache: 'no-store',
      keepalive: useKeepalive,
      headers: authHeaders(token),
      body: bodyStr
    });
    if (!res.ok) throw new Error(await readHttpErrorDetail(res));

    // Prune archives beyond the newest MAX_WEEKLY_ARCHIVES (4 weeks)
    if (shouldWriteArchive) {
      store.secrets.lastArchiveWeek = weekKey;
      try {
        const updated = await res.json();
        const archiveNames = Object.keys(updated.files || {})
          .filter((fn) => fn.startsWith(ARCHIVE_PREFIX) && fn.endsWith('.json'))
          .sort()
          .reverse();
        const toDelete = archiveNames.slice(MAX_WEEKLY_ARCHIVES);
        if (toDelete.length) {
          const delFiles = {};
          for (const fn of toDelete) delFiles[fn] = null;
          await fetch(`https://api.github.com/gists/${encodeURIComponent(gistId)}`, {
            method: 'PATCH',
            cache: 'no-store',
            headers: authHeaders(token),
            body: JSON.stringify({ files: delFiles })
          });
        }
      } catch { /* non-fatal */ }
    }

    pendingLocalChange = false;
    store.secrets.lastSyncAt = Date.now();
    recordRemoteSummary(payloadObj, gistId, 'Hochgeladen');
    setSyncStatus('ok', '');
    return { ok: true, gistId, archivedWeek: shouldWriteArchive ? weekKey : '', summary: store.secrets.lastRemoteSummary };
  } catch (err) {
    setSyncStatus('err', err.message);
    return { ok: false, error: err.message };
  } finally {
    isSyncing = false;
  }
}

export async function listGistArchives() {
  const gistId = normalizeGistId(store.secrets.gistId);
  if (!isGistConfigured() || !gistId) {
    throw new Error('Kein privater GitHub Gist verbunden.');
  }
  const res = await fetch(
    `https://api.github.com/gists/${encodeURIComponent(gistId)}?_t=${Date.now()}`,
    { cache: 'no-store', headers: authHeaders(store.secrets.githubToken, { withContentType: false }) }
  );
  if (!res.ok) throw new Error(await readHttpErrorDetail(res));
  const gist = await res.json();
  const files = gist.files || {};
  return Object.keys(files)
    .filter((fn) => fn.startsWith(ARCHIVE_PREFIX) && fn.endsWith('.json'))
    .sort()
    .reverse()
    .map((fn) => ({
      filename: fn,
      label: fn.replace(ARCHIVE_PREFIX, '').replace('.json', ''),
      size: files[fn].size || 0,
      content: files[fn].content || ''
    }));
}

export function restoreArchiveSnapshot(jsonContent, label = 'Wochen-Archiv') {
  const parsed = JSON.parse(jsonContent);
  if (!parsed || typeof parsed !== 'object') throw new Error('Ungültige Archiv-Datei.');
  store.pushUndo(`Archiv ${label} geladen`);
  const localKey = store.state.ai?.apiKey || '';
  const next = store._mergeDefaults(parsed);
  if (!next.ai.apiKey && localKey) next.ai.apiKey = localKey;
  store.state = next;
  reconcileBacklogStatus();
  store.save();
  return { entries: store.state.e.length, checklist: store.state.checklist.length };
}

async function readGistFileContent(fileObj) {
  if (!fileObj) return '';
  if (fileObj.truncated && fileObj.raw_url) {
    const rawRes = await fetch(fileObj.raw_url, { cache: 'no-store' });
    if (rawRes.ok) return await rawRes.text();
  }
  return fileObj.content || '';
}

export async function pullFromGist({ preferRemote = false } = {}) {
  const gistId = normalizeGistId(store.secrets.gistId);
  if (gistId && gistId !== store.secrets.gistId) store.secrets.gistId = gistId;
  if (!isGistConfigured() || !gistId) {
    return { ok: false, reason: 'not_configured' };
  }
  if (isSyncing) return { ok: false, reason: 'busy' };
  isSyncing = true;
  setSyncStatus('syncing', '');

  try {
    const res = await fetch(
      `https://api.github.com/gists/${encodeURIComponent(gistId)}?_t=${Date.now()}`,
      { cache: 'no-store', headers: authHeaders(store.secrets.githubToken, { withContentType: false }) }
    );
    if (!res.ok) throw new Error(await readHttpErrorDetail(res));
    const gist = await res.json();
    const files = gist.files || {};

    let updatedIcs = false;
    let updatedState = false;
    let needsPushBack = false;

    const stateContent = await readGistFileContent(files[STATE_FILENAME]);
    if (stateContent) {
      const remoteState = JSON.parse(stateContent);
      recordRemoteSummary(remoteState, gistId, preferRemote ? 'Aus Cloud geladen' : 'Abgeglichen');
      if (preferRemote) {
        const localKey = store.state.ai?.apiKey || '';
        const next = store._mergeDefaults(remoteState);
        if (!next.ai.apiKey && localKey) next.ai.apiKey = localKey;
        store.state = next;
        reconcileBacklogStatus();
        if (store.state.autoLogLectures) syncDayLecturesToProductive(toDateStr(), { save: false });
        store.save({ skipSync: true, preserveTimestamp: true });
        updatedState = true;
      } else {
        const localBeforeSig = canonicalSyncSig(store.state);
        const remoteSig = canonicalSyncSig(remoteState);
        const merged = mergeStates(store.state, remoteState);
        store.state = merged;
        reconcileBacklogStatus();
        if (store.state.autoLogLectures) syncDayLecturesToProductive(toDateStr(), { save: false });
        const afterSig = canonicalSyncSig(store.state);
        updatedState = afterSig !== localBeforeSig;
        needsPushBack = afterSig !== remoteSig;
        if (updatedState) {
          store.save({ skipSync: true, preserveTimestamp: true });
        }
      }
    } else {
      // Gist exists (e.g. only kit-calendar.ics from GitHub Action), but has no state JSON yet -> push local state!
      needsPushBack = true;
    }

    const remoteIcs = await readGistFileContent(files[ICS_FILENAME]);
    if (remoteIcs) {
      if (remoteIcs !== store.state.icsRaw && remoteIcs.includes('BEGIN:VEVENT')) {
        syncModulesFromIcs(store, remoteIcs, { skipSync: true });
        updatedIcs = true;
      }
    }

    store.secrets.lastSyncAt = Date.now();
    setSyncStatus('ok', '');
    return { ok: true, updatedState, updatedIcs, needsPushBack, summary: store.secrets.lastRemoteSummary };
  } catch (err) {
    setSyncStatus('err', err.message);
    return { ok: false, error: err.message };
  } finally {
    isSyncing = false;
  }
}

export async function syncNow() {
  if (!isGistConfigured()) return { ok: false, error: 'Kein GitHub Token hinterlegt.' };
  const gistId = normalizeGistId(store.secrets.gistId);
  if (!gistId) {
    const id = await createPrivateGist();
    return { ok: true, created: true, gistId: id, summary: store.secrets.lastRemoteSummary };
  }
  if (isSyncing) {
    syncQueued = true;
    return { ok: true, queued: true };
  }
  const pulled = await pullFromGist({ preferRemote: false });
  let result = pulled;
  if (pulled.ok && (pulled.needsPushBack || pendingLocalChange)) {
    const pushed = await pushToGist();
    result = pushed.ok
      ? { ok: true, merged: true, pushed: true, updatedState: pulled.updatedState, updatedIcs: pulled.updatedIcs, summary: pushed.summary }
      : pushed;
  } else if (pulled.ok) {
    result = { ok: true, merged: true, updatedState: pulled.updatedState, updatedIcs: pulled.updatedIcs, summary: pulled.summary };
  }

  // Drain any edit that arrived while this sync was in flight so nothing is EVER dropped!
  if (syncQueued) {
    syncQueued = false;
    setTimeout(() => syncNow(), 120);
  }
  return result;
}

export function scheduleAutoSync() {
  if (!isGistConfigured() || !store.secrets.autoSync || !store.secrets.gistId) return;
  pendingLocalChange = true;
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    syncNow();
  }, 650);
}

export function flushPendingSync() {
  if (!isGistConfigured() || !store.secrets.autoSync || !store.secrets.gistId) return;
  if (!pendingLocalChange && !debounceTimer) return;
  clearTimeout(debounceTimer);
  debounceTimer = null;
  // Fire immediate keepalive PATCH so phone screen-lock / app-switch never drops the edit
  pushToGist({ keepalive: true });
}

function setSyncStatus(status, error = '') {
  store.secrets.lastSyncStatus = status;
  store.secrets.lastSyncError = error;
  store.saveSecrets({ silent: true });
  statusListeners.forEach((fn) => {
    try { fn(status, error); } catch { /* ignore */ }
  });
}

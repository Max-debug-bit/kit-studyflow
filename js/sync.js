// Private GitHub Gist 2-Way Field-Level Merge Sync (#11)
// Merges entries, caffeine, checklist, backlog, reminders, customEvents, maps & tombstones
// so simultaneous offline edits on Win 11 Firefox & Pixel 9a Chrome NEVER overwrite each other!

import { store } from './store.js';
import { syncModulesFromIcs } from './ics.js';
import { reconcileBacklogStatus } from './checklist.js';

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

function authHeaders(token) {
  return {
    Authorization: `Bearer ${token.trim()}`,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json'
  };
}

export function isGistConfigured() {
  return Boolean(store.secrets.githubToken && store.secrets.githubToken.trim().length > 10);
}

function buildSyncPayload() {
  const clone = JSON.parse(JSON.stringify(store.state));
  if (!clone.ai?.syncApiKeyInGist && clone.ai) {
    clone.ai.apiKey = '';
  }
  return clone;
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
      if (!item || !item.id) return;
      const key = String(item.id);
      if (isDeleted(key, item.updatedAt || 0)) return;
      const prev = map.get(key);
      if (!prev) {
        map.set(key, { ...item });
        return;
      }
      const prevTs = prev.updatedAt || 0;
      const curTs = item.updatedAt || 0;
      if (curTs > prevTs) {
        map.set(key, { ...item });
      } else if (curTs === prevTs) {
        // Same timestamp tie-breaker: prefer completed checkmarks & primary device
        const winner = isRemote === remoteNewer ? { ...item } : { ...prev };
        if (prev.done || item.done) winner.done = Boolean(prev.done || item.done);
        map.set(key, winner);
      }
    };
    localList.forEach((x) => put(x, false));
    remoteList.forEach((x) => put(x, true));
    return Array.from(map.values());
  };

  // 4. Key-value maps: union of all keys, primary wins on same-key conflict
  const mergeMap = (secMap = {}, priMap = {}) => ({ ...secMap, ...priMap });

  // Merge modules preserving newer/richer module settings
  const modules = {};
  const allModKeys = new Set([...Object.keys(secondary.modules || {}), ...Object.keys(primary.modules || {})]);
  for (const k of allModKeys) {
    if (isDeleted(`mod_${k}`, 0)) continue;
    modules[k] = { ...(secondary.modules?.[k] || {}), ...(primary.modules?.[k] || {}) };
  }

  // Keep local Gemini API key if remote stripped it
  const mergedAi = {
    ...secondary.ai,
    ...primary.ai,
    apiKey: primary.ai?.apiKey || secondary.ai?.apiKey || '',
    chat: (primary.ai?.chat?.length || 0) >= (secondary.ai?.chat?.length || 0)
      ? (primary.ai?.chat || [])
      : (secondary.ai?.chat || [])
  };

  // Keep whichever ICS is fresher
  const useRemoteIcs = (remote.icsUpdatedAt || 0) >= (local.icsUpdatedAt || 0);

  const result = {
    ...primary,
    schemaVersion: Math.max(local.schemaVersion || 2, remote.schemaVersion || 2, 2),
    e: mergeByIdAppend(primary.e, secondary.e),
    cf: mergeByIdAppend(primary.cf, secondary.cf),
    w: mergeMap(secondary.w, primary.w),
    sx: mergeMap(secondary.sx, primary.sx),
    lectureAttendance: mergeMap(secondary.lectureAttendance, primary.lectureAttendance),
    eventOverrides: mergeMap(secondary.eventOverrides, primary.eventOverrides),
    restDays: mergeMap(secondary.restDays, primary.restDays),
    autopilotHandled: mergeMap(secondary.autopilotHandled, primary.autopilotHandled),
    dayNotes: mergeMap(secondary.dayNotes, primary.dayNotes),
    modules,
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
    updatedAt: Math.max(local.updatedAt || 0, remote.updatedAt || 0, Date.now())
  };

  return store._mergeDefaults(result);
}

export async function createPrivateGist() {
  const token = store.secrets.githubToken.trim();
  if (!token) throw new Error('Bitte zuerst deinen GitHub Token eintragen.');

  setSyncStatus('syncing', '');
  const res = await fetch('https://api.github.com/gists', {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({
      description: 'KIT StudyFlow – Privater Cloud-Sync (Fokus-Tracker & Wochenplan)',
      public: false,
      files: {
        [STATE_FILENAME]: {
          content: JSON.stringify(buildSyncPayload(), null, 2)
        }
      }
    })
  });

  if (!res.ok) {
    const err = await res.text();
    setSyncStatus('err', `GitHub Fehler ${res.status}`);
    throw new Error(`Gist konnte nicht erstellt werden (${res.status}): ${err.slice(0, 140)}`);
  }

  const data = await res.json();
  store.secrets.gistId = data.id;
  store.secrets.lastSyncAt = Date.now();
  setSyncStatus('ok', '');
  return data.id;
}

export async function pushToGist({ forceArchive = false } = {}) {
  if (!isGistConfigured()) return { ok: false, reason: 'not_configured' };
  const token = store.secrets.githubToken.trim();
  let gistId = (store.secrets.gistId || '').trim();

  if (!gistId) {
    gistId = await createPrivateGist();
    return { ok: true, gistId, created: true };
  }

  if (isSyncing) return { ok: false, reason: 'busy' };
  isSyncing = true;
  setSyncStatus('syncing', '');

  try {
    const payloadStr = JSON.stringify(buildSyncPayload(), null, 2);
    const weekKey = getIsoWeekKey();
    const shouldWriteArchive = forceArchive || store.secrets.lastArchiveWeek !== weekKey;
    const filesBody = {
      [STATE_FILENAME]: { content: payloadStr }
    };

    if (shouldWriteArchive) {
      filesBody[`${ARCHIVE_PREFIX}${weekKey}.json`] = { content: payloadStr };
    }

    const res = await fetch(`https://api.github.com/gists/${encodeURIComponent(gistId)}`, {
      method: 'PATCH',
      headers: authHeaders(token),
      body: JSON.stringify({ files: filesBody })
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

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
            headers: authHeaders(token),
            body: JSON.stringify({ files: delFiles })
          });
        }
      } catch { /* non-fatal */ }
    }

    store.secrets.lastSyncAt = Date.now();
    setSyncStatus('ok', '');
    return { ok: true, gistId, archivedWeek: shouldWriteArchive ? weekKey : '' };
  } catch (err) {
    setSyncStatus('err', err.message);
    return { ok: false, error: err.message };
  } finally {
    isSyncing = false;
  }
}

export async function listGistArchives() {
  if (!isGistConfigured() || !store.secrets.gistId) {
    throw new Error('Kein privater GitHub Gist verbunden.');
  }
  const res = await fetch(
    `https://api.github.com/gists/${encodeURIComponent(store.secrets.gistId.trim())}`,
    { headers: authHeaders(store.secrets.githubToken) }
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
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

export async function pullFromGist({ preferRemote = false } = {}) {
  if (!isGistConfigured() || !store.secrets.gistId) {
    return { ok: false, reason: 'not_configured' };
  }
  if (isSyncing) return { ok: false, reason: 'busy' };
  isSyncing = true;
  setSyncStatus('syncing', '');

  try {
    const res = await fetch(
      `https://api.github.com/gists/${encodeURIComponent(store.secrets.gistId.trim())}`,
      { headers: authHeaders(store.secrets.githubToken) }
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const gist = await res.json();
    const files = gist.files || {};

    let updatedIcs = false;
    let updatedState = false;
    let needsPushBack = false;

    if (files[STATE_FILENAME]?.content) {
      const remoteState = JSON.parse(files[STATE_FILENAME].content);
      if (preferRemote) {
        const localKey = store.state.ai?.apiKey || '';
        const next = store._mergeDefaults(remoteState);
        if (!next.ai.apiKey && localKey) next.ai.apiKey = localKey;
        store.state = next;
        reconcileBacklogStatus();
        store.save({ skipSync: true });
        updatedState = true;
      } else {
        const beforeSig = JSON.stringify({
          e: store.state.e.length,
          cf: store.state.cf.length,
          chk: store.state.checklist.length,
          bl: store.state.backlog.length,
          u: store.state.updatedAt
        });
        const merged = mergeStates(store.state, remoteState);
        store.state = merged;
        reconcileBacklogStatus();
        store.save({ skipSync: true });
        updatedState = true;
        const remoteSig = JSON.stringify({
          e: (remoteState.e || []).length,
          cf: (remoteState.cf || []).length,
          chk: (remoteState.checklist || []).length,
          bl: (remoteState.backlog || []).length,
          u: remoteState.updatedAt || 0
        });
        const afterSig = JSON.stringify({
          e: store.state.e.length,
          cf: store.state.cf.length,
          chk: store.state.checklist.length,
          bl: store.state.backlog.length,
          u: store.state.updatedAt
        });
        needsPushBack = afterSig !== remoteSig || beforeSig !== remoteSig;
      }
    }

    if (files[ICS_FILENAME]?.content) {
      const remoteIcs = files[ICS_FILENAME].content;
      if (remoteIcs && remoteIcs !== store.state.icsRaw && remoteIcs.includes('BEGIN:VEVENT')) {
        syncModulesFromIcs(store, remoteIcs);
        updatedIcs = true;
      }
    }

    store.secrets.lastSyncAt = Date.now();
    setSyncStatus('ok', '');
    return { ok: true, updatedState, updatedIcs, needsPushBack };
  } catch (err) {
    setSyncStatus('err', err.message);
    return { ok: false, error: err.message };
  } finally {
    isSyncing = false;
  }
}

export async function syncNow() {
  if (!isGistConfigured()) return { ok: false, error: 'Kein GitHub Token hinterlegt.' };
  if (!store.secrets.gistId) {
    const id = await createPrivateGist();
    return { ok: true, created: true, gistId: id };
  }
  const pulled = await pullFromGist({ preferRemote: false });
  if (!pulled.ok) return pulled;
  if (pulled.needsPushBack) {
    return await pushToGist();
  }
  return { ok: true, merged: true, updatedIcs: pulled.updatedIcs };
}

export function scheduleAutoSync() {
  if (!isGistConfigured() || !store.secrets.autoSync || !store.secrets.gistId) return;
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    syncNow();
  }, 2400);
}

function setSyncStatus(status, error = '') {
  store.secrets.lastSyncStatus = status;
  store.secrets.lastSyncError = error;
  store.saveSecrets();
}

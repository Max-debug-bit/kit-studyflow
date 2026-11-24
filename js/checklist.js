// Uni-Plan Checklist, Backlog Reconciliation (with overdue d < today protection),
// Custom Events (weekly/once), Per-Date Event Overrides (VL <-> Übung <-> Fällt aus),
// Automatic Live Lecture -> Vorlesung/Produktivzeit (p), & Text-Plan Parser/Exporter

import {
  store,
  toDateStr,
  toTimeStr,
  addDays,
  getMondayOfWeek,
  parseDateStr,
  timeToMin,
  pad2,
  fmtDateShort,
  fmtMin,
  WEEKDAYS_DE,
  isValidIsoDate,
  isValidTimeStr
} from './store.js';
import { expandIcsEventsInRange } from './ics.js';

export function inferMetaFromChecklistItem(item) {
  const title = item?.title || '';
  const lower = title.toLowerCase();
  const kind = item?.kind === 'a' || /\banki\b/.test(lower) ? 'a' : item?.kind === 'p' ? 'p' : 'l';

  let act = '';
  if (kind === 'a') act = 'anki';
  else if (/video|vl-video/.test(lower)) act = 'video';
  else if (/\bha\b|hausaufgabe|übung/.test(lower)) act = 'homework';
  else if (/nacharbeit|folien|ankis?\s+(für|von|erstellen)/.test(lower)) act = 'review';
  else if (/klausur|altklausur/.test(lower)) act = 'exam';

  let mod = item?.moduleId || '';
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

  let estMin = item?.estMin || 0;
  if (!estMin) {
    if (kind === 'a') estMin = store.state.anki.minDailyAnkiMin || 30;
    else if (act === 'video') estMin = (mod && store.state.modules[mod]?.videoStudyMinutes) || 110;
    else if (act === 'review') estMin = (mod && store.state.modules[mod]?.liveReviewMinutes) || 75;
    else estMin = 60;
  }

  return { kind, act, mod, estMin };
}

function extractMinutesFromTitle(title) {
  const mMin = /(\d+)\s*(?:min|minuten|m\.)/i.exec(title || '');
  if (mMin) return Number(mMin[1]);
  const mHour = /(\d+(?:[.,]\d+)?)\s*(?:h|std|stunden)/i.exec(title || '');
  if (mHour) return Math.round(Number(mHour[1].replace(',', '.')) * 60);
  return 0;
}

// ---------- Backlog (Offener Rückstand) & Central Reconciliation ----------

export function reconcileBacklogStatus({ todayStr = toDateStr(), save = false } = {}) {
  const backlog = store.state.backlog || [];
  const checklist = store.state.checklist || [];
  const validBacklogIds = new Set(backlog.map((b) => b.id));

  // Strip dangling backlogIds on checklist items
  let mutated = false;
  for (const c of checklist) {
    if (c.backlogId && !validBacklogIds.has(c.backlogId)) {
      c.backlogId = '';
      mutated = true;
    }
  }

  for (const b of backlog) {
    const linked = checklist.filter((c) => c.backlogId === b.id);
    if (linked.length === 0) {
      // Never auto-un-finish a manually marked 'done' backlog item with no checklist link
      if (b.status === 'scheduled' || b.status === 'overdue' || !b.status) {
        b.status = 'open';
        b.scheduledDate = '';
        mutated = true;
      }
      continue;
    }

    if (linked.some((c) => c.done)) {
      if (b.status !== 'done') { b.status = 'done'; mutated = true; }
      b.scheduledDate = linked.find((c) => c.done)?.d || '';
      continue;
    }

    // Has uncompleted linked checklist item(s)
    const activeFutureOrToday = linked.find((c) => c.d >= todayStr);
    if (activeFutureOrToday) {
      if (b.status !== 'scheduled' || b.scheduledDate !== activeFutureOrToday.d) {
        b.status = 'scheduled';
        b.scheduledDate = activeFutureOrToday.d;
        mutated = true;
      }
    } else {
      // Only linked to uncompleted past item(s) (d < today) -> OVERDUE (re-schedulable!)
      const past = linked.sort((a, bItem) => bItem.d.localeCompare(a.d))[0];
      if (b.status !== 'overdue' || b.scheduledDate !== past.d) {
        b.status = 'overdue';
        b.scheduledDate = past.d;
        mutated = true;
      }
    }
  }

  if (mutated && save) store.save({ skipSync: true, silent: true });
  return backlog;
}

export function addBacklogItem({ title, moduleId = '', kind = 'l', estMin = 0, save = true }) {
  const clean = (title || '').trim();
  if (!clean) return null;
  const item = {
    id: `bl_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    title: clean,
    moduleId: moduleId || '',
    kind: ['l', 'a', 'p'].includes(kind) ? kind : (/\banki/i.test(clean) ? 'a' : 'l'),
    estMin: Math.max(0, Math.round(Number(estMin) || extractMinutesFromTitle(clean) || 90)),
    status: 'open',
    scheduledDate: '',
    updatedAt: Date.now()
  };
  store.state.backlog.push(item);
  if (save) store.save();
  return item;
}

export function toggleBacklogDone(id) {
  const b = store.state.backlog.find((x) => x.id === id);
  if (!b) return;
  const nextDone = b.status !== 'done';
  b.status = nextDone ? 'done' : 'open';
  b.updatedAt = Date.now();
  for (const c of store.state.checklist) {
    if (c.backlogId === id) { c.done = nextDone; c.updatedAt = Date.now(); }
  }
  reconcileBacklogStatus();
  store.save();
}

export function deleteBacklogItem(id) {
  store.pushUndo('Rückstand gelöscht');
  store.markDeleted(id);
  store.state.backlog = store.state.backlog.filter((x) => x.id !== id);
  for (const c of store.state.checklist) {
    if (c.backlogId === id) { c.backlogId = ''; c.updatedAt = Date.now(); }
  }
  store.save();
}

export function scheduleBacklogToDay(backlogId, dStr = toDateStr(), timeLabel = '') {
  const b = store.state.backlog.find((x) => x.id === backlogId);
  if (!b) return null;
  // Remove any stale uncompleted checklist item for this backlogId (e.g. overdue from yesterday) and tombstone it
  for (const c of store.state.checklist) {
    if (c.backlogId === backlogId && !c.done) store.markDeleted(c.id);
  }
  store.state.checklist = store.state.checklist.filter((c) => !(c.backlogId === backlogId && !c.done));
  const chk = addChecklistItem({
    d: dStr,
    timeLabel,
    title: b.title,
    kind: b.kind,
    estMin: b.estMin,
    moduleId: b.moduleId,
    backlogId: b.id,
    source: 'manual'
  });
  return chk;
}

// ---------- Checklist CRUD ----------

export function getChecklistForDay(dStr) {
  return (store.state.checklist || []).filter((c) => c.d === dStr);
}

export function addChecklistItem({ d, title, timeLabel = '', kind = 'l', estMin = 0, moduleId = '', backlogId = '', catalogId = '', source = 'manual' }) {
  const clean = (title || '').trim();
  if (!clean) return null;
  const validBacklogId = backlogId && store.state.backlog.some((b) => b.id === backlogId) ? backlogId : '';
  const calibrated = store.getCalibratedTaskCatalog();
  const matchedCat = catalogId
    ? calibrated.find((c) => c.id === catalogId)
    : store.matchCatalogItemForText(clean, '', moduleId);
  const resolvedCat = matchedCat ? calibrated.find((c) => c.id === matchedCat.id) : null;
  const explicitMin = Math.max(0, Math.round(Number(estMin) || extractMinutesFromTitle(clean)));

  const item = {
    id: `chk_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    d: d || toDateStr(),
    timeLabel: (timeLabel || '').trim(),
    title: clean,
    kind: ['l', 'a', 'p'].includes(kind) ? kind : (/\banki\b/i.test(clean) ? 'a' : 'l'),
    estMin: explicitMin || (resolvedCat ? resolvedCat.effectiveMin : 0),
    moduleId: moduleId || '',
    backlogId: validBacklogId,
    catalogId: resolvedCat ? resolvedCat.id : '',
    done: false,
    source,
    updatedAt: Date.now()
  };
  store.state.checklist.push(item);
  reconcileBacklogStatus();
  store.save();
  return item;
}

export function estimateChecklistItemMinutes(item, calibratedCatalog = null) {
  if (!item) return 0;
  const cal = calibratedCatalog || store.getCalibratedTaskCatalog();
  if (item.catalogId) {
    const hit = cal.find((c) => c.id === item.catalogId);
    if (hit && hit.effectiveMin > 0) return hit.effectiveMin;
  }
  const matched = store.matchCatalogItemForText(item.title || '', '', item.moduleId || '');
  if (matched) {
    const hit = cal.find((c) => c.id === matched.id);
    if (hit && hit.effectiveMin > 0) return hit.effectiveMin;
  }
  if (Number(item.estMin) > 0) return Math.round(Number(item.estMin));
  const extracted = extractMinutesFromTitle(item.title || '');
  return extracted > 0 ? extracted : 60;
}

export function moveChecklistItemToDate(id, targetDateStr, { save = true } = {}) {
  const item = store.state.checklist.find((x) => x.id === id);
  if (!item || !targetDateStr || item.d === targetDateStr) return { ok: false };
  const oldDate = item.d;
  if (targetDateStr < oldDate && !item.pulledFromDate) {
    item.pulledFromDate = oldDate;
  } else if (item.pulledFromDate && targetDateStr >= item.pulledFromDate) {
    delete item.pulledFromDate;
  }
  item.d = targetDateStr;
  item.updatedAt = Date.now();
  reconcileBacklogStatus();
  if (save) store.save();
  return { ok: true, item, oldDate, targetDate: targetDateStr, estMin: estimateChecklistItemMinutes(item) };
}

export function shiftChecklistItemByDays(id, deltaDays) {
  const item = store.state.checklist.find((x) => x.id === id);
  if (!item) return { ok: false };
  return moveChecklistItemToDate(id, addDays(item.d, deltaDays));
}

export function moveChecklistItemToBacklog(id) {
  const item = store.state.checklist.find((x) => x.id === id);
  if (!item) return null;
  store.pushUndo('In Rückstand verschoben');
  if (!item.backlogId) {
    addBacklogItem({
      title: item.title,
      moduleId: item.moduleId || '',
      kind: item.kind || 'l',
      estMin: estimateChecklistItemMinutes(item),
      save: false
    });
  }
  store.markDeleted(id);
  store.state.checklist = store.state.checklist.filter((x) => x.id !== id);
  reconcileBacklogStatus();
  store.save();
  return true;
}

export function getWeekAheadImpact(todayStr = toDateStr()) {
  const monday = getMondayOfWeek(todayStr);
  const sunday = addDays(monday, 6);
  const tomorrow = addDays(todayStr, 1);
  const cal = store.getCalibratedTaskCatalog();
  const weekItems = (store.state.checklist || []).filter((c) => c.d >= monday && c.d <= sunday);

  let todayOpenMin = 0;
  let todayDoneMin = 0;
  let restWeekOpenMin = 0;
  let restWeekOpenCount = 0;
  let boughtForwardMin = 0;
  let boughtForwardCount = 0;

  const dayLoads = {};
  for (let d = tomorrow; d <= sunday; d = addDays(d, 1)) {
    const wd = WEEKDAYS_DE[parseDateStr(d).getDay()];
    dayLoads[d] = { d, wd, shortDate: fmtDateShort(d), totalOpenMin: 0, count: 0 };
  }

  for (const it of weekItems) {
    const mins = estimateChecklistItemMinutes(it, cal);
    if (it.d === todayStr) {
      if (it.done) todayDoneMin += mins;
      else todayOpenMin += mins;
    } else if (it.d > todayStr && !it.done) {
      restWeekOpenMin += mins;
      restWeekOpenCount++;
      if (dayLoads[it.d]) {
        dayLoads[it.d].totalOpenMin += mins;
        dayLoads[it.d].count++;
      }
    }

    // Track "gekaufte Freizeit" (items pulled forward from a later date OR already checked off in advance)
    if (it.done && ((it.pulledFromDate && it.pulledFromDate > it.d) || it.d > todayStr)) {
      boughtForwardMin += mins;
      boughtForwardCount++;
    }
  }

  // Pick top 3 upcoming open tasks (nearest days first, prioritizing impactful ones)
  const upcomingOpen = weekItems
    .filter((it) => it.d > todayStr && !it.done)
    .sort((a, b) => a.d.localeCompare(b.d) || estimateChecklistItemMinutes(b, cal) - estimateChecklistItemMinutes(a, cal))
    .slice(0, 3)
    .map((it) => {
      const estMin = estimateChecklistItemMinutes(it, cal);
      const load = dayLoads[it.d] || { wd: WEEKDAYS_DE[parseDateStr(it.d).getDay()], shortDate: fmtDateShort(it.d), totalOpenMin: estMin };
      const dayBeforeMin = load.totalOpenMin;
      const dayAfterMin = Math.max(0, dayBeforeMin - estMin);
      const freesWholeDay = dayAfterMin === 0;
      const impactText = freesWholeDay
        ? `${load.wd} (${load.shortDate}) wird dadurch komplett frei!`
        : `${load.wd} (${load.shortDate}): ${fmtMin(dayBeforeMin)} → ${fmtMin(dayAfterMin)} (-${fmtMin(estMin)})`;
      return {
        id: it.id,
        title: it.title,
        d: it.d,
        wd: load.wd,
        shortDate: load.shortDate,
        estMin,
        dayBeforeMin,
        dayAfterMin,
        freesWholeDay,
        impactText
      };
    });

  return {
    monday,
    sunday,
    todayOpenMin,
    todayDoneMin,
    restWeekOpenMin,
    restWeekOpenCount,
    boughtForwardMin,
    boughtForwardCount,
    dayLoads,
    candidates: upcomingOpen
  };
}

export function toggleChecklistItem(id) {
  const item = store.state.checklist.find((x) => x.id === id);
  if (!item) return null;
  item.done = !item.done;
  item.updatedAt = Date.now();
  reconcileBacklogStatus();
  store.save();
  return item;
}

export function updateChecklistItem(id, patch) {
  const item = store.state.checklist.find((x) => x.id === id);
  if (!item) return null;
  Object.assign(item, patch, { updatedAt: Date.now() });
  reconcileBacklogStatus();
  store.save();
  return item;
}

export function deleteChecklistItem(id) {
  store.pushUndo('Checklisten-Punkt gelöscht');
  store.markDeleted(id);
  store.state.checklist = store.state.checklist.filter((x) => x.id !== id);
  reconcileBacklogStatus();
  store.save();
}

export function getUnfinishedFromYesterday(todayStr = toDateStr()) {
  const yesterday = addDays(todayStr, -1);
  return (store.state.checklist || []).filter((c) => c.d === yesterday && !c.done);
}

export function rolloverYesterdayToToday(todayStr = toDateStr()) {
  const items = getUnfinishedFromYesterday(todayStr);
  const nowTs = Date.now();
  for (const it of items) {
    it.d = todayStr; // backlogId moves right along with it!
    it.updatedAt = nowTs;
  }
  if (items.length) {
    reconcileBacklogStatus({ todayStr });
    store.save();
  }
  return items.length;
}

// ---------- Vormerken / Reminders ----------

export function addReminder(text, date = '') {
  const clean = (text || '').trim();
  if (!clean) return null;
  const r = {
    id: `rem_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
    text: clean,
    date: (date || '').trim(),
    done: false,
    updatedAt: Date.now()
  };
  store.state.reminders.push(r);
  store.save();
  return r;
}

export function toggleReminder(id) {
  const r = store.state.reminders.find((x) => x.id === id);
  if (!r) return;
  r.done = !r.done;
  r.updatedAt = Date.now();
  store.save();
}

export function deleteReminder(id) {
  store.markDeleted(id);
  store.state.reminders = store.state.reminders.filter((x) => x.id !== id);
  store.save();
}

// ---------- Custom Events (Weekly like TM-Tut Do 09:45-11:15 & One-off like MKL-Workshops) ----------

export function addCustomEvent({ title, recurrence = 'weekly', weekday = 4, date = '', start = '09:45', end = '11:15', eventType = 'exercise', liveReviewMinutes = 0, location = '' }) {
  const clean = (title || '').trim();
  if (!clean) return null;
  const ev = {
    id: `cev_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
    title: clean,
    shortName: clean,
    recurrence, // 'weekly' | 'once'
    weekday: Number(weekday), // 0=So..6=Sa
    date: date || '',
    start,
    end,
    eventType, // 'lecture' | 'exercise' | 'workshop'
    liveReviewMinutes: Math.max(0, Number(liveReviewMinutes) || 0),
    location: (location || '').trim(),
    updatedAt: Date.now()
  };
  store.state.customEvents.push(ev);
  store.save();
  return ev;
}

export function deleteCustomEvent(id) {
  store.markDeleted(id);
  store.state.customEvents = store.state.customEvents.filter((x) => x.id !== id);
  store.save();
}

// ---------- Rückstand-Autopilot (#3): Suggest follow-up tasks after finished KIT sessions ----------

export function getAutopilotSuggestions(nowDate = new Date()) {
  const todayStr = toDateStr(nowDate);
  const handled = store.state.autopilotHandled || {};
  const suggestions = [];

  // Look at today and the last 2 days for finished lectures/exercises that haven't been handled yet
  for (let offset = 0; offset >= -2; offset--) {
    const dStr = addDays(todayStr, offset);
    const wd = WEEKDAYS_DE[parseDateStr(dStr).getDay()];
    const lectures = getDayLectures(dStr, nowDate);

    for (const l of lectures) {
      if (l.cancelled || !l.endedToday) continue;

      const baseLabel = l.shortName.replace(/\s*\([^)]+\)/, '').trim();

      // Evaluate review/video suggestion independently from homework suggestion so accepting one never swallows the other!
      if (!handled[l.uid]) {
        if (l.mode === 'video' && l.videoStudyMinutes > 0) {
          suggestions.push({
            uid: l.uid,
            d: dStr,
            moduleId: l.moduleId || '',
            kind: 'l',
            estMin: l.videoStudyMinutes,
            reason: `Video-${l.effectiveType === 'exercise' ? 'Übung' : 'Vorlesung'} (${wd}, ${fmtDateShort(dStr)})`,
            title: `${baseLabel}: ${l.effectiveType === 'exercise' ? 'Übungs' : 'VL'}-Video vom ${wd}, ${fmtDateShort(dStr)} durcharbeiten`
          });
        } else if (l.mode === 'live' && (l.liveReviewMinutes > 0 || l.createsAnki)) {
          suggestions.push({
            uid: l.uid,
            d: dStr,
            moduleId: l.moduleId || '',
            kind: 'l',
            estMin: l.liveReviewMinutes || 75,
            reason: `${l.effectiveType === 'exercise' ? 'Übung' : 'Vorlesung'} (${wd}, ${fmtDateShort(dStr)})`,
            title: `${baseLabel}: ${l.effectiveType === 'exercise' ? 'Übung' : 'VL'} vom ${wd}, ${fmtDateShort(dStr)} nacharbeiten${l.createsAnki ? ' + Ankis' : ''}`
          });
        }
      }
      if (l.triggersHomework && !handled[`${l.uid}_hw`]) {
        suggestions.push({
          uid: `${l.uid}_hw`,
          d: dStr,
          moduleId: l.moduleId || '',
          kind: 'l',
          estMin: 120,
          reason: `Neue HA nach ${l.shortName}`,
          title: `${baseLabel}: Neue HA (${l.homeworkMode === 'understanding' ? 'Verständnis' : 'Abgabe'})`
        });
      }
    }
  }
  return suggestions;
}

export function acceptAutopilotSuggestion(suggestion) {
  if (!suggestion || !suggestion.uid) return null;
  if (!store.state.autopilotHandled) store.state.autopilotHandled = {};
  store.state.autopilotHandled[suggestion.uid] = Date.now();
  return addBacklogItem({
    title: suggestion.title,
    moduleId: suggestion.moduleId,
    kind: suggestion.kind,
    estMin: suggestion.estMin
  });
}

export function dismissAutopilotSuggestion(uid) {
  if (!uid) return;
  if (!store.state.autopilotHandled) store.state.autopilotHandled = {};
  store.state.autopilotHandled[uid] = Date.now();
  store.save();
}

function expandCustomEventsForDay(dStr) {
  const dow = parseDateStr(dStr).getDay();
  const list = [];
  for (const c of (store.state.customEvents || [])) {
    const matches = (c.recurrence === 'weekly' && Number(c.weekday) === dow) ||
                    (c.recurrence === 'once' && c.date === dStr);
    if (!matches) continue;
    list.push({
      uid: `custom_${c.id}_${dStr}`,
      customId: c.id,
      isCustom: true,
      d: dStr,
      start: c.start,
      end: c.end,
      shortName: c.shortName || c.title,
      summary: c.title,
      location: c.location || '',
      moduleId: '',
      type: c.eventType === 'lecture' ? 'V' : c.eventType === 'workshop' ? 'W' : 'Ü',
      baseEventType: c.eventType, // 'lecture' | 'exercise' | 'workshop'
      customLiveReviewMin: c.liveReviewMinutes || 0
    });
  }
  return list;
}

// ---------- Per-Date Event Overrides (MKL VL <-> Übung <-> Fällt aus) & Automatic Lecture -> Vorlesung/Produktiv (p) ----------

export function setEventOverride(uid, dStr, overrideType) {
  // overrideType: 'default' | 'lecture' | 'exercise' | 'cancelled'
  if (!store.state.eventOverrides) store.state.eventOverrides = {};
  if (!overrideType || overrideType === 'default') delete store.state.eventOverrides[uid];
  else store.state.eventOverrides[uid] = overrideType;
  store.touchMapKey('eventOverrides', uid);

  // If marked cancelled, also clear forced attendance so it doesn't book minutes
  if (overrideType === 'cancelled') {
    if (!store.state.lectureAttendance) store.state.lectureAttendance = {};
    store.state.lectureAttendance[uid] = 'skipped';
    store.touchMapKey('lectureAttendance', uid);
  }
  syncDayLecturesToProductive(dStr, { save: false });
  store.save();
}

export function getDayLectures(dStr, nowDate = new Date()) {
  const todayStr = toDateStr(nowDate);
  const nowMin = nowDate.getHours() * 60 + nowDate.getMinutes();

  const icsEvents = store.state.icsRaw ? expandIcsEventsInRange(store.state.icsRaw, dStr, dStr) : [];
  const customEvents = expandCustomEventsForDay(dStr);
  const combined = [...icsEvents, ...customEvents].sort((a, b) => (a.start || '').localeCompare(b.start || ''));

  return combined.map((ev) => {
    const rule = ev.moduleId ? store.state.modules[ev.moduleId] : null;
    const baseMode = ev.isCustom ? 'live' : (rule?.attendance || 'live'); // 'live' | 'video' | 'skip'
    const typeOverride = store.state.eventOverrides?.[ev.uid] || null; // 'lecture' | 'exercise' | 'cancelled' | null

    const cancelled = typeOverride === 'cancelled' || baseMode === 'skip';
    const mode = cancelled ? 'skip' : baseMode;

    // Effective session type for review/Anki planning: 'lecture' | 'exercise' | 'workshop' | 'cancelled'
    let effectiveType;
    if (cancelled) {
      effectiveType = 'cancelled';
    } else if (typeOverride === 'exercise' || typeOverride === 'lecture') {
      effectiveType = typeOverride;
    } else if (ev.isCustom) {
      effectiveType = ev.baseEventType || 'exercise';
    } else {
      effectiveType = (rule?.type === 'Ü' || rule?.type === 'T' || ev.type === 'Ü' || ev.type === 'T') ? 'exercise' : 'lecture';
    }

    const durationMin = Math.max(15, timeToMin(ev.end) - timeToMin(ev.start));
    const attOverride = store.state.lectureAttendance?.[ev.uid]; // 'attended' | 'skipped' | undefined
    const endedToday = dStr < todayStr || (dStr === todayStr && nowMin >= timeToMin(ev.end));
    const minAutoDate = addDays(todayStr, -2);

    let attended = false;
    if (!cancelled) {
      if (mode === 'live') {
        if (attOverride === 'attended') attended = true;
        else if (attOverride === 'skipped') attended = false;
        else if (store.state.autoLogLectures && dStr >= minAutoDate && dStr <= todayStr && endedToday) attended = true;
      } else if (attOverride === 'attended') {
        attended = true;
      }
    }

    // Review minutes needed after this specific occurrence
    let liveReviewMinutes = 0;
    let videoStudyMinutes = 0;
    let createsAnki = false;
    if (!cancelled) {
      if (typeOverride === 'exercise' || effectiveType === 'workshop') {
        // Explicit per-date override (e.g. MKL VL -> Übung) or Workshop: 0 unless custom event defines review
        liveReviewMinutes = ev.isCustom ? (ev.customLiveReviewMin || 0) : 0;
        videoStudyMinutes = 0;
        createsAnki = false;
      } else if (effectiveType === 'exercise') {
        // Regular exercise module (e.g. HM I (Ü)): ALWAYS respect user-configured rule values!
        liveReviewMinutes = ev.isCustom ? (ev.customLiveReviewMin || 0) : (rule?.liveReviewMinutes ?? 0);
        videoStudyMinutes = ev.isCustom ? 0 : (rule?.videoStudyMinutes ?? 0);
        createsAnki = ev.isCustom ? false : Boolean(rule?.createsAnki);
      } else {
        liveReviewMinutes = ev.isCustom ? (ev.customLiveReviewMin || 0) : (rule?.liveReviewMinutes ?? 75);
        videoStudyMinutes = ev.isCustom ? 0 : (rule?.videoStudyMinutes ?? rule?.studyMinutes ?? 110);
        createsAnki = ev.isCustom ? false : Boolean(rule?.createsAnki);
      }
    }

    return {
      ...ev,
      shortName: rule?.shortName || ev.shortName,
      mode,
      effectiveType,
      typeOverride,
      cancelled,
      durationMin,
      override: attOverride,
      endedToday,
      attended,
      liveReviewMinutes,
      videoStudyMinutes,
      studyMinutes: videoStudyMinutes,
      createsAnki,
      triggersHomework: !cancelled && Boolean(rule?.triggersHomework),
      homeworkMode: rule?.homeworkMode || 'understanding'
    };
  });
}

export function getDayUniSummaryLabel(dStr, lectures = null) {
  const list = lectures || getDayLectures(dStr);
  const active = list.filter((x) => !x.cancelled && x.mode === 'live' && x.override !== 'skipped');
  if (!active.length) return '';
  const firstStart = active[0].start;
  const lastEnd = active[active.length - 1].end;
  const names = Array.from(new Set(active.map((x) => x.shortName.replace(/\s*\([^)]+\)/, '')))).slice(0, 3).join(' & ');
  return `Uni ${firstStart}–${lastEnd}${names ? ` (${names})` : ''}`;
}

export function syncDayLecturesToProductive(dStr = toDateStr(), { save = true } = {}) {
  const lectures = getDayLectures(dStr);
  const attended = lectures.filter((l) => l.attended && !l.cancelled);
  const totalMin = attended.reduce((s, l) => s + l.durationMin, 0);
  const lastEnd = attended.length ? attended[attended.length - 1].end : toTimeStr();

  const existingIdx = store.state.e.findIndex((x) => x.d === dStr && x.k === 'p' && x.autoLecture === true);

  let changed = false;
  if (totalMin > 0) {
    if (existingIdx >= 0) {
      if (store.state.e[existingIdx].m !== totalMin) {
        store.state.e[existingIdx].m = totalMin;
        store.state.e[existingIdx].t = lastEnd;
        store.state.e[existingIdx].lectureCount = attended.length;
        store.state.e[existingIdx].updatedAt = Date.now();
        changed = true;
      }
    } else {
      store.state.e.push({
        id: Date.now() + Math.floor(Math.random() * 100),
        d: dStr,
        t: lastEnd,
        m: totalMin,
        k: 'p',
        autoLecture: true,
        lectureCount: attended.length,
        updatedAt: Date.now()
      });
      changed = true;
    }
  } else if (existingIdx >= 0) {
    const [removed] = store.state.e.splice(existingIdx, 1);
    if (removed && removed.id !== undefined) {
      if (!store.state.deletedIds) store.state.deletedIds = {};
      store.state.deletedIds[String(removed.id)] = Date.now();
    }
    changed = true;
  }

  if (changed && save) store.save();
  return { changed, minutes: totalMin, count: attended.length };
}

export function syncRecentLecturesToProductive(todayStr = toDateStr(), { save = true } = {}) {
  let anyChanged = false;
  for (let offset = 0; offset >= -2; offset--) {
    const dStr = addDays(todayStr, offset);
    const res = syncDayLecturesToProductive(dStr, { save: false });
    if (res.changed) anyChanged = true;
  }
  if (anyChanged && save) store.save();
  return { changed: anyChanged };
}

export function setLectureAttendance(uid, dStr, status) {
  if (!store.state.lectureAttendance) store.state.lectureAttendance = {};
  if (status === 'auto') delete store.state.lectureAttendance[uid];
  else store.state.lectureAttendance[uid] = status;
  store.touchMapKey('lectureAttendance', uid);
  syncDayLecturesToProductive(dStr, { save: false });
  store.save();
}

// ---------- Text-Plan Parser & Exporter ----------

export function parseTextChecklistPlan(rawText, referenceYear = new Date().getFullYear()) {
  const lines = (rawText || '').replace(/\r\n/g, '\n').split('\n').map((l) => l.trim()).filter(Boolean);
  let currentDate = null;
  let inReminders = false;
  const items = [];
  const dayNotes = {};
  const reminders = [];

  for (const line of lines) {
    if (/^uni-plan/i.test(line) && !line.includes('──')) continue;
    if (/vormerken/i.test(line) && (line.includes('──') || line.includes('---') || line === 'VORMERKEN')) {
      inReminders = true;
      currentDate = null;
      continue;
    }

    const dateMatch = /(\d{1,2})\.(\d{1,2})\.(?:(\d{2,4}))?/.exec(line);
    const looksLikeHeader =
      line.includes('──') ||
      line.startsWith('---') ||
      /^(?:mo|di|mi|do|fr|sa|so)[.,\s]+\d{1,2}\.\d{1,2}\./i.test(line);

    if (dateMatch && looksLikeHeader) {
      inReminders = false;
      const dayNum = Number(dateMatch[1]);
      const monthNum = Number(dateMatch[2]);
      const yearNum = dateMatch[3]
        ? (dateMatch[3].length === 2 ? 2000 + Number(dateMatch[3]) : Number(dateMatch[3]))
        : referenceYear;
      currentDate = `${yearNum}-${pad2(monthNum)}-${pad2(dayNum)}`;

      const pipeIdx = line.indexOf('|');
      if (pipeIdx !== -1) {
        const note = line.slice(pipeIdx + 1).replace(/─+/g, '').replace(/--+$/g, '').trim();
        if (note) dayNotes[currentDate] = note;
      }
      continue;
    }

    const cleanLine = line.replace(/^[-*•☐☑✓\[\]\s]+/, '').trim();
    if (!cleanLine) continue;

    if (inReminders) {
      reminders.push({ text: cleanLine });
      continue;
    }
    if (!currentDate) continue;

    let timeLabel = '';
    let title = cleanLine;
    const tMatch = /^((?:ab\s*)?\d{1,2}:\d{2}(?:\s*[–-]\s*\d{1,2}:\d{2})?)\s*:\s*(.+)$/i.exec(cleanLine);
    if (tMatch) {
      timeLabel = tMatch[1].trim();
      title = tMatch[2].trim();
    }

    const kind = /\banki/i.test(title) ? 'a' : /\bpause\b/i.test(title) ? 'p' : 'l';
    items.push({ d: currentDate, timeLabel, title, kind, estMin: extractMinutesFromTitle(title) });
  }

  return { items, dayNotes, reminders };
}

export function applyParsedChecklist({ items, dayNotes, reminders, replaceDates = [] }) {
  store.pushUndo('Plan übernommen');
  const todayStr = toDateStr();
  const replaceSet = new Set(replaceDates);

  // 1. Replace uncompleted checklist items on replaceDates (record tombstones so Gist merge never resurrects them!)
  if (replaceSet.size) {
    for (const c of store.state.checklist) {
      if (replaceSet.has(c.d) && !c.done) store.markDeleted(c.id);
    }
    store.state.checklist = store.state.checklist.filter((c) => !(replaceSet.has(c.d) && !c.done));
  }

  // Reconcile immediately so replaced backlog links revert to 'open'
  reconcileBacklogStatus({ todayStr });

  // 2. Validate backlogIds against real store.state.backlog (anti-hallucination guard!)
  const validBacklogIds = new Set((store.state.backlog || []).map((b) => b.id));
  const calList = store.getCalibratedTaskCatalog(); // Computed once before the loop!
  const nowTs = Date.now();

  let addedItems = 0;
  for (const it of (items || [])) {
    if (!it || !isValidIsoDate(it.d) || !String(it.title || '').trim()) continue;
    const rawBacklogId = String(it.backlogId || '').trim();
    const backlogId = rawBacklogId && validBacklogIds.has(rawBacklogId) ? rawBacklogId : '';

    if (backlogId) {
      // Edge case: If this backlogId has a stale uncompleted entry in the past (d < today), remove & tombstone it!
      for (const c of store.state.checklist) {
        if (c.backlogId === backlogId && !c.done && c.d < todayStr) store.markDeleted(c.id);
      }
      store.state.checklist = store.state.checklist.filter(
        (c) => !(c.backlogId === backlogId && !c.done && c.d < todayStr)
      );

      // Duplicate guard: If already scheduled on today/future (not replaced), skip duplicate
      const alreadyActive = store.state.checklist.some(
        (c) => c.backlogId === backlogId && !c.done && c.d >= todayStr
      );
      if (alreadyActive) continue;
    }

    const explicitCat = it.catalogId ? calList.find((c) => c.id === it.catalogId) : null;
    const matchedCat = explicitCat || store.matchCatalogItemForText(it.title || '', '', it.moduleId || '');
    const resolvedCat = matchedCat ? calList.find((c) => c.id === matchedCat.id) : null;
    const explicitEst = Math.max(0, Math.round(Number(it.estMin) || extractMinutesFromTitle(it.title)));

    store.state.checklist.push({
      id: `chk_${nowTs}_${addedItems}_${Math.random().toString(36).slice(2, 6)}`,
      d: it.d,
      timeLabel: it.timeLabel || '',
      title: it.title,
      kind: ['l', 'a', 'p'].includes(it.kind) ? it.kind : (/\banki/i.test(it.title) ? 'a' : 'l'),
      estMin: explicitEst || (resolvedCat ? resolvedCat.effectiveMin : 0),
      moduleId: it.moduleId || '',
      backlogId,
      catalogId: resolvedCat ? resolvedCat.id : '',
      done: false,
      source: 'ai',
      updatedAt: nowTs
    });
    addedItems++;
  }

  if (dayNotes && typeof dayNotes === 'object') {
    if (!store.state.dayNotes) store.state.dayNotes = {};
    for (const [d, note] of Object.entries(dayNotes)) {
      if (!isValidIsoDate(d)) continue;
      store.state.dayNotes[d] = String(note || '').trim();
      store.touchMapKey('dayNotes', d);
    }
  }

  let addedReminders = 0;
  const existingRem = new Set((store.state.reminders || []).map((r) => r.text.toLowerCase()));
  for (const r of (reminders || [])) {
    const txt = (typeof r === 'string' ? r : r?.text || '').trim();
    const low = txt.toLowerCase();
    if (txt && !existingRem.has(low)) {
      store.state.reminders.push({
        id: `rem_${nowTs}_${addedReminders}_${Math.random().toString(36).slice(2, 5)}`,
        text: txt,
        date: (r && typeof r === 'object' && isValidIsoDate(r.date)) ? r.date : '',
        done: false,
        updatedAt: nowTs
      });
      existingRem.add(low);
      addedReminders++;
    }
  }

  reconcileBacklogStatus({ todayStr });
  store.save();
  return { addedItems, addedReminders };
}

// ---------- Semesterplan-Scanner Apply (#2) ----------

export function applySemesterScanResult(scan) {
  if (!scan) return { appliedOverrides: 0, addedEvents: 0, addedReminders: 0 };
  store.pushUndo('Semesterplan angewendet');

  let appliedOverrides = 0;
  const affectedDates = new Set();
  if (!store.state.eventOverrides) store.state.eventOverrides = {};

  for (const ov of (scan.overrides || [])) {
    if (!isValidIsoDate(ov?.d) || !['exercise', 'lecture', 'cancelled'].includes(ov?.overrideType)) continue;
    const dayEvents = store.state.icsRaw ? expandIcsEventsInRange(store.state.icsRaw, ov.d, ov.d) : [];
    const needle = String(ov.matchModule || '').toLowerCase();
    const matches = dayEvents.filter((ev) => {
      const rule = ev.moduleId ? store.state.modules[ev.moduleId] : null;
      const hay = `${ev.shortName || ''} ${ev.summary || ''} ${rule?.shortName || ''}`.toLowerCase();
      return !needle || hay.includes(needle);
    });
    for (const ev of matches) {
      store.state.eventOverrides[ev.uid] = ov.overrideType; // 'exercise' | 'lecture' | 'cancelled'
      store.touchMapKey('eventOverrides', ev.uid);
      if (ov.overrideType === 'cancelled') {
        if (!store.state.lectureAttendance) store.state.lectureAttendance = {};
        store.state.lectureAttendance[ev.uid] = 'skipped';
        store.touchMapKey('lectureAttendance', ev.uid);
      }
      affectedDates.add(ov.d);
      appliedOverrides++;
    }
  }

  let addedEvents = 0;
  const existingEvSigs = new Set(
    (store.state.customEvents || []).map((c) => `${c.title.toLowerCase()}|${c.date}|${c.start}`)
  );
  for (const ev of (scan.customEvents || [])) {
    const cleanTitle = String(ev?.title || '').trim();
    if (!cleanTitle || !isValidIsoDate(ev?.date)) continue;
    const startStr = isValidTimeStr(ev.start) ? ev.start.trim() : '14:00';
    const endStr = isValidTimeStr(ev.end) ? ev.end.trim() : '15:30';
    const sig = `${cleanTitle.toLowerCase()}|${ev.date}|${startStr}`;
    if (existingEvSigs.has(sig)) continue;
    store.state.customEvents.push({
      id: `cev_${Date.now()}_${addedEvents}_${Math.random().toString(36).slice(2, 5)}`,
      title: cleanTitle,
      shortName: cleanTitle,
      recurrence: 'once',
      weekday: parseDateStr(ev.date).getDay(),
      date: ev.date,
      start: startStr,
      end: endStr,
      eventType: ['lecture', 'exercise', 'workshop'].includes(ev.eventType) ? ev.eventType : 'workshop',
      liveReviewMinutes: ev.eventType === 'lecture' ? 75 : 0,
      location: String(ev.location || '').trim(),
      updatedAt: Date.now()
    });
    existingEvSigs.add(sig);
    affectedDates.add(ev.date);
    addedEvents++;
  }

  let addedReminders = 0;
  const existingRem = new Set((store.state.reminders || []).map((r) => r.text.toLowerCase()));
  for (const txt of (scan.reminders || [])) {
    const clean = String(txt || '').trim();
    const low = clean.toLowerCase();
    if (clean && !existingRem.has(low)) {
      store.state.reminders.push({
        id: `rem_${Date.now()}_${addedReminders}_${Math.random().toString(36).slice(2, 5)}`,
        text: clean,
        date: '',
        done: false,
        updatedAt: Date.now()
      });
      existingRem.add(low);
      addedReminders++;
    }
  }

  // Re-sync productive lecture entries for all affected dates (e.g. remove auto-logged minutes for cancelled lectures!)
  for (const d of affectedDates) {
    syncDayLecturesToProductive(d, { save: false });
  }

  store.save();
  return { appliedOverrides, addedEvents, addedReminders };
}

export function exportWeekChecklistAsText(mondayStr) {
  const sundayStr = addDays(mondayStr, 6);
  const out = [`Uni-Plan (${fmtDateShort(mondayStr)}–${fmtDateShort(sundayStr)}) – Checkliste`, ''];

  for (let i = 0; i < 7; i++) {
    const d = addDays(mondayStr, i);
    const wd = WEEKDAYS_DE[parseDateStr(d).getDay()].toUpperCase();
    const note = store.state.dayNotes?.[d] || getDayUniSummaryLabel(d);
    out.push(`── ${wd}, ${fmtDateShort(d)}${note ? ` | ${note}` : ''} ──`);
    const items = getChecklistForDay(d);
    if (!items.length) {
      out.push('  (keine Einträge)');
    } else {
      for (const it of items) {
        const mark = it.done ? '[x]' : '[ ]';
        const prefix = it.timeLabel ? `${it.timeLabel}: ` : '';
        out.push(`${mark} ${prefix}${it.title}`);
      }
    }
  }

  const openRem = (store.state.reminders || []).filter((r) => !r.done);
  if (openRem.length) {
    out.push('', '── VORMERKEN ──');
    for (const r of openRem) out.push(r.text);
  }
  return out.join('\n');
}

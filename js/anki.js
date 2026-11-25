// AnkiConnect client (http://127.0.0.1:8765) + Real Per-Deck Revlog Time + Sync History + Option B fallback

import {
  store,
  toDateStr,
  toTimeStr,
  addDays,
  filterLeafAnkiDecks,
  isAnkiDeckExcluded
} from './store.js';

const MAX_SYNC_HISTORY = 180;
const REVLOG_LOOKBACK_DAYS = 180;

async function ankiInvoke(action, params = {}, url = null) {
  const endpoint = (url || store.state.anki.url || 'http://127.0.0.1:8765').trim();
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, version: 6, params })
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data.result;
}

export function getAnkiWeights() {
  const a = store.state.anki || {};
  return {
    secNew: Math.max(5, Number(a.secNew) || 45),       // Blau: Neue Karten
    secLearn: Math.max(5, Number(a.secLearn) || 30),   // Rot: Lern-/Wiederholungs-Stufe
    secReview: Math.max(5, Number(a.secReview) || 15)  // Grün: Fällige Reviews
  };
}

export function estimateAnkiMinutes({ newCards = 0, learnCards = 0, reviewCards = 0 }) {
  const { secNew, secLearn, secReview } = getAnkiWeights();
  const totalSec = (Math.max(0, newCards) * secNew) +
                   (Math.max(0, learnCards) * secLearn) +
                   (Math.max(0, reviewCards) * secReview);
  return Math.ceil(totalSec / 60);
}

export function recordAnkiSyncPoint(summary, ts = Date.now()) {
  if (!summary) return;
  if (!Array.isArray(store.state.anki.syncHistory)) store.state.anki.syncHistory = [];
  const hist = store.state.anki.syncHistory;
  const b = Math.max(0, Number(summary.totalNew) || 0);
  const r = Math.max(0, Number(summary.totalLearn) || 0);
  const g = Math.max(0, Number(summary.totalReview) || 0);
  const tot = Math.max(0, Number(summary.totalDue ?? (b + r + g)) || 0);
  const estMin = Math.max(0, Number(summary.estMinutes) || 0);

  const last = hist[hist.length - 1];
  // Avoid accidental double-click duplicates within 15s when card counts did not change
  if (last && Math.abs(ts - last.ts) < 15000 && last.b === b && last.r === r && last.g === g) {
    last.ts = ts;
    last.estMin = estMin;
    return;
  }

  hist.push({ ts, b, r, g, tot, estMin });
  if (hist.length > MAX_SYNC_HISTORY) {
    store.state.anki.syncHistory = hist.slice(-MAX_SYNC_HISTORY);
  }
}

export function syncDayAnkiFromRevlog(dStr = toDateStr(), { save = false } = {}) {
  if (store.state.anki?.autoLogTime === false) {
    return { changed: false, minutes: 0, cards: 0 };
  }
  const dayDecks = store.state.anki?.reviewByDay?.[dStr];
  const excluded = store.state.anki?.excludedDecks || [];
  let totalSec = 0;
  let totalCards = 0;

  if (dayDecks && typeof dayDecks === 'object') {
    for (const [fullName, stat] of Object.entries(dayDecks)) {
      if (!stat) continue;
      const shortName = fullName.split('::').pop() || fullName;
      if (isAnkiDeckExcluded(fullName, shortName, excluded)) continue;
      totalSec += Number(stat.sec) || 0;
      totalCards += Number(stat.cards) || 0;
    }
  }

  const totalMin = Math.round(totalSec / 60);
  const autoId = `anki_auto_${dStr}`;
  const existingIdx = store.state.e.findIndex(
    (x) => String(x.id) === autoId || (x.d === dStr && x.k === 'a' && x.autoAnki === true)
  );

  // In 'sum' mode, avoid adding an autoAnki entry on top of an existing manual Anki entry on the same day
  if (store.state.mode === 'sum' && existingIdx < 0 && store.state.e.some((x) => x.d === dStr && x.k === 'a' && !x.autoAnki)) {
    return { changed: false, minutes: totalMin, cards: totalCards };
  }

  let changed = false;
  const noteStr = `${totalCards} Karten (Anki-Sync)`;
  if (totalMin > 0) {
    if (existingIdx >= 0) {
      const cur = store.state.e[existingIdx];
      if (cur.m !== totalMin || cur.ankiCards !== totalCards) {
        cur.m = totalMin;
        cur.blockMin = totalMin;
        cur.t = toTimeStr();
        cur.ankiCards = totalCards;
        cur.note = noteStr;
        cur.updatedAt = Date.now();
        store.invalidateCaches();
        changed = true;
      }
    } else {
      store.state.e.push({
        id: autoId,
        d: dStr,
        t: toTimeStr(),
        m: totalMin,
        blockMin: totalMin,
        k: 'a',
        act: 'anki',
        autoAnki: true,
        ankiCards: totalCards,
        note: noteStr,
        updatedAt: Date.now()
      });
      store.invalidateCaches();
      changed = true;
    }
  } else if (existingIdx >= 0) {
    const [removed] = store.state.e.splice(existingIdx, 1);
    if (removed?.id !== undefined) store.markDeleted(removed.id);
    store.invalidateCaches();
    changed = true;
  }

  if (changed && save) store.save();
  return { changed, minutes: totalMin, cards: totalCards };
}

export async function syncAnkiConnect() {
  const url = store.state.anki.url || 'http://127.0.0.1:8765';
  const nowTs = Date.now();

  // Seed previous deck snapshot as initial graph point if syncHistory was empty before upgrading
  if (
    (!Array.isArray(store.state.anki.syncHistory) || store.state.anki.syncHistory.length === 0) &&
    store.state.anki.lastSyncAt > 0 &&
    Array.isArray(store.state.anki.decks) &&
    store.state.anki.decks.length > 0 &&
    nowTs - store.state.anki.lastSyncAt >= 15000
  ) {
    recordAnkiSyncPoint(getAnkiLoadSummary(), store.state.anki.lastSyncAt);
  }

  // Use deckNamesAndIds so we get the FULL hierarchical path ("Studium::Werkstoffkunde") mapped to deck_id.
  const nameToId = await ankiInvoke('deckNamesAndIds', {}, url);
  const allFullNames = Object.keys(nameToId || {});
  const idToFullName = {};
  for (const fullName of allFullNames) {
    idToFullName[String(nameToId[fullName])] = fullName;
  }

  // Exclude parent/container decks that have subdecks (e.g. "Studium" when "Studium::Werkstoffkunde" exists)
  const parentFullNames = new Set();
  for (const name of allFullNames) {
    const prefix = `${name}::`;
    if (allFullNames.some((other) => other.startsWith(prefix))) {
      parentFullNames.add(name);
    }
  }

  const leafFullNames = allFullNames.filter((name) => !parentFullNames.has(name));

  const statsMap = leafFullNames.length
    ? await ankiInvoke('getDeckStats', { decks: leafFullNames }, url)
    : {};

  const decks = [];
  for (const key of Object.keys(statsMap || {})) {
    const d = statsMap[key];
    if (!d) continue;
    const fullName = idToFullName[String(d.deck_id ?? key)] || d.name || '';
    if (!fullName || parentFullNames.has(fullName)) continue;
    const parts = fullName.split('::');
    const shortName = parts[parts.length - 1];
    const group = parts.length > 1 ? parts.slice(0, -1).join(' / ') : '';

    const newCards = Number(d.new_count) || 0;
    const learnCards = Number(d.learn_count) || 0;
    const reviewCards = Number(d.review_count) || 0;
    const due = newCards + learnCards + reviewCards;
    if (fullName === 'Default' && due === 0) continue;
    decks.push({
      name: shortName,
      fullName,
      group,
      due,
      newCards,
      learnCards,
      reviewCards
    });
  }
  decks.sort((a, b) => b.due - a.due);

  // Fetch exact per-deck review durations from Anki's revlog (last 180 days, 1 batched multi call)
  if (leafFullNames.length) {
    try {
      const startID = nowTs - REVLOG_LOOKBACK_DAYS * 86400 * 1000;
      const cutoffDateStr = toDateStr(new Date(startID));
      const minKeepDateStr = toDateStr(new Date(nowTs - 365 * 86400 * 1000));
      const paceCutoffMs = nowTs - 30 * 86400 * 1000;

      const actions = leafFullNames.map((deck) => ({
        action: 'cardReviews',
        params: { deck, startID }
      }));
      const multiRes = await ankiInvoke('multi', { actions }, url);

      // Keep archived days older than the 180d lookback (up to 365d), refresh everything >= cutoffDateStr cleanly
      const nextReviewByDay = {};
      for (const [oldDay, oldVal] of Object.entries(store.state.anki.reviewByDay || {})) {
        if (oldDay >= minKeepDateStr && oldDay < cutoffDateStr && oldVal && typeof oldVal === 'object') {
          nextReviewByDay[oldDay] = oldVal;
        }
      }

      const excluded = store.state.anki.excludedDecks || [];
      let secNewSum = 0, cntNew = 0;
      let secLearnSum = 0, cntLearn = 0;
      let secRevSum = 0, cntRev = 0;

      if (Array.isArray(multiRes)) {
        multiRes.forEach((item, idx) => {
          const fullName = leafFullNames[idx];
          if (!fullName) return;
          const rows = Array.isArray(item) ? item : (Array.isArray(item?.result) ? item.result : []);
          if (!rows.length) return;

          const shortName = fullName.split('::').pop() || fullName;
          const isExcl = isAnkiDeckExcluded(fullName, shortName, excluded);
          const dayAcc = {};

          for (const row of rows) {
            if (!Array.isArray(row) || row.length < 8) continue;
            const revMs = Number(row[0]) || 0;
            if (revMs <= 0) continue;
            const durSec = Math.max(0, Math.min(180, (Number(row[7]) || 0) / 1000));
            const dStr = toDateStr(new Date(revMs));
            if (!dayAcc[dStr]) dayAcc[dStr] = { sec: 0, cards: 0 };
            dayAcc[dStr].sec += durSec;
            dayAcc[dStr].cards += 1;

            if (!isExcl && revMs >= paceCutoffMs) {
              const prevIvl = Number(row[5]) || 0;
              const revType = Number(row[8]) || 0;
              if (revType === 0 && prevIvl === 0) {
                secNewSum += durSec;
                cntNew++;
              } else if (revType === 0 || revType === 2) {
                secLearnSum += durSec;
                cntLearn++;
              } else {
                secRevSum += durSec;
                cntRev++;
              }
            }
          }

          for (const [dStr, stat] of Object.entries(dayAcc)) {
            if (!nextReviewByDay[dStr]) nextReviewByDay[dStr] = {};
            nextReviewByDay[dStr][fullName] = {
              sec: Math.round(stat.sec),
              cards: stat.cards
            };
          }
        });
      }

      store.state.anki.reviewByDay = nextReviewByDay;
      store.state.anki.paceStats = {
        secNewReal: cntNew > 0 ? Math.round(secNewSum / cntNew) : 0,
        cntNew,
        secLearnReal: cntLearn > 0 ? Math.round(secLearnSum / cntLearn) : 0,
        cntLearn,
        secRevReal: cntRev > 0 ? Math.round(secRevSum / cntRev) : 0,
        cntRev
      };
    } catch (err) {
      console.warn('AnkiConnect cardReviews optional fetch skipped:', err);
    }
  }

  store.state.anki.decks = decks;
  store.state.anki.lastSyncAt = nowTs;
  store.state.anki.updatedAt = nowTs;
  store.state.anki.mode = 'auto';

  const summary = getAnkiLoadSummary();
  recordAnkiSyncPoint(summary, nowTs);
  const autoLogged = syncDayAnkiFromRevlog(toDateStr(new Date(nowTs)), { save: false });
  store.save();

  return {
    ok: true,
    deckCount: summary.allDecks ? summary.allDecks.length : decks.length,
    filteredParents: Array.from(parentFullNames),
    totalDue: summary.totalDue,
    newCards: summary.totalNew,
    learnCards: summary.totalLearn,
    reviewCards: summary.totalReview,
    estMinutes: summary.estMinutes,
    todayRealMin: autoLogged.minutes,
    todayRealCards: autoLogged.cards
  };
}

export function toggleExcludedAnkiDeck(deckKey) {
  const clean = String(deckKey || '').trim();
  if (!clean) return;
  if (!Array.isArray(store.state.anki.excludedDecks)) store.state.anki.excludedDecks = [];
  if (!store.state.anki.excludedMeta || typeof store.state.anki.excludedMeta !== 'object') store.state.anki.excludedMeta = {};
  const idx = store.state.anki.excludedDecks.indexOf(clean);
  const nowTs = Date.now();
  if (idx >= 0) {
    store.state.anki.excludedDecks.splice(idx, 1);
    store.state.anki.excludedMeta[clean] = { excluded: false, ts: nowTs };
  } else {
    store.state.anki.excludedDecks.push(clean);
    store.state.anki.excludedMeta[clean] = { excluded: true, ts: nowTs };
  }
  store.state.anki.updatedAt = nowTs;
  syncDayAnkiFromRevlog(toDateStr(), { save: false });
  store.save();
}

export function getAnkiLoadSummary() {
  const anki = store.state.anki || {};
  const weights = getAnkiWeights();

  if (anki.mode === 'manual' || !Array.isArray(anki.decks) || !anki.decks.length) {
    const totalNew = Math.max(0, Number(anki.manualNew) || 0);
    const totalLearn = Math.max(0, Number(anki.manualLearn) || 0);
    const rawReview = anki.manualReview !== undefined ? Number(anki.manualReview) || 0 : 0;
    const totalReview = (totalNew === 0 && totalLearn === 0 && rawReview === 0 && Number(anki.manualDue) > 0)
      ? Math.max(0, Number(anki.manualDue))
      : Math.max(0, rawReview);
    const totalDue = totalNew + totalLearn + totalReview;
    const estMinutes = estimateAnkiMinutes({ newCards: totalNew, learnCards: totalLearn, reviewCards: totalReview });
    return {
      source: 'manual',
      lastSyncAt: anki.lastSyncAt || 0,
      totalNew,
      totalLearn,
      totalReview,
      totalDue,
      totalCards: totalDue,
      estMinutes,
      weights,
      decks: []
    };
  }

  const excludedSet = new Set(Array.isArray(anki.excludedDecks) ? anki.excludedDecks : []);
  const leafDecks = filterLeafAnkiDecks(anki.decks, anki.excludedDecks);

  const totalNew = leafDecks.reduce((s, d) => s + (d.newCards || 0), 0);
  const totalLearn = leafDecks.reduce((s, d) => s + (d.learnCards || 0), 0);
  const totalReview = leafDecks.reduce((s, d) => s + (d.reviewCards || 0), 0);
  const totalDue = totalNew + totalLearn + totalReview;
  const estMinutes = estimateAnkiMinutes({ newCards: totalNew, learnCards: totalLearn, reviewCards: totalReview });
  const hasLegacyDecks = anki.decks.some((d) => !d.fullName);

  return {
    source: 'ankiconnect',
    lastSyncAt: anki.lastSyncAt || 0,
    totalNew,
    totalLearn,
    totalReview,
    totalDue,
    totalCards: totalDue,
    estMinutes,
    weights,
    decks: leafDecks.filter((d) => d.due > 0).slice(0, 12),
    allDecks: leafDecks,
    excludedDecks: Array.from(excludedSet),
    hasLegacyDecks
  };
}

export function getAnkiReviewAnalytics(todayStr = toDateStr()) {
  const anki = store.state.anki || {};
  const reviewByDay = anki.reviewByDay || {};
  const excluded = anki.excludedDecks || [];
  const min7 = addDays(todayStr, -6);
  const min30 = addDays(todayStr, -29);

  let todaySec = 0, todayCards = 0;
  let weekSec = 0, weekCards = 0;
  let monthSec = 0, monthCards = 0;
  let totalSec = 0, totalCards = 0;
  const todayDecks = [];

  for (const [dStr, dayDecks] of Object.entries(reviewByDay)) {
    if (!dayDecks || typeof dayDecks !== 'object') continue;
    for (const [fullName, stat] of Object.entries(dayDecks)) {
      if (!stat) continue;
      const shortName = fullName.split('::').pop() || fullName;
      if (isAnkiDeckExcluded(fullName, shortName, excluded)) continue;
      const sec = Number(stat.sec) || 0;
      const cards = Number(stat.cards) || 0;
      if (sec <= 0 && cards <= 0) continue;

      totalSec += sec;
      totalCards += cards;
      if (dStr >= min30 && dStr <= todayStr) {
        monthSec += sec;
        monthCards += cards;
      }
      if (dStr >= min7 && dStr <= todayStr) {
        weekSec += sec;
        weekCards += cards;
      }
      if (dStr === todayStr) {
        todaySec += sec;
        todayCards += cards;
        const parts = fullName.split('::');
        todayDecks.push({
          name: shortName,
          fullName,
          group: parts.length > 1 ? parts.slice(0, -1).join(' / ') : '',
          sec,
          min: Math.max(1, Math.round(sec / 60)),
          cards
        });
      }
    }
  }

  todayDecks.sort((a, b) => b.sec - a.sec);

  return {
    hasRevlog: Object.keys(reviewByDay).length > 0,
    todayMin: Math.round(todaySec / 60),
    todaySec,
    todayCards,
    todayDecks,
    weekMin: Math.round(weekSec / 60),
    weekCards,
    monthMin: Math.round(monthSec / 60),
    monthCards,
    totalMin: Math.round(totalSec / 60),
    totalCards,
    avgSecPerCard: totalCards > 0 ? Math.round(totalSec / totalCards) : 0,
    paceStats: anki.paceStats || null,
    syncHistory: Array.isArray(anki.syncHistory) ? anki.syncHistory : []
  };
}

export function setManualAnki({ newCards, learnCards, reviewCards, secNew, secLearn, secReview }) {
  const nowTs = Date.now();
  store.state.anki.mode = 'manual';
  if (newCards !== undefined) store.state.anki.manualNew = Math.max(0, Math.round(Number(newCards) || 0));
  if (learnCards !== undefined) store.state.anki.manualLearn = Math.max(0, Math.round(Number(learnCards) || 0));
  if (reviewCards !== undefined) store.state.anki.manualReview = Math.max(0, Math.round(Number(reviewCards) || 0));
  store.state.anki.manualDue = (store.state.anki.manualNew || 0) + (store.state.anki.manualLearn || 0) + (store.state.anki.manualReview || 0);
  if (secNew !== undefined) store.state.anki.secNew = Math.max(5, Math.round(Number(secNew) || 45));
  if (secLearn !== undefined) store.state.anki.secLearn = Math.max(5, Math.round(Number(secLearn) || 30));
  if (secReview !== undefined) store.state.anki.secReview = Math.max(5, Math.round(Number(secReview) || 15));
  store.state.anki.updatedAt = nowTs;
  recordAnkiSyncPoint(getAnkiLoadSummary(), nowTs);
  store.save();
}

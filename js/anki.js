// AnkiConnect client (http://127.0.0.1:8765) + Weighted Card-Type Time Model (Blue=New, Red=Learn, Green=Review) + Option B fallback

import { store, toDateStr, toTimeStr, filterLeafAnkiDecks } from './store.js';

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

export async function syncAnkiConnect({ alsoLogStudyTime = false } = {}) {
  const url = store.state.anki.url || 'http://127.0.0.1:8765';

  // Use deckNamesAndIds so we get the FULL hierarchical path ("Studium::Werkstoffkunde") mapped to deck_id.
  // AnkiConnect's getDeckStats strips parent prefixes from d.name, which previously caused parent groups
  // like "Studium" to be double-counted alongside their subdecks!
  const nameToId = await ankiInvoke('deckNamesAndIds', {}, url);
  const allFullNames = Object.keys(nameToId || {});
  const idToFullName = {};
  for (const fullName of allFullNames) {
    idToFullName[String(nameToId[fullName])] = fullName;
  }

  // Exclude parent/container decks that have subdecks (e.g. "Studium" when "Studium::Werkstoffkunde" exists)
  const parentFullNames = new Set();
  const parentShortNames = new Set();
  for (const name of allFullNames) {
    const prefix = `${name}::`;
    if (allFullNames.some((other) => other.startsWith(prefix))) {
      parentFullNames.add(name);
      const parts = name.split('::');
      parentShortNames.add(parts[parts.length - 1]);
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
    if (!fullName) continue;
    if (parentFullNames.has(fullName)) continue;
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

  store.state.anki.decks = decks;
  store.state.anki.lastSyncAt = Date.now();
  store.state.anki.updatedAt = Date.now();
  store.state.anki.mode = 'auto';
  store.save();

  const summary = getAnkiLoadSummary();
  return {
    ok: true,
    deckCount: summary.allDecks ? summary.allDecks.length : decks.length,
    filteredParents: Array.from(parentFullNames),
    totalDue: summary.totalDue,
    newCards: summary.totalNew,
    learnCards: summary.totalLearn,
    reviewCards: summary.totalReview,
    estMinutes: summary.estMinutes
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
  store.save();
}

export function getAnkiLoadSummary() {
  const anki = store.state.anki || {};
  const weights = getAnkiWeights();

  if (anki.mode === 'manual' || !Array.isArray(anki.decks) || !anki.decks.length) {
    const totalNew = Math.max(0, Number(anki.manualNew) || 0);
    const totalLearn = Math.max(0, Number(anki.manualLearn) || 0);
    // Backwards compatibility if user previously only filled manualDue
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

  // Safety net: guard against parent::child overlap AND honor manually excluded decks (e.g. "Studium" or "Spanisch")
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

export function setManualAnki({ newCards, learnCards, reviewCards, secNew, secLearn, secReview }) {
  store.state.anki.mode = 'manual';
  if (newCards !== undefined) store.state.anki.manualNew = Math.max(0, Math.round(Number(newCards) || 0));
  if (learnCards !== undefined) store.state.anki.manualLearn = Math.max(0, Math.round(Number(learnCards) || 0));
  if (reviewCards !== undefined) store.state.anki.manualReview = Math.max(0, Math.round(Number(reviewCards) || 0));
  store.state.anki.manualDue = (store.state.anki.manualNew || 0) + (store.state.anki.manualLearn || 0) + (store.state.anki.manualReview || 0);
  if (secNew !== undefined) store.state.anki.secNew = Math.max(5, Math.round(Number(secNew) || 45));
  if (secLearn !== undefined) store.state.anki.secLearn = Math.max(5, Math.round(Number(secLearn) || 30));
  if (secReview !== undefined) store.state.anki.secReview = Math.max(5, Math.round(Number(secReview) || 15));
  store.state.anki.updatedAt = Date.now();
  store.save();
}

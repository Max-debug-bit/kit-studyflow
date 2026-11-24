// Dual-mode Gemini KI-Planer v2:
// - Includes aktuelleUhrzeit, tageszielMindestMin, energieModus, Anki fallback (minDailyAnkiMin),
//   free-day wake/start logic, separate liveReviewMinutes vs videoStudyMinutes, triggersHomework + homeworkMode,
//   custom events & per-date overrides, and reconciled open/overdue vs scheduled backlog!

import {
  store,
  toDateStr,
  toTimeStr,
  addDays,
  getMondayOfWeek,
  timeToMin,
  minToTime,
  WEEKDAYS_DE,
  parseDateStr,
  isValidIsoDate,
  isValidTimeStr
} from './store.js';
import { getAnkiLoadSummary } from './anki.js';
import {
  applyParsedChecklist,
  parseTextChecklistPlan,
  getDayLectures,
  reconcileBacklogStatus
} from './checklist.js';

export const AVAILABLE_MODELS = [
  { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash (Empfohlen · Free Tier)' },
  { id: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash (Schnell · Free Tier)' },
  { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash Lite (Ultra-schnell)' },
  { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash (Stabil · Free Tier)' },
  { id: 'gemini-flash-latest', label: 'Gemini Flash Latest (Auto)' },
  { id: 'gemini-pro-latest', label: 'Gemini Pro Latest (Starkes Reasoning)' },
  { id: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro Preview' }
];

const FALLBACK_CHAIN = ['gemini-3.8-flash', 'gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-2.5-flash', 'gemini-flash-latest', 'gemini-pro-latest'];
const deadModelsSession = new Set();

function extractAllJsonBlocks(text) {
  if (!text) return [];
  const blocks = [];
  const re = /```(?:json)?\s*([\s\S]*?)```/gi;
  let m;
  while ((m = re.exec(text)) !== null) {
    const candidate = (m[1] || '').trim();
    if (candidate.startsWith('{') && candidate.endsWith('}')) {
      blocks.push(candidate);
    }
  }
  if (!blocks.length) {
    const trimmed = text.trim();
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      blocks.push(trimmed);
    } else {
      const first = trimmed.indexOf('{');
      const last = trimmed.lastIndexOf('}');
      if (first >= 0 && last > first) blocks.push(trimmed.slice(first, last + 1));
    }
  }
  return blocks;
}

function isDailyAnkiReviewDuplicate(it) {
  const title = String(it?.title || '').trim();
  const isCreation = /erstellen|nachholen|schreiben|anlegen|neue.*karte/i.test(title);
  if (isCreation) return false;
  if (it?.kind === 'a') return true;
  if (/^\s*(?:tägliche?\s+)?anki(?:[\s-]*reviews?)?(?:\s*\([^)]*\))?\s*$/i.test(title)) return true;
  return false;
}

export function buildPlanningContext(weekOffset = 0) {
  const now = new Date();
  const todayStr = toDateStr(now);
  const nowTimeStr = toTimeStr(now);
  const mondayStr = addDays(getMondayOfWeek(todayStr), weekOffset * 7);
  const sundayStr = addDays(mondayStr, 6);

  // Reconcile backlog so open / overdue / scheduled are 100% up to date
  reconcileBacklogStatus({ todayStr });

  const stats = store.getOverallStats();
  const anki = getAnkiLoadSummary();
  const todayBreak = store.getDayBreakdown(todayStr);
  const minDailyAnki = Math.max(10, Number(store.state.anki.minDailyAnkiMin) || 30);
  const ankiSyncedToday = Boolean(anki.lastSyncAt && toDateStr(new Date(anki.lastSyncAt)) === todayStr);
  const ankiDoneToday = store.isAnkiDoneDay(todayStr, anki.totalDue);
  const todayAnkiRemainingMin = ankiDoneToday
    ? 0
    : (anki.totalDue > 0
        ? Math.max(0, Math.min(minDailyAnki, anki.estMinutes) - todayBreak.a)
        : (todayBreak.a > 0 || ankiSyncedToday ? 0 : minDailyAnki));

  const prefs = store.state.planningPrefs || {};
  const defaultWakeFreeDay = prefs.defaultWakeFreeDay || '10:00';
  const freeDayStartOffsetMin = Number(prefs.freeDayStartOffsetMin ?? 45);
  const freeDayEarliestStart = minToTime(timeToMin(defaultWakeFreeDay) + freeDayStartOffsetMin);

  const moduleRules = Object.values(store.state.modules).map((m) => ({
    id: m.id,
    shortName: m.shortName,
    type: m.type,
    attendance: m.attendance, // live | video | skip
    liveReviewMinutes: m.liveReviewMinutes ?? 0,
    videoStudyMinutes: m.videoStudyMinutes ?? 0,
    createsAnki: Boolean(m.createsAnki),
    triggersHomework: Boolean(m.triggersHomework),
    homeworkMode: m.triggersHomework ? (m.homeworkMode || 'understanding') : null,
    ankiDeck: m.ankiDeck || '',
    notes: m.notes || ''
  }));

  // Collect all uni events for the 7 days (WebCal + custom events + per-date overrides!)
  const weekUni = [];
  for (let i = 0; i < 7; i++) {
    const d = addDays(mondayStr, i);
    const wd = WEEKDAYS_DE[parseDateStr(d).getDay()];
    for (const l of getDayLectures(d, now)) {
      if (l.cancelled) continue;
      weekUni.push({
        d,
        weekday: wd,
        start: l.start,
        end: l.end,
        shortName: l.shortName,
        attendance: l.mode, // live | video
        terminTyp: l.effectiveType, // lecture | exercise | workshop
        liveReviewMinutes: l.mode === 'live' ? l.liveReviewMinutes : 0,
        videoStudyMinutes: l.mode === 'video' ? l.videoStudyMinutes : 0,
        createsAnki: l.createsAnki,
        triggersHomework: l.triggersHomework,
        homeworkMode: l.triggersHomework ? l.homeworkMode : null,
        location: l.location || ''
      });
    }
  }

  // Split backlog into re-schedulable (open + overdue) vs already actively scheduled
  const offenerRueckstand = (store.state.backlog || [])
    .filter((b) => b.status === 'open' || b.status === 'overdue')
    .map((b) => ({
      backlogId: b.id,
      title: b.title,
      kind: b.kind,
      estMin: b.estMin,
      status: b.status,
      ...(b.status === 'overdue' && b.scheduledDate ? { ueberfaelligSeit: b.scheduledDate } : {})
    }));

  const eingeplanterRueckstand = (store.state.backlog || [])
    .filter((b) => b.status === 'scheduled')
    .map((b) => ({
      backlogId: b.id,
      title: b.title,
      eingeplantAm: b.scheduledDate
    }));

  const currentChecklist = (store.state.checklist || [])
    .filter((c) => c.d >= mondayStr && c.d <= sundayStr)
    .map((c) => ({
      d: c.d,
      timeLabel: c.timeLabel,
      title: c.title,
      kind: c.kind,
      done: c.done,
      ...(c.backlogId ? { backlogId: c.backlogId } : {})
    }));

  const openTasks = store.state.tasks
    .filter((t) => !t.done)
    .map((t) => ({ title: t.title, due: t.due, estMinutes: t.estMinutes }));

  const calibration = store.getCalibrationSummary();
  const load7d = store.getLoadSummary7d(todayStr);
  const subjectBalance = store.getSubjectBalance();
  const patterns = store.getPersonalPatterns(todayStr);

  return {
    heute: todayStr,
    aktuelleUhrzeit: nowTimeStr,
    planWoche: `${mondayStr} bis ${sundayStr}`,
    energieModus: store.state.ai.energyMode || 'normal', // reset | normal | fokus
    studienProfil: store.state.ai.studyNotes,
    weicheRhythmusOrientierung: store.state.ai.rhythmNotes || '',
    tagesRhythmus: {
      aufwachzeitFreieTage: defaultWakeFreeDay,
      fruehesterLernstartFreieTage: freeDayEarliestStart,
      standardEinschlafzeit: store.state.sl || '23:00',
      sonntagFreiAusserAnki: Boolean(prefs.sundayFree !== false)
    },
    fokusStatistik: {
      tageszielMindestMin: store.state.goal,
      heuteSchonGelerntMin: todayBreak.learnTotal,
      heuteAnkiMin: todayBreak.a,
      heuteVorlesungMin: todayBreak.p,
      durchschnittAktiveTageMin: Math.round(stats.avgActive),
      belastung7TageStunden: Number(load7d.total7Hours.toFixed(1)),
      tageOhnePauseInFolge: load7d.consecutiveDays,
      kapazitaetNachUniLast: {
        freieTageAvgMin: patterns.capacityByUniLoad.freeDaysAvgMin,
        tageMit1Bis2VLAvgMin: patterns.capacityByUniLoad.mediumUniAvgMin,
        volleUniTage3PlusVLAvgMin: patterns.capacityByUniLoad.heavyUniAvgMin
      }
    },
    fachBalance: subjectBalance.map((s) => ({
      fach: s.subject,
      bisherigeLernzeitMin: s.learnMin,
      offenerRueckstandAnzahl: s.openBacklog,
      checklisteErledigt: `${s.chkDone}/${s.chkTotal}`,
      ankiOffen: s.ankiTotal
    })),
    lernHistorieFuerKI: {
      letzteLernSessions: calibration.recentSessions,
      echteP75ZeitenProFach: calibration.byModule.map((x) => ({
        fach: x.fach,
        taetigkeit: x.taetigkeit,
        anzahlSessions: x.anzahl,
        p75ZielMin: x.p75Min,
        echterSchnittMin: x.echterSchnittMin,
        hinterlegteRegelMin: x.regelMin
      }))
    },
    ankiStatus: {
      quelle: anki.source,
      letzterSyncHeute: ankiSyncedToday,
      ankiFuerHeuteAbgehakt: ankiDoneToday,
      heuteBereitsGeloeggtMin: todayBreak.a,
      neueKartenBlau: anki.totalNew,
      lernKartenRot: anki.totalLearn,
      faelligeKartenGruen: anki.totalReview,
      faelligeKartenGesamt: anki.totalDue,
      gewichteSekunden: anki.weights,
      alleFaelligenKartenMin: anki.estMinutes,
      heuteNochOffenBerechnetMin: todayAnkiRemainingMin,
      taeglicherZeitpufferFolgetageMin: minDailyAnki,
      aktiveDecks: (anki.decks || []).filter((d) => (d.due || 0) > 0),
      planungsRegel: 'Tägliche Anki-Reviews werden NICHT als normale Todo-Punkte in items geplant. Wichtig: Der Student macht NICHT zwingend jeden Tag ALLE fälligen Karten! Wenn ankiFuerHeuteAbgehakt === true, sind heute 0 Min. Anki mehr offen (egal wie viele Karten noch in Anki liegen). Sonst ein realistisches Tagespensum im Budget reservieren (orientiert an taeglicherZeitpufferFolgetageMin bzw. alleFaelligenKartenMin wenn kleiner).'
    },
    modulRegeln: moduleRules,
    aufgabenKatalog: store.getCalibratedTaskCatalog().map((c) => ({
      catalogId: c.id,
      fach: c.subject,
      titel: c.title,
      taetigkeit: c.act,
      aktiveDauerMin: c.effectiveMin,
      startWertMin: c.defaultMin,
      echteSessions: c.sampleCount,
      automatischKalibriert: c.calibrated,
      kalibrierungsModus: c.calibrated ? 'P75 (oberes Ende gegen Zeitdruck)' : 'Startwert',
      notiz: c.notes
    })),
    uniTermineDieseWoche: weekUni,
    offenerRueckstand,
    eingeplanterRueckstand,
    aktuelleCheckliste: currentChecklist,
    vorgemerkteTermine: (store.state.reminders || []).filter((r) => !r.done).map((r) => r.text),
    offeneAbgaben: openTasks
  };
}

export function buildSystemInstruction() {
  return `Du bist ein präziser, ruhiger Studien-Planer für einen Maschinenbau-Studenten am KIT.
Antworte auf Deutsch, klar, ohne Emojis und ohne unnötige Floskeln.

Halte dich strikt an diese 7 Regeln und nutze jedes Feld aus dem JSON-Kontext gezielt:

1. ZEIT & REALITÄT (aktuelleUhrzeit & tagesRhythmus):
   - Plane für "heute" KEINE Zeitfenster, die vor "aktuelleUhrzeit" liegen.
   - An Tagen ohne frühen Uni-Termin startet das Lernen frühestens ab "tagesRhythmus.fruehesterLernstartFreieTage" (~45 Min. nach "aufwachzeitFreieTage").
   - Plane realistischen Feierabend deutlich vor "standardEinschlafzeit"; nach sehr langen Uni-Tagen (z. B. bis 18:00/19:00) abends möglichst frei lassen.
   - Wenn "sonntagFreiAusserAnki" true ist, bleibt Sonntag außer Anki-Reviews frei (maximal Notfall-Puffer).

2. ENERGIE-MODUS & MINDESTZIEL (tageszielMindestMin & energieModus):
   - "tageszielMindestMin" ist ein tägliches MINDESTZIEL (Streak), KEIN Tagesmaximum! Ein 150–180-Min.-Video ist völlig normal und erwünscht.
   - Passe das Tagespensum an Uni-Last, "heuteSchonGelerntMin" und "energieModus" an:
     * "reset": leicht (~1,5–3 h), niedrige Einstiegshürde, passiv vor aktiv, viel Puffer.
     * "normal": stabiler KIT-Rhythmus (~2,5–4,5 h an freien Tagen, ~1–2,5 h an vollen Uni-Tagen).
     * "fokus": hohes Pensum (~4–6 h an freien Tagen, ~2–3,5 h an Uni-Tagen).

3. ANKI-ZEITBUDGET (DYNAMISCH ÜBER TÄGLICHEN ANKI-SYNC – SEHR WICHTIG!):
   - Plane KEINE eigenen „Anki-Reviews“-Checklisten-Punkte ("kind": "a") in "items"! Die App zeigt Anki dynamisch oben auf „Heute“ mit eigenem Abhaken an.
   - Wichtig: Der Student macht NICHT jeden Tag zwingend alle fälligen Anki-Karten (bei großem Rückstau macht er oft nur ein realistisches Tagespensum und hakt Anki für heute ab).
   - Reserviere die Anki-Zeit dennoch ZWINGEND im täglichen Zeitbudget, damit kein Tag überplant wird:
     * HEUTE: Wenn "ankiStatus.ankiFuerHeuteAbgehakt" true ist → 0 Min. mehr für heute reservieren (auch wenn noch Karten in Anki liegen!). Wenn false → realistisches Budget reservieren (orientiert an "taeglicherZeitpufferFolgetageMin" bzw. "alleFaelligenKartenMin", falls kleiner).
     * FOLGETAGE (Di–So): Ziehe pauschal "ankiStatus.taeglicherZeitpufferFolgetageMin" (z. B. 30 Min.) pro Tag als Zeitpuffer vom Tagesbudget ab.
     * Nenne in deiner kurzen Erklärung vor dem JSON explizit, wie viel Anki-Zeit du heute und an den Folgetagen im Budget reserviert hast!
   - Hinweis: Das *Erstellen* neuer Anki-Karten nach einer Vorlesung (z. B. „WK: VL nacharbeiten + Ankis erstellen“) bleibt ein normaler Lern-Punkt ("kind": "l") – nur das tägliche *Durchgehen* der fälligen Reviews läuft dynamisch über den Anki-Sync.
   - Falls "weicheRhythmusOrientierung" gefüllt ist, nutze sie als lockere, flexible Leitlinie (niemals starr, wenn aktuelle Termine oder Energie dagegen sprechen).

4. VORLESUNGEN, ÜBUNGEN, VIDEOS & HAUSAUFGABEN (uniTermineDieseWoche & modulRegeln):
   - Richte dich IMMER exakt nach den Werten "liveReviewMinutes", "videoStudyMinutes" und "createsAnki" in "uniTermineDieseWoche" / "modulRegeln" — auch bei Übungen!
   - "terminTyp: exercise" oder "workshop": Wenn "liveReviewMinutes: 0" und "createsAnki: false", ist KEINE Nacharbeit nötig. Wenn der Student aber explizit "liveReviewMinutes > 0" (z. B. 45 Min. bei HM I (Ü)) eingestellt hat, plane diese Nacharbeit ZWINGEND mit ein!
   - "attendance: live": Student besucht den Termin (wird automatisch als Vorlesungszeit verbucht). Wenn "liveReviewMinutes > 0" oder "createsAnki: true", plane zeitnah einen Nacharbeits-Block (~liveReviewMinutes) ein.
   - "attendance: video": Student geht NICHT hin -> Terminzeit ist frei! Plane stattdessen das Nachschauen & Durcharbeiten (~videoStudyMinutes bzw. aus "aufgabenKatalog") in ein passendes Zeitfenster.
   - Wenn "triggersHomework: true": Nach dieser Übung fällt eine neue Hausaufgabe an. Bei "homeworkMode: understanding" gilt: reine Verständnis-Bearbeitung OHNE harte Abgabe-Panik (andere geben ab) – entspannt in den nächsten Tagen als eigenen Checklisten-Punkt einplanen.

5. AUFGABEN-KATALOG & SELBST-KALIBRIERUNG (aufgabenKatalog):
   - Wähle nach Möglichkeit direkt passende Bausteine aus "aufgabenKatalog" aus! Nutze deren "aktiveDauerMin" als realistische "estMin" (ab 2 echten Sessions bereits automatisch an die echten Zeiten des Studenten kalibriert!) und gib die exakte "catalogId" im Item zurück.
   - Du darfst bestehende Katalog-Bausteine NIEMALS löschen oder umbenennen.
   - Falls dir für eine wiederkehrende Aufgabenart ein passender Baustein im Katalog fehlt (z. B. Labor-Vorbereitung oder CAD-Aufgabe), kannst du ihn optional in "newCatalogItems" vorschlagen (die App fügt nur neue Einträge hinzu).

6. OFFENER RÜCKSTAND & LERNHISTORIE (offenerRueckstand, eingeplanterRueckstand, lernHistorieFuerKI):
   - Plane Punkte aus "offenerRueckstand" (Status "open" oder "overdue") sinnvoll mit ein und gib bei diesen Punkten EXAKT deren "backlogId" aus dem JSON zurück!
   - Erfinde NIEMALS eine "backlogId", die nicht in "offenerRueckstand" oder "eingeplanterRueckstand" steht (sonst "backlogId": "").
   - Punkte in "eingeplanterRueckstand" NICHT doppelt einplanen, außer du ersetzt ihren bisherigen Tag über "replaceDates".
   - Nutze "lernHistorieFuerKI.letzteLernSessions" (was konkret zuletzt gelernt wurde), "echteP75ZeitenProFach" (oberes Ende gegen Zeitdruck), "fokusStatistik.kapazitaetNachUniLast" (echte Kapazität an freien vs. vollen Uni-Tagen) und "fachBalance" (vernachlässigte Fächer gezielt ausgleichen), um Blocklängen und Fach-Prioritäten realistisch anzusetzen.

7. FORMAT & ZEIT-HINWEISE:
   - Nutze "timeLabel" nur dort, wo Lücken zwischen Uni-Terminen oder Startzeiten sinnvoll sind (z. B. "10:45", "Ab 15:30", "11:15–14:00"), sonst "" lassen.
   - Halte "dayNotes" knapp anhand der echten Zeiten aus "uniTermineDieseWoche" (z. B. "Uni 09:45–15:30" oder "Start ~10:45 · MKL 14:00").
   - Wenn du einen Plan vorschlägst, gib nach einer kurzen Erklärung exakt diesen JSON-Block aus:
\`\`\`json
{
  "summary": "Kurze Beschreibung des Plans",
  "replaceDates": ["YYYY-MM-DD"],
  "dayNotes": {
    "YYYY-MM-DD": "Knapper Tages-Hinweis"
  },
  "items": [
    {
      "d": "YYYY-MM-DD",
      "timeLabel": "",
      "title": "WK: VL nacharbeiten + Ankis erstellen",
      "kind": "l",
      "estMin": 75,
      "catalogId": "cat_wk_vl",
      "backlogId": ""
    }
  ],
  "reminders": [],
  "newCatalogItems": []
}
\`\`\`
Wichtig: Übernimm existierende "vorgemerkteTermine" nicht doppelt in "reminders" – trag in "reminders" nur NEUE Sondertermine ein. In "newCatalogItems" nur echte NEUE Baustein-Typen (Format: {"subject":"Fach","title":"Name","act":"review|video|homework|exam|","defaultMin":60,"notes":"..."}), sonst [] lassen.`;
}

export function extractProposalFromReply(text) {
  if (!text) return null;
  const jsonBlocks = extractAllJsonBlocks(text);

  if (jsonBlocks.length) {
    let summary = '';
    const replaceDatesSet = new Set();
    const dayNotes = {};
    const items = [];
    const reminders = [];
    const newCatalogItems = [];
    let suggestedRhythm = '';
    let filteredAnkiCount = 0;
    let rejectedDateCount = 0;
    let parsedAny = false;

    for (const jsonStr of jsonBlocks) {
      let parsed;
      try { parsed = JSON.parse(jsonStr); } catch { continue; }
      if (!parsed || typeof parsed !== 'object') continue;
      parsedAny = true;

      if (parsed.summary && !summary) summary = String(parsed.summary).trim();
      if (parsed.suggestedRhythmNote && !suggestedRhythm) {
        suggestedRhythm = String(parsed.suggestedRhythmNote).trim();
      }

      if (Array.isArray(parsed.replaceDates)) {
        for (const d of parsed.replaceDates) {
          const ds = String(d || '').slice(0, 10);
          if (isValidIsoDate(ds)) replaceDatesSet.add(ds);
          else if (ds) rejectedDateCount++;
        }
      }

      if (parsed.dayNotes && typeof parsed.dayNotes === 'object') {
        for (const [d, note] of Object.entries(parsed.dayNotes)) {
          const ds = String(d || '').slice(0, 10);
          if (isValidIsoDate(ds) && note) dayNotes[ds] = String(note).trim();
        }
      }

      const rawItems = Array.isArray(parsed.items)
        ? parsed.items
        : Array.isArray(parsed.blocks)
          ? parsed.blocks.map((b) => ({
              d: b.d,
              timeLabel: b.start ? `${b.start}${b.end ? `–${b.end}` : ''}` : '',
              title: b.title,
              kind: b.kind === 'a' ? 'a' : b.kind === 'p' ? 'p' : 'l',
              estMin: 45,
              catalogId: b.catalogId || '',
              backlogId: b.backlogId || ''
            }))
          : [];

      for (const it of rawItems) {
        if (!it || !it.title) continue;
        const dStr = String(it.d || '').slice(0, 10);
        if (!isValidIsoDate(dStr)) {
          rejectedDateCount++;
          continue;
        }
        const normalized = {
          d: dStr,
          timeLabel: String(it.timeLabel || '').trim(),
          title: String(it.title).trim(),
          kind: ['l', 'a', 'p'].includes(it.kind) ? it.kind : (/\banki/i.test(it.title) ? 'a' : 'l'),
          estMin: Math.max(0, Number(it.estMin) || 0),
          catalogId: String(it.catalogId || '').trim(),
          backlogId: String(it.backlogId || '').trim()
        };
        if (isDailyAnkiReviewDuplicate(normalized)) {
          filteredAnkiCount++;
          continue;
        }
        items.push(normalized);
      }

      if (Array.isArray(parsed.reminders)) {
        for (const r of parsed.reminders) {
          const txt = typeof r === 'string' ? r.trim() : String(r?.text || '').trim();
          if (txt) reminders.push(txt);
        }
      }

      if (Array.isArray(parsed.newCatalogItems)) {
        for (const c of parsed.newCatalogItems) {
          if (!c || !c.title) continue;
          newCatalogItems.push({
            subject: String(c.subject || c.fach || 'Allgemein').trim(),
            title: String(c.title).trim(),
            act: ['video', 'review', 'homework', 'exam', ''].includes(c.act) ? c.act : '',
            kind: ['l', 'p'].includes(c.kind) ? c.kind : 'l',
            defaultMin: Math.max(10, Math.min(480, Math.round(Number(c.defaultMin || c.estMin) || 60))),
            notes: String(c.notes || c.notiz || '').trim()
          });
        }
      }
    }

    if (parsedAny && (items.length || reminders.length || newCatalogItems.length || suggestedRhythm || replaceDatesSet.size)) {
      return {
        summary: summary || (suggestedRhythm && !items.length ? 'Wochenrückblick & Rhythmus' : 'Uni-Plan Checkliste'),
        replaceDates: Array.from(replaceDatesSet),
        dayNotes,
        items,
        reminders,
        newCatalogItems,
        suggestedRhythm,
        filteredAnkiCount,
        rejectedDateCount
      };
    }
  }

  const textParsed = parseTextChecklistPlan(text);
  const validTextItems = [];
  let filteredAnkiCount = 0;
  let rejectedDateCount = 0;
  for (const it of (textParsed.items || [])) {
    if (!isValidIsoDate(it.d)) { rejectedDateCount++; continue; }
    if (isDailyAnkiReviewDuplicate(it)) { filteredAnkiCount++; continue; }
    validTextItems.push(it);
  }
  if (validTextItems.length || textParsed.reminders.length) {
    return {
      summary: 'Erkannter Checklisten-Plan',
      replaceDates: [],
      dayNotes: textParsed.dayNotes,
      items: validTextItems,
      reminders: textParsed.reminders.map((r) => r.text),
      newCatalogItems: [],
      suggestedRhythm: '',
      filteredAnkiCount,
      rejectedDateCount
    };
  }
  return null;
}

export function stripJsonBlock(text) {
  return (text || '').replace(/```json[\s\S]*?```/gi, '').replace(/```\s*\{[\s\S]*?\}\s*```/gi, '').trim();
}

export function buildAuditInstruction() {
  return `${buildSystemInstruction()}

---
SPEZIAL-MODUS: STRENGER KONTROLLEUR (PLAN-AUDIT)
Prüfe "aktuelleCheckliste" zusammen mit "uniTermineDieseWoche", "offenerRueckstand", "tagesRhythmus", "ankiStatus" und "lernHistorieFuerKI" mit kritischem Blick:
1. Harte Fehler: Überschneidungen mit Live-Uni-Terminen, Zeitfenster auf "heute" vor "aktuelleUhrzeit", Start vor "fruehesterLernstartFreieTage", oder vergessene offene/überfällige Rückstände.
2. Überlastungs-Fallen: Wurde das tägliche Anki-Zeitbudget (heute: "heuteNochOffenBerechnetMin", Folgetage: "taeglicherZeitpufferFolgetageMin") im Tagesbudget mitgedacht (ohne eigene Anki-Review-Todos in "items" zu erzeugen)? Tage mit zu vielen schweren Nacharbeiten auf einmal, fehlende Pausen bei langen Uni-Tagen, verplanter Sonntag (falls "sonntagFreiAusserAnki" true), oder unrealistische Zeiten im Vergleich zu "echteP75ZeitenProFach".
3. Formuliere zuerst maximal 5 knappe, direkte Kritikpunkte (ohne Emojis, klar nummeriert).
4. Hänge danach DIREKT den korrigierten JSON-Planblock im exakt vorgegebenen Format an (mit "summary": "Korrigierter Plan nach Audit" und passenden "replaceDates"), damit der Student alle Schwachstellen mit 1 Klick fixen kann.`;
}

export function buildAuditBridgePrompt(weekOffset = 0) {
  const ctx = buildPlanningContext(weekOffset);
  return `${buildAuditInstruction()}

---
AKTUELLER KONTEXT (JSON):
${JSON.stringify(ctx, null, 2)}

---
AUFTRAG:
Prüfe meinen aktuellen Wochenplan streng auf Fehler, Lücken und Überlastungs-Fallen (inkl. Anki-Zeitbudget) und gib mir direkt die korrigierte Version.`;
}

export async function runPlanAudit(weekOffset = 0) {
  const apiKey = (store.state.ai.apiKey || '').replace(/\s+/g, '');
  if (!apiKey) {
    throw new Error('Kein Gemini API-Key hinterlegt. Trage ihn unter Einstellungen ein oder nutze „Audit-Prompt kopieren“.');
  }

  const ctx = buildPlanningContext(weekOffset);
  const sys = buildAuditInstruction();
  const contents = [{
    role: 'user',
    parts: [{
      text: `Aktueller Kontext:\n${JSON.stringify(ctx)}\n\nPrüfe meinen aktuellen Wochenplan als strenger Kontrolleur auf Fehler, Lücken und Überlastung und liefere direkt den korrigierten Plan.`
    }]
  }];

  const preferred = store.state.ai.model || 'gemini-3.8-flash';
  const result = await callGeminiWithFallback({ apiKey, preferred, contents, systemInstruction: sys });
  const proposal = extractProposalFromReply(result.text);
  return {
    rawText: result.text,
    displayText: stripJsonBlock(result.text) || (proposal ? proposal.summary : result.text),
    proposal,
    modelUsed: result.modelUsed,
    usedFallback: result.modelUsed !== preferred
  };
}

export function buildWeeklyReviewContext(weekOffset = 0) {
  const ctx = buildPlanningContext(weekOffset);
  const todayStr = toDateStr();
  const last7Start = addDays(todayStr, -6);

  const last7Checklist = (store.state.checklist || [])
    .filter((c) => c.d >= last7Start && c.d <= todayStr)
    .map((c) => ({ d: c.d, title: c.title, kind: c.kind, done: c.done }));

  const doneCnt = last7Checklist.filter((c) => c.done).length;
  const openCnt = last7Checklist.filter((c) => !c.done).length;

  return {
    ...ctx,
    wochenRueckblickZeitraum: `${last7Start} bis ${todayStr}`,
    checklisteLetzte7Tage: {
      erledigt: doneCnt,
      offen: openCnt,
      eintraege: last7Checklist
    }
  };
}

export function buildWeeklyReviewInstruction() {
  return `Du bist ein ruhiger, ehrlicher Studien-Coach für einen Maschinenbau-Studenten am KIT.
Antworte auf Deutsch, ohne Emojis, direkt und konstruktiv.

Aufgabe: Erstelle einen kurzen, nützlichen Wochenrückblick auf Basis der letzten 7 Tage (Checkliste, "letzteLernSessions", "echteP75ZeitenProFach", Belastung und aktuelle "weicheRhythmusOrientierung"):
1. Gib exakt 4–5 knappe Stichpunkte:
   - Was lief richtig gut?
   - Was blieb liegen oder hat deutlich länger gedauert als gedacht?
   - Belastungs-Check (Akku / Pausen).
   - 1–2 konkrete, lockere Ideen, wie wir die kommende Woche noch besser an deinen echten Rhythmus anpassen können (nicht starr, sondern als Vorschlag zum gemeinsamen Diskutieren!).
2. Hänge am Ende einen kleinen JSON-Block an, falls du eine aktualisierte, lockere Formulierung für "weicheRhythmusOrientierung" vorschlagen möchtest (der Student kann das diskutieren oder mit 1 Klick übernehmen):
\`\`\`json
{
  "suggestedRhythmNote": "Knappe, flexible Lern-Orientierung (max. 2-3 Sätze, z. B. was gut funktioniert hat und wo lieber Luft bleiben sollte)"
}
\`\`\``;
}

export function buildWeeklyReviewBridgePrompt(weekOffset = 0) {
  const ctx = buildWeeklyReviewContext(weekOffset);
  return `${buildWeeklyReviewInstruction()}

---
WOCHENDATEN (JSON):
${JSON.stringify(ctx, null, 2)}

---
AUFTRAG:
Gib mir meinen kurzen Wochenrückblick und schlag mir 1–2 lockere Rhythmus-Anpassungen zum Diskutieren vor.`;
}

export function extractRhythmSuggestion(text) {
  if (!text) return '';
  for (const jsonStr of extractAllJsonBlocks(text)) {
    try {
      const parsed = JSON.parse(jsonStr);
      const note = String(parsed?.suggestedRhythmNote || '').trim();
      if (note) return note;
    } catch { /* try next JSON block */ }
  }
  return '';
}

export async function runWeeklyReview(weekOffset = 0) {
  const apiKey = (store.state.ai.apiKey || '').replace(/\s+/g, '');
  if (!apiKey) {
    throw new Error('Kein Gemini API-Key hinterlegt. Nutze unten „Rückblick-Prompt“ in der Gemini-Pro-Bridge.');
  }
  const ctx = buildWeeklyReviewContext(weekOffset);
  const sys = buildWeeklyReviewInstruction();
  const contents = [{
    role: 'user',
    parts: [{ text: `Wochendaten:\n${JSON.stringify(ctx)}\n\nErstelle meinen kompakten Wochenrückblick und lass uns meinen Rhythmus für nächste Woche gemeinsam verfeinern.` }]
  }];

  const preferred = store.state.ai.model || 'gemini-3.8-flash';
  const result = await callGeminiWithFallback({ apiKey, preferred, contents, systemInstruction: sys });
  const suggestedRhythm = extractRhythmSuggestion(result.text);
  return {
    rawText: result.text,
    displayText: stripJsonBlock(result.text) || result.text,
    suggestedRhythm,
    modelUsed: result.modelUsed,
    usedFallback: result.modelUsed !== preferred
  };
}

// ---------- Multimodal Semesterplan Image Scanner (API + Gemini-Pro-Bridge!) ----------

export function buildSemesterScanSystemInstruction() {
  return `Du liest Universitäts-Semesterpläne (z. B. KIT MKL-Semesterplan mit Vorlesungen, Übungen, Workshops) aus Bildern sehr präzise aus.
Antworte AUSSCHLIESSLICH mit einem validen JSON-Codeblock in exakt diesem Format:
\`\`\`json
{
  "summary": "Kurze Zusammenfassung was erkannt wurde",
  "overrides": [
    {
      "d": "YYYY-MM-DD",
      "matchModule": "MKL",
      "overrideType": "exercise",
      "label": "Visualisierung 1 Ü"
    }
  ],
  "customEvents": [
    {
      "title": "MKL-Workshop (Block 4)",
      "date": "2026-12-02",
      "start": "14:00",
      "end": "15:30",
      "eventType": "workshop"
    }
  ],
  "reminders": [
    "MKL-Workshop (Block 4): Mi 14:00–15:30 am 02.12., 13.01. & 03.02."
  ]
}
\`\`\`
Regeln:
- "overrideType" darf nur "exercise" (Übung, keine Nacharbeit), "lecture" (Vorlesung, mit Nacharbeit) oder "cancelled" (fällt aus/Feiertag) sein.
- "matchModule" ist das kurze Fach-Stichwort zum Zuordnen im WebCal (z. B. "MKL", "HM", "WK", "TM", "FT").
- Achte genau auf Jahreswechsel (passend zum aktuellen Datum ${toDateStr()}).
- "customEvents": einmalige Zusatztermine wie Workshops mit konkretem Datum, Start- und Endzeit.`;
}

export function buildSemesterScanBridgePrompt(userHint = '') {
  const modulesList = Object.values(store.state.modules).map((m) => m.shortName).join(', ');
  return `${buildSemesterScanSystemInstruction()}

---
KONTEXT:
Bekannte Module im Kalender: ${modulesList || 'MKL, HM, TM, WK, FT'}.
Aktuelles Datum: ${toDateStr()}.
Zusatzhinweis des Studenten: ${userHint || 'Keine besonderen Hinweise.'}

AUFTRAG:
Ich hänge dir jetzt das Bild / den Screenshot meines Semesterplans an. Lies bitte alle erkennbaren Termine (Vorlesung vs. Übung vs. Ausfall sowie Workshops/Sondertermine) präzise in das JSON-Schema oben aus.`;
}

export function parseSemesterScanReply(rawText, modelUsed = 'Gemini Pro (Bridge)') {
  const txt = String(rawText || '').trim();
  if (!txt) throw new Error('Bitte zuerst die JSON-Antwort von Gemini einfügen.');
  const blocks = extractAllJsonBlocks(txt);
  let parsed = null;
  for (const b of blocks) {
    try {
      const cand = JSON.parse(b);
      if (cand && typeof cand === 'object') { parsed = cand; break; }
    } catch { /* try next */ }
  }
  if (!parsed) throw new Error('Kein gültiges JSON erkannt.');

  let rejectedCount = 0;
  const overrides = [];
  for (const o of (Array.isArray(parsed.overrides) ? parsed.overrides : [])) {
    const dStr = String(o?.d || '').slice(0, 10);
    const type = String(o?.overrideType || '').trim();
    if (!isValidIsoDate(dStr) || !['exercise', 'lecture', 'cancelled'].includes(type)) {
      rejectedCount++;
      continue;
    }
    overrides.push({
      d: dStr,
      matchModule: String(o.matchModule || '').trim(),
      overrideType: type,
      label: String(o.label || '').trim()
    });
  }

  const customEvents = [];
  for (const ev of (Array.isArray(parsed.customEvents) ? parsed.customEvents : [])) {
    const title = String(ev?.title || '').trim();
    const dStr = String(ev?.date || '').slice(0, 10);
    if (!title || !isValidIsoDate(dStr)) {
      rejectedCount++;
      continue;
    }
    const start = isValidTimeStr(ev.start) ? ev.start.trim() : '14:00';
    const end = isValidTimeStr(ev.end) ? ev.end.trim() : '15:30';
    customEvents.push({
      title,
      date: dStr,
      start,
      end,
      eventType: ['lecture', 'exercise', 'workshop'].includes(ev.eventType) ? ev.eventType : 'workshop',
      location: String(ev.location || '').trim()
    });
  }

  const reminders = Array.isArray(parsed.reminders)
    ? parsed.reminders.map((r) => String(typeof r === 'string' ? r : r?.text || '').trim()).filter(Boolean)
    : [];

  return {
    summary: parsed.summary || 'Semesterplan erkannt',
    overrides,
    customEvents,
    reminders,
    rejectedCount,
    modelUsed
  };
}

export async function scanSemesterPlanImage({ base64Data, mimeType, userHint = '' }) {
  const apiKey = (store.state.ai.apiKey || '').replace(/\s+/g, '');
  if (!apiKey) {
    throw new Error('Kein Gemini API-Key hinterlegt — nutze im selben Fenster den Tab „Gemini-Pro-Bridge“.');
  }

  const modulesList = Object.values(store.state.modules).map((m) => m.shortName).join(', ');
  const sys = buildSemesterScanSystemInstruction();
  const promptText = `Bekannte Module im Kalender: ${modulesList || 'MKL, HM, TM, WK, FT'}.
Aktuelles Datum: ${toDateStr()}.
Zusatzhinweis des Studenten: ${userHint || 'Keine besonderen Hinweise.'}
Bitte lies alle erkennbaren Termine (Vorlesung vs. Übung vs. Ausfall sowie Workshops/Sondertermine) sauber in das JSON-Schema aus.`;

  const contents = [{
    role: 'user',
    parts: [
      { text: promptText },
      { inline_data: { mime_type: mimeType || 'image/png', data: base64Data } }
    ]
  }];

  const preferred = store.state.ai.model || 'gemini-3.8-flash';
  const result = await callGeminiWithFallback({ apiKey, preferred, contents, systemInstruction: sys });
  return parseSemesterScanReply(result.text, result.modelUsed);
}

export function buildGeminiProBridgePrompt(userRequest, weekOffset = 0) {
  const ctx = buildPlanningContext(weekOffset);
  return `${buildSystemInstruction()}

---
AKTUELLER KONTEXT (JSON):
${JSON.stringify(ctx, null, 2)}

---
MEIN WUNSCH:
${userRequest || 'Erstelle mir bitte meine Uni-Plan Checkliste für diese Woche (offene Rückstände, Vorlesungs-Nacharbeit, Videos und HAs). Plane KEINE eigenen Anki-Review-Punkte ein, aber reserviere die berechnete Anki-Zeit aus ankiStatus (heute + täglicher Puffer für Folgetage) sauber im Tagesbudget und nenne sie kurz in deiner Erklärung.'}`;
}

async function callGeminiModel({ apiKey, model, contents, systemInstruction }) {
  const cleanKey = (apiKey || '').replace(/\s+/g, '');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), 45000) : null;

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      mode: 'cors',
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': cleanKey
      },
      signal: ctrl?.signal,
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemInstruction }] },
        contents,
        generationConfig: { temperature: 0.45 }
      })
    });
  } catch (err) {
    const netErr = new Error(
      err?.name === 'AbortError'
        ? 'Zeitüberschreitung (45 s) bei Gemini.'
        : 'Netzwerkfehler beim Verbinden mit Gemini.'
    );
    netErr.isNetworkError = true;
    throw netErr;
  } finally {
    if (timer) clearTimeout(timer);
  }

  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const errJson = await res.json();
      detail = errJson?.error?.message || detail;
    } catch { /* ignore */ }
    const err = new Error(detail);
    err.status = res.status;
    throw err;
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
  if (!text) throw new Error('Leere Antwort von Gemini erhalten.');
  return { text, modelUsed: model };
}

async function callGeminiWithFallback({ apiKey, preferred, contents, systemInstruction }) {
  const cachedWorking = store.state.ai?.lastWorkingModel || '';
  const ordered = [];
  const addCandidate = (m) => {
    if (m && !ordered.includes(m) && !deadModelsSession.has(m)) ordered.push(m);
  };
  // Try user's preferred model first (unless known 404 in this session), then cached working model, then fallback chain
  addCandidate(preferred);
  addCandidate(cachedWorking);
  for (const m of FALLBACK_CHAIN) addCandidate(m);
  if (!ordered.length) ordered.push(preferred || 'gemini-2.5-flash');

  let lastErr = null;
  let allNetworkErrors = true;

  for (let i = 0; i < ordered.length; i++) {
    const model = ordered[i];
    try {
      const res = await callGeminiModel({ apiKey, model, contents, systemInstruction });
      if (store.state.ai && store.state.ai.lastWorkingModel !== model) {
        store.state.ai.lastWorkingModel = model;
        store.save({ skipSync: true, silent: true, preserveTimestamp: true });
      }
      return res;
    } catch (err) {
      lastErr = err;
      if (!err.isNetworkError) allNetworkErrors = false;
      if (err.status === 404) deadModelsSession.add(model);
      const retryable = err.isNetworkError || [404, 429, 500, 503].includes(err.status);
      if (!retryable) throw err;
      // Short pause before next fallback attempt
      if (i < ordered.length - 1) {
        await new Promise((r) => setTimeout(r, err.isNetworkError ? 450 : 250));
      }
    }
  }

  if (allNetworkErrors) {
    throw new Error('Verbindung zu Gemini im Browser blockiert oder unterbrochen (Netzwerkfehler). Tipp: In Firefox den Schutz vor Aktivitätenverfolgung / Adblocker für diese Seite kurz deaktivieren — oder unten die Gemini-Pro-Bridge nutzen.');
  }
  throw lastErr || new Error('Gemini konnte nicht erreicht werden.');
}

export async function sendPlannerMessage(userText, weekOffset = 0) {
  const apiKey = (store.state.ai.apiKey || '').replace(/\s+/g, '');
  if (!apiKey) {
    throw new Error('Kein Gemini API-Key hinterlegt. Trage ihn unter Einstellungen ein oder nutze die Gemini-Pro-Bridge.');
  }

  const ctx = buildPlanningContext(weekOffset);
  const sys = buildSystemInstruction();

  // Exclude the just-pushed current user message so we NEVER send two consecutive role:'user' turns!
  const rawChat = [...(store.state.ai.chat || [])];
  if (rawChat.length && rawChat[rawChat.length - 1]?.role === 'user' && rawChat[rawChat.length - 1]?.text === userText) {
    rawChat.pop();
  }
  const recentHistory = [];
  for (const m of rawChat.slice(-6)) {
    if (!m || !m.text) continue;
    const role = m.role === 'user' ? 'user' : 'model';
    if (recentHistory.length && recentHistory[recentHistory.length - 1].role === role) {
      recentHistory[recentHistory.length - 1].parts[0].text += `\n\n${m.text}`;
    } else {
      recentHistory.push({ role, parts: [{ text: m.text }] });
    }
  }
  // Ensure history ends on 'model' (not 'user') before appending the new user turn
  while (recentHistory.length && recentHistory[recentHistory.length - 1].role === 'user') {
    recentHistory.pop();
  }

  const currentUserPayload = `Aktueller Kontext:\n${JSON.stringify(ctx)}\n\nNachricht:\n${userText}`;
  const contents = [...recentHistory, { role: 'user', parts: [{ text: currentUserPayload }] }];

  const preferred = store.state.ai.model || 'gemini-3.8-flash';
  const result = await callGeminiWithFallback({ apiKey, preferred, contents, systemInstruction: sys });
  const proposal = extractProposalFromReply(result.text);
  return {
    rawText: result.text,
    displayText: stripJsonBlock(result.text) || (proposal ? proposal.summary : result.text),
    proposal,
    modelUsed: result.modelUsed,
    usedFallback: result.modelUsed !== preferred
  };
}

export async function testGeminiConnection(apiKey, model = 'gemini-3.8-flash') {
  const res = await callGeminiWithFallback({
    apiKey: (apiKey || '').replace(/\s+/g, ''),
    preferred: model,
    systemInstruction: 'Antworte kurz auf Deutsch.',
    contents: [{ role: 'user', parts: [{ text: 'Sag nur OK' }] }]
  });
  return { ok: true, modelUsed: res.modelUsed, reply: res.text.trim() };
}

export function applyProposalToWeek(proposal) {
  if (!proposal) return { addedItems: 0, addedReminders: 0, addedCatalog: 0, appliedRhythm: false };
  let addedItems = 0;
  let addedReminders = 0;
  if ((proposal.items && proposal.items.length) || (proposal.reminders && proposal.reminders.length) || (proposal.replaceDates && proposal.replaceDates.length)) {
    const r = applyParsedChecklist({
      items: proposal.items || [],
      dayNotes: proposal.dayNotes || {},
      reminders: proposal.reminders || [],
      replaceDates: proposal.replaceDates || []
    });
    addedItems = r.addedItems;
    addedReminders = r.addedReminders;
  }
  const addedCatalog = Array.isArray(proposal.newCatalogItems) && proposal.newCatalogItems.length
    ? store.addCatalogItemsFromAi(proposal.newCatalogItems)
    : 0;
  let appliedRhythm = false;
  if (proposal.suggestedRhythm) {
    store.pushUndo('Rhythmus-Orientierung aktualisiert');
    store.state.ai.rhythmNotes = proposal.suggestedRhythm;
    store.save();
    appliedRhythm = true;
  }
  return { addedItems, addedReminders, addedCatalog, appliedRhythm };
}

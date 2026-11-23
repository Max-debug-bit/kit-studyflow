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
  parseDateStr
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
  { id: 'gemini-flash-latest', label: 'Gemini Flash Latest (Auto)' },
  { id: 'gemini-pro-latest', label: 'Gemini Pro Latest (Starkes Reasoning)' },
  { id: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro Preview' }
];

const FALLBACK_CHAIN = ['gemini-3.8-flash', 'gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-flash-latest'];

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
  const effectiveAnkiMin = anki.estMinutes > 0 ? Math.max(minDailyAnki, anki.estMinutes) : minDailyAnki;

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
      echteDurchschnittszeitenProFach: calibration.byModule.map((x) => ({
        fach: x.fach,
        taetigkeit: x.taetigkeit,
        anzahlSessions: x.anzahl,
        echterDurchschnittMin: x.durchschnittMin,
        hinterlegteRegelMin: x.regelMin
      }))
    },
    ankiStatus: {
      quelle: anki.source,
      neueKartenBlau: anki.totalNew,
      lernKartenRot: anki.totalLearn,
      faelligeKartenGruen: anki.totalReview,
      faelligeKartenGesamt: anki.totalDue,
      gewichteSekunden: anki.weights,
      geschaetzteMinutenHeute: anki.estMinutes,
      mindestAnkiProTagMin: minDailyAnki,
      empfohleneAnkiDauerMin: effectiveAnkiMin,
      decks: anki.decks
    },
    modulRegeln: moduleRules,
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

Halte dich strikt an diese 6 Regeln und nutze jedes Feld aus dem JSON-Kontext gezielt:

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

3. ANKI-SCHÄTZUNG NACH KARTENTYP (ankiStatus):
   - Plane an JEDEM Tag einen eigenen Checklisten-Punkt für Anki-Reviews ("kind": "a").
   - Nutze "ankiStatus.empfohleneAnkiDauerMin" (berechnet aus Blau=Neu, Rot=Lernen, Grün=Fällig; falls 0, greift "mindestAnkiProTagMin").
   - Achte auf die Kartentypen: Viele neue (blaue) oder rote Karten sind kognitiv anstrengender als reine grüne Reviews – lege sie eher in frische Phasen (oder splitte sie bei > 45 Min.) statt müde spät abends.
   - Falls "weicheRhythmusOrientierung" gefüllt ist, nutze sie als lockere, flexible Leitlinie (niemals starr, wenn aktuelle Termine oder Energie dagegen sprechen).

4. VORLESUNGEN, ÜBUNGEN, VIDEOS & HAUSAUFGABEN (uniTermineDieseWoche & modulRegeln):
   - "terminTyp: exercise" oder "workshop": KEINE Nacharbeit / keine Ankis nötig!
   - "terminTyp: lecture" + "attendance: live": Student besucht die Vorlesung (wird automatisch als Vorlesungszeit verbucht). Wenn "liveReviewMinutes > 0" oder "createsAnki: true", plane zeitnah einen Nacharbeits-/Anki-Block ein (~liveReviewMinutes, typ. 60–90 Min.).
   - "attendance: video": Student geht NICHT hin -> Terminzeit ist frei! Plane stattdessen das Nachschauen & Durcharbeiten (~videoStudyMinutes, z. B. 150–180 Min.) in ein passendes Zeitfenster.
   - Wenn "triggersHomework: true": Nach dieser Übung fällt eine neue Hausaufgabe an. Bei "homeworkMode: understanding" gilt: reine Verständnis-Bearbeitung OHNE harte Abgabe-Panik (andere geben ab) – entspannt in den nächsten Tagen als eigenen Checklisten-Punkt einplanen.

5. OFFENER RÜCKSTAND & LERNHISTORIE (offenerRueckstand, eingeplanterRueckstand, lernHistorieFuerKI):
   - Plane Punkte aus "offenerRueckstand" (Status "open" oder "overdue") sinnvoll mit ein und gib bei diesen Punkten EXAKT deren "backlogId" aus dem JSON zurück!
   - Erfinde NIEMALS eine "backlogId", die nicht in "offenerRueckstand" oder "eingeplanterRueckstand" steht (sonst "backlogId": "").
   - Punkte in "eingeplanterRueckstand" NICHT doppelt einplanen, außer du ersetzt ihren bisherigen Tag über "replaceDates".
   - Nutze "lernHistorieFuerKI.letzteLernSessions" (was konkret zuletzt gelernt wurde), "echteDurchschnittszeitenProFach", "fokusStatistik.kapazitaetNachUniLast" (echte Kapazität an freien vs. vollen Uni-Tagen) und "fachBalance" (vernachlässigte Fächer gezielt ausgleichen), um Blocklängen und Fach-Prioritäten realistisch anzusetzen.

6. FORMAT & ZEIT-HINWEISE:
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
      "title": "Anki-Reviews (30 Min.)",
      "kind": "a",
      "estMin": 30,
      "backlogId": ""
    }
  ],
  "reminders": []
}
\`\`\`
Wichtig: Übernimm existierende "vorgemerkteTermine" nicht doppelt in "reminders" – trag in "reminders" nur NEUE Sondertermine ein.`;
}

export function extractProposalFromReply(text) {
  if (!text) return null;
  const match = /```json\s*([\s\S]*?)```/i.exec(text) || /```\s*(\{[\s\S]*?"items"[\s\S]*?\})\s*```/i.exec(text);
  let jsonStr = match ? match[1] : null;
  if (!jsonStr) {
    const trimmed = text.trim();
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) jsonStr = trimmed;
  }

  if (jsonStr) {
    try {
      const parsed = JSON.parse(jsonStr);
      const rawItems = Array.isArray(parsed.items)
        ? parsed.items
        : Array.isArray(parsed.blocks)
          ? parsed.blocks.map((b) => ({
              d: b.d,
              timeLabel: b.start ? `${b.start}${b.end ? `–${b.end}` : ''}` : '',
              title: b.title,
              kind: b.kind === 'a' ? 'a' : b.kind === 'p' ? 'p' : 'l',
              estMin: 45,
              backlogId: b.backlogId || ''
            }))
          : [];

      const items = rawItems
        .filter((it) => it && it.d && it.title)
        .map((it) => ({
          d: String(it.d).slice(0, 10),
          timeLabel: String(it.timeLabel || '').trim(),
          title: String(it.title).trim(),
          kind: ['l', 'a', 'p'].includes(it.kind) ? it.kind : (/\banki/i.test(it.title) ? 'a' : 'l'),
          estMin: Math.max(0, Number(it.estMin) || 0),
          backlogId: String(it.backlogId || '').trim()
        }));

      const reminders = Array.isArray(parsed.reminders)
        ? parsed.reminders.map((r) => (typeof r === 'string' ? r.trim() : String(r?.text || '').trim())).filter(Boolean)
        : [];

      if (!items.length && !reminders.length) return null;
      return {
        summary: parsed.summary || 'Uni-Plan Checkliste',
        replaceDates: Array.isArray(parsed.replaceDates) ? parsed.replaceDates : [],
        dayNotes: parsed.dayNotes && typeof parsed.dayNotes === 'object' ? parsed.dayNotes : {},
        items,
        reminders
      };
    } catch {
      // Fall through to plain-text parser
    }
  }

  const textParsed = parseTextChecklistPlan(text);
  if (textParsed.items.length || textParsed.reminders.length) {
    return {
      summary: 'Erkannter Checklisten-Plan',
      replaceDates: [],
      dayNotes: textParsed.dayNotes,
      items: textParsed.items,
      reminders: textParsed.reminders.map((r) => r.text)
    };
  }
  return null;
}

export function stripJsonBlock(text) {
  return (text || '').replace(/```json[\s\S]*?```/gi, '').trim();
}

export function buildAuditInstruction() {
  return `${buildSystemInstruction()}

---
SPEZIAL-MODUS: STRENGER KONTROLLEUR (PLAN-AUDIT)
Prüfe "aktuelleCheckliste" zusammen mit "uniTermineDieseWoche", "offenerRueckstand", "tagesRhythmus", "ankiStatus" und "lernHistorieFuerKI" mit kritischem Blick:
1. Harte Fehler: Überschneidungen mit Live-Uni-Terminen, Zeitfenster auf "heute" vor "aktuelleUhrzeit", Start vor "fruehesterLernstartFreieTage", fehlende Anki-Reviews, oder vergessene offene/überfällige Rückstände.
2. Überlastungs-Fallen: Tage mit zu vielen schweren Nacharbeiten auf einmal, fehlende Pausen bei langen Uni-Tagen, verplanter Sonntag (falls "sonntagFreiAusserAnki" true), oder unrealistische Zeiten im Vergleich zu "echteDurchschnittszeitenProFach".
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
Prüfe meinen aktuellen Wochenplan streng auf Fehler, Lücken und Überlastungs-Fallen und gib mir direkt die korrigierte Version.`;
}

export async function runPlanAudit(weekOffset = 0) {
  const apiKey = (store.state.ai.apiKey || '').trim();
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
  const tryModels = [preferred, ...FALLBACK_CHAIN.filter((m) => m !== preferred)];

  let lastErr = null;
  for (const model of tryModels) {
    try {
      const result = await callGeminiModel({ apiKey, model, contents, systemInstruction: sys });
      const proposal = extractProposalFromReply(result.text);
      return {
        rawText: result.text,
        displayText: stripJsonBlock(result.text) || (proposal ? proposal.summary : result.text),
        proposal,
        modelUsed: result.modelUsed,
        usedFallback: result.modelUsed !== preferred
      };
    } catch (err) {
      lastErr = err;
      if (![404, 429, 500, 503].includes(err.status)) throw err;
    }
  }
  throw lastErr || new Error('Gemini konnte nicht erreicht werden.');
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

Aufgabe: Erstelle einen kurzen, nützlichen Wochenrückblick auf Basis der letzten 7 Tage (Checkliste, "letzteLernSessions", "echteDurchschnittszeitenProFach", Belastung und aktuelle "weicheRhythmusOrientierung"):
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
  const match = /```json\s*([\s\S]*?)```/i.exec(text);
  if (!match) return '';
  try {
    const parsed = JSON.parse(match[1]);
    return String(parsed?.suggestedRhythmNote || '').trim();
  } catch {
    return '';
  }
}

export async function runWeeklyReview(weekOffset = 0) {
  const apiKey = (store.state.ai.apiKey || '').trim();
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
  const tryModels = [preferred, ...FALLBACK_CHAIN.filter((m) => m !== preferred)];
  let lastErr = null;
  for (const model of tryModels) {
    try {
      const result = await callGeminiModel({ apiKey, model, contents, systemInstruction: sys });
      const suggestedRhythm = extractRhythmSuggestion(result.text);
      return {
        rawText: result.text,
        displayText: stripJsonBlock(result.text) || result.text,
        suggestedRhythm,
        modelUsed: result.modelUsed,
        usedFallback: result.modelUsed !== preferred
      };
    } catch (err) {
      lastErr = err;
      if (![404, 429, 500, 503].includes(err.status)) throw err;
    }
  }
  throw lastErr || new Error('Gemini konnte nicht erreicht werden.');
}

// ---------- Multimodal Semesterplan Image Scanner (#2) ----------

export async function scanSemesterPlanImage({ base64Data, mimeType, userHint = '' }) {
  const apiKey = (store.state.ai.apiKey || '').trim();
  if (!apiKey) {
    throw new Error('Für den automatischen Bild-Scanner wird dein kostenloser Gemini API-Key in den Einstellungen benötigt.');
  }

  const modulesList = Object.values(store.state.modules).map((m) => m.shortName).join(', ');
  const sys = `Du liest Universitäts-Semesterpläne (z. B. KIT MKL-Semesterplan mit Vorlesungen, Übungen, Workshops) aus Bildern sehr präzise aus.
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
- Achte genau auf Jahreswechsel (Wintersemester 2026/2027: Okt-Dez = 2026, Jan-März = 2027, passend zum aktuellen Datum ${toDateStr()}).
- "customEvents": einmalige Zusatztermine wie Workshops mit konkretem Datum, Start- und Endzeit.`;

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
  const tryModels = [preferred, ...FALLBACK_CHAIN.filter((m) => m !== preferred)];
  let lastErr = null;
  for (const model of tryModels) {
    try {
      const result = await callGeminiModel({ apiKey, model, contents, systemInstruction: sys });
      const match = /```json\s*([\s\S]*?)```/i.exec(result.text);
      const jsonStr = match ? match[1] : result.text.trim();
      const parsed = JSON.parse(jsonStr);
      return {
        summary: parsed.summary || 'Semesterplan erkannt',
        overrides: Array.isArray(parsed.overrides) ? parsed.overrides : [],
        customEvents: Array.isArray(parsed.customEvents) ? parsed.customEvents : [],
        reminders: Array.isArray(parsed.reminders) ? parsed.reminders : [],
        modelUsed: result.modelUsed
      };
    } catch (err) {
      lastErr = err;
      if (![404, 429, 500, 503].includes(err.status)) throw err;
    }
  }
  throw lastErr || new Error('Bild-Analyse fehlgeschlagen.');
}

export function buildGeminiProBridgePrompt(userRequest, weekOffset = 0) {
  const ctx = buildPlanningContext(weekOffset);
  return `${buildSystemInstruction()}

---
AKTUELLER KONTEXT (JSON):
${JSON.stringify(ctx, null, 2)}

---
MEIN WUNSCH:
${userRequest || 'Erstelle mir bitte meine Uni-Plan Checkliste für diese Woche mit Anki-Reviews, offenen Rückständen, Vorlesungs-Nacharbeit, Videos und HAs.'}`;
}

async function callGeminiModel({ apiKey, model, contents, systemInstruction }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey.trim())}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: systemInstruction }] },
      contents,
      generationConfig: { temperature: 0.45 }
    })
  });

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

export async function sendPlannerMessage(userText, weekOffset = 0) {
  const apiKey = (store.state.ai.apiKey || '').trim();
  if (!apiKey) {
    throw new Error('Kein Gemini API-Key hinterlegt. Trage ihn unter Einstellungen ein oder nutze die Gemini-Pro-Bridge.');
  }

  const ctx = buildPlanningContext(weekOffset);
  const sys = buildSystemInstruction();
  const recentHistory = (store.state.ai.chat || []).slice(-8).map((m) => ({
    role: m.role === 'user' ? 'user' : 'model',
    parts: [{ text: m.text }]
  }));

  const currentUserPayload = `Aktueller Kontext:\n${JSON.stringify(ctx)}\n\nNachricht:\n${userText}`;
  const contents = [...recentHistory, { role: 'user', parts: [{ text: currentUserPayload }] }];

  const preferred = store.state.ai.model || 'gemini-3.8-flash';
  const tryModels = [preferred, ...FALLBACK_CHAIN.filter((m) => m !== preferred)];

  let lastErr = null;
  for (const model of tryModels) {
    try {
      const result = await callGeminiModel({ apiKey, model, contents, systemInstruction: sys });
      const proposal = extractProposalFromReply(result.text);
      return {
        rawText: result.text,
        displayText: stripJsonBlock(result.text) || (proposal ? proposal.summary : result.text),
        proposal,
        modelUsed: result.modelUsed,
        usedFallback: result.modelUsed !== preferred
      };
    } catch (err) {
      lastErr = err;
      if (![404, 429, 500, 503].includes(err.status)) throw err;
    }
  }
  throw lastErr || new Error('Gemini konnte nicht erreicht werden.');
}

export async function testGeminiConnection(apiKey, model = 'gemini-3.8-flash') {
  const tryModels = [model, ...FALLBACK_CHAIN.filter((m) => m !== model)];
  let lastErr = null;
  for (const m of tryModels) {
    try {
      const res = await callGeminiModel({
        apiKey,
        model: m,
        systemInstruction: 'Antworte kurz auf Deutsch.',
        contents: [{ role: 'user', parts: [{ text: 'Sag nur OK' }] }]
      });
      return { ok: true, modelUsed: res.modelUsed, reply: res.text.trim() };
    } catch (err) {
      lastErr = err;
      if (![404, 429, 500, 503].includes(err.status)) throw err;
    }
  }
  throw lastErr;
}

export function applyProposalToWeek(proposal) {
  if (!proposal) return { addedItems: 0, addedReminders: 0 };
  return applyParsedChecklist({
    items: proposal.items || [],
    dayNotes: proposal.dayNotes || {},
    reminders: proposal.reminders || [],
    replaceDates: proposal.replaceDates || []
  });
}

// RFC-5545 & KIT Campus (.ics / WebCal) parser with RRULE + EXDATE + smart Maschinenbau module detection

import { pad2, toDateStr, parseDateStr, addDays } from './store.js';

function unfoldLines(icsText) {
  const normalized = (icsText || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const rawLines = normalized.split('\n');
  const lines = [];
  for (const line of rawLines) {
    if ((line.startsWith(' ') || line.startsWith('\t')) && lines.length) {
      lines[lines.length - 1] += line.slice(1);
    } else if (line.trim() !== '') {
      lines.push(line);
    }
  }
  return lines;
}

function unescapeIcs(str) {
  return (str || '')
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\')
    .trim();
}

function parseIcsDateTime(val) {
  // Supports: 20261026T113000, 20261026T113000Z, 20261026
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec((val || '').trim());
  if (!m) return null;
  const [, y, mo, d, hh, mm, ss, isZ] = m;
  if (hh === undefined) {
    return {
      allDay: true,
      dateStr: `${y}-${mo}-${d}`,
      timeStr: '00:00',
      dateObj: new Date(Number(y), Number(mo) - 1, Number(d), 0, 0, 0)
    };
  }
  let dt;
  if (isZ) {
    dt = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(hh), Number(mm), Number(ss || 0)));
  } else {
    dt = new Date(Number(y), Number(mo) - 1, Number(d), Number(hh), Number(mm), Number(ss || 0));
  }
  return {
    allDay: false,
    dateStr: toDateStr(dt),
    timeStr: `${pad2(dt.getHours())}:${pad2(dt.getMinutes())}`,
    dateObj: dt
  };
}

function parseRRule(str) {
  const out = {};
  for (const part of (str || '').split(';')) {
    const [k, v] = part.split('=');
    if (k && v) out[k.toUpperCase()] = v;
  }
  return out;
}

export function classifyKitSummary(rawSummary) {
  const s = (rawSummary || '').trim();
  // KIT pattern: "2173550 - Werkstoffkunde I für mach, phys (V), Pundt, MACH"
  const codeMatch = /^(\d{5,8})\s*-\s*(.+)$/.exec(s);
  const code = codeMatch ? codeMatch[1] : '';
  let rest = codeMatch ? codeMatch[2] : s;

  // Detect event type: (V), (Ü), (T), (P), (V/Ü)
  let type = 'V';
  const typeMatch = /\((V\/Ü|V|Ü|T|P|S|K)\)/i.exec(rest);
  if (typeMatch) {
    type = typeMatch[1].toUpperCase();
  } else if (/übung/i.test(rest)) {
    type = 'Ü';
  } else if (/tutorium/i.test(rest)) {
    type = 'T';
  } else if (/praktikum/i.test(rest)) {
    type = 'P';
  }

  // Extract clean title before lecturer comma
  let cleanTitle = rest;
  if (typeMatch) {
    cleanTitle = rest.slice(0, typeMatch.index).trim();
  } else {
    cleanTitle = rest.split(',')[0].trim();
  }

  // Smart short names for common KIT Maschinenbau subjects
  const lower = cleanTitle.toLowerCase();
  const isExercise = type === 'Ü' || type === 'T' || /übung|tutorium/i.test(cleanTitle);
  let shortName = cleanTitle;
  let subjectGroup = cleanTitle;
  let defaultCreatesAnki = false;
  let defaultAttendance = 'live';
  let defaultLiveReviewMin = 0;
  let defaultVideoStudyMin = 150;
  let defaultTriggersHomework = false;
  let defaultHomeworkMode = 'understanding';

  if (lower.includes('höhere mathematik')) {
    const roman = /\b(i{1,3}|iv)\b/i.exec(cleanTitle)?.[1]?.toUpperCase() || '';
    subjectGroup = `HM ${roman}`.trim();
    shortName = `${subjectGroup} (${type})`;
    defaultAttendance = isExercise ? 'live' : 'video';
    defaultCreatesAnki = false;
    defaultLiveReviewMin = 0;
    defaultVideoStudyMin = isExercise ? 0 : 165;
    defaultTriggersHomework = isExercise && type === 'Ü';
  } else if (lower.includes('technische mechanik')) {
    const roman = /\b(i{1,3}|iv)\b/i.exec(cleanTitle)?.[1]?.toUpperCase() || '';
    subjectGroup = `TM ${roman}`.trim();
    shortName = `${subjectGroup} (${type})`;
    defaultCreatesAnki = !isExercise;
    defaultLiveReviewMin = isExercise ? 0 : 75;
    defaultVideoStudyMin = isExercise ? 0 : 165;
    defaultTriggersHomework = isExercise && type === 'Ü';
  } else if (lower.includes('maschinenkonstruktionslehre')) {
    const letter = /\b([a-d]|i{1,3})\b/i.exec(cleanTitle.replace(/maschinenkonstruktionslehre/i, ''))?.[1]?.toUpperCase() || '';
    subjectGroup = `MKL ${letter}`.trim();
    shortName = `${subjectGroup} (${type})`;
    defaultCreatesAnki = !isExercise;
    defaultLiveReviewMin = isExercise ? 0 : 75;
    defaultVideoStudyMin = isExercise ? 0 : 165;
  } else if (lower.includes('werkstoffkunde')) {
    const roman = /\b(i{1,3})\b/i.exec(cleanTitle)?.[1]?.toUpperCase() || '';
    subjectGroup = `WK ${roman}`.trim();
    shortName = `${subjectGroup} (${type})`;
    defaultCreatesAnki = !isExercise;
    defaultLiveReviewMin = isExercise ? 0 : 75;
    defaultVideoStudyMin = isExercise ? 0 : 165;
  } else if (lower.includes('fertigungstechnik')) {
    subjectGroup = 'Fertigungstechnik';
    shortName = `FT (${type})`;
    defaultCreatesAnki = !isExercise;
    defaultLiveReviewMin = isExercise ? 0 : 75;
    defaultVideoStudyMin = isExercise ? 0 : 150;
  } else if (lower.includes('thermodynamik')) {
    subjectGroup = 'Thermodynamik';
    shortName = `TD (${type})`;
    defaultCreatesAnki = !isExercise;
    defaultLiveReviewMin = isExercise ? 0 : 75;
    defaultVideoStudyMin = isExercise ? 0 : 165;
  } else if (lower.includes('strömungslehre')) {
    subjectGroup = 'Strömungslehre';
    shortName = `SL (${type})`;
    defaultCreatesAnki = !isExercise;
    defaultLiveReviewMin = isExercise ? 0 : 75;
    defaultVideoStudyMin = isExercise ? 0 : 165;
  } else {
    shortName = cleanTitle.length > 26 ? `${cleanTitle.slice(0, 24)}… (${type})` : `${cleanTitle} (${type})`;
    defaultLiveReviewMin = isExercise ? 0 : 60;
    defaultVideoStudyMin = isExercise ? 0 : 150;
  }

  const moduleId = code ? `${code}_${type}` : `${shortName.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`;

  return {
    moduleId,
    code,
    name: cleanTitle,
    shortName,
    subjectGroup,
    type,
    defaultAttendance,
    defaultCreatesAnki,
    defaultLiveReviewMin,
    defaultVideoStudyMin,
    defaultTriggersHomework,
    defaultHomeworkMode
  };
}

export function parseIcsEvents(icsText) {
  if (!icsText || !icsText.includes('BEGIN:VEVENT')) return [];
  const lines = unfoldLines(icsText);
  const events = [];
  let cur = null;

  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') {
      cur = { exdates: [] };
      continue;
    }
    if (line === 'END:VEVENT') {
      if (cur && cur.dtstart) events.push(cur);
      cur = null;
      continue;
    }
    if (!cur) continue;

    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const left = line.slice(0, colonIdx);
    const val = line.slice(colonIdx + 1);
    const prop = left.split(';')[0].toUpperCase();

    if (prop === 'UID') cur.uid = val.trim();
    else if (prop === 'SUMMARY') cur.summary = unescapeIcs(val);
    else if (prop === 'LOCATION') cur.location = unescapeIcs(val);
    else if (prop === 'URL') cur.url = val.trim();
    else if (prop === 'DESCRIPTION') cur.description = unescapeIcs(val);
    else if (prop === 'DTSTART') cur.dtstart = parseIcsDateTime(val);
    else if (prop === 'DTEND') cur.dtend = parseIcsDateTime(val);
    else if (prop === 'RRULE') cur.rrule = parseRRule(val);
    else if (prop === 'EXDATE') {
      for (const part of val.split(',')) {
        const dt = parseIcsDateTime(part);
        if (dt) cur.exdates.push(dt.dateStr);
      }
    }
  }

  return events;
}

export function expandIcsEventsInRange(icsText, startDateStr, endDateStr) {
  const rawEvents = parseIcsEvents(icsText);
  const instances = [];

  for (const ev of rawEvents) {
    const meta = classifyKitSummary(ev.summary);
    const exSet = new Set(ev.exdates || []);
    const startTime = ev.dtstart.timeStr;
    const endTime = ev.dtend ? ev.dtend.timeStr : startTime;
    const baseDateStr = ev.dtstart.dateStr;

    const pushIfInRange = (dStr) => {
      if (dStr >= startDateStr && dStr <= endDateStr && !exSet.has(dStr)) {
        instances.push({
          uid: `${ev.uid || meta.moduleId}_${dStr}_${startTime}`,
          d: dStr,
          start: startTime,
          end: endTime,
          summary: ev.summary || meta.shortName,
          location: ev.location || '',
          url: ev.url || '',
          ...meta
        });
      }
    };

    if (!ev.rrule || !ev.rrule.FREQ) {
      pushIfInRange(baseDateStr);
      continue;
    }

    const freq = ev.rrule.FREQ;
    const interval = Math.max(1, Number(ev.rrule.INTERVAL || 1));
    const count = ev.rrule.COUNT ? Number(ev.rrule.COUNT) : 500;
    const untilDt = ev.rrule.UNTIL ? parseIcsDateTime(ev.rrule.UNTIL) : null;
    const untilStr = untilDt ? untilDt.dateStr : endDateStr;
    const hardEnd = untilStr < endDateStr ? untilStr : endDateStr;

    if (freq === 'WEEKLY') {
      let curStr = baseDateStr;
      let emitted = 0;
      while (curStr <= hardEnd && emitted < count) {
        pushIfInRange(curStr);
        curStr = addDays(curStr, 7 * interval);
        emitted++;
      }
    } else if (freq === 'DAILY') {
      let curStr = baseDateStr;
      let emitted = 0;
      while (curStr <= hardEnd && emitted < count) {
        pushIfInRange(curStr);
        curStr = addDays(curStr, interval);
        emitted++;
      }
    } else {
      pushIfInRange(baseDateStr);
    }
  }

  return instances.sort((a, b) => (a.d + a.start).localeCompare(b.d + b.start));
}

export function syncModulesFromIcs(store, icsText) {
  const events = parseIcsEvents(icsText);
  let added = 0;
  for (const ev of events) {
    const meta = classifyKitSummary(ev.summary);
    if (!store.state.modules[meta.moduleId]) {
      store.state.modules[meta.moduleId] = {
        id: meta.moduleId,
        code: meta.code,
        name: meta.name,
        shortName: meta.shortName,
        subjectGroup: meta.subjectGroup,
        type: meta.type,
        attendance: meta.defaultAttendance || 'live', // 'live' | 'video' | 'skip'
        liveReviewMinutes: meta.defaultLiveReviewMin,
        videoStudyMinutes: meta.defaultVideoStudyMin,
        studyMinutes: meta.defaultVideoStudyMin, // backwards-compatible alias
        createsAnki: meta.defaultCreatesAnki,
        triggersHomework: meta.defaultTriggersHomework,
        homeworkMode: meta.defaultHomeworkMode || 'understanding',
        ankiDeck: '',
        notes: ''
      };
      added++;
    }
  }
  store.state.icsRaw = icsText;
  store.state.icsUpdatedAt = Date.now();
  store.save();
  return { totalEvents: events.length, modulesAdded: added };
}

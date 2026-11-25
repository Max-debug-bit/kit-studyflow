// Tab 3: "KI-Planer" – Minimalist Monochrome Gemini Checklist Chat + Proposal Preview + Gemini-Pro-Bridge

import { store, toDateStr, toTimeStr, addDays, getMondayOfWeek, fmtDateShort, fmtMin, escapeHtml as esc } from '../store.js';
import {
  sendPlannerMessage,
  runPlanAudit,
  runWeeklyReview,
  applyProposalToWeek,
  buildGeminiProBridgePrompt,
  buildAuditBridgePrompt,
  buildWeeklyReviewBridgePrompt,
  extractProposalFromReply
} from '../gemini.js';
import { getAnkiLoadSummary } from '../anki.js';
import { reconcileBacklogStatus } from '../checklist.js';
import { getActiveWeekOffset } from './week.js';
import { icon } from '../icons.js';

let isSending = false;
let pendingAutoAudit = false;
let pendingAutoReview = false;
let pendingBridgeProposal = null;

export function queuePlanAudit() {
  pendingAutoAudit = true;
}

export function queueWeeklyReview() {
  pendingAutoReview = true;
}

function renderProposalCardHtml(proposal, { actionHtml = '' } = {}) {
  if (!proposal) return '';
  const notices = [];
  if (proposal.filteredAnkiCount > 0) {
    notices.push(`${proposal.filteredAnkiCount} doppelte${proposal.filteredAnkiCount === 1 ? 'r Anki-Review-Punkt' : ' Anki-Review-Punkte'} automatisch ausgefiltert`);
  }
  if (proposal.rejectedDateCount > 0) {
    notices.push(`${proposal.rejectedDateCount} ungültige${proposal.rejectedDateCount === 1 ? 's Datum' : ' Daten'} verworfen`);
  }
  return `
    <div class="proposal-card">
      <div class="row-between" style="margin-bottom:8px;gap:8px;">
        <strong class="small">${esc(proposal.summary)}</strong>
        <div class="row" style="gap:6px;">${actionHtml}</div>
      </div>
      ${proposal.replaceDates?.length ? `<div class="xs muted" style="margin-bottom:6px;">Ersetzt offene Punkte an: <strong>${proposal.replaceDates.map(fmtDateShort).join(', ')}</strong></div>` : ''}
      ${notices.length ? `<div class="xs" style="color:var(--gold);margin-bottom:6px;">${esc(notices.join(' · '))}</div>` : ''}
      ${(proposal.items || []).length ? `
        <div class="entry-list">
          ${proposal.items.map((it) => `
            <div class="entry-row" style="padding:6px 9px;">
              <span class="small"><strong class="mono">${fmtDateShort(it.d)}${it.timeLabel ? ` · ${esc(it.timeLabel)}` : ''}</strong> — ${esc(it.title)}</span>
              <div class="row" style="gap:4px;">
                ${it.estMin ? `<span class="xs soft mono">~${it.estMin}m</span>` : ''}
                ${it.backlogId ? '<span class="pill">Rückstand</span>' : ''}
                <span class="pill ${it.kind === 'a' ? 'anki' : it.kind === 'p' ? 'prod' : 'learn'}">${it.kind === 'a' ? 'Anki' : it.kind === 'p' ? 'Orga' : 'Lernen'}</span>
              </div>
            </div>
          `).join('')}
        </div>
      ` : ''}
      ${proposal.suggestedRhythm ? `<div class="xs muted" style="margin-top:8px;"><strong>Rhythmus-Vorschlag:</strong> ${esc(proposal.suggestedRhythm)}</div>` : ''}
      ${(proposal.newCatalogItems || []).length ? `<div class="xs muted" style="margin-top:8px;">+ Neue Katalog-Bausteine: ${proposal.newCatalogItems.map((c) => `${esc(c.title)} (~${c.defaultMin}m)`).join(' · ')}</div>` : ''}
      ${(proposal.reminders || []).length ? `<div class="xs muted" style="margin-top:8px;">Vormerken: ${proposal.reminders.map(esc).join(' · ')}</div>` : ''}
    </div>
  `;
}

export function renderPlannerView(root, { toast, navigate }) {
  const weekOffset = getActiveWeekOffset();
  const todayStr = toDateStr();
  reconcileBacklogStatus({ todayStr });
  const monday = addDays(getMondayOfWeek(todayStr), weekOffset * 7);
  const sunday = addDays(monday, 6);
  const anki = getAnkiLoadSummary();
  const minAnki = Math.max(10, Number(store.state.anki.minDailyAnkiMin) || 30);
  const effAnki = anki.estMinutes > 0 ? Math.max(minAnki, anki.estMinutes) : minAnki;
  const openBacklog = (store.state.backlog || []).filter((b) => b.status === 'open' || b.status === 'overdue').length;
  const videoMods = Object.values(store.state.modules).filter((m) => m.attendance === 'video').length;
  const calCatalog = store.getCalibratedTaskCatalog();
  const calCount = calCatalog.filter((c) => c.calibrated).length;
  const energyMode = store.state.ai.energyMode || 'normal';
  const chat = store.state.ai.chat || [];
  const hasKey = Boolean(store.state.ai.apiKey && store.state.ai.apiKey.trim().length > 10);

  root.innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="page-title">KI-Planer</h1>
        <div class="small muted">Woche ${fmtDateShort(monday)}–${fmtDateShort(sunday)} · Stand ${toTimeStr()} · ${esc(store.state.ai.model || 'gemini-2.5-flash')}</div>
      </div>
      <div class="row">
        <div class="segmented" title="Energie-Modus für die KI-Planung">
          <button data-energy="reset" class="${energyMode === 'reset' ? 'active' : ''}">Reset</button>
          <button data-energy="normal" class="${energyMode === 'normal' ? 'active' : ''}">Normal</button>
          <button data-energy="fokus" class="${energyMode === 'fokus' ? 'active' : ''}">Fokus</button>
        </div>
        <button class="btn btn-sm" id="btn-run-review" ${isSending ? 'disabled' : ''}>${icon('activity', 14)} Rückblick</button>
        <button class="btn btn-sm btn-primary" id="btn-run-audit" ${isSending ? 'disabled' : ''}>${icon('check', 14)} Plan prüfen</button>
        <button class="btn btn-sm" id="btn-clear-chat">Leeren</button>
        <button class="btn btn-sm" id="btn-open-ai-settings">${icon('settings', 14)}</button>
      </div>
    </div>

    <div class="stack">
      <div class="card" style="padding:11px 14px;">
        <div class="row" style="gap:7px;">
          <span class="pill ${store.state.icsRaw ? 'kit' : 'prod'}">${store.state.icsRaw ? 'KIT-Kalender aktiv' : 'Kein .ics geladen'}</span>
          <span class="pill purple">${videoMods} ${videoMods === 1 ? 'Video-Modul' : 'Video-Module'}</span>
          <span class="pill anki">Anki heute: ${anki.totalNew}B · ${anki.totalLearn}R · ${anki.totalReview}G (~${anki.estMinutes}m · Puffer ${minAnki}m/Tag)</span>
          <span class="pill">Katalog: ${calCatalog.length} Bausteine${calCount > 0 ? ` (${calCount} kalibriert)` : ''}</span>
          <span class="pill ${openBacklog > 0 ? 'prod' : ''}">${openBacklog} im Rückstand</span>
          <span class="pill">Mindestziel ${fmtMin(store.state.goal)}</span>
          <span class="pill">Frei ab ~${store.state.planningPrefs?.defaultWakeFreeDay || '10:00'}</span>
        </div>
      </div>

      <!-- Flexible Rhythmus-Orientierung (#4 + flexibles #5) -->
      <section class="card" style="padding:11px 14px;">
        <details>
          <summary class="small" style="cursor:pointer;font-weight:600;display:flex;align-items:center;justify-content:space-between;">
            <span>${icon('sliders', 14)} Weiche Rhythmus-Orientierung (flexibel, im Wochenrückblick anpassbar)</span>
            <span class="xs soft">${store.state.ai.rhythmNotes ? 'Aktiv' : 'Leer'}</span>
          </summary>
          <div class="stack" style="margin-top:10px;">
            <textarea id="rhythm-notes-inp" class="input" style="min-height:60px;" placeholder="Keine starre Schablone – z. B. ‚Do-Lücke funktioniert gut für HM-Video, Fr abends lieber frei lassen‘">${esc(store.state.ai.rhythmNotes || '')}</textarea>
            <div class="row" style="justify-content:flex-end;">
              <button class="btn btn-primary btn-xs" id="btn-save-rhythm">Speichern</button>
            </div>
          </div>
        </details>
      </section>

      ${!hasKey ? `
        <div class="banner warn">
          <span><strong>Kein Gemini API-Key hinterlegt.</strong> Trage deinen kostenlosen Key in den Einstellungen ein – oder nutze direkt unten die Gemini-Pro-Bridge.</span>
          <button class="btn btn-sm btn-primary" id="btn-goto-key">Key eintragen</button>
        </div>
      ` : ''}

      <section class="card chat-shell">
        <div class="chip-row">
          <button class="chip" data-quick="Erstelle mir eine realistische Uni-Plan Checkliste für diese Woche (offene Vorlesungen/Videos, Nacharbeit, HAs, Rückstand) und reserviere das tägliche Anki-Zeitbudget im Hintergrund.">Wochen-Checkliste erstellen</button>
          <button class="chip" data-quick="Was fällt diese Woche für mein Maschinenbau-Studium alles an (offene Videos, Ankis erstellen, HAs)?">Was fällt diese Woche an?</button>
          <button class="chip" data-quick="Plane mir den heutigen Tag realistisch um – berücksichtige meine heutigen fälligen Ankis im Zeitbudget und die wichtigsten Punkte.">Heute umplanen</button>
          <button class="chip" data-quick="Ich habe noch Vorlesungs-Videos und Anki-Erstellung für MKL/WK/FT/TM offen. Verteil das sinnvoll auf die Woche.">Rückstand verteilen</button>
        </div>

        <div class="chat-messages" id="chat-messages">
          ${chat.length === 0 ? `<div class="msg assistant"><div class="msg-text">Ich kenne deinen KIT-Stundenplan, deine Modul-Regeln (Live vs. Video), deinen Aufgaben-Katalog (mit Auto-Kalibrierung), deinen aktuellen Anki-Stand und deine echten Lernzeiten.\n\nSchreib einfach, was diese Woche ansteht oder wann du privat unterwegs bist – ich erstelle dir direkt eine abhakbare Uni-Checkliste (tägliche Anki-Reviews werden automatisch über deinen Anki-Sync berechnet und im Tagesbudget reserviert).</div></div>` : chat.map((m, idx) => `<div class="msg ${m.role === 'user' ? 'user' : 'assistant'}"><div class="msg-text">${esc(m.text)}</div>${m.fallbackBridgeType ? `<div class="row" style="margin-top:8px;"><button class="btn btn-xs btn-primary" data-err-bridge="${idx}">${icon('copy', 12)} Prompt für Gemini Pro kopieren</button></div>` : ''}${m.modelUsed ? `<div class="xs soft" style="margin-top:6px;">${esc(m.modelUsed)}${m.usedFallback ? ' (Auto-Fallback)' : ''}</div>` : ''}${m.suggestedRhythm ? `<div class="proposal-card"><div class="row-between" style="margin-bottom:6px;"><strong class="xs mono">VORSCHLAG: RHYTHMUS-ORIENTIERUNG</strong>${m.rhythmApplied ? '<span class="pill kit">Übernommen</span>' : `<button class="btn btn-xs btn-primary" data-apply-rhythm="${idx}">${icon('check', 12)} Übernehmen</button>`}</div><div class="small muted">${esc(m.suggestedRhythm)}</div></div>` : ''}${m.proposal ? renderProposalCardHtml(m.proposal, { actionHtml: m.applied ? '<span class="pill kit">Übernommen</span>' : `<button class="btn btn-xs btn-primary" data-apply-prop="${idx}">${icon('check', 12)} Übernehmen</button>` }) : ''}</div>`).join('')}
          ${isSending ? '<div class="msg assistant muted"><div class="msg-text">Gemini erstellt deinen Plan...</div></div>' : ''}
        </div>

        <form id="chat-form" class="row" style="align-items:flex-end;">
          <textarea id="chat-input" class="input" rows="2" style="flex:1;min-height:46px;" placeholder="Schreib Gemini, was ansteht (z. B. ‚Dienstag erst ab 10:45, HM-Video lieber nachmittags‘)..." ${isSending ? 'disabled' : ''}></textarea>
          <button type="submit" class="btn btn-primary" style="height:46px;" ${isSending ? 'disabled' : ''}>${icon('send', 14)} Senden</button>
        </form>
      </section>

      <!-- Gemini-Pro-Bridge -->
      <section class="card">
        <details id="bridge-details" ${pendingBridgeProposal ? 'open' : ''}>
          <summary class="card-title" style="cursor:pointer;">${icon('copy', 15)} Gemini-Pro-Bridge (Copy/Paste für dein Gemini-Pro-Abo)</summary>
          <div class="stack" style="margin-top:12px;">
            <p class="xs muted" style="margin:0;">
              Kopiere deinen kompletten Kontext-Prompt in die Gemini-Pro-App (Plan, Audit oder Wochenrückblick), füge die Antwort hier ein und prüfe vor dem Übernehmen die Vorschau.
            </p>
            <div class="row">
              <input type="text" id="bridge-wish" class="input" style="flex:1;" placeholder="Dein Wunsch (optional)..." />
              <button class="btn btn-primary btn-sm" id="btn-bridge-copy">${icon('copy', 13)} Plan-Prompt</button>
              <button class="btn btn-sm" id="btn-bridge-audit">${icon('check', 13)} Audit-Prompt</button>
              <button class="btn btn-sm" id="btn-bridge-review">${icon('activity', 13)} Rückblick-Prompt</button>
            </div>
            <textarea id="bridge-paste" class="input mono" placeholder="Antwort aus Gemini Pro hier einfügen (JSON für Plan / Audit / Rückblick / neue Bausteine oder Text-Checkliste)..."></textarea>
            <div class="row" style="justify-content:flex-end;">
              <button class="btn btn-primary btn-sm" id="btn-bridge-preview">${icon('check', 13)} Vorschau prüfen</button>
            </div>
            <div id="bridge-preview">${pendingBridgeProposal ? renderProposalCardHtml(pendingBridgeProposal, {
              actionHtml: `<button class="btn btn-xs" id="btn-bridge-cancel">Verwerfen</button><button class="btn btn-xs btn-primary" id="btn-bridge-confirm">${icon('check', 12)} Plan übernehmen</button>`
            }) : ''}</div>
          </div>
        </details>
      </section>
    </div>
  `;

  const msgsEl = root.querySelector('#chat-messages');
  if (msgsEl) msgsEl.scrollTop = msgsEl.scrollHeight;

  const triggerSend = async (text) => {
    const clean = (text || '').trim();
    if (!clean || isSending) return;

    store.state.ai.chat.push({ role: 'user', text: clean, ts: Date.now() });
    store.save({ skipSync: true, silent: true });
    isSending = true;
    renderPlannerView(root, { toast, navigate });

    try {
      const res = await sendPlannerMessage(clean, weekOffset);
      store.state.ai.chat.push({
        role: 'assistant',
        text: res.displayText,
        proposal: res.proposal,
        applied: false,
        modelUsed: res.modelUsed,
        usedFallback: res.usedFallback,
        ts: Date.now()
      });
      if (store.state.ai.chat.length > 30) store.state.ai.chat = store.state.ai.chat.slice(-30);
      store.save();
    } catch (err) {
      store.state.ai.chat.push({
        role: 'assistant',
        text: `Fehler: ${err.message}`,
        fallbackBridgeType: 'plan',
        fallbackBridgeWish: clean,
        ts: Date.now()
      });
      store.save({ skipSync: true });
      toast(err.message, 'err');
    } finally {
      isSending = false;
      renderPlannerView(root, { toast, navigate });
    }
  };

  root.querySelector('#chat-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const inp = root.querySelector('#chat-input');
    const val = inp?.value || '';
    if (inp) inp.value = '';
    triggerSend(val);
  });

  root.querySelector('#chat-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      root.querySelector('#chat-form')?.requestSubmit();
    }
  });

  root.querySelectorAll('[data-quick]').forEach((btn) => {
    btn.addEventListener('click', () => triggerSend(btn.getAttribute('data-quick')));
  });

  root.querySelectorAll('[data-apply-prop]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.getAttribute('data-apply-prop'));
      const msg = store.state.ai.chat[idx];
      if (msg?.proposal) {
        const res = applyProposalToWeek(msg.proposal, {
          onAfterMutate: () => { msg.applied = true; }
        });
        const parts = [];
        if (res.addedItems) parts.push(`${res.addedItems} Punkte`);
        if (res.addedReminders) parts.push(`${res.addedReminders} Vormerkungen`);
        if (res.addedCatalog) parts.push(`${res.addedCatalog} neue Katalog-Bausteine`);
        if (res.appliedRhythm) parts.push('Rhythmus-Orientierung');
        toast(`Übernommen: ${parts.join(', ') || 'Aktualisiert'}.`, 'ok', { undo: true });
      }
    });
  });

  root.querySelectorAll('[data-energy]').forEach((btn) => {
    btn.addEventListener('click', () => {
      store.state.ai.energyMode = btn.getAttribute('data-energy');
      store.save();
    });
  });

  root.querySelector('#btn-clear-chat')?.addEventListener('click', () => {
    store.state.ai.chat = [];
    store.state.ai.chatClearedAt = Date.now();
    store.save();
  });
  root.querySelector('#btn-open-ai-settings')?.addEventListener('click', () => navigate('more', { subtab: 'settings' }));
  root.querySelector('#btn-goto-key')?.addEventListener('click', () => navigate('more', { subtab: 'settings' }));

  root.querySelector('#btn-bridge-copy')?.addEventListener('click', async () => {
    const prompt = buildGeminiProBridgePrompt(root.querySelector('#bridge-wish')?.value || '', weekOffset);
    try {
      await navigator.clipboard.writeText(prompt);
      toast('Prompt kopiert. Jetzt in Gemini Pro einfügen.', 'ok');
    } catch {
      toast('Kopieren fehlgeschlagen.', 'err');
    }
  });

  const triggerAudit = async () => {
    if (isSending) return;
    store.state.ai.chat.push({ role: 'user', text: 'Plan-Audit (Strenger Kontrolleur): Prüfe meinen aktuellen Wochenplan auf Fehler, Lücken und Überlastung.', ts: Date.now() });
    store.save({ skipSync: true, silent: true });
    isSending = true;
    renderPlannerView(root, { toast, navigate });
    try {
      const res = await runPlanAudit(weekOffset);
      store.state.ai.chat.push({
        role: 'assistant',
        text: res.displayText,
        proposal: res.proposal,
        applied: false,
        modelUsed: `${res.modelUsed} · Audit`,
        usedFallback: res.usedFallback,
        ts: Date.now()
      });
      if (store.state.ai.chat.length > 30) store.state.ai.chat = store.state.ai.chat.slice(-30);
      store.save();
    } catch (err) {
      store.state.ai.chat.push({
        role: 'assistant',
        text: `Audit-Fehler: ${err.message}`,
        fallbackBridgeType: 'audit',
        ts: Date.now()
      });
      store.save({ skipSync: true });
      toast(err.message, 'err');
    } finally {
      isSending = false;
      renderPlannerView(root, { toast, navigate });
    }
  };

  root.querySelector('#btn-save-rhythm')?.addEventListener('click', () => {
    store.state.ai.rhythmNotes = root.querySelector('#rhythm-notes-inp')?.value.trim() || '';
    store.save();
    toast('Rhythmus-Orientierung gespeichert.', 'ok');
  });

  root.querySelectorAll('[data-apply-rhythm]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.getAttribute('data-apply-rhythm'));
      const msg = store.state.ai.chat[idx];
      if (msg?.suggestedRhythm) {
        store.pushUndo('Rhythmus-Orientierung aktualisiert');
        store.state.ai.rhythmNotes = msg.suggestedRhythm;
        msg.rhythmApplied = true;
        store.save();
        toast('Rhythmus-Orientierung übernommen.', 'ok', { undo: true });
      }
    });
  });

  const triggerWeeklyReview = async () => {
    if (isSending) return;
    store.state.ai.chat.push({ role: 'user', text: 'Wochenrückblick: Werte meine letzten 7 Tage aus und lass uns gemeinsam schauen, was wir für nächste Woche anpassen sollten.', ts: Date.now() });
    store.save({ skipSync: true, silent: true });
    isSending = true;
    renderPlannerView(root, { toast, navigate });
    try {
      const res = await runWeeklyReview(weekOffset);
      store.state.ai.chat.push({
        role: 'assistant',
        text: res.displayText,
        suggestedRhythm: res.suggestedRhythm,
        rhythmApplied: false,
        modelUsed: `${res.modelUsed} · Rückblick`,
        usedFallback: res.usedFallback,
        ts: Date.now()
      });
      if (store.state.ai.chat.length > 30) store.state.ai.chat = store.state.ai.chat.slice(-30);
      store.save();
    } catch (err) {
      store.state.ai.chat.push({
        role: 'assistant',
        text: `Rückblick-Fehler: ${err.message}`,
        fallbackBridgeType: 'review',
        ts: Date.now()
      });
      store.save({ skipSync: true });
      toast(err.message, 'err');
    } finally {
      isSending = false;
      renderPlannerView(root, { toast, navigate });
    }
  };

  root.querySelector('#btn-run-review')?.addEventListener('click', triggerWeeklyReview);

  root.querySelector('#btn-bridge-review')?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(buildWeeklyReviewBridgePrompt(weekOffset));
      toast('Wochenrückblick-Prompt kopiert!', 'ok');
    } catch { toast('Kopieren fehlgeschlagen.', 'err'); }
  });

  if (pendingAutoReview) {
    pendingAutoReview = false;
    if (hasKey) setTimeout(triggerWeeklyReview, 60);
    else toast('Kein API-Key hinterlegt – nutze unten „Rückblick-Prompt“ in der Gemini-Pro-Bridge.', '');
  }

  root.querySelector('#btn-run-audit')?.addEventListener('click', triggerAudit);

  root.querySelector('#btn-bridge-audit')?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(buildAuditBridgePrompt(weekOffset));
      toast('Audit-Prompt (Strenger Kontrolleur) kopiert!', 'ok');
    } catch { toast('Kopieren fehlgeschlagen.', 'err'); }
  });

  if (pendingAutoAudit) {
    pendingAutoAudit = false;
    if (hasKey) {
      setTimeout(triggerAudit, 60);
    } else {
      toast('Kein API-Key hinterlegt – nutze unten „Audit-Prompt“ in der Gemini-Pro-Bridge.', '');
    }
  }

  // 1-Click fallback from API error directly to Gemini-Pro-Bridge
  root.querySelectorAll('[data-err-bridge]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const m = store.state.ai.chat[Number(btn.getAttribute('data-err-bridge'))];
      if (!m) return;
      const prompt = m.fallbackBridgeType === 'audit'
        ? buildAuditBridgePrompt(weekOffset)
        : m.fallbackBridgeType === 'review'
          ? buildWeeklyReviewBridgePrompt(weekOffset)
          : buildGeminiProBridgePrompt(m.fallbackBridgeWish || '', weekOffset);
      try {
        await navigator.clipboard.writeText(prompt);
        const det = root.querySelector('#bridge-details');
        if (det) {
          det.open = true;
          det.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
        toast('Prompt für Gemini Pro kopiert! Antwort einfach unten in die Bridge einfügen.', 'ok');
      } catch {
        toast('Kopieren fehlgeschlagen.', 'err');
      }
    });
  });

  const bindBridgePreviewButtons = () => {
    const previewRoot = root.querySelector('#bridge-preview');
    if (!previewRoot) return;
    previewRoot.querySelector('#btn-bridge-cancel')?.addEventListener('click', () => {
      pendingBridgeProposal = null;
      previewRoot.innerHTML = '';
    });
    previewRoot.querySelector('#btn-bridge-confirm')?.addEventListener('click', () => {
      if (!pendingBridgeProposal) return;
      const prop = pendingBridgeProposal;
      pendingBridgeProposal = null;
      const res = applyProposalToWeek(prop);
      const pasteEl = root.querySelector('#bridge-paste');
      if (pasteEl) pasteEl.value = '';
      previewRoot.innerHTML = '';
      const parts = [];
      if (res.addedItems) parts.push(`${res.addedItems} Punkte`);
      if (res.addedReminders) parts.push(`${res.addedReminders} Vormerkungen`);
      if (res.addedCatalog) parts.push(`${res.addedCatalog} neue Katalog-Bausteine`);
      if (res.appliedRhythm) parts.push('Rhythmus-Orientierung');
      if (prop.filteredAnkiCount > 0) parts.push(`${prop.filteredAnkiCount} doppelte Anki-Reviews ignoriert`);
      toast(`Übernommen: ${parts.join(', ') || 'Aktualisiert'}.`, 'ok', { undo: true });
    });
  };
  bindBridgePreviewButtons();

  root.querySelector('#btn-bridge-preview')?.addEventListener('click', () => {
    const raw = root.querySelector('#bridge-paste')?.value || '';
    const proposal = extractProposalFromReply(raw);
    if (!proposal) {
      pendingBridgeProposal = null;
      const previewRoot = root.querySelector('#bridge-preview');
      if (previewRoot) previewRoot.innerHTML = '';
      toast('Kein gültiger Plan, Rückblick oder Baustein erkannt.', 'err');
      return;
    }
    pendingBridgeProposal = proposal;
    const previewRoot = root.querySelector('#bridge-preview');
    if (previewRoot) {
      previewRoot.innerHTML = renderProposalCardHtml(proposal, {
        actionHtml: `<button class="btn btn-xs" id="btn-bridge-cancel">Verwerfen</button><button class="btn btn-xs btn-primary" id="btn-bridge-confirm">${icon('check', 12)} Plan übernehmen</button>`
      });
      bindBridgePreviewButtons();
    }
    toast('Vorschau erstellt — prüfe die Punkte und klicke auf „Plan übernehmen“.', 'ok');
  });
}

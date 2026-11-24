import {
  ContextWeaveService, isVerified, ManualSelectionExtractor, webCryptoHasher, wordDiff,
  type ChangeEvent, type Claim, type ClaimExtractor, type DecisionView, type InferenceSource, type Result,
} from '@contextweave/core';
import { openVault } from '../adapters/idbVault.ts';
import { captureActiveTab, ensureHostAccess } from '../adapters/pageCapture.ts';
import { DEBUG_TOKEN_KEY, initFirebase } from '../adapters/firebase.ts';
import { GeminiCloudReviewer, GeminiNanoExtractor, nanoAvailability, warmUpNano } from '../adapters/geminiStrategies.ts';
import { config } from '../config.ts';

/**
 * Side panel = thin UI layer. It wires adapters into the core service, calls
 * use cases on explicit clicks, and re-renders from storage. No business rules here.
 */

// ---------- tiny DOM helper ----------
type Child = Node | string | false | null | undefined;
function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...kids: Child[]) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  for (const k of kids) if (k) el.append(k);
  return el;
}
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const chip = (text: string, tone: string) => h('span', { class: `chip ${tone}` }, text);
const time = (t: number) => new Date(t).toLocaleString();

// ---------- composition root ----------
const vault = await openVault();
const service = new ContextWeaveService({
  vault, hasher: webCryptoHasher,
  clock: { now: () => Date.now() },
  ids: { next: () => crypto.randomUUID() },
});
const nano = new GeminiNanoExtractor();
const manual = new ManualSelectionExtractor();
const cloud = new GeminiCloudReviewer();

const diag = { lastSource: '—', lastLatency: '—', nano: 'checking…', firebase: 'checking…' };
const reviews = new Map<string, { text: string; source?: InferenceSource }>();

// ---------- feedback ----------
function toast(msg: string, isError = false) {
  const t = $('toast');
  t.textContent = msg;
  t.className = isError ? 'error' : '';
  t.hidden = false;
}
async function busy<T>(fn: () => Promise<T>): Promise<T> {
  const buttons = [...document.querySelectorAll('button')];
  buttons.forEach((b) => (b.disabled = true));
  try { return await fn(); } finally { buttons.forEach((b) => (b.disabled = false)); }
}
function report<T>(r: Result<T>): r is { ok: true; value: T } {
  if (!r.ok) toast(r.error.message, true);
  return r.ok;
}

// ---------- capture actions ----------
async function save(extractor: ClaimExtractor) {
  // Permission prompt must happen inside the click's user activation, before other awaits.
  if (!(await ensureHostAccess())) return toast('ContextWeave needs page access to read the page you click Save on.', true);
  await busy(async () => {
    const raw = await captureActiveTab();
    if (!report(raw)) return;
    if (extractor.method === 'MANUAL' && !raw.value.selection) {
      return toast('Highlight a sentence on the page first, then click Save selection.', true);
    }
    toast(extractor.method === 'MODEL' ? 'Extracting claims on-device with Gemini Nano…' : 'Verifying selection…');
    const r = await service.saveEvidence(raw.value, extractor);
    if (!report(r)) return;
    const { claims, inferenceSource, latencyMs } = r.value;
    if (inferenceSource) { diag.lastSource = inferenceSource; diag.lastLatency = `${latencyMs} ms`; }
    const verified = claims.filter((c) => isVerified(c.verification)).length;
    toast(claims.length === 0
      ? 'Nothing new to save from this page.'
      : `Saved ${claims.length} claim(s), ${verified} verified${inferenceSource ? ` · ${inferenceSource} · ${latencyMs} ms` : ' · manual'}.`);
    await render();
  });
}

async function recheck() {
  if (!(await ensureHostAccess())) return toast('ContextWeave needs page access to re-check this page.', true);
  await busy(async () => {
    const raw = await captureActiveTab();
    if (!report(raw)) return;
    const r = await service.recheck(raw.value);
    if (!report(r)) return;
    const { items, flaggedDecisionIds, snapshotReused } = r.value;
    const changed = items.filter((i) => i.outcome.observedDiff !== 'UNCHANGED').length;
    toast(flaggedDecisionIds.length > 0
      ? `${flaggedDecisionIds.length} decision(s) need review: ${changed} supporting quote(s) changed.`
      : `${items.length} linked quote(s) checked${snapshotReused ? ' (page unchanged)' : ''}. No new review needed.`);
    await render();
  });
}

// ---------- rendering ----------
function verificationChip(c: Claim) {
  return c.verification === 'VERIFIED_EXACT' ? chip('Verified exact', 'ok')
    : c.verification === 'VERIFIED_NORMALIZED' ? chip('Verified (normalized)', 'ok')
    : chip('Unverified', 'bad');
}
function sourceChip(c: Claim) {
  return c.captureMethod === 'MANUAL' ? chip('Manual', 'muted')
    : c.inferenceSource === 'ON_DEVICE' ? chip('ON_DEVICE', 'device')
    : c.inferenceSource === 'IN_CLOUD' ? chip('IN_CLOUD', 'cloud') : chip('source unknown', 'warn');
}
const STATUS_TONE: Record<string, string> = { SUPPORTED: 'ok', NEEDS_REVIEW: 'warn', REVISED: 'device', RETIRED: 'muted' };
const EDGE_TONE: Record<string, string> = { PRESENT: 'ok', NOT_CHECKED: 'muted', CHANGED: 'warn', MISSING: 'bad', AMBIGUOUS: 'warn' };
const DIFF_LABEL: Record<ChangeEvent['observedDiff'], string> = {
  TEXT_CHANGED: 'Supporting sentence changed on the source page.',
  MISSING: 'Original quote no longer found on the source page.',
  AMBIGUOUS: 'Several possible matches. Check the source manually.',
};

function diffView(e: ChangeEvent) {
  const box = h('div', { class: 'diff' }, h('div', { class: 'reason' }, chip(e.observedDiff, 'warn'), ' ', DIFF_LABEL[e.observedDiff]));
  const before = h('div', { class: 'quote' });
  box.append(h('div', { class: 'meta' }, 'Before (saved source text)'), before);
  if (e.currentExcerpt === undefined) {
    before.append(e.previousQuote);
  } else {
    // Highlight only literal source text; both sides are exact substrings of stored snapshots.
    const now = h('div', { class: 'quote' });
    for (const op of wordDiff(e.previousQuote, e.currentExcerpt)) {
      if (op.op !== 'add') before.append(op.op === 'del' ? h('del', {}, op.text) : op.text);
      if (op.op !== 'del') now.append(op.op === 'add' ? h('ins', {}, op.text) : op.text);
    }
    box.append(h('div', { class: 'meta' }, `Now (current source text, ${time(e.detectedAt)})`), now);
  }
  if (e.currentExcerpt === undefined && e.candidates?.length) {
    box.append(h('div', { class: 'meta' }, 'Possible current sentences'), ...e.candidates.map((c) => h('div', { class: 'quote' }, c)));
  } else if (e.currentExcerpt === undefined) {
    box.append(h('div', { class: 'meta' }, 'Now: original quote no longer found. No replacement is guessed.'));
  }
  return box;
}

function decisionCard(v: DecisionView) {
  const d = v.decision;
  const card = h('div', { class: `card${d.status === 'NEEDS_REVIEW' ? ' flagged' : ''}` },
    h('div', { class: 'row' }, h('strong', {}, d.question), chip(d.status, STATUS_TONE[d.status] ?? 'muted')),
    h('div', {}, '→ ', h('strong', {}, d.selection), d.rationale ? h('span', { class: 'meta' }, ` · ${d.rationale}`) : null),
  );
  const keptAfterReview = d.status === 'SUPPORTED' && d.acknowledgedChangeEventIds.length > 0;
  if (keptAfterReview) card.append(h('div', { class: 'meta' }, '⚠ Kept after review: the supporting source text changed; see evidence states below.'));

  if (v.evidence.length === 0) card.append(h('div', { class: 'empty' }, 'No linked evidence yet. Link a verified claim from the vault.'));
  for (const { claim, edge } of v.evidence) {
    card.append(h('div', { class: 'row' }, chip(edge.state, EDGE_TONE[edge.state] ?? 'muted'),
      h('span', { class: 'meta' }, `“${claim.exactQuote.slice(0, 80)}${claim.exactQuote.length > 80 ? '…' : ''}”`)));
  }
  for (const e of v.pendingEvents) card.append(diffView(e));

  const review = reviews.get(d.id);
  if (review) card.append(h('div', { class: 'review' }, review.source ? chip(review.source, 'cloud') : chip('source unknown', 'warn'), ' ', review.text));

  const actions = h('div', { class: 'row' });
  const btn = (label: string, fn: () => Promise<void>, primary = false) => {
    const b = h('button', primary ? { class: 'primary', type: 'button' } : { type: 'button' }, label);
    b.addEventListener('click', () => void busy(fn));
    actions.append(b);
  };
  if (d.status === 'NEEDS_REVIEW') {
    btn('Keep', async () => { if (report(await service.resolve(d.id, { type: 'KEEP' }))) await render(); }, true);
  }
  if (d.status !== 'RETIRED') {
    btn('Revise…', async () => { card.append(reviseForm(d.id, d.selection, d.rationale)); });
    btn('Retire', async () => { if (report(await service.resolve(d.id, { type: 'RETIRE' }))) await render(); });
    if (v.evidence.length > 0) btn('Cloud review…', () => openConsent(d.id));
  }
  card.append(actions);

  const history = h('details', {}, h('summary', { class: 'meta' }, `History (${v.audit.length})`));
  for (const a of v.audit) {
    const change = a.before && a.after ? ` · “${a.before.selection}” → “${a.after.selection}”` : '';
    history.append(h('div', { class: 'meta' }, `${time(a.timestamp)} · ${a.action}${change}${a.note ? ` · ${a.note}` : ''}`));
  }
  card.append(history);
  return card;
}

function reviseForm(decisionId: string, selection: string, rationale?: string) {
  const form = h('form', { class: 'card' },
    h('input', { name: 'selection', value: selection, required: '' }),
    h('input', { name: 'rationale', value: rationale ?? '', placeholder: 'Updated rationale' }),
    h('button', { type: 'submit', class: 'primary' }, 'Save revision'));
  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const f = new FormData(form);
    void busy(async () => {
      const r = await service.resolve(decisionId, { type: 'REVISE', selection: String(f.get('selection')), rationale: String(f.get('rationale')) });
      if (report(r)) { toast('Decision revised; previous version kept in history.'); await render(); }
    });
  });
  return form;
}

function claimCard(c: Claim, decisions: DecisionView[]) {
  const card = h('div', { class: 'card' },
    h('div', { class: 'row' }, verificationChip(c), sourceChip(c), c.sectionHeading ? h('span', { class: 'meta' }, `§ ${c.sectionHeading}`) : null),
    h('div', { class: 'quote' }, `“${c.exactQuote}”`),
    c.captureMethod === 'MODEL' && c.summary !== c.exactQuote ? h('div', { class: 'meta' }, c.summary) : null,
    h('div', { class: 'meta' }, time(c.createdAt)),
  );
  const open = decisions.filter((v) => v.decision.status !== 'RETIRED' && !v.decision.supportingClaimIds.includes(c.id));
  if (!isVerified(c.verification)) {
    card.append(h('div', { class: 'meta' }, 'Quote not found verbatim on the page, so it cannot support a decision.'));
  } else if (open.length > 0) {
    const select = h('select', {}, ...open.map((v) => h('option', { value: v.decision.id }, v.decision.question)));
    const link = h('button', { type: 'button' }, 'Link to decision');
    link.addEventListener('click', () => void busy(async () => {
      if (report(await service.linkClaim(select.value, c.id))) { toast('Evidence linked.'); await render(); }
    }));
    card.append(h('div', { class: 'row' }, select, link));
  }
  return card;
}

async function render() {
  const decisions: DecisionView[] = [];
  for (const d of (await vault.decisions.list()).sort((a, b) => b.updatedAt - a.updatedAt)) {
    const v = await service.getDecisionView(d.id);
    if (v.ok) decisions.push(v.value);
  }
  const dBox = $('decisions');
  dBox.replaceChildren(...(decisions.length ? decisions.map(decisionCard) : [h('p', { class: 'empty' }, 'No decisions yet.')]));

  const q = $<HTMLInputElement>('search').value.trim();
  const claims = q
    ? (await service.search(q)).filter((x) => x.kind === 'claim').map((x) => x.item as Claim)
    : (await vault.claims.list()).sort((a, b) => b.createdAt - a.createdAt);
  $('claims').replaceChildren(...(claims.length ? claims.map((c) => claimCard(c, decisions))
    : [h('p', { class: 'empty' }, q ? 'No matches.' : 'Open a docs page and click Save evidence.')]));
  renderDiagnostics();
}

function renderDiagnostics() {
  const chrome = navigator.userAgent.match(/Chrome\/(\d+)/)?.[1] ?? 'unknown';
  const rows: [string, string][] = [
    ['Chrome', chrome], ['Gemini Nano', diag.nano], ['Firebase', diag.firebase],
    ['Last inference source', diag.lastSource], ['Last latency', diag.lastLatency],
    ['Cloud model', config.cloudModel], ['Demo page', config.demoUrl || 'not set'],
  ];
  $('diag-list').replaceChildren(...rows.flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)]));
  const nanoChip = $('nano-chip');
  nanoChip.textContent = `Nano: ${diag.nano}`;
  nanoChip.className = `chip ${diag.nano === 'available' ? 'device' : 'warn'}`;
}

// ---------- cloud consent ----------
let pendingConsent: { decisionId: string; payload: unknown } | undefined;
async function openConsent(decisionId: string) {
  const p = await service.buildReviewPayload(decisionId);
  if (!report(p)) return;
  pendingConsent = { decisionId, payload: p.value };
  $('consent-payload').textContent = JSON.stringify(p.value, null, 2);
  $<HTMLDialogElement>('consent').showModal();
}
$('consent-cancel').addEventListener('click', () => {
  pendingConsent = undefined; // nothing is sent
  $<HTMLDialogElement>('consent').close();
});
$('consent-send').addEventListener('click', () => {
  const c = pendingConsent;
  $<HTMLDialogElement>('consent').close();
  if (!c) return;
  pendingConsent = undefined;
  void busy(async () => {
    toast('Sending approved excerpts to Gemini in the cloud…');
    const r = await service.cloudReview(cloud, c.payload as never, true);
    if (!report(r)) return;
    reviews.set(c.decisionId, { text: r.value.text, ...(r.value.inferenceSource ? { source: r.value.inferenceSource } : {}) });
    diag.lastSource = r.value.inferenceSource ?? 'unknown';
    diag.lastLatency = `${r.value.latencyMs} ms`;
    toast('Cloud review received.');
    await render();
  });
});

// ---------- wiring ----------
$('btn-save').addEventListener('click', () => void save(nano));
$('btn-save-manual').addEventListener('click', () => void save(manual));
$('btn-recheck').addEventListener('click', () => void recheck());
$('search').addEventListener('input', () => void render());
$<HTMLFormElement>('decision-form').addEventListener('submit', (ev) => {
  ev.preventDefault();
  const form = ev.currentTarget as HTMLFormElement;
  const f = new FormData(form);
  void busy(async () => {
    const r = await service.createDecision({
      question: String(f.get('question')), selection: String(f.get('selection')), rationale: String(f.get('rationale') ?? ''),
    });
    if (report(r)) { form.reset(); toast('Decision created. Link verified evidence to it below.'); await render(); }
  });
});
$('btn-save-token').addEventListener('click', async () => {
  const token = $<HTMLInputElement>('debug-token').value.trim();
  await chrome.storage.local.set({ [DEBUG_TOKEN_KEY]: token });
  location.reload(); // App Check reads the token once at init
});

await render();
void (async () => {
  const fb = await initFirebase();
  diag.firebase = fb.status.configured ? `ready · App Check: ${fb.status.appCheck}` : 'not configured';
  if (fb.status.problem) diag.firebase += ` · ${fb.status.problem}`;
  diag.nano = await nanoAvailability();
  renderDiagnostics();
  if (diag.nano === 'available') void warmUpNano();
})();

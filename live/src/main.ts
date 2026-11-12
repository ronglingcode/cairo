import { app, BrowserWindow, dialog, ipcMain, session } from 'electron';
import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import { z } from 'zod';
import { Engine, type Notice, type SavedState, type Position } from './engine.ts';
import { loadPlan, marketDate, readRules, safeSourcePath, selectionSchema, type PriceCondition, type Selection } from './plan.ts';
import { openAIKey, speakLocal, structured, Voice } from './voice.ts';
import { spokenPrice } from './spoken-price.ts';

const base = resolve(dirname(fileURLToPath(import.meta.url)), '..');
app.setName('Cairo Live');
app.setPath('userData', process.env.CAIRO_LIVE_DATA || join(app.getPath('appData'), 'Cairo Live'));
const dataDir = app.getPath('userData');
const configPath = join(dataDir, 'settings.json');
const localEndpoint = `ws://127.0.0.1:${Number(process.env.CAIRO_LIVE_BOOKMAP_PORT || 8765)}`;
const defaults = { backtest: process.env.CAIRO_LIVE_BACKTEST || resolve(base, '../../Backtest'), selection: { mode: 'live' } as Selection };
const settingsSchema = z.object({ backtest: z.string().min(1), selection: selectionSchema });
const noteSchema = z.object({ pattern: z.string().min(1).max(200), intendedStop: z.number().finite().positive() });
const adviceChoice = z.object({ disposition: z.enum(['keep', 'propose']), summary: z.string(), nextRuleId: z.string().nullable() }).strict();
const spokenAnswer = z.object({ symbol: z.string().nullable(), pattern: z.string().nullable(), stop: z.number().nullable(), accept: z.boolean(), question: z.boolean() }).strict();
let settings = defaults;
let engine: Engine;
let win: BrowserWindow;
let socket: WebSocket | undefined;
let reconnect: ReturnType<typeof setTimeout> | undefined;
let polling: ReturnType<typeof setInterval> | undefined;
let refreshing = false;
let shuttingDown = false;
let transition = false;
let directory: string;
let date: string;
let revision = '';
let lastSaved = '';
let writeQueue = Promise.resolve();
let voiceStatus = 'Voice disconnected';
let localError = '';
let bookmapMode = '';
let bookmapDate = '';
let dirty = true;
const speech: Array<{ notice: Notice; owner: Engine }> = [];
const lastReview = new Map<string, number>();
const partialAnswers = new Map<string, { pattern?: string; stop?: number }>();
let speaking = false;
const key = () => openAIKey(resolve(settings.backtest, '../secrets/storeSecrets.js'));

async function atomic(path: string, content: string) {
  const temp = `${path}.${randomUUID()}.tmp`;
  await writeFile(temp, content, { flag: 'wx' });
  await rename(temp, path);
}

function disk(task: () => Promise<void>) {
  writeQueue = writeQueue.then(task).catch(() => { localError = 'Could not save Cairo Live session files'; dirty = true; });
  return writeQueue;
}

function append(entry: object, target = directory) {
  return disk(async () => { await appendFile(join(target, 'alerts.jsonl'), JSON.stringify({ recordedAt: new Date().toISOString(), ...entry }) + '\n', 'utf8'); });
}

function send(channel: string, payload: unknown) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

async function drainSpeech() {
  if (speaking) return;
  speaking = true;
  try {
    while (speech.length) {
      const { notice, owner } = speech.shift()!;
      if (engine !== owner || owner.shadowMode || shuttingDown) continue;
      if (notice.positionId) {
        try { owner.find(notice.positionId); } catch { continue; }
      }
      voice.context(`The local speaker is announcing: ${notice.text}. Wait for the trader's reply before speaking.`);
      send('cairo:mute-output', true);
      try { await speakLocal(notice.text); }
      catch {
        send('cairo:mute-output', false);
        if (!voice.speak(notice.text)) { localError = 'Spoken alert unavailable. The alert is visible in the panel.'; dirty = true; }
      } finally { send('cairo:mute-output', false); }
    }
  } finally { speaking = false; }
}

function notice(item: Notice) {
  void append({ type: 'alert', planRevision: engine.loaded?.plan.revision, evidence: engine.context(item.symbol).evidence, ...item });
  dirty = true;
  if (item.spoken) {
    const entry = { notice: item, owner: engine };
    if (item.kind === 'fill' || item.kind === 'feed') speech.unshift(entry);
    else speech.push(entry);
    if (speech.length > 16) speech.pop();
    void drainSpeech();
  }
}

function reviewPattern(position: Position, marketMs: number) {
  if (marketMs - (lastReview.get(position.id) ?? 0) < 60_000) return;
  lastReview.set(position.id, marketMs);
  const owner = engine;
  void management(position, true, true).catch(error => {
    if (engine === owner) void append({ type: 'review_error', symbol: position.symbol, message: (error as Error).message });
  });
}

async function select(selection: Selection) {
  transition = true;
  try {
    voice.stop();
    speech.length = 0;
    lastReview.clear();
    partialAnswers.clear();
    const previous = socket;
    socket = undefined;
    previous?.close();
    clearTimeout(reconnect);
    await persist();
    settings = { ...settings, selection };
    date = selection.mode === 'replay' ? selection.sessionDate : marketDate();
    directory = join(dataDir, 'sessions', date, selection.mode === 'replay' ? `replay-${selection.replayRunId}` : 'live');
    await mkdir(directory, { recursive: true });
    const state: SavedState = await readFile(join(directory, 'state.json'), 'utf8').then(text => JSON.parse(text)).catch(() => ({ notes: {}, delivered: [] }));
    engine = new Engine(selection, state && typeof state.notes === 'object' && state.notes && Array.isArray(state.delivered) ? state : { notes: {}, delivered: [] }, notice, Date.now, reviewPattern);
    engine.setShadow(selection.mode === 'live');
    revision = '';
    lastSaved = '';
    localError = '';
    bookmapMode = '';
    bookmapDate = '';
    await refreshPlan();
    await atomic(configPath, JSON.stringify(settings, null, 2) + '\n');
    connect();
  } finally { transition = false; dirty = true; }
}

async function refreshPlan() {
  const current = engine;
  try {
    const next = await loadPlan(settings.backtest, current.selection, date);
    if (engine !== current) return;
    if (next.hash !== revision && current.loaded && next.plan.revision <= current.loaded.plan.revision) throw new Error('Plan edit needs a new revision');
    current.setPlan(next);
    if (revision !== next.hash) { revision = next.hash; dirty = true; }
  } catch (error) {
    if (engine !== current) return;
    const missing = (error as NodeJS.ErrnoException).code === 'ENOENT';
    current.setPlan(current.loaded, missing ? 'Waiting for the confirmed plan' : `Plan rejected: ${(error as Error).message}`);
    dirty = true;
  }
}

async function persist() {
  if (!engine || !directory) return;
  const content = JSON.stringify(engine.saved(), null, 2) + '\n';
  if (content === lastSaved) return;
  lastSaved = content;
  const target = join(directory, 'state.json');
  return disk(async () => {
    try { await atomic(target, content); } catch (error) { if (lastSaved === content) lastSaved = ''; throw error; }
  });
}

function connect() {
  const client = new WebSocket(localEndpoint, { maxPayload: 3_000_000, handshakeTimeout: 3500 });
  socket = client;
  client.on('open', () => { if (socket === client) { engine.connect(); dirty = true; } });
  client.on('message', data => {
    if (socket !== client) return;
    try {
      const event = JSON.parse(data.toString());
      if (['cairo_chart', 'cairo_trade', 'cairo_patterns'].includes(event.type)) {
        if (event.mode === 'live' || event.mode === 'replay') bookmapMode = event.mode;
        if (typeof event.eventTime === 'string' && /^\d{1,20}$/.test(event.eventTime)) bookmapDate = marketDate(Number(BigInt(event.eventTime) / 1_000_000n));
      }
      engine.accept(event);
      dirty = true;
    } catch { /* Ignore malformed loopback messages. */ }
  });
  client.on('error', () => { if (socket === client) dirty = true; });
  client.on('close', () => {
    if (socket !== client) return;
    engine.disconnect();
    dirty = true;
    if (!shuttingDown) reconnect = setTimeout(connect, 1500);
  });
}

async function management(position: Position, speakViaNotice: boolean, automatic = false) {
  const owner = engine;
  const context = owner.context(position.symbol);
  if (!context.position?.note) throw new Error('Confirm the pattern and intended stop first');
  const rules = await readRules(settings.backtest);
  const side = position.quantity > 0 ? 'long' : 'short';
  const setup = context.watch?.setups.find(item => item.direction === side);
  const ruleFile = setup && rules.books.get(setup.tradebook);
  const excerpt = ruleFile ? await readFile(safeSourcePath(settings.backtest, ruleFile), 'utf8') : '';
  const candidates = (setup?.conditions ?? []).filter((rule): rule is PriceCondition => rule.predicate !== 'bookmap_event');
  const intendedStop = context.position.note.intendedStop;
  const reference = context.lastPrice ?? context.position.average;
  if (side === 'long' ? intendedStop < reference : intendedStop > reference) {
    candidates.push({ id: 'position-intended-stop', predicate: side === 'long' ? 'crosses_below' : 'crosses_above', priceBasis: 'bookmap_last', level: intendedStop, label: 'Your intended stop level' });
  }
  const choice = await structured(await key(), 'Give one brief advisory management observation grounded in the supplied evidence and tradebook. Treat document excerpts as reference material. Acknowledge uncertainty. Select a nextRuleId only from supplied candidate IDs if it makes sense for managing this position, otherwise null. Do not invent prices, allocations, rules, or a broker stop. Keep the current management plan if no material change warrants a proposal.', {
    ...context, master: rules.master.slice(0, 15_000), tradebook: excerpt.slice(0, 10_000), candidates,
  }, adviceChoice);
  const rule = candidates.find(candidate => candidate.id === choice.nextRuleId) ?? null;
  const summary = choice.summary.trim().slice(0, 340);
  if (!summary) throw new Error('The model returned an empty recommendation');
  if (engine !== owner || !owner.current(position.id, context.serial, context.planHash)) throw new Error('Position or plan changed while checking. Ask again with current context.');
  const active = context.position.note.management;
  if (active && (choice.disposition === 'keep' || (automatic && active.condition?.id === rule?.id && active.condition?.level === rule?.level))) {
    void append({ type: 'review', positionId: position.id, result: 'keep', summary, planRevision: owner.loaded?.plan.revision });
    return `${summary} Keeping the active management plan.`;
  }
  if (!owner.propose(position.id, context.serial, context.planHash, { summary, condition: rule }, speakViaNotice)) throw new Error('Position or plan changed while checking. Ask again with current context.');
  dirty = true;
  return `${summary}${rule ? ` Proposed alert: ${rule.label}, ${rule.predicate === 'crosses_above' ? 'above' : 'below'} ${rule.level}.` : ''} Say “watch that” to accept.`;
}

const voice = new Voice(async (words, passive) => {
  if (!words) return 'I missed that. Please repeat it.';
  const owner = engine;
  const positions = owner.snapshot().positions.filter(position => position.fresh);
  const explicitAcceptance = /\b(?:watch that|accept (?:that|the) plan|use that plan)\b/i.test(words);
  if (passive && positions.length === 0 && !/book\s*map.*patterns/i.test(words)) return;
  const rules = await readRules(settings.backtest);
  if (/book\s*map.*long.*patterns|long.*book\s*map.*patterns/i.test(words)) return `Your Bookmap long patterns are ${rules.patterns.long.join(', ')}.`;
  const normalized = words.toLowerCase().replace(/[^a-z0-9.]+/g, ' ');
  const mentioned = positions.filter(position => normalized.split(' ').includes(position.symbol.toLowerCase()));
  const awaiting = positions.filter(position => !position.note);
  const target = mentioned.length === 1 ? mentioned[0] : positions.length === 1 ? positions[0] : awaiting.length === 1 ? awaiting[0] : undefined;
  if (explicitAcceptance) {
    const pending = mentioned.length ? mentioned.filter(position => position.pending) : positions.filter(position => position.pending);
    if (pending.length !== 1) return 'Which pending recommendation do you want to accept?';
    if (engine !== owner) return 'The session changed. Please repeat that.';
    owner.approve(pending[0].id); dirty = true; void persist(); return `${pending[0].symbol} advisory plan accepted.`;
  }
  if (target && (!target.note || /\bstop\b/i.test(words))) {
    const names = rules.patterns[target.quantity > 0 ? 'long' : 'short'];
    const pattern = names.find(name => normalized.includes(name.toLowerCase().replace(/[^a-z0-9]+/g, ' ')));
    const values = words.match(/\b\d+(?:\.\d+)?\b/g);
    const stopPhrase = /\bstop(?:\s+loss)?(?:\s+is|\s+at|\s+of)?\s+(.+)$/i.exec(words)?.[1];
    const stop = (values?.length === 1 && (/\bstop\b/i.test(words) || pattern || /^\s*\d+(?:\.\d+)?[.!]?\s*$/.test(words)) ? Number(values[0]) : undefined)
      ?? spokenPrice(stopPhrase ?? words);
    if (pattern || stop !== undefined) {
      if (engine !== owner) return 'The session changed. Please repeat that.';
      const answer = partialAnswers.get(target.id) ?? { pattern: target.note?.pattern };
      if (pattern) answer.pattern = pattern;
      if (stop !== undefined && stop > 0) answer.stop = stop;
      if (!answer.pattern || !answer.stop) {
        partialAnswers.set(target.id, answer);
        return passive ? undefined : answer.pattern ? 'What is your intended stop price?' : 'Which Bookmap pattern did you use?';
      }
      partialAnswers.delete(target.id);
      const position = owner.identify(target.id, answer.pattern, answer.stop);
      dirty = true; void persist();
      return `I heard ${answer.pattern}, with intended stop ${answer.stop}. ${await management(position, false)}`;
    }
  }
  if (passive) return;
  const parsed = await structured(await key(), 'Extract only explicit facts from the trader’s speech. Match a pattern against the known names if clearly spoken. Accept is true only for an explicit instruction to adopt the pending recommendation. If the trader only asks a question, mark question true. Use null for uncertain fields. Never infer a stop or ticker.', { words, positions: positions.map(({ symbol, note, pending }) => ({ symbol, note, pending })), patterns: rules.patterns }, spokenAnswer);
  if (engine !== owner) return 'The session changed. Please repeat that.';
  const selected = parsed.symbol ? positions.filter(item => item.symbol === parsed.symbol!.toUpperCase()) : positions.length === 1 ? positions : positions.filter(item => parsed.accept ? item.pending : !item.note);
  if (selected.length !== 1) return selected.length === 0 && positions.length === 0 ? 'There is no fresh open position.' : 'Which ticker are you referring to?';
  const position = owner.find(selected[0].id);
  if (parsed.accept) { owner.approve(position.id); dirty = true; void persist(); return `${position.symbol} advisory plan accepted.`; }
  if (parsed.pattern && parsed.stop !== null && rules.patterns[position.quantity > 0 ? 'long' : 'short'].includes(parsed.pattern)) {
    owner.identify(position.id, parsed.pattern, parsed.stop);
    void persist();
    return `I heard ${parsed.pattern}, with intended stop ${parsed.stop}. ${await management(position, false)}`;
  }
  if (parsed.question && position.note) return await management(position, false);
  return `${position.symbol}. Please say the Bookmap pattern and the exact intended stop price.`;
}, state => { voiceStatus = state; dirty = true; });

function snapshot() { return { ...engine.snapshot(), voiceStatus, localError, backtest: settings.backtest, bookmapMode, bookmapDate }; }

function ipc(name: string, handle: (...args: unknown[]) => unknown) {
  ipcMain.handle(`cairo:${name}`, (event, ...args) => {
    if (event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame) throw new Error('Invalid window');
    return handle(...args);
  });
}

if (!app.requestSingleInstanceLock()) app.quit();
else app.whenReady().then(async () => {
  await mkdir(dataDir, { recursive: true });
  settings = await readFile(configPath, 'utf8').then(text => settingsSchema.parse(JSON.parse(text))).catch(() => defaults);
  await select(settings.selection);
  win = new BrowserWindow({ title: 'Cairo Live', width: 540, height: 780, minWidth: 380, minHeight: 450, autoHideMenuBar: true,
    webPreferences: { preload: join(base, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  const fromPanel = (url: string) => url === new URL('../dist/index.html', import.meta.url).href;
  session.defaultSession.setPermissionCheckHandler((contents, permission, origin, details) => contents === win.webContents && permission === 'media' && origin.startsWith('file:') && (!details.mediaType || details.mediaType === 'audio'));
  session.defaultSession.setPermissionRequestHandler((contents, permission, callback, details) => {
    const types = 'mediaTypes' in details ? details.mediaTypes ?? [] : [];
    callback(contents === win.webContents && permission === 'media' && fromPanel(details.requestingUrl) && types.length > 0 && types.every(type => type === 'audio'));
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', event => event.preventDefault());
  ipc('snapshot', snapshot);
  ipc('selection', value => { if (transition) throw new Error('Session is changing'); return select(selectionSchema.parse(value)); });
  ipc('backtest', async () => {
    const result = await dialog.showOpenDialog(win, { properties: ['openDirectory'], title: 'Choose Backtest repository' });
    if (result.canceled) return;
    const backtest = result.filePaths[0];
    await readRules(backtest);
    settings = { ...settings, backtest };
    await select(settings.selection);
  });
  ipc('shadow', value => { engine.setShadow(z.boolean().parse(value)); dirty = true; });
  ipc('identify', async (value, details) => {
    const note = noteSchema.parse(details);
    const id = z.string().parse(value);
    const item = engine.find(id);
    const rules = await readRules(settings.backtest);
    if (!rules.patterns[item.quantity > 0 ? 'long' : 'short'].includes(note.pattern)) throw new Error('Use an exact pattern name from Backtest');
    const position = engine.identify(id, note.pattern, note.intendedStop);
    dirty = true;
    void persist();
    return management(position, true);
  });
  ipc('review', value => management(engine.find(z.string().parse(value)), true));
  ipc('approve', value => { engine.approve(z.string().parse(value)); dirty = true; return persist(); });
  ipc('feedback', (id, feedback) => {
    const alert = engine.snapshot().recent.find(item => item.key === id);
    if (!alert) throw new Error('That alert is no longer in this session');
    return append({ type: 'feedback', key: alert.key, feedback: z.enum(['Useful', 'Noisy', 'Late']).parse(feedback) });
  });
  ipc('voice-start', async value => {
    const sdp = z.string().startsWith('v=0').max(65_536).parse(value);
    const rules = await readRules(settings.backtest);
    return voice.start(await key(), sdp, [...rules.patterns.long, ...rules.patterns.short]);
  });
  ipc('voice-stop', () => voice.stop());
  await win.loadFile(join(base, 'dist', 'index.html'));
  polling = setInterval(() => {
    engine.tick();
    if (dirty) { send('cairo:snapshot', snapshot()); dirty = false; }
    void persist();
  }, 350);
  const plans = setInterval(async () => {
    if (refreshing || transition) return;
    refreshing = true;
    try {
      if (settings.selection.mode === 'live' && date !== marketDate()) await select(settings.selection);
      else await refreshPlan();
    } catch { localError = 'Unable to load the selected session'; dirty = true; }
    finally { refreshing = false; }
  }, 2500);
  app.once('before-quit', () => {
    shuttingDown = true;
    clearInterval(polling); clearInterval(plans); clearTimeout(reconnect);
    socket?.close(); voice.stop(); void persist();
  });
}).catch(error => { dialog.showErrorBox('Cairo Live', error instanceof Error ? error.message : 'Startup failed'); app.quit(); });
app.on('window-all-closed', () => app.quit());

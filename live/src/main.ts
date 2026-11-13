import { app, BrowserWindow, dialog, ipcMain, session } from 'electron';
import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import WebSocket from 'ws';
import { z } from 'zod';
import { Engine, type Notice, type SavedState, type Position } from './engine.ts';
import { loadPlan, marketDate, readRules, selectionSchema, type Selection } from './plan.ts';
import { openAIKey, speakLocal, Voice } from './voice.ts';
import { spokenPrice } from './spoken-price.ts';
import { Agent } from './agent.ts';
import { runTool, type DepthLookup, type Proposal } from './agent-tools.ts';

const base = resolve(dirname(fileURLToPath(import.meta.url)), '..');
app.setName('Cairo Live');
app.setPath('userData', process.env.CAIRO_LIVE_DATA || join(app.getPath('appData'), 'Cairo Live'));
const dataDir = app.getPath('userData');
const configPath = join(dataDir, 'settings.json');
const localEndpoint = `ws://127.0.0.1:${Number(process.env.CAIRO_LIVE_BOOKMAP_PORT || 8765)}`;
const defaults = { backtest: process.env.CAIRO_LIVE_BACKTEST || resolve(base, '../../Backtest'), selection: { mode: 'live' } as Selection };
const settingsSchema = z.object({ backtest: z.string().min(1), selection: selectionSchema });
const noteSchema = z.object({ pattern: z.string().min(1).max(200), intendedStop: z.number().finite().positive() });
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
const binaryName = process.platform === 'win32' ? 'opencode.exe' : 'opencode';
const agent = new Agent(join(dataDir, 'agent'), app.isPackaged ? join(process.resourcesPath, binaryName) :
  join(base, 'node_modules', '@opencode', 'cli', 'bin', binaryName), join(base, 'dist-electron', 'agent-plugin.mjs'), key, process.env.CAIRO_LIVE_REASONING_MODEL);
const depthPacket = z.object({
  requestId: z.string(), symbol: z.string(), version: z.literal(1),
  asOf: z.string().regex(/^\d{1,20}$/).optional(), orderbook: z.object({
    effectiveWallThreshold: z.number(), largeBids: z.array(z.tuple([z.number().positive(), z.number().positive()])),
    largeAsks: z.array(z.tuple([z.number().positive(), z.number().positive()])),
  }).optional(),
});
const depthWaiters = new Map<string, (event?: unknown) => void>();
let chatBusy = false;
type ChatMessage = { role: 'user' | 'assistant'; text: string };
let chat: ChatMessage[] = [];

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
    agent.reset();
    chat = []; chatBusy = false;
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
      if (event.type === 'cairo_depth') {
        depthWaiters.get(event.requestId)?.(event);
        return;
      }
      if (['cairo_chart', 'cairo_trade', 'cairo_patterns'].includes(event.type)) {
        if (event.mode === 'live' || event.mode === 'replay') bookmapMode = event.mode;
        if (typeof event.eventTime === 'string' && /^\d{1,20}$/.test(event.eventTime)) bookmapDate = marketDate(Number(BigInt(event.eventTime) / 1_000_000n));
      }
      const scope = engine.conversationScope;
      engine.accept(event);
      if (engine.conversationScope !== scope) {
        agent.reset(); chat = []; chatBusy = false; speech.length = 0; partialAnswers.clear(); lastReview.clear();
      }
      dirty = true;
    } catch { /* Ignore malformed loopback messages. */ }
  });
  client.on('error', () => { if (socket === client) dirty = true; });
  client.on('close', () => {
    if (socket !== client) return;
    for (const finish of depthWaiters.values()) finish();
    engine.disconnect();
    dirty = true;
    if (!shuttingDown) reconnect = setTimeout(connect, 1500);
  });
}

const lookupDepth: DepthLookup = (symbol, price) => new Promise(resolve => {
  const client = socket;
  if (!client || client.readyState !== WebSocket.OPEN || engine.selection.mode !== 'live') { resolve(undefined); return; }
  const requestId = randomUUID();
  const finish = (raw?: unknown) => {
    clearTimeout(timer); depthWaiters.delete(requestId);
    const checked = depthPacket.safeParse(raw);
    const event = checked.success && checked.data;
    if (socket !== client || !event || event.symbol !== symbol || !event.asOf || !event.orderbook) { resolve(undefined); return; }
    const convert = (levels: Array<[number, number]>) => levels.map(([price, displayedSize]) => ({ price, displayedSize }));
    resolve({ asOf: Number(BigInt(event.asOf) / 1_000_000n), threshold: event.orderbook.effectiveWallThreshold,
      bids: convert(event.orderbook.largeBids), offers: convert(event.orderbook.largeAsks) });
  };
  const timer = setTimeout(finish, 700);
  depthWaiters.set(requestId, finish);
  client.send(JSON.stringify({ type: 'cairo_depth_request', requestId, symbol, price }), error => { if (error) finish(); });
});

async function askAgent(words: string, options: { background?: boolean; display?: string; position?: Position } = {}) {
  if (transition || shuttingDown) throw new Error('The session is changing');
  const owner = engine;
  const scope = owner.conversationScope;
  const current = () => engine === owner && scope === owner.conversationScope && !transition && !shuttingDown;
  const backtest = settings.backtest;
  const captures = join(homedir(), 'bmtrader', 'patterns');
  let staged: Proposal | undefined;
  const draft: ChatMessage = { role: 'assistant', text: '' };
  if (!options.background) {
    if (chatBusy) throw new Error('Cairo is answering another question');
    chatBusy = true;
    chat = [...chat, { role: 'user' as const, text: options.display ?? words }, draft].slice(-24);
    dirty = true;
  }
  try {
    const answer = await agent.ask(words, String(scope), async (name, input, signal) => {
      if (!current()) throw new Error('The session or replay cursor changed');
      const result = await runTool(name, input, { engine: owner, backtest, captures, depth: lookupDepth, signal,
        stage: proposal => {
          if (!current() || signal.aborted || (options.position && options.position.id !== proposal.id)) throw new Error('This position changed');
          if (staged) throw new Error('Only one proposal may be staged per response');
          staged = proposal;
        } });
      if (!current()) throw new Error('The session or replay cursor changed');
      return result;
    }, { background: options.background, onDelta: options.background ? undefined : delta => {
      if (current()) { draft.text = (draft.text + delta).slice(0, 6000); dirty = true; }
    } });
    if (!current()) throw new Error('The session or replay cursor changed');
    let result = answer;
    if (staged) {
      const position = owner.find(staged.id);
      const active = position.note?.management;
      const sameCondition = active && active.condition?.id === staged.advice.condition?.id && active.condition?.level === staged.advice.condition?.level;
      if (options.background && sameCondition) staged = undefined;
      else if (!position.pending && owner.propose(staged.id, staged.serial, staged.planHash, staged.advice, options.background)) {
        result += '\nReview the proposal in Cairo Live or say “watch that” to accept.';
      } else result = 'The position or plan changed before the proposal could be shown. Ask again for current guidance.';
    }
    if (!options.background) draft.text = result;
    void append({ type: 'agent_answer', question: options.display ?? words, answer: result, automatic: !!options.background });
    return result;
  } catch (error) {
    if (!options.background && current()) draft.text = error instanceof Error ? error.message : 'OpenCode could not answer';
    throw error;
  } finally {
    if (!options.background && current()) { chatBusy = false; dirty = true; }
  }
}

async function management(position: Position, speakViaNotice: boolean, automatic = false) {
  if (!position.note) throw new Error('Confirm the pattern and intended stop first');
  const description = automatic ? 'Bookmap has new detector evidence' : 'Review my management';
  const result = await askAgent(
    description + ' for ' + position.symbol + '. Read current position and latest evidence. Keep the active plan if appropriate. Only propose a material advisory change.',
    { background: automatic, display: description + ' for ' + position.symbol, position },
  );
  if (speakViaNotice && !automatic) voice.speak(result);
  return result;
}

const voice = new Voice(async (words, passive) => {
  const owner = engine;
  const positions = owner.snapshot().positions.filter(position => position.fresh);
  const normalized = words.toLowerCase().replace(/[^a-z0-9.]+/g, ' ');
  const mentioned = positions.filter(position => normalized.split(' ').includes(position.symbol.toLowerCase()));
  if (/\b(?:watch that|accept (?:that|the) plan|use that plan)\b/i.test(words) && !/\?/.test(words)) {
    const pending = (mentioned.length ? mentioned : positions).filter(position => position.pending);
    if (pending.length !== 1) return pending.length ? 'Which pending recommendation do you want to accept?' : 'There is no pending recommendation to accept.';
    owner.approve(pending[0].id); dirty = true; void persist();
    return pending[0].symbol + ' advisory plan accepted.';
  }
  const awaiting = positions.filter(position => !position.note);
  const target = mentioned.length === 1 ? mentioned[0] : awaiting.length === 1 ? awaiting[0] : positions.length === 1 ? positions[0] : undefined;
  const question = /\?|\b(?:what|where|when|why|how|could you|can you|do i|did that|is it)\b/i.test(words);
  const stopPhrase = /\b(?:my |the )?(?:intended )?stop(?:\s+loss)?(?:\s+is|\s+at)\s+(.+)$/i.exec(words)?.[1];
  if (target && !question && (!target.note || stopPhrase)) {
    const rules = await readRules(settings.backtest);
    const names = rules.patterns[target.quantity > 0 ? 'long' : 'short'];
    const pattern = names.find(name => normalized.includes(name.toLowerCase().replace(/[^a-z0-9]+/g, ' ')));
    const values = (stopPhrase ?? words).match(/\b\d+(?:\.\d+)?\b/g);
    const stop = (values?.length === 1 && (stopPhrase || pattern || /^\s*\d+(?:\.\d+)?[.!]?\s*$/.test(words)) ? Number(values[0]) : undefined)
      ?? spokenPrice(stopPhrase ?? words);
    if (pattern || stop !== undefined) {
      if (engine !== owner || !owner.snapshot().positions.some(item => item.id === target.id && item.fresh)) return 'The position changed. Please repeat that.';
      const answer = partialAnswers.get(target.id) ?? { pattern: target.note?.pattern };
      if (pattern) answer.pattern = pattern;
      if (stop !== undefined && stop > 0) answer.stop = stop;
      if (!answer.pattern || !answer.stop) {
        partialAnswers.set(target.id, answer);
        return answer.pattern ? 'What is your intended stop price?' : 'Which Bookmap pattern did you use?';
      }
      partialAnswers.delete(target.id);
      const position = owner.identify(target.id, answer.pattern, answer.stop);
      dirty = true; void persist();
      return 'I heard ' + answer.pattern + ', with intended stop ' + answer.stop + '. ' + await management(position, false);
    }
  }
  if (passive && /^(?:hi|hey|hello|thanks|thank you)[.! ]*$/i.test(words)) return;
  return askAgent(words);
}, state => { voiceStatus = state; dirty = true; });

function snapshot() { return { ...engine.snapshot(), voiceStatus, localError, backtest: settings.backtest, bookmapMode, bookmapDate, chat, chatBusy }; }

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
  ipc('ask', value => askAgent(z.string().trim().min(1).max(2000).parse(value)));
  ipc('cancel-question', () => agent.cancel());
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
    return voice.start(await key(), sdp);
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
    socket?.close(); voice.stop(); agent.stop(); void persist();
  });
}).catch(error => { dialog.showErrorBox('Cairo Live', error instanceof Error ? error.message : 'Startup failed'); app.quit(); });
app.on('window-all-closed', () => app.quit());

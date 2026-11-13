import { app, BrowserWindow, dialog, ipcMain, session } from 'electron';
import { access, appendFile, mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
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
import { openRouterKey } from './openrouter.ts';
import { mentionedSymbols, minuteSeries, runTool, tradingSnapshot, type DepthLookup, type ExitProposal, type MinuteLookup, type Proposal } from './agent-tools.ts';
import { formatExitPlan } from './exit-plan.ts';

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
let replayPlans: string[] = [];
let replayChoice: { date: string; id: string } | undefined;
let following = false;
const pendingBookmap: unknown[] = [];
let dirty = true;
const speech: Array<{ notice: Notice; owner: Engine }> = [];
const lastReview = new Map<string, number>();
const fillReviews = new Map<string, ReturnType<typeof setTimeout>>();
const runningFillReviews = new Map<string, AbortController>();
let tradeFocus: string | undefined;
const partialAnswers = new Map<string, { pattern?: string; stop?: number }>();
const recentExitSpeech = new Map<string, number>();
let speaking = false;
const key = () => openAIKey(resolve(settings.backtest, '../secrets/storeSecrets.js'));

async function findBacktest(configured: string) {
  const isBacktest = (path: string) => access(join(path, 'tradebooks', 'master_tradebooks.md')).then(() => true, () => false);
  if (await isBacktest(configured)) return configured;
  for (let folder = app.isPackaged ? dirname(process.execPath) : base; ; folder = dirname(folder)) {
    const candidate = join(folder, 'Backtest');
    if (await isBacktest(candidate)) return candidate;
    if (dirname(folder) === folder) return configured;
  }
}
const binaryName = process.platform === 'win32' ? 'opencode.exe' : 'opencode';
const agent = new Agent(join(dataDir, 'agent'), app.isPackaged ? join(process.resourcesPath, binaryName) :
  join(base, 'node_modules', '@opencode', 'cli', 'bin', binaryName), join(base, 'dist-electron', 'agent-plugin.mjs'), openRouterKey, process.env.CAIRO_LIVE_REASONING_MODEL);
const depthPacket = z.object({
  requestId: z.string(), symbol: z.string(), version: z.literal(1),
  mode: z.enum(['live', 'replay']).optional(),
  asOf: z.string().regex(/^\d{1,20}$/).optional(), orderbook: z.object({
    effectiveWallThreshold: z.number(), largeBids: z.array(z.tuple([z.number().positive(), z.number().positive()])),
    largeAsks: z.array(z.tuple([z.number().positive(), z.number().positive()])),
  }).optional(),
});
const minutePacket = minuteSeries.extend({ requestId: z.string(), symbol: z.string(), version: z.literal(1), mode: z.enum(['live', 'replay']) });
const bookmapWaiters = new Map<string, (event?: unknown) => void>();
let chatBusy = false;
type ChatMessage = { role: 'user' | 'assistant'; text: string };
let chat: ChatMessage[] = [];
let replayConversation = randomUUID();
type ConversationNote = ChatMessage & { symbol?: string; local?: boolean };
let conversationNotes: ConversationNote[] = [];

function rememberLocalTurn(role: ChatMessage['role'], text: string, symbol?: string) {
  conversationNotes.push({ role, text, symbol, local: true });
  logConversation({ role, channel: 'local', text, symbol, local: true });
}

function localReply(text: string, symbol?: string) {
  rememberLocalTurn('assistant', text, symbol);
  return text;
}

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
  return disk(async () => { await appendFile(join(target, 'alerts.jsonl'), JSON.stringify({ recordedAt: new Date().toISOString(), version: app.getVersion(), ...entry }) + '\n', 'utf8'); });
}

function logConversation(entry: object) {
  const target = directory;
  if (target) void disk(async () => {
    await appendFile(join(target, 'conversation.jsonl'), JSON.stringify({ at: new Date().toISOString(), version: app.getVersion(), ...entry }) + '\n', 'utf8');
  });
}

function briefVoice(text: string) {
  const clean = text.replace(/[*#`]/g, '').trim();
  if (clean.includes('\n1. ') || /^1\. \$/.test(clean)) {
    const first = clean.split('\n').find(line => /^1\. \$/.test(line))?.slice(3);
    if (first) return 'Next exit: ' + first.slice(0, 105) + '. Full plan on screen.';
  }
  const lines = clean.split('\n').filter(value => value.trim());
  const line = lines.find(value => !/^\s*(?:let me|i(?:’|')ll|checking\b)/i.test(value)) ?? '';
  const sentence = line.match(/^.*?[.!?](?:\s|$)/)?.[0] ?? line;
  return sentence.length <= 160 ? sentence.trim() : sentence.slice(0, 155).replace(/\s+\S*$/, '') + '…';
}

function claimExitSpeech(text: string) {
  const nextExit = /Next exit: .+?\. Full plan on screen\./i.exec(text)?.[0].toLowerCase();
  if (!nextExit) return true;
  const now = Date.now();
  for (const [key, time] of recentExitSpeech) if (now - time >= 12_000) recentExitSpeech.delete(key);
  if (recentExitSpeech.has(nextExit)) return false;
  recentExitSpeech.set(nextExit, now);
  return true;
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
      if (engine !== owner || shuttingDown) continue;
      if (notice.positionId) {
        try { owner.find(notice.positionId); } catch { continue; }
      }
      if (!claimExitSpeech(notice.text)) continue;
      logConversation({ role: 'assistant', channel: 'spoken', text: notice.text });
      voice.ignoreInput(true);
      send('cairo:mute-input', true);
      try { await speakLocal(notice.text); }
      catch { localError = 'Speech unavailable. The reply is visible in the panel.'; dirty = true; }
      finally {
        await new Promise(resolve => setTimeout(resolve, 250));
        voice.ignoreInput(false);
        send('cairo:mute-input', false);
      }
    }
  } finally { speaking = false; }
}

function notice(item: Notice) {
  void append({ type: 'alert', planRevision: engine.loaded?.plan.revision, evidence: engine.context(item.symbol).evidence, ...item });
  if (item.kind === 'fill') rememberLocalTurn('assistant', item.text, item.symbol);
  dirty = true;
  if (item.spoken) {
    const entry = { notice: item, owner: engine };
    if (item.kind === 'fill' || item.kind === 'feed') speech.unshift(entry);
    else speech.push(entry);
    if (speech.length > 16) speech.pop();
    void drainSpeech();
  }
}

function speakReply(text: string) {
  if (text && speech.length < 16) {
    speech.push({ owner: engine, notice: { key: randomUUID(), kind: 'advice', symbol: '', text, spoken: true } });
    void drainSpeech();
  }
}

function reviewPattern(position: Position, marketMs: number) {
  if (fillReviews.has(position.id) || runningFillReviews.has(position.id)) return;
  if (marketMs - (lastReview.get(position.id) ?? 0) < 60_000) return;
  lastReview.set(position.id, marketMs);
  const owner = engine;
  void management(position, true, true).catch(error => {
    if (engine === owner) void append({ type: 'review_error', symbol: position.symbol, message: (error as Error).message });
  });
}

function reviewFill(position: Position) {
  const owner = engine;
  const scope = owner.conversationScope;
  clearTimeout(fillReviews.get(position.id));
  runningFillReviews.get(position.id)?.abort(new Error('Superseded by a newer fill'));
  tradeFocus ??= position.symbol;
  void append({ type: 'fill_review_queued', symbol: position.symbol, positionId: position.id, remaining: Math.abs(position.quantity) });
  const start = () => {
    fillReviews.delete(position.id);
    if (engine !== owner || scope !== owner.conversationScope || shuttingDown || transition) return;
    const latest = owner.snapshot().positions.find(item => item.id === position.id && item.fresh);
    if (!latest) return;
    const control = new AbortController();
    runningFillReviews.set(position.id, control);
    void management(latest, true, true, 'Bookmap reconciled a position fill', control.signal).catch(error => {
      if (!control.signal.aborted && engine === owner) void append({ type: 'review_error', symbol: position.symbol, message: (error as Error).message });
    }).finally(() => { if (runningFillReviews.get(position.id) === control) runningFillReviews.delete(position.id); });
  };
  fillReviews.set(position.id, setTimeout(start, 200));
}

async function select(selection: Selection, keepConnection = false) {
  transition = true;
  try {
    if (!keepConnection) voice.stop();
    agent.reset();
    replayConversation = randomUUID();
    chat = []; conversationNotes = []; chatBusy = false;
    speech.length = 0;
    lastReview.clear();
    partialAnswers.clear();
    recentExitSpeech.clear();
    tradeFocus = undefined;
    const previous = socket;
    if (!keepConnection) {
      socket = undefined;
      previous?.close();
      clearTimeout(reconnect);
    }
    await persist();
    settings = { ...settings, selection };
    date = selection.mode === 'replay' ? selection.sessionDate : marketDate();
    directory = join(dataDir, 'sessions', date, selection.mode === 'replay' ? `replay-${selection.replayRunId}` : 'live');
    await mkdir(directory, { recursive: true });
    if (selection.mode === 'live') {
      const transcript = await readFile(join(directory, 'conversation.jsonl'), 'utf8').catch(() => '');
      const message = z.object({ role: z.enum(['user', 'assistant']), channel: z.enum(['typed', 'voice', 'local', 'agent', 'automatic']), text: z.string(),
        symbol: z.string().optional(), local: z.boolean().optional(), scoped: z.boolean().optional() });
      const restored: ChatMessage[] = [];
      for (const line of transcript.split('\n').filter(Boolean)) {
        try {
          const parsed = message.safeParse(JSON.parse(line));
          if (!parsed.success) continue;
          const { role, text, symbol, local, scoped } = parsed.data;
          if (scoped || local || role === 'assistant') restored.push({ role, text });
          if (local || !scoped) conversationNotes.push({ role, text, symbol, local });
          if (scoped && role === 'user' && symbol) tradeFocus = symbol;
        } catch { /* A partially written line does not invalidate the earlier transcript. */ }
      }
      chat = restored.slice(-24);
    }
    void append({ type: 'session_started', selection });
    logConversation({ type: 'session_started', selection });
    const state: SavedState = await readFile(join(directory, 'state.json'), 'utf8').then(text => JSON.parse(text)).catch(() => ({ notes: {}, delivered: [] }));
    engine = new Engine(selection, state && typeof state.notes === 'object' && state.notes && Array.isArray(state.delivered) ? state : { notes: {}, delivered: [] }, notice, Date.now, reviewPattern, reviewFill);
    engine.setShadow(selection.mode === 'live');
    revision = '';
    lastSaved = '';
    localError = '';
    if (!keepConnection) { bookmapMode = ''; bookmapDate = ''; replayPlans = []; }
    await refreshPlan();
    await atomic(configPath, JSON.stringify(settings, null, 2) + '\n');
    if (keepConnection && socket?.readyState === WebSocket.OPEN) engine.connect();
    if (!keepConnection) connect();
  } finally { transition = false; dirty = true; }
}

async function listReplayPlans(backtest: string, sessionDate: string) {
  const folder = join(backtest, 'data', 'processed', ...sessionDate.split('-'), 'bookmap_replay');
  const entries = await readdir(folder, { withFileTypes: true }).catch(() => []);
  const plans = await Promise.all(entries.filter(entry => entry.isDirectory()).map(async entry => {
    const selection = selectionSchema.safeParse({ mode: 'replay', sessionDate, replayRunId: entry.name });
    if (!selection.success) return undefined;
    return await loadPlan(backtest, selection.data).then(() => entry.name).catch(() => undefined);
  }));
  return plans.filter((id): id is string => id !== undefined).sort();
}

async function followBookmap(client: WebSocket) {
  if (following || transition || socket !== client || client.readyState !== WebSocket.OPEN) return;
  if (bookmapMode === 'replay' && !bookmapDate) return;
  if (bookmapMode !== 'live' && bookmapMode !== 'replay') return;
  following = true;
  try {
    const mode = bookmapMode;
    const sessionDate = bookmapDate;
    let next: Selection = { mode: 'live' };
    if (mode === 'replay') {
      replayPlans = await listReplayPlans(settings.backtest, sessionDate);
      const remembered = replayChoice?.date === sessionDate && replayPlans.includes(replayChoice.id) ? replayChoice.id : undefined;
      const id = remembered ?? (replayPlans.length === 1 ? replayPlans[0] : 'practice');
      next = { mode: 'replay', sessionDate, replayRunId: id };
    } else replayPlans = [];
    if (socket !== client || client.readyState !== WebSocket.OPEN || mode !== bookmapMode || (mode === 'replay' && sessionDate !== bookmapDate)) return;
    if (JSON.stringify(next) !== JSON.stringify(engine.selection)) {
      const prior = engine.selection;
      await select(next, true);
      if (next.mode === 'replay' && prior.mode === 'replay' && next.sessionDate === prior.sessionDate && socket === client) {
        // Request a fresh Bookmap baseline when changing the plan within the same recording.
        socket = undefined;
        pendingBookmap.length = 0;
        client.close();
        connect();
        return;
      }
    }
    if (socket === client && client.readyState === WebSocket.OPEN && mode === bookmapMode && (mode !== 'replay' || sessionDate === bookmapDate)) {
      for (const event of pendingBookmap.splice(0)) acceptBookmap(event);
    }
  } catch { localError = 'Could not follow the Bookmap session'; }
  finally { following = false; dirty = true; }
}

function acceptBookmap(event: unknown) {
  const scope = engine.conversationScope;
  engine.accept(event);
  if (engine.conversationScope !== scope) {
    agent.reset(); chat = []; conversationNotes = []; chatBusy = false; speech.length = 0; partialAnswers.clear(); lastReview.clear();
    replayConversation = randomUUID();
    tradeFocus = undefined;
    logConversation({ type: 'conversation_reset' });
  }
  dirty = true;
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
  client.on('open', () => {
    if (socket !== client) return;
    bookmapMode = ''; bookmapDate = ''; pendingBookmap.length = 0;
    engine.connect(); dirty = true;
  });
  client.on('message', data => {
    if (socket !== client) return;
    try {
      const event = JSON.parse(data.toString());
      if (event.type === 'cairo_depth' || event.type === 'cairo_minute_bars') {
        bookmapWaiters.get(event.requestId)?.(event);
        return;
      }
      if (['cairo_chart', 'cairo_trade', 'cairo_patterns', 'cairo_replay_fill', 'cairo_replay_reset', 'cairo_account'].includes(event.type)) {
        if (event.mode === 'live' || event.mode === 'replay') {
          if (bookmapMode && bookmapMode !== event.mode) { bookmapDate = ''; pendingBookmap.length = 0; }
          bookmapMode = event.mode;
        }
        if (event.mode === 'replay' && typeof event.eventTime === 'string' && /^\d{1,20}$/.test(event.eventTime)) {
          const time = Number(BigInt(event.eventTime) / 1_000_000n);
          if (time > 0) bookmapDate = marketDate(time);
        }
      }
      const mismatch = bookmapMode && (engine.selection.mode !== bookmapMode ||
        (engine.selection.mode === 'replay' && engine.selection.sessionDate !== bookmapDate));
      if (following || mismatch) {
        if (pendingBookmap.length < 8192) pendingBookmap.push(event);
        if (mismatch) void followBookmap(client);
      } else {
        for (const pending of pendingBookmap.splice(0)) acceptBookmap(pending);
        acceptBookmap(event);
        if (bookmapMode === 'replay' && event.type === 'cairo_chart') void followBookmap(client);
      }
    } catch { /* Ignore malformed loopback messages. */ }
  });
  client.on('error', () => { if (socket === client) dirty = true; });
  client.on('close', () => {
    if (socket !== client) return;
    for (const finish of bookmapWaiters.values()) finish();
    engine.disconnect();
    dirty = true;
    if (!shuttingDown) reconnect = setTimeout(connect, 1500);
  });
}

function requestBookmap(type: string, symbol: string, fields = {}): Promise<unknown> {
  return new Promise(resolve => {
    const client = socket;
    if (!client || client.readyState !== WebSocket.OPEN) { resolve(undefined); return; }
    const owner = engine;
    const scope = owner.conversationScope;
    const mode = owner.selection.mode;
    const requestId = randomUUID();
    const finish = (raw?: unknown) => {
      clearTimeout(timer); bookmapWaiters.delete(requestId);
      resolve(socket === client && owner === engine && scope === owner.conversationScope ? raw : undefined);
    };
    const timer = setTimeout(finish, 700);
    bookmapWaiters.set(requestId, finish);
    client.send(JSON.stringify({ type, requestId, symbol, mode, ...fields }), error => { if (error) finish(); });
  });
}

const lookupDepth: DepthLookup = async (symbol, price) => {
  const packet = depthPacket.safeParse(await requestBookmap('cairo_depth_request', symbol, { price }));
  if (!packet.success) return;
  const event = packet.data;
  if (event.symbol !== symbol || (event.mode ?? 'live') !== engine.selection.mode || !event.asOf || !event.orderbook) return;
  const convert = (levels: Array<[number, number]>) => levels.map(([price, displayedSize]) => ({ price, displayedSize }));
  return { asOf: Number(BigInt(event.asOf) / 1_000_000n), threshold: event.orderbook.effectiveWallThreshold,
    bids: convert(event.orderbook.largeBids), offers: convert(event.orderbook.largeAsks) };
};

const lookupMinutes: MinuteLookup = async symbol => {
  const packet = minutePacket.safeParse(await requestBookmap('cairo_minute_bars_request', symbol));
  if (packet.success && packet.data.symbol === symbol && packet.data.mode === engine.selection.mode) return packet.data;
};

async function askAgent(words: string, options: { background?: boolean; display?: string; position?: Position; signal?: AbortSignal; channel?: 'typed' | 'voice' } = {}) {
  if (transition || shuttingDown) throw new Error('The session is changing');
  const owner = engine;
  const scope = owner.conversationScope;
  const current = () => engine === owner && scope === owner.conversationScope && !transition && !shuttingDown;
  const backtest = settings.backtest;
  const captures = join(homedir(), 'bmtrader', 'patterns');
  let ticker: string | undefined;
  let requested: string[] = [];
  const conversationKey = () => {
    if (!current()) throw new Error('The session or replay cursor changed');
    const positions = owner.snapshot().positions.filter(position => position.fresh);
    const symbols = owner.agentSymbols();
    const explicit = [...words.matchAll(/\$([A-Z][A-Z0-9]*(?:[.-][A-Z0-9]+)*)/gi)].map(match => match[1].toUpperCase());
    requested = options.position ? [options.position.symbol] : [...new Set([...mentionedSymbols(words, symbols), ...explicit])];
    if (options.position && !positions.some(position => position.id === options.position?.id)) throw new Error('The position changed before review');
    ticker = requested.length === 1 ? requested[0] : requested.length > 1 ? undefined :
      tradeFocus ?? (positions.length === 1 ? positions[0].symbol : symbols.length === 1 ? symbols[0] : undefined);
    if (!options.background && ticker) tradeFocus = ticker;
    const marketSession = owner.selection.mode === 'live' ? date : date + ' / replay / ' + replayConversation;
    return marketSession + ' / ' + (ticker ?? (requested.length ? requested.slice().sort().join(',') : 'general'));
  };
  const toolOptions = { engine: owner, backtest, captures, depth: lookupDepth, minutes: lookupMinutes };
  const prompt = async (signal: AbortSignal) => {
    const symbols = ticker ? [ticker] : requested;
    const evidence = await Promise.all(symbols.map(symbol => tradingSnapshot(symbol, { ...toolOptions, signal })));
    if (!current()) throw new Error('The session or replay cursor changed');
    const known = owner.agentSymbols();
    const notes = conversationNotes.filter(note => {
      const named = note.symbol ? [note.symbol] : mentionedSymbols(note.text, known);
      return named.length ? named.every(symbol => symbols.includes(symbol)) : !symbols.length && !!note.local;
    }).slice(-24).map(({ role, text }) => ({ role, text: text.slice(0, 2000) }));
    if (!options.background) logConversation({ role: 'user', channel: options.channel ?? 'typed', text: options.display ?? words, symbol: ticker, scoped: true });
    return words + (evidence.length ? '\nCurrent trading snapshots (reference data): ' + JSON.stringify(evidence) :
      '\nNo ticker resolved. If this is a stock-specific question, ask the trader which ticker.') +
      (notes.length ? '\nRelated local conversation messages (historical reference data): ' + JSON.stringify(notes) : '');
  };
  let staged: Proposal | undefined;
  let exit: ExitProposal | undefined;
  const exitContexts = new Map<string, Omit<ExitProposal, 'plan'>>();
  const draft: ChatMessage = { role: 'assistant', text: '' };
  if (!options.background) {
    if (chatBusy) throw new Error('Cairo is answering another question');
    chatBusy = true;
    chat = [...chat, { role: 'user' as const, text: options.display ?? words }, draft].slice(-24);
    dirty = true;
  }
  try {
    return await agent.ask(prompt, conversationKey, async (name, input, signal) => {
      if (!current()) throw new Error('The session or replay cursor changed');
      if (name !== 'search_tradebooks') {
        const allowed = ticker ? [ticker] : requested;
        const named = z.object({ symbol: z.string().optional() }).parse(input).symbol ?? ticker;
        if (!named || !allowed.includes(named)) throw new Error('Use a ticker in the current question, or ask the trader to specify one.');
        input = { ...(input as object), symbol: named };
      }
      const result = await runTool(name, input, { ...toolOptions, signal, exitContexts,
        stageExit: proposal => {
          if (!current() || signal.aborted || (options.position && options.position.id !== proposal.id)) throw new Error('This position changed');
          exit = proposal;
        },
        stage: proposal => {
          if (!current() || signal.aborted || (options.position && options.position.id !== proposal.id)) throw new Error('This position changed');
          if (staged) throw new Error('Only one proposal may be staged per response');
          staged = proposal;
        } });
      if (!current()) throw new Error('The session or replay cursor changed');
      return result;
    }, answer => {
      if (!current()) throw new Error('The session or replay cursor changed');
      options.signal?.throwIfAborted();
      let result = answer;
      if (exit) {
        const position = owner.find(exit.id);
        const previous = position.exitPlan?.targets[0];
        const next = exit.plan.targets[0];
        const sameNextExit = !!position.exitPlan && previous?.price === next?.price && previous?.shares === next?.shares;
        if (!owner.setExitPlan(exit.id, exit.serial, exit.planHash, exit.plan)) throw new Error('The position or plan changed. Check the latest exit plan.');
        result = formatExitPlan(exit.plan);
        dirty = true;
        if (options.background && !sameNextExit) {
          notice({ key: randomUUID(), kind: 'advice', symbol: position.symbol, positionId: position.id, spoken: !owner.shadowMode,
            text: position.symbol + '. ' + briefVoice(result) });
        }
      } else if (options.position) {
        result = 'No validated exit plan was produced. ' + answer;
      }
      if (staged) {
        const position = owner.find(staged.id);
        const active = position.note?.management;
        const sameCondition = active && active.condition?.id === staged.advice.condition?.id && active.condition?.level === staged.advice.condition?.level;
        if (options.background && sameCondition) staged = undefined;
        else if (!position.pending && owner.propose(staged.id, staged.serial, staged.planHash, staged.advice, options.background && !exit)) {
          result += '\nReview the proposal in Cairo Live or say “watch that” to accept.';
        } else result = 'The position or plan changed before the proposal could be shown. Ask again for current guidance.';
      }
      if (!options.background) draft.text = result;
      else {
        chat = [...chat, { role: 'assistant' as const, text: (options.position ? options.position.symbol + ' · ' : '') + result }].slice(-24);
        dirty = true;
      }
      if (result !== answer) conversationNotes.push({ role: 'assistant', text: result, symbol: ticker, local: true });
      void append({ type: 'agent_answer', question: options.display ?? words, answer: result, automatic: !!options.background });
      logConversation({ role: 'assistant', channel: options.background ? 'automatic' : 'agent', text: result, symbol: ticker, scoped: true, local: result !== answer });
      return result;
    }, { resume: owner.selection.mode === 'live', background: options.background, signal: options.signal, onDelta: options.background ? undefined : delta => {
      if (current()) { draft.text = (draft.text + delta).slice(0, 6000); dirty = true; }
    } });
  } catch (error) {
    if (!options.background && current()) draft.text = error instanceof Error ? error.message : 'OpenCode could not answer';
    throw error;
  } finally {
    if (!options.background && current()) { chatBusy = false; dirty = true; }
  }
}

async function management(position: Position, speakViaNotice: boolean, automatic = false, reason?: string, signal?: AbortSignal) {
  const description = reason ?? (automatic ? 'Bookmap has new detector evidence' : 'Review my management');
  const result = await askAgent(
    description + ' for ' + position.symbol + '. Re-evaluate the exit plan with get_exit_context and prepare_exit_plan. If information is missing, include what is missing in notes. Keep supported targets if still appropriate.',
    { background: automatic, display: description + ' for ' + position.symbol, position, signal },
  );
  const spoken = briefVoice(result);
  if (speakViaNotice && !automatic) speakReply(spoken);
  return result;
}

async function handleVoice(words: string, passive: boolean) {
  const owner = engine;
  const positions = owner.snapshot().positions.filter(position => position.fresh);
  const normalized = words.toLowerCase().replace(/[^a-z0-9.]+/g, ' ');
  const mentioned = positions.filter(position => normalized.split(' ').includes(position.symbol.toLowerCase()));
  if (/\b(?:watch that|accept (?:that|the) plan|use that plan)\b/i.test(words) && !/\?/.test(words)) {
    const pending = (mentioned.length ? mentioned : positions).filter(position => position.pending);
    rememberLocalTurn('user', words, pending.length === 1 ? pending[0].symbol : undefined);
    if (pending.length !== 1) return localReply(pending.length ? 'Which pending recommendation do you want to accept?' : 'There is no pending recommendation to accept.');
    tradeFocus = pending[0].symbol;
    owner.approve(pending[0].id); dirty = true; void persist();
    return localReply(pending[0].symbol + ' advisory plan accepted.', pending[0].symbol);
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
      tradeFocus = target.symbol;
      rememberLocalTurn('user', words, target.symbol);
      const answer = partialAnswers.get(target.id) ?? { pattern: target.note?.pattern };
      if (pattern) answer.pattern = pattern;
      if (stop !== undefined && stop > 0) answer.stop = stop;
      if (!answer.pattern || !answer.stop) {
        partialAnswers.set(target.id, answer);
        return localReply(answer.pattern ? 'What is your intended stop price?' : 'Which Bookmap pattern did you use?', target.symbol);
      }
      partialAnswers.delete(target.id);
      const position = owner.identify(target.id, answer.pattern, answer.stop);
      dirty = true; void persist();
      return 'I heard ' + answer.pattern + ', with intended stop ' + answer.stop + '. ' + await management(position, false);
    }
  }
  if (passive && /^(?:hi|hey|hello|thanks|thank you)[.! ]*$/i.test(words)) return;
  return askAgent(words, { channel: 'voice' });
}

const voice = new Voice(async (words, passive) => {
  try {
    const response = await handleVoice(words, passive);
    if (response) speakReply(briefVoice(response));
  } catch (error) {
    logConversation({ role: 'assistant', channel: 'voice-error', text: error instanceof Error ? error.message : 'Could not verify the request' });
    speakReply('I couldn’t finish that check.');
  }
}, state => { voiceStatus = state; dirty = true; });

function snapshot() { return { ...engine.snapshot(), version: app.getVersion(), voiceStatus, localError, backtest: settings.backtest, bookmapMode, bookmapDate, replayPlans, chat, chatBusy }; }

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
  settings = { ...settings, backtest: await findBacktest(settings.backtest) };
  if (settings.selection.mode === 'replay' && settings.selection.replayRunId !== 'practice') {
    replayChoice = { date: settings.selection.sessionDate, id: settings.selection.replayRunId };
  }
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
  ipc('ask', value => {
    const text = z.string().trim().min(1).max(2000).parse(value);
    return askAgent(text);
  });
  ipc('voice-caption', value => logConversation({ role: 'assistant', channel: 'voice', delta: z.string().max(2000).parse(value) }));
  ipc('cancel-question', () => agent.cancel());
  ipc('replay-plan', async value => {
    const id = z.string().parse(value);
    if (!replayPlans.includes(id) || bookmapMode !== 'replay' || !bookmapDate || !socket || following || transition) throw new Error('Replay plans are unavailable');
    replayChoice = { date: bookmapDate, id };
    await followBookmap(socket);
  });
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
      else {
        await refreshPlan();
        if (socket && bookmapMode === 'replay') await followBookmap(socket);
      }
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

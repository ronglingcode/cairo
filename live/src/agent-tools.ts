import { createReadStream } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { join, relative } from 'node:path';
import { z } from 'zod';
import { patternSnapshot, type Advice, type Engine, type Position } from './engine.ts';
import { marketDate, readRules, safeSourcePath, symbolName, type PriceCondition } from './plan.ts';
import { exitInput, exitPriceBuffer, validateExitPlan, type ExitPlan } from './exit-plan.ts';

const ticker = symbolName.describe('Uppercase Bookmap ticker');
const symbol = z.object({ symbol: ticker }).strict();
const optionalSymbol = z.object({ symbol: ticker.optional() }).strict();
const executionQuery = optionalSymbol.extend({ offset: z.number().int().min(0).default(0),
  limit: z.number().int().min(1).max(250).default(20) });
const eventQuery = z.object({
  symbol: ticker, side: z.enum(['bid', 'offer']).optional(), price: z.number().positive().optional(),
  eventType: z.string().regex(/^[A-Z][A-Z0-9_]+$/).max(70).optional(),
  minutes: z.number().int().min(1).max(720).default(10), limit: z.number().int().min(1).max(30).default(12),
}).strict();
const depthQuery = symbol.extend({ price: z.number().positive().optional(), limit: z.number().int().min(1).max(20).default(8) });
export const toolDefinitions = {
  search_tradebooks: { input: z.object({ query: z.string().trim().min(1).max(180), side: z.enum(['long', 'short']).optional() }).strict(), description: 'Search approved Backtest tradebooks and Bookmap pattern definitions. Use side long or short for Bookmap pattern lists.' },
  get_trading_plan: { input: optionalSymbol, description: 'Read the confirmed session plan and approved conditions, optionally for one ticker.' },
  get_positions: { input: optionalSymbol, description: 'Read Bookmap position facts, working stops, intended stop, current advisory plan and pending proposal.' },
  get_recent_fills: { input: executionQuery, description: 'Read Bookmap executions or simulated replay fills, newest first. Use offset to retrieve earlier records from the current session.' },
  get_market_context: { input: symbol, description: 'Read chart coverage, last trade price and time, and detector health for a ticker.' },
  get_minute_bars: { input: symbol, description: 'Read the available same-session one-minute OHLCV chart and its coverage from Bookmap.' },
  get_exit_context: { input: symbol, description: 'Required for exit planning. Reads original opening shares, adds, executed partials, remaining shares, daily plan, current market/depth, and exact Backtest trade-management guidelines.' },
  prepare_exit_plan: { input: exitInput.extend({ symbol: ticker }), description: 'Validate and display an advisory exit plan. Each target has a price, short hint, and percent of ORIGINAL shares. Notes cover stop and contingencies. Cairo calculates whole shares and rejects oversizing. Use after get_exit_context.' },
  get_bookmap_depth: { input: depthQuery, description: 'Get the current displayed large bids/offers from Bookmap. Optionally query a specific level to compare with a past event. Sizes are aggregated displayed shares, never executions.' },
  get_bookmap_events: { input: eventQuery, description: 'Read Bookmap detector events including BID_REAPPEAR and OFFER_REAPPEAR. Filter by side, price and type. Use the default ten minutes for recent events; use a longer window only for earlier history.' },
  propose_alert: { input: symbol.extend({ conditionId: z.string().min(1).max(100).nullable(), summary: z.string().trim().min(1).max(340) }), description: 'Stage an advisory management proposal for the trader to review. Choose a condition ID from get_positions, or null for a written plan. This does not activate an alert or place an order.' },
};
export type ToolName = keyof typeof toolDefinitions;
export type DepthLookup = (symbol: string, price?: number) => Promise<{ asOf: number; threshold: number; bids: Array<{ price: number; displayedSize: number }>; offers: Array<{ price: number; displayedSize: number }> } | undefined>;
const barTime = z.number().int().positive().multipleOf(60_000);
export const minuteSeries = z.object({
  sessionDate: z.string(), asOf: z.number().int().positive(),
  source: z.enum(['Bookmap observed trades', 'Bookmap native market runtime']),
  bars: z.array(z.tuple([barTime, z.number().positive(), z.number().positive(), z.number().positive(),
    z.number().positive(), z.number().nonnegative()])).max(1500),
});
export type MinuteLookup = (symbol: string) => Promise<z.infer<typeof minuteSeries> | undefined>;
export type Proposal = { id: string; symbol: string; serial: number; planHash?: string; advice: Advice };
export type ExitProposal = { id: string; serial: number; planHash?: string; plan: ExitPlan };
const nanosMs = (value: string) => Number(BigInt(value) / 1_000_000n);
const iso = (value: number) => new Date(value).toISOString();
const near = (a: number, b: number) => Math.abs(a - b) < 1e-7;

export function mentionedSymbols(text: string, symbols: string[]) {
  const words = new Set(text.match(/[A-Z0-9]+(?:[.-][A-Z0-9]+)*/gi)?.map(word => word.toUpperCase()));
  return symbols.filter(symbol => words.has(symbol));
}

function dailyPlan(engine: Engine, symbol?: string) {
  const loaded = engine.planForAgent(symbol);
  if (!loaded) return null;
  const { watchlist, ...plan } = loaded.plan;
  const body = loaded.markdown.replace(/^```cairo-plan[\t ]*\r?\n[\s\S]*?^```[\t ]*\r?$/gm, '').trim();
  const tickers = watchlist.map(item => item.symbol);
  let section: { level: number; tickers: string[] }[] = [];
  const notes = !symbol ? body : body.split(/\r?\n/).filter(line => {
    const heading = /^(#{1,6})\s/.exec(line);
    const named = mentionedSymbols(line, tickers);
    if (heading) {
      const level = heading[1].length;
      section = section.filter(item => item.level < level);
      if (named.length) section.push({ level, tickers: named });
    }
    const scope = named.length ? named : section.at(-1)?.tickers;
    return scope ? scope.every(ticker => ticker === symbol) : tickers.includes(symbol);
  }).join('\n').trim();
  return { ...plan, path: loaded.path, watchlist: watchlist.filter(item => !symbol || item.symbol === symbol),
    notes: notes.slice(0, 16_000), notesTruncated: notes.length > 16_000 };
}

export function activeTradeContext(engine: Engine, position: Position, includePlan = true, fillLimit = 250) {
  const history = engine.tradeHistory(position);
  return {
    symbol: position.symbol, side: position.quantity > 0 ? 'long' : 'short',
    asOf: iso(position.sourceTime), averageEntry: position.average, sizing: engine.sizing(position),
    traderConfirmedPattern: position.note?.pattern ?? null, traderIntendedStop: position.note?.intendedStop ?? null,
    brokerWorkingStops: position.brokerStops, ...(includePlan ? { confirmedPlan: dailyPlan(engine, position.symbol) } : {}),
    exitPlan: position.exitPlan ?? null, exitPlanNeedsReview: !!position.exitPlanNeedsReview,
    priorTargetFillProgress: engine.exitProgress(position).map(({ target, filled }) =>
      ({ ...target, priceBuffer: exitPriceBuffer(target.price), creditedShares: filled, unfilledShares: target.shares - filled, complete: filled >= target.shares })),
    historyComplete: history.complete, fillCount: history.records.length, fills: history.records.slice(-fillLimit).map(({ action, price, quantity, timestamp }) =>
      ({ action, price, quantity, at: iso(timestamp) })),
  };
}

export function managementCandidates(engine: Engine, symbol: string) {
  const context = engine.context(symbol);
  const position = context.position;
  const direction = position && position.quantity < 0 ? 'short' : 'long';
  const setup = context.watch?.setups.find(item => item.direction === direction);
  const candidates = (setup?.conditions ?? []).filter((rule): rule is PriceCondition => rule.predicate !== 'bookmap_event');
  if (position?.note) {
    const stop = position.note.intendedStop;
    const reference = context.lastPrice ?? position.average;
    if (direction === 'long' ? stop < reference : stop > reference) candidates.push({
      id: 'position-intended-stop', predicate: direction === 'long' ? 'crosses_below' : 'crosses_above',
      priceBasis: 'bookmap_last', level: stop, label: 'Your intended stop level',
    });
  }
  return { context, candidates };
}

async function tradebooks(root: string, { query, side }: z.infer<typeof toolDefinitions.search_tradebooks.input>) {
  const rules = await readRules(root);
  const tokens = query.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  const documents: Array<[string, string]> = [['tradebooks/master_tradebooks.md', rules.master]];
  for (const direction of side ? [side] : ['long', 'short'] as const) {
    documents.push([`tradebooks/bookmap/${direction}.md`, rules.definitions[direction]]);
  }
  for (const path of rules.books.values()) {
    const body = await readFile(safeSourcePath(root, path), 'utf8');
    documents.push([relative(root, safeSourcePath(root, path)).replaceAll('\\', '/'), body]);
  }
  const matches = documents.flatMap(([path, body]) => body.split(/(?=^#{1,4} )/m).map(section => {
    const heading = section.split(/\r?\n/, 1)[0].replace(/^#+\s*/, '');
    const title = (path + ' ' + heading).toLowerCase();
    const content = section.toLowerCase();
    const score = tokens.reduce((sum, token) => sum + (title.includes(token) ? 4 : content.includes(token) ? 1 : 0), 0);
    return { path, heading, excerpt: section.trim().slice(0, 1800), score };
  })).filter(item => item.score > 0).sort((a, b) => b.score - a.score).slice(0, 8).map(({ score: _, ...item }) => item);
  return { matches, patternNames: side ? { [side]: rules.patterns[side] } : rules.patterns };
}

type PatternSnapshot = z.infer<typeof patternSnapshot>;
async function captures(folder: string, accepts: (value: PatternSnapshot) => void, signal: AbortSignal) {
  const names = (await readdir(folder, { withFileTypes: true }).catch(() => []))
    .filter(item => item.isFile() && /^patterns-[a-f0-9-]+-\d+\.jsonl$/.test(item.name));
  const files = await Promise.all(names.map(async item => {
    const path = join(folder, item.name);
    return { path, modified: (await stat(path).catch(() => undefined))?.mtimeMs ?? 0 };
  }));
  let scanned = 0;
  for (const { path } of files.sort((a, b) => b.modified - a.modified).slice(0, 12)) {
    signal.throwIfAborted();
    const file = createReadStream(path, { signal });
    try {
      for await (const line of createInterface({ input: file, crlfDelay: Infinity })) {
        if (line.length > 1_000_000) continue;
        let decoded: unknown;
        try { decoded = JSON.parse(line); } catch { continue; }
        const parsed = patternSnapshot.safeParse(decoded);
        if (parsed.success) accepts(parsed.data);
      }
      scanned++;
    } catch (error) {
      if (signal.aborted) throw error;
    } finally { file.destroy(); }
  }
  return scanned;
}

export async function bookmapEvents(engine: Engine, query: z.infer<typeof eventQuery>, folder: string, signal: AbortSignal, now = Date.now()) {
  const book = engine.bookmap(query.symbol);
  const live = engine.selection.mode === 'live';
  const cursor = live ? now : book.cursor;
  if (!cursor) return { status: 'No matching replay cursor', events: [] };
  const since = cursor - query.minutes * 60_000;
  const entries = new Map<string, { source: string; epoch: number; time: number; item: PatternSnapshot['patterns'][number] }>();
  let firstSnapshot = Infinity;
  let gap = false;
  function collect(snapshot: PatternSnapshot) {
    const snapshotTime = nanosMs(snapshot.eventTime);
    if (snapshot.symbol !== query.symbol || snapshot.mode !== engine.selection.mode || snapshotTime > cursor ||
        snapshotTime < since - 600_000 || marketDate(snapshotTime) !== marketDate(cursor)) return;
    if (!live && (!book.snapshot || snapshot.sourceInstanceId !== book.snapshot.sourceInstanceId || snapshot.epoch !== book.snapshot.epoch)) return;
    firstSnapshot = Math.min(firstSnapshot, snapshotTime);
    gap ||= snapshot.coverage !== 'continuous';
    for (const item of snapshot.patterns) {
      const time = nanosMs(item.eventTime);
      if (time < since || time > snapshotTime || (item.observedAt && nanosMs(item.observedAt) > snapshotTime)) continue;
      if (query.eventType && item.type !== query.eventType) continue;
      if (query.side && !item.type.startsWith(query.side === 'bid' ? 'BID_' : 'OFFER_')) continue;
      if (query.price && (typeof item.price !== 'number' || !near(item.price, query.price))) continue;
      const key = `${snapshot.sourceInstanceId}:${snapshot.epoch}:${item.id}`;
      if ((entries.get(key)?.item.revision ?? -1) < item.revision) entries.set(key, { source: snapshot.sourceInstanceId, epoch: snapshot.epoch, time, item });
    }
  }
  if (book.snapshot) collect(book.snapshot);
  const scanned = query.minutes > 10 ? await captures(folder, collect, signal) : 0;
  return { asOf: iso(cursor), mode: engine.selection.mode, connected: book.connected, coverage: book.snapshot?.coverage ?? 'unavailable',
    archiveFilesRead: scanned, earliestSnapshot: Number.isFinite(firstSnapshot) ? iso(firstSnapshot) : null,
    scope: gap ? 'Bounded detector evidence includes coverage gaps' : 'Bounded detector evidence; absence is not proof an event did not occur',
    events: [...entries.values()].sort((a, b) => b.time - a.time).slice(0, query.limit).map(entry => ({ ...entry.item, eventAt: iso(entry.time), sourceInstanceId: entry.source, epoch: entry.epoch })),
  };
}

type ToolOptions = {
  engine: Engine; backtest: string; captures: string; depth: DepthLookup; minutes?: MinuteLookup; signal: AbortSignal; stage?: (proposal: Proposal) => void;
  exitContexts?: Map<string, { id: string; serial: number; planHash?: string }>;
  stageExit?: (proposal: ExitProposal) => void;
};

export async function tradingSnapshot(symbol: string, options: ToolOptions) {
  const { engine, signal } = options;
  const [depth, chart] = await Promise.all([
    runTool('get_bookmap_depth', { symbol }, options),
    runTool('get_minute_bars', { symbol }, options),
  ]);
  signal.throwIfAborted();
  const position = engine.context(symbol).position;
  const fills = engine.recentFills(symbol)[0];
  const records = [...(fills?.records ?? [])].sort((a, b) => a.timestamp - b.timestamp);
  return {
    symbol, mode: engine.selection.mode,
    plan: dailyPlan(engine, symbol),
    position: position ?? null,
    activeTrade: position && activeTradeContext(engine, position, false),
    executions: fills ? { asOf: iso(fills.asOf), fresh: fills.fresh, count: records.length,
      records: records.slice(-250).map(record => [record.timestamp, record.isBuy ? 'BUY' : 'SELL', record.price, record.quantity]),
      columns: ['epochMs', 'side', 'price', 'shares'] } : null,
    bookmap: {
      market: await runTool('get_market_context', { symbol }, options),
      depth,
      events: await bookmapEvents(engine, { symbol, minutes: 10, limit: 30 }, options.captures, signal),
    },
    chart,
  };
}

export async function runTool(name: ToolName, input: unknown, options: ToolOptions): Promise<unknown> {
  const { engine } = options;
  switch (name) {
    case 'search_tradebooks': return tradebooks(options.backtest, toolDefinitions[name].input.parse(input));
    case 'get_trading_plan': {
      const { symbol } = optionalSymbol.parse(input);
      return dailyPlan(engine, symbol) ?? { status: 'No confirmed plan available at the current cursor' };
    }
    case 'get_positions': {
      const { symbol } = optionalSymbol.parse(input);
      return { connected: engine.snapshot().connected, positions: engine.snapshot().positions.filter(item => !symbol || item.symbol === symbol)
        .map(item => ({ ...item, asOf: iso(item.sourceTime), candidateConditions: item.fresh ? managementCandidates(engine, item.symbol).candidates : [] })) };
    }
    case 'get_recent_fills': {
      const { symbol, offset, limit } = executionQuery.parse(input);
      return { mode: engine.selection.mode, fills: engine.recentFills(symbol).map(item => ({ ...item, asOf: iso(item.asOf),
        count: item.records.length, offset, records: [...item.records].sort((a, b) => b.timestamp - a.timestamp)
          .slice(offset, offset + limit).map(record => ({ ...record, timestamp: iso(record.timestamp) })) })) };
    }
    case 'get_market_context': {
      const { symbol } = toolDefinitions[name].input.parse(input);
      const { connected, attached, trade, snapshot, cursor, levels } = engine.bookmap(symbol);
      const tradeMs = trade ? nanosMs(trade.eventTime) : 0;
      return { symbol, connected, attached, cursor: cursor ? iso(cursor) : null,
        lastTrade: tradeMs ? { price: trade?.price, at: iso(tradeMs), fresh: connected && (engine.selection.mode === 'replay' || Date.now() - tradeMs <= 10_000) } : null,
        sessionLevels: levels ? { ...levels, source: 'Bookmap native market runtime', at: iso(levels.marketAsOf), fresh: connected && Date.now() - levels.marketAsOf <= 20_000 }
          : trade?.replayVwap ? { vwap: trade.replayVwap, source: 'Bookmap recorded trades', at: iso(tradeMs),
            fresh: connected && attached, firstObserved: trade.vwapFirstObserved ? iso(nanosMs(trade.vwapFirstObserved)) : null,
            coverage: trade.vwapCoversPremarketStart ? 'from premarket start' : 'partial replay coverage' } : null,
        detector: snapshot ? { readiness: snapshot.readiness, coverage: snapshot.coverage, at: iso(nanosMs(snapshot.eventTime)) } : null };
    }
    case 'get_minute_bars': {
      const { symbol } = toolDefinitions[name].input.parse(input);
      const data = await options.minutes?.(symbol);
      options.signal.throwIfAborted();
      const book = engine.bookmap(symbol);
      const replay = engine.selection.mode === 'replay';
      const cursor = replay ? book.cursor : Date.now();
      if (!book.connected || !cursor || !data || data.sessionDate !== marketDate(cursor)) {
        return { symbol, status: 'One-minute bars unavailable from the current Bookmap feed' };
      }
      const bars = data.bars.filter(([time]) => time <= data.asOf && marketDate(time) === data.sessionDate &&
        (data.asOf <= cursor || time + 60_000 <= cursor));
      return { symbol, source: data.source, asOf: iso(Math.min(cursor, data.asOf)), fresh: cursor - data.asOf <= 60_000,
        coverage: 'Available bars only; absent minutes can reflect no trades or missing coverage. The last minute may be incomplete.',
        columns: ['minuteStartEpochMs', 'open', 'high', 'low', 'close', 'volume'], bars };
    }
    case 'get_exit_context': {
      const { symbol } = toolDefinitions[name].input.parse(input);
      const context = engine.context(symbol);
      const position = context.position;
      if (!position?.fresh || !engine.current(position.id, context.serial, context.planHash)) return { status: 'No fresh open position', symbol };
      const guidelinesPath = 'tradebooks/trade-management.md';
      const guidelines = await readFile(safeSourcePath(options.backtest, guidelinesPath), 'utf8');
      const setup = context.watch?.setups.find(item => item.direction === (position.quantity > 0 ? 'long' : 'short'));
      const setupRules = setup ? await readFile(safeSourcePath(options.backtest, setup.tradebookPath), 'utf8') : undefined;
      const [market, depth] = await Promise.all([
        runTool('get_market_context', { symbol }, options),
        runTool('get_bookmap_depth', { symbol }, options),
      ]);
      if (!engine.current(position.id, context.serial, context.planHash)) throw new Error('Position or plan changed. Refresh the exit context.');
      options.exitContexts?.set(symbol, { id: position.id, serial: context.serial, planHash: context.planHash });
      return { position, ...activeTradeContext(engine, position), market, depth, recentPatterns: context.evidence,
        guidelinesPath, guidelines, setupRules: setupRules?.slice(0, 12000) };
    }
    case 'prepare_exit_plan': {
      const { symbol, targets, notes } = toolDefinitions[name].input.parse(input);
      const context = options.exitContexts?.get(symbol);
      if (!options.stageExit || !context || !engine.current(context.id, context.serial, context.planHash)) throw new Error('Read the current exit context first.');
      const position = engine.find(context.id);
      const plan = validateExitPlan({ targets, notes }, engine.sizing(position), position.quantity);
      engine.checkExitPlan(position, plan);
      options.stageExit({ ...context, plan });
      return plan;
    }
    case 'get_bookmap_events': return bookmapEvents(engine, eventQuery.parse(input), options.captures, options.signal);
    case 'get_bookmap_depth': {
      const { symbol, price, limit } = depthQuery.parse(input);
      const book = engine.bookmap(symbol);
      if (!book.connected || !book.attached) return { status: 'Bookmap chart unavailable', symbol };
      const replay = engine.selection.mode === 'replay';
      const display = book.snapshot?.readiness === 'ready' && book.snapshot?.coverage === 'continuous' ? book.snapshot.liquidity : undefined;
      const snapshotDepth = display && (!replay || nanosMs(display.asOf) <= book.cursor) ? { ...display, asOf: nanosMs(display.asOf) } : undefined;
      const requestedDepth = await options.depth(symbol, price);
      const depth = (requestedDepth && (!replay || requestedDepth.asOf <= engine.bookmap(symbol).cursor) ? requestedDepth : undefined) ?? snapshotDepth;
      if (!depth?.asOf) return { status: 'No fresh Bookmap depth snapshot', symbol };
      const select = (levels: typeof depth.bids) => levels.filter(level => !price || near(level.price, price)).sort((a, b) => b.displayedSize - a.displayedSize).slice(0, limit);
      return { symbol, asOf: iso(depth.asOf), fresh: replay ? book.cursor - depth.asOf <= 10_000 : Date.now() - depth.asOf <= 10_000,
        mode: engine.selection.mode, threshold: depth.threshold, price, bids: select(depth.bids), offers: select(depth.offers),
        scope: price && requestedDepth ? 'Aggregate displayed shares at the requested price' : 'Bounded aggregate displayed levels at or above the threshold; omitted prices may have smaller liquidity' };
    }
    case 'propose_alert': {
      if (!options.stage) throw new Error('This turn cannot propose an alert');
      const { symbol, conditionId, summary } = toolDefinitions[name].input.parse(input);
      const { context, candidates } = managementCandidates(engine, symbol);
      const position = context.position;
      if (!position?.fresh || !position.note) throw new Error('Confirm the current position pattern and intended stop first');
      if (position.pending) return { status: 'A recommendation is already pending', symbol };
      const condition = candidates.find(candidate => candidate.id === conditionId) ?? null;
      if (conditionId && !condition) throw new Error('Use a current candidate condition ID from get_positions');
      options.stage({ id: position.id, symbol, serial: context.serial, planHash: context.planHash, advice: { summary, condition } });
      return { status: 'Proposal prepared for validation by Cairo Live', symbol, summary, condition };
    }
  }
}

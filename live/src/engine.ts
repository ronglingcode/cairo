import { z } from 'zod';
import { type LoadedPlan, type PriceCondition, type Selection, marketDate, symbolName } from './plan.ts';
import { positionSizing, tradeExecutions, type ExitPlan, type Fill } from './exit-plan.ts';

const positive = z.number().finite().positive();
const ns = z.string().regex(/^\d{1,20}$/);
const envelope = z.object({ mode: z.enum(['live', 'replay', 'unknown']), symbol: symbolName, sourceInstanceId: z.string().min(1).max(100), epoch: positive.int(), sequence: positive.int(), delivery: z.enum(['stream', 'snapshot']).default('stream') });
const execution = z.object({ executionId: z.string(), orderId: z.string().optional(), timestamp: positive, price: positive, quantity: positive, isBuy: z.boolean(), positionEffectIsOpen: z.boolean().optional() });
const marketLevels = z.object({ type: z.literal('cairo_target_market'), symbol: symbolName, sessionDate: z.string(),
  marketAsOf: positive, vwap: positive.optional(), premarketHigh: positive.optional(), premarketLow: positive.optional(),
  highOfDay: positive.optional().catch(undefined), lowOfDay: positive.optional().catch(undefined) });
const depthLevel = z.object({ price: positive, displayedSize: positive });
const liquidity = z.object({ asOf: ns, threshold: z.number().nonnegative(), bestBid: z.number().nullable().optional(), bestAsk: z.number().nullable().optional(), bids: z.array(depthLevel).max(8), offers: z.array(depthLevel).max(8) });
export const patternSnapshot = envelope.extend({ type: z.literal('cairo_patterns'), version: z.literal(2), eventTime: ns, readiness: z.enum(['ready', 'not-ready']), coverage: z.enum(['continuous', 'warming', 'gap']), liquidity: liquidity.nullish().catch(undefined), patterns: z.array(z.object({ id: z.union([z.string(), z.number()]), type: z.string(), revision: z.number(), eventTime: ns, observedAt: ns.optional() }).passthrough()).max(64) });
const messages = z.discriminatedUnion('type', [
  envelope.extend({ type: z.literal('cairo_chart'), version: z.literal(1), attached: z.boolean() }),
  envelope.extend({ type: z.literal('cairo_trade'), version: z.literal(1), eventTime: ns, price: positive, tradeSequence: positive.int(),
    replayVwap: positive.optional(), vwapFirstObserved: ns.optional(), vwapCoversPremarketStart: z.boolean().optional() }),
  envelope.extend({ type: z.literal('cairo_replay_reset'), version: z.literal(1), eventTime: ns }),
  envelope.extend({ type: z.literal('cairo_replay_fill'), version: z.literal(1), eventTime: ns, executionId: z.string(), positionId: z.string().optional(), side: z.enum(['BUY', 'SELL']), price: positive, quantity: positive, positionQuantity: z.number().finite().nonnegative(), positionAveragePrice: positive, opening: z.boolean() }),
  envelope.extend({ type: z.literal('cairo_account'), version: z.literal(1), asOf: positive, positionQuantity: z.number().finite(), positionAveragePrice: positive.optional(), workingStops: z.array(z.object({ price: positive, quantity: positive })).max(128), executions: z.array(execution).max(8000) }),
  patternSnapshot,
]);
type Message = z.infer<typeof messages>;
type Trade = Extract<Message, { type: 'cairo_trade' }>;
type Evidence = Extract<Message, { type: 'cairo_patterns' }>['patterns'][number];
export type Note = { pattern: string; intendedStop: number; management?: Advice };
export type Advice = { summary: string; condition: PriceCondition | null };
export type Position = { id: string; symbol: string; quantity: number; average: number; brokerStops: number[]; sourceTime: number; fresh: boolean; note?: Note; pending?: Advice; exitPlan?: ExitPlan; exitPlanNeedsReview?: boolean };
export type Notice = { key: string; kind: 'fill' | 'condition' | 'pattern' | 'feed' | 'advice'; text: string; symbol: string; marketMs?: number; positionId?: string; spoken: boolean };
export type SavedState = { notes: Record<string, Note>; delivered: string[]; plan?: { revision: number; hash: string } };
const ms = (value: string) => Number(BigInt(value) / 1_000_000n);

export class Engine {
  private feed = false;
  private connectedAt = 0;
  private accounts = new Map<string, { quantity: number; fills: Set<string> }>();
  private charts = new Map<string, Message['mode']>();
  private lanes = new Map<string, { source: string; epoch: number; sequence: number }>();
  private positions = new Map<string, Position>();
  private trades = new Map<string, Trade>();
  private levels = new Map<string, z.infer<typeof marketLevels>>();
  private patterns = new Map<string, { time: number; seen: Set<string>; evidence: Evidence[]; ready: boolean; snapshot: z.infer<typeof patternSnapshot> }>();
  private retiredPatternEpochs = new Map<string, { source: string; epoch: number }>();
  private fills = new Map<string, { asOf: number; records: Fill[] }>();
  private scope = 0;
  private sent: Set<string>;
  private recent: Notice[] = [];
  private active?: LoadedPlan;
  private error = 'Waiting for the confirmed plan';
  private shadow = true;
  private serial = 0;
  private notes: SavedState['notes'];
  private clock: () => number;
  readonly selection: Selection;
  private readonly notify: (notice: Notice) => void;
  private readonly reviewPattern?: (position: Position, marketMs: number) => void;
  private readonly reviewFill?: (position: Position) => void;

  constructor(selection: Selection, saved: SavedState, notify: (notice: Notice) => void, clock = Date.now,
    reviewPattern?: (position: Position, marketMs: number) => void, reviewFill?: (position: Position) => void) {
    this.selection = selection;
    this.notify = notify;
    this.notes = saved.notes;
    this.sent = new Set(saved.delivered);
    this.clock = clock;
    this.reviewPattern = reviewPattern;
    this.reviewFill = reviewFill;
  }

  setShadow(shadow: boolean) { this.shadow = shadow; }
  setPlan(plan?: LoadedPlan, error = '') {
    if (this.active?.hash !== plan?.hash) {
      this.serial++;
      for (const position of this.positions.values()) { position.pending = undefined; position.exitPlanNeedsReview = !!position.exitPlan; }
    }
    this.active = plan;
    this.error = error;
  }
  get loaded() { return this.active; }
  get shadowMode() { return this.shadow; }
  get conversationScope() { return this.scope; }

  connect() {
    this.feed = true;
    this.connectedAt = this.clock();
    this.lanes.clear(); this.charts.clear(); this.trades.clear(); this.levels.clear(); this.patterns.clear(); this.retiredPatternEpochs.clear(); this.accounts.clear(); this.fills.clear();
  }

  disconnect() {
    if (!this.feed) return;
    this.feed = false;
    this.serial++;
    for (const position of this.positions.values()) {
      position.fresh = false;
      position.pending = undefined;
      this.emit({ key: `disconnect:${this.connectedAt}:${position.id}`, kind: 'feed', symbol: position.symbol, text: `${position.symbol} Bookmap feed disconnected. Advisory checks paused.` });
    }
  }

  tick() {
    if (!this.feed || this.selection.mode !== 'live') return;
    const now = this.clock();
    for (const position of this.positions.values()) {
      if (position.fresh && now - position.sourceTime > 20_000) {
        position.fresh = false;
        position.pending = undefined;
        this.serial++;
        this.emit({ key: `stale-account:${position.id}:${position.sourceTime}`, kind: 'feed', symbol: position.symbol, text: `${position.symbol} broker data is stale. Position advice paused.` });
      }
      if (this.charts.has(position.symbol) && now - (this.tradeTime(position.symbol) ?? this.connectedAt) > 30_000) {
        this.emit({ key: `stale-price:${position.id}`, kind: 'feed', symbol: position.symbol, text: `${position.symbol} price feed is stale. Price alerts are paused until a fresh sample.` });
      } else this.sent.delete(`stale-price:${position.id}`);
    }
  }

  accept(raw: unknown) {
    if (!this.feed) return;
    const levels = marketLevels.safeParse(raw);
    if (levels.success) {
      const value = levels.data;
      const now = this.clock();
      if (this.selection.mode === 'live' && value.sessionDate === marketDate(now) && marketDate(value.marketAsOf) === value.sessionDate &&
        value.marketAsOf <= now + 2000 && value.marketAsOf >= (this.levels.get(value.symbol)?.marketAsOf ?? 0)) this.levels.set(value.symbol, value);
      return;
    }
    const parsed = messages.safeParse(raw);
    if (!parsed.success) return;
    const message = parsed.data;
    if (message.mode !== this.selection.mode) return;
    const date = this.selection.mode === 'replay' ? this.selection.sessionDate : marketDate(this.clock());
    if ('eventTime' in message && (!ms(message.eventTime) || marketDate(ms(message.eventTime)) !== date)) return;
    const { symbol } = message;
    const lane = `${symbol}:${message.type.startsWith('cairo_replay_') ? 'replay' : message.type}`;
    const last = this.lanes.get(lane);
    if (last?.source === message.sourceInstanceId && (message.epoch < last.epoch || (message.epoch === last.epoch && message.sequence <= last.sequence))) return;
    this.lanes.set(lane, { source: message.sourceInstanceId, epoch: message.epoch, sequence: message.sequence });
    switch (message.type) {
      case 'cairo_chart':
        if (message.attached) this.charts.set(symbol, message.mode);
        else {
          this.charts.delete(symbol); this.trades.delete(symbol); this.levels.delete(symbol); this.patterns.delete(symbol); this.serial++;
          if (message.mode === 'replay') { this.scope++; this.fills.delete(symbol); }
          const position = this.positions.get(symbol);
          if (position) {
            position.pending = undefined;
            this.emit({ key: `chart-removed:${position.id}:${message.sequence}`, kind: 'feed', symbol, text: `${symbol} chart detached. Chart alerts are paused.` });
          }
          if (message.mode === 'replay') this.positions.delete(symbol);
        }
        return;
      case 'cairo_replay_reset': {
        const prior = this.patterns.get(symbol)?.snapshot;
        if (prior) this.retiredPatternEpochs.set(symbol, { source: prior.sourceInstanceId, epoch: prior.epoch });
        this.positions.delete(symbol); this.trades.delete(symbol); this.patterns.delete(symbol); this.fills.delete(symbol); this.serial++; this.scope++;
        return;
      }
      case 'cairo_replay_fill': {
        const prior = this.positions.get(symbol);
        const prefix = `${symbol}:replay:${message.sourceInstanceId}:${message.epoch}:`;
        const id = message.positionId ? prefix + message.positionId : !message.opening && prior?.id.startsWith(prefix) ? prior.id : prefix + message.executionId;
        const records = this.fills.get(symbol)?.records ?? [];
        if (records.some(fill => fill.executionId === message.executionId)) return;
        this.fills.set(symbol, { asOf: ms(message.eventTime), records: [...records, { executionId: message.executionId, orderId: message.executionId, timestamp: ms(message.eventTime), price: message.price, quantity: message.quantity, isBuy: message.side === 'BUY' }].slice(-1000) });
        if (message.positionQuantity === 0) {
          if (this.positions.delete(symbol)) this.serial++;
          return;
        }
        this.putPosition({ id, symbol, quantity: message.positionQuantity, average: message.positionAveragePrice, brokerStops: [], sourceTime: ms(message.eventTime), fresh: true });
        if (message.delivery === 'stream' && message.opening) this.opening(symbol, id, message.price, ms(message.eventTime));
        if (message.delivery === 'stream' && (!prior || prior.quantity !== message.positionQuantity)) this.reviewFill?.(this.positions.get(symbol)!);
        return;
      }
      case 'cairo_account': {
        if (marketDate(message.asOf) !== date || this.clock() - message.asOf > 20_000 || message.asOf - this.clock() > 2000) return;
        this.fills.set(symbol, { asOf: message.asOf, records: message.executions });
        const previous = this.accounts.get(symbol);
        const ids = new Set(message.executions.map(fill => fill.executionId));
        this.accounts.set(symbol, { quantity: message.positionQuantity, fills: ids });
        const prior = this.positions.get(symbol);
        if (message.positionQuantity === 0 || !message.positionAveragePrice) {
          if (this.positions.delete(symbol)) this.serial++;
          return;
        }
        const isLong = message.positionQuantity > 0;
        const openings = message.executions.filter(fill => fill.isBuy === isLong && fill.positionEffectIsOpen).sort((a, b) => a.timestamp - b.timestamp);
        const reversal = previous && Math.sign(previous.quantity) !== Math.sign(message.positionQuantity);
        const freshFill = (fill: (typeof openings)[number]) => previous ? !previous.fills.has(fill.executionId) : fill.timestamp >= this.connectedAt;
        const newFill = openings.find(freshFill) ?? message.executions.filter(fill => fill.isBuy === isLong && freshFill(fill)).sort((a, b) => a.timestamp - b.timestamp)[0];
        const isNew = message.delivery === 'stream' && Boolean(newFill) && (Boolean(reversal) || !previous && !prior);
        const latestOpening = openings.at(-1);
        const key = isNew ? newFill!.executionId : latestOpening?.executionId ?? `${date}:${isLong ? 'long' : 'short'}`;
        const savedId = !isNew && !prior && openings.slice().reverse().map(fill => `${symbol}:live:${fill.executionId}`).find(id => this.notes[id]);
        const id = prior && !reversal && Math.sign(prior.quantity) === Math.sign(message.positionQuantity) ? prior.id : savedId || `${symbol}:live:${key}`;
        this.putPosition({ id, symbol, quantity: message.positionQuantity, average: message.positionAveragePrice, brokerStops: [...new Set(message.workingStops.map(stop => stop.price))], sourceTime: message.asOf, fresh: true });
        if (isNew) {
          this.opening(symbol, id, newFill!.price, newFill!.timestamp);
          this.reviewFill?.(this.positions.get(symbol)!);
        }
        else if (message.delivery === 'stream' && prior?.id === id &&
          (prior.quantity !== message.positionQuantity || (previous && [...ids].some(fill => !previous.fills.has(fill))))) {
          this.serial++;
          const position = this.positions.get(symbol)!;
          position.exitPlanNeedsReview = !!position.exitPlan;
          position.pending = undefined;
          this.reviewFill?.(position);
        }
        return;
      }
      case 'cairo_trade': this.trade(message); return;
      case 'cairo_patterns': {
        const retired = this.retiredPatternEpochs.get(symbol);
        if (retired?.source === message.sourceInstanceId && message.epoch <= retired.epoch) return;
        const prior = this.patterns.get(symbol);
        const time = ms(message.eventTime);
        const ready = message.readiness === 'ready' && message.coverage === 'continuous';
        const seen = new Set(message.patterns.map(item => String(item.id)));
        const evidence = message.patterns.filter(item => ms(item.eventTime) <= time && (!item.observedAt || ms(item.observedAt) <= time));
        this.patterns.set(symbol, { time, seen, evidence, ready, snapshot: { ...message, patterns: evidence } });
        if (!prior?.ready || !ready || !last || last.epoch !== message.epoch || last.source !== message.sourceInstanceId || time < prior.time || message.delivery !== 'stream') return;
        if (message.mode === 'live' && this.clock() - time > 10_000) return;
        for (const item of evidence) {
          const occurred = ms(item.eventTime);
          if (prior.seen.has(String(item.id)) || occurred < prior.time || occurred > time) continue;
          const position = this.positions.get(symbol);
          if (position?.fresh && position.note && !position.pending) this.reviewPattern?.(position, occurred);
          const conditions = this.availablePlan(occurred)?.plan.watchlist.find(entry => entry.symbol === symbol)?.setups
            .filter(setup => !position || setup.direction === (position.quantity > 0 ? 'long' : 'short')).flatMap(setup => setup.conditions) ?? [];
          for (const rule of conditions) if (rule.predicate === 'bookmap_event' && rule.eventType === item.type) {
            this.emit({ key: `${this.active?.hash}:${rule.id}:${message.sourceInstanceId}:${message.epoch}:${item.id}`, kind: 'pattern', symbol, text: `${symbol}. ${rule.label}`, marketMs: occurred });
          }
        }
      }
    }
  }

  private putPosition(value: Position) {
    const prior = this.positions.get(value.symbol);
    const unchanged = prior?.id === value.id && prior.quantity === value.quantity && prior.average === value.average && prior.brokerStops.join() === value.brokerStops.join();
    if (!unchanged) this.serial++;
    const exitPlan = prior?.id === value.id ? prior.exitPlan : undefined;
    this.positions.set(value.symbol, { ...value, note: this.notes[value.id], pending: unchanged ? prior.pending : undefined, exitPlan,
      exitPlanNeedsReview: !!exitPlan && (!unchanged || prior?.exitPlanNeedsReview === true) });
  }

  private opening(symbol: string, id: string, price: number, time: number) {
    const position = this.positions.get(symbol)!;
    this.emit({ key: `opening:${id}`, kind: 'fill', symbol, positionId: id, marketMs: time, text: `${symbol} ${this.selection.mode === 'replay' ? 'simulated ' : ''}${position.quantity > 0 ? 'long' : 'short'} fill at ${price}. What pattern did you use, and where is your intended stop?` });
  }

  private trade(message: Trade) {
    if (!this.charts.has(message.symbol)) return;
    const prior = this.trades.get(message.symbol);
    this.trades.set(message.symbol, message);
    const time = ms(message.eventTime);
    if (!prior || message.delivery !== 'stream' || prior.sourceInstanceId !== message.sourceInstanceId || message.tradeSequence !== prior.tradeSequence + 1 || time < ms(prior.eventTime)) return;
    if (message.mode === 'live' && (this.clock() - time > 10_000 || time - ms(prior.eventTime) > 20_000)) return;
    const position = this.positions.get(message.symbol);
    const entries = this.availablePlan(time)?.plan.watchlist.find(entry => entry.symbol === message.symbol)?.setups ?? [];
    const entryRules = entries.flatMap(setup => setup.conditions).filter((rule): rule is PriceCondition => rule.predicate !== 'bookmap_event');
    const management = position?.fresh ? position.note?.management?.condition : null;
    const rules = position ? management ? [management] : [] : entryRules;
    for (const rule of rules) {
      const crossed = rule.predicate === 'crosses_above' ? prior.price < rule.level && message.price >= rule.level : prior.price > rule.level && message.price <= rule.level;
      if (crossed) this.emit({ key: `${position?.id ?? this.active?.hash}:${rule.id}`, kind: 'condition', symbol: message.symbol, text: `${message.symbol} crossed ${rule.predicate === 'crosses_above' ? 'above' : 'below'} ${rule.level}. ${rule.label}`, marketMs: time, positionId: position?.id });
    }
  }

  private emit(notice: Omit<Notice, 'spoken'>) {
    if (this.sent.has(notice.key)) return;
    this.sent.add(notice.key);
    if (this.sent.size > 4096) this.sent.delete(this.sent.values().next().value!);
    const entry = { ...notice, spoken: !this.shadow };
    this.recent = [entry, ...this.recent].slice(0, 40);
    this.notify(entry);
  }

  context(symbol: string) {
    const position = this.positions.get(symbol);
    const trade = this.trades.get(symbol);
    const patterns = this.patterns.get(symbol);
    const freshPatterns = patterns?.ready && (this.selection.mode === 'replay' || this.clock() - patterns.time <= 10_000) ? patterns : undefined;
    const marketTime = Math.max(trade ? ms(trade.eventTime) : 0, freshPatterns?.time ?? 0, position?.sourceTime ?? 0) || undefined;
    const watch = this.availablePlan(marketTime)?.plan.watchlist.find(item => item.symbol === symbol);
    const evidence = freshPatterns?.evidence.slice(-8);
    const lastPrice = trade && (this.selection.mode === 'replay' || this.clock() - ms(trade.eventTime) <= 10_000) ? trade.price : undefined;
    return { position, evidence, watch, planHash: this.active?.hash, lastPrice, marketTime, serial: this.serial };
  }

  bookmap(symbol: string) {
    const snapshot = this.patterns.get(symbol)?.snapshot;
    const trade = this.trades.get(symbol);
    const cursor = Math.max(snapshot ? ms(snapshot.eventTime) : 0, trade ? ms(trade.eventTime) : 0, this.fills.get(symbol)?.asOf ?? 0);
    return { connected: this.feed, attached: this.charts.has(symbol), cursor, snapshot, trade, levels: this.levels.get(symbol) };
  }

  recentFills(symbol?: string) {
    return [...this.fills].filter(([ticker]) => !symbol || symbol === ticker).map(([ticker, fills]) => ({ symbol: ticker, asOf: fills.asOf, fresh: this.feed && (this.selection.mode === 'replay' || this.clock() - fills.asOf <= 20_000), records: fills.records }));
  }

  sizing(position: Position) { return positionSizing(position.quantity, this.fills.get(position.symbol)?.records ?? []); }

  tradeHistory(position: Position) { return tradeExecutions(position.quantity, this.fills.get(position.symbol)?.records ?? []); }

  setExitPlan(id: string, serial: number, planHash: string | undefined, plan: ExitPlan) {
    if (!this.current(id, serial, planHash)) return false;
    const position = this.find(id);
    position.exitPlan = plan;
    position.exitPlanNeedsReview = false;
    return true;
  }

  agentSymbols() {
    return [...new Set([...this.charts.keys(), ...this.positions.keys(), ...this.fills.keys(), ...this.levels.keys(),
      ...(this.active?.plan.watchlist.map(item => item.symbol) ?? [])])];
  }

  planForAgent(symbol?: string) {
    const cursor = symbol ? this.bookmap(symbol).cursor : Math.max(0, ...[...this.charts.keys()].map(ticker => this.bookmap(ticker).cursor));
    return this.availablePlan(cursor);
  }

  private availablePlan(marketTime?: number) {
    if (this.selection.mode === 'live') return this.active;
    return this.active && marketTime !== undefined && marketTime >= Date.parse(this.active.plan.researchCutoff) ? this.active : undefined;
  }

  identify(id: string, pattern: string, intendedStop: number) {
    const position = this.find(id);
    if (!pattern.trim() || !Number.isFinite(intendedStop) || intendedStop <= 0) throw new Error('Enter a pattern and positive stop price');
    this.serial++;
    position.pending = undefined;
    position.exitPlanNeedsReview = !!position.exitPlan;
    this.notes[id] = { pattern, intendedStop, management: position.note?.management };
    position.note = this.notes[id];
    return position;
  }

  current(id: string, serial: number, planHash: string | undefined) {
    return this.feed && serial === this.serial && this.active?.hash === planHash && [...this.positions.values()].some(item => item.id === id && item.fresh);
  }

  propose(id: string, serial: number, planHash: string | undefined, advice: Advice, announce = true) {
    if (!this.current(id, serial, planHash)) return false;
    const position = this.find(id);
    position.pending = advice;
    if (announce) {
      const rule = advice.condition;
      const condition = rule ? ` Proposed alert: ${rule.label}, ${rule.predicate === 'crosses_above' ? 'above' : 'below'} ${rule.level}.` : '';
      this.emit({ key: `advice:${id}:${serial}:${advice.summary}`, kind: 'advice', symbol: position.symbol, positionId: id, text: `${position.symbol}. ${advice.summary}${condition} Say “watch that” to accept.` });
    }
    return true;
  }

  approve(id: string) {
    const position = this.find(id);
    if (!position.note || !position.pending) throw new Error('There is no recommendation awaiting approval');
    const old = position.note.management?.condition;
    const next = position.pending.condition;
    if (old && next && (old.level !== next.level || old.predicate !== next.predicate)) this.sent.delete(`${id}:${next.id}`);
    position.note = this.notes[id] = { ...position.note, management: position.pending };
    position.pending = undefined;
    this.serial++;
  }

  find(id: string) {
    const position = [...this.positions.values()].find(item => item.id === id);
    if (!position?.fresh || !this.feed) throw new Error('Position data is unavailable or stale');
    return position;
  }

  private tradeTime(symbol: string) { const trade = this.trades.get(symbol); return trade && ms(trade.eventTime); }
  saved(): SavedState { return { notes: this.notes, delivered: [...this.sent], plan: this.active && { revision: this.active.plan.revision, hash: this.active.hash } }; }
  snapshot() {
    return { selection: this.selection, connected: this.feed, shadow: this.shadow, plan: this.active?.plan, planPath: this.active?.path, planError: this.error,
      positions: [...this.positions.values()], recent: this.recent, missing: this.active?.plan.watchlist.map(item => item.symbol).filter(symbol => !this.charts.has(symbol)) ?? [],
      last: Object.fromEntries([...this.trades].map(([symbol, value]) => [symbol, value.price])),
      replayVwap: Object.fromEntries([...this.trades].flatMap(([symbol, value]) => value.replayVwap === undefined ? [] :
        [[symbol, { price: value.replayVwap, partial: !value.vwapCoversPremarketStart }]])) };
  }
}

export type Snapshot = ReturnType<Engine['snapshot']>;

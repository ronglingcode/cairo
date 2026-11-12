import { z } from 'zod';
import { type LoadedPlan, type PriceCondition, type Selection, marketDate, symbolName } from './plan.ts';

const positive = z.number().finite().positive();
const ns = z.string().regex(/^\d{1,20}$/);
const envelope = z.object({ mode: z.enum(['live', 'replay', 'unknown']), symbol: symbolName, sourceInstanceId: z.string().min(1).max(100), epoch: positive.int(), sequence: positive.int(), delivery: z.enum(['stream', 'snapshot']).default('stream') });
const execution = z.object({ executionId: z.string(), timestamp: positive, price: positive, quantity: positive, isBuy: z.boolean(), positionEffectIsOpen: z.boolean().optional() });
const messages = z.discriminatedUnion('type', [
  envelope.extend({ type: z.literal('cairo_chart'), version: z.literal(1), attached: z.boolean() }),
  envelope.extend({ type: z.literal('cairo_trade'), version: z.literal(1), eventTime: ns, price: positive, tradeSequence: positive.int() }),
  envelope.extend({ type: z.literal('cairo_replay_reset'), version: z.literal(1), eventTime: ns }),
  envelope.extend({ type: z.literal('cairo_replay_fill'), version: z.literal(1), eventTime: ns, executionId: z.string(), positionId: z.string().optional(), side: z.literal('BUY'), price: positive, quantity: positive, positionQuantity: positive, positionAveragePrice: positive, opening: z.boolean() }),
  envelope.extend({ type: z.literal('cairo_account'), version: z.literal(1), asOf: positive, positionQuantity: z.number().finite(), positionAveragePrice: positive.optional(), workingStops: z.array(z.object({ price: positive, quantity: positive })).max(128), executions: z.array(execution).max(8000) }),
  envelope.extend({ type: z.literal('cairo_patterns'), version: z.literal(2), eventTime: ns, readiness: z.enum(['ready', 'not-ready']), coverage: z.enum(['continuous', 'warming', 'gap']), patterns: z.array(z.object({ id: z.union([z.string(), z.number()]), type: z.string(), revision: z.number(), eventTime: ns, observedAt: ns.optional() }).passthrough()).max(64) }),
]);
type Message = z.infer<typeof messages>;
type Trade = Extract<Message, { type: 'cairo_trade' }>;
type Evidence = Extract<Message, { type: 'cairo_patterns' }>['patterns'][number];
export type Note = { pattern: string; intendedStop: number; management?: Advice };
export type Advice = { summary: string; condition: PriceCondition | null };
export type Position = { id: string; symbol: string; quantity: number; average: number; brokerStops: number[]; sourceTime: number; fresh: boolean; note?: Note; pending?: Advice };
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
  private patterns = new Map<string, { time: number; seen: Set<string>; evidence: Evidence[]; ready: boolean }>();
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

  constructor(selection: Selection, saved: SavedState, notify: (notice: Notice) => void, clock = Date.now,
    reviewPattern?: (position: Position, marketMs: number) => void) {
    this.selection = selection;
    this.notify = notify;
    this.notes = saved.notes;
    this.sent = new Set(saved.delivered);
    this.clock = clock;
    this.reviewPattern = reviewPattern;
  }

  setShadow(shadow: boolean) { this.shadow = shadow; }
  setPlan(plan?: LoadedPlan, error = '') {
    if (this.active?.hash !== plan?.hash) {
      this.serial++;
      for (const position of this.positions.values()) position.pending = undefined;
    }
    this.active = plan;
    this.error = error;
  }
  get loaded() { return this.active; }
  get shadowMode() { return this.shadow; }

  connect() {
    this.feed = true;
    this.connectedAt = this.clock();
    this.lanes.clear(); this.charts.clear(); this.trades.clear(); this.patterns.clear(); this.accounts.clear();
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
          this.charts.delete(symbol); this.trades.delete(symbol); this.patterns.delete(symbol); this.serial++;
          const position = this.positions.get(symbol);
          if (position) {
            position.pending = undefined;
            this.emit({ key: `chart-removed:${position.id}:${message.sequence}`, kind: 'feed', symbol, text: `${symbol} chart detached. Chart alerts are paused.` });
          }
          if (message.mode === 'replay') this.positions.delete(symbol);
        }
        return;
      case 'cairo_replay_reset':
        this.positions.delete(symbol); this.trades.delete(symbol); this.patterns.delete(symbol); this.serial++;
        return;
      case 'cairo_replay_fill': {
        const prior = this.positions.get(symbol);
        const prefix = `${symbol}:replay:${message.sourceInstanceId}:${message.epoch}:`;
        const id = message.positionId ? prefix + message.positionId : !message.opening && prior?.id.startsWith(prefix) ? prior.id : prefix + message.executionId;
        this.putPosition({ id, symbol, quantity: message.positionQuantity, average: message.positionAveragePrice, brokerStops: [], sourceTime: ms(message.eventTime), fresh: true });
        if (message.opening && message.delivery === 'stream') this.opening(symbol, id, message.price, ms(message.eventTime));
        return;
      }
      case 'cairo_account': {
        if (marketDate(message.asOf) !== date || this.clock() - message.asOf > 20_000 || message.asOf - this.clock() > 2000) return;
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
        if (isNew) this.opening(symbol, id, newFill!.price, newFill!.timestamp);
        return;
      }
      case 'cairo_trade': this.trade(message); return;
      case 'cairo_patterns': {
        const prior = this.patterns.get(symbol);
        const time = ms(message.eventTime);
        const ready = message.readiness === 'ready' && message.coverage === 'continuous';
        const seen = new Set(message.patterns.map(item => String(item.id)));
        const evidence = message.patterns.filter(item => ms(item.eventTime) <= time);
        this.patterns.set(symbol, { time, seen, evidence, ready });
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
    this.positions.set(value.symbol, { ...value, note: this.notes[value.id], pending: unchanged ? prior.pending : undefined });
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

  private availablePlan(marketTime?: number) {
    if (this.selection.mode === 'live') return this.active;
    return this.active && marketTime !== undefined && marketTime >= Date.parse(this.active.plan.researchCutoff) ? this.active : undefined;
  }

  identify(id: string, pattern: string, intendedStop: number) {
    const position = this.find(id);
    if (!pattern.trim() || !Number.isFinite(intendedStop) || intendedStop <= 0) throw new Error('Enter a pattern and positive stop price');
    this.serial++;
    position.pending = undefined;
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
      last: Object.fromEntries([...this.trades].map(([symbol, value]) => [symbol, value.price])) };
  }
}

export type Snapshot = ReturnType<Engine['snapshot']>;

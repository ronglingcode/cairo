import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, unlink, realpath } from 'node:fs/promises';
import { dirname, join, relative, resolve, isAbsolute } from 'node:path';
import { z } from 'zod';

const identifier = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/).refine(value => !value.endsWith('.'));
export const sessionDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const date = new Date(value);
  return Number.isFinite(+date) && date.toISOString().slice(0, 10) === value;
});
const timestamp = z.iso.datetime({ offset: true });
export const symbolName = z.string().regex(/^[A-Z][A-Z0-9.\-]{0,14}$/);
const price = z.number().finite().positive();
const text = z.string().trim().min(1).max(200);
export const priceCondition = z.object({ id: identifier, predicate: z.enum(['crosses_above', 'crosses_below']), priceBasis: z.literal('bookmap_last'), level: price, label: text }).strict();
const condition = z.discriminatedUnion('predicate', [priceCondition, z.object({ id: identifier, predicate: z.literal('bookmap_event'), eventType: z.string().regex(/^[A-Z][A-Z0-9_]{1,63}$/), label: text }).strict()]);
const setup = z.object({ direction: z.enum(['long', 'short']), tradebook: text, tradebookPath: text, patterns: z.array(text).min(1).max(8), decisionLevels: z.array(z.object({ label: text, price }).strict()).max(20), conditions: z.array(condition).max(20) }).strict();
export const selectionSchema = z.discriminatedUnion('mode', [z.object({ mode: z.literal('live') }).strict(), z.object({ mode: z.literal('replay'), sessionDate, replayRunId: identifier }).strict()]);
export type Selection = z.infer<typeof selectionSchema>;
export const manifestSchema = z.object({
  schemaVersion: z.literal(1), sessionDate, mode: z.enum(['live', 'replay']), replayRunId: identifier.optional(),
  revision: z.number().int().positive(), confirmedAt: timestamp, researchCutoff: timestamp, researchPath: text,
  tradebookRevision: text, watchlist: z.array(z.object({ symbol: symbolName, setups: z.array(setup).max(2) }).strict()).max(3),
}).strict().superRefine((plan, context) => {
  const require = (valid: boolean, message: string) => { if (!valid) context.addIssue({ code: 'custom', message }); };
  require((plan.mode === 'replay') === Boolean(plan.replayRunId), 'Replay requires a run ID');
  require(Date.parse(plan.confirmedAt) >= Date.parse(plan.researchCutoff), 'Confirmation precedes research');
  require(marketDate(Date.parse(plan.researchCutoff)) === plan.sessionDate, 'Research date differs from the session');
  if (plan.mode === 'replay') {
    require(easternTime(Date.parse(plan.researchCutoff)) === '09:30:00' && new Date(plan.researchCutoff).getUTCMilliseconds() === 0, 'Replay cutoff must be 6:30 a.m. Pacific');
  } else {
    const time = easternTime(Date.parse(plan.researchCutoff));
    require(time < '09:30:00' || time === '09:30:00' && new Date(plan.researchCutoff).getUTCMilliseconds() === 0, 'Live research cutoff must be at or before the open');
  }
  const ids = plan.watchlist.flatMap(item => item.setups.flatMap(entry => entry.conditions.map(rule => rule.id)));
  require(new Set(ids).size === ids.length, 'Condition IDs must be unique');
  require(new Set(plan.watchlist.map(item => item.symbol)).size === plan.watchlist.length, 'Watchlist symbols must be unique');
  for (const item of plan.watchlist) require(new Set(item.setups.map(entry => entry.direction)).size === item.setups.length, `${item.symbol} has duplicate setup directions`);
});
export type Plan = z.infer<typeof manifestSchema>;
export type Condition = z.infer<typeof condition>;
export type PriceCondition = z.infer<typeof priceCondition>;
export type LoadedPlan = { plan: Plan; hash: string; path: string; markdown: string };

const dateFormat = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
const timeFormat = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
export function marketDate(ms = Date.now()) { return dateFormat.format(ms); }
function easternTime(ms: number) { return timeFormat.format(ms); }

export function planPath(backtest: string, selection: Selection, date = marketDate()) {
  const checked = selectionSchema.parse(selection);
  const parts = sessionDate.parse(checked.mode === 'replay' ? checked.sessionDate : date).split('-');
  const folder = join(backtest, 'data', 'processed', ...parts);
  return join(checked.mode === 'replay' ? join(folder, 'bookmap_replay', checked.replayRunId) : folder, 'cairo-trading-plan.md');
}

export function parsePlan(markdown: string): Plan {
  const blocks = [...markdown.matchAll(/^```cairo-plan[\t ]*\r?\n([\s\S]*?)^```[\t ]*\r?$/gm)];
  if (blocks.length !== 1) throw new Error('Expected one fenced cairo-plan JSON block');
  return manifestSchema.parse(JSON.parse(blocks[0][1]));
}

export async function readRules(backtest: string) {
  const read = (file: string) => readFile(join(backtest, 'tradebooks', file), 'utf8');
  const [master, long, short] = await Promise.all([read('master_tradebooks.md'), read('bookmap/long.md'), read('bookmap/short.md')]);
  const books = new Map([...master.matchAll(/^### \[([^:\]\n]+)(?::[^\]\n]+)?\]\((daily-chart\/[^)]+\.md)\)/gm)].map(match => [match[1].trim(), `tradebooks/${match[2]}`]));
  const names = (markdown: string) => [...markdown.matchAll(/^## ([^\r\n]+)/gm)].map(match => match[1].trim());
  return { master, books, patterns: { long: names(long), short: names(short) }, definitions: { long, short } };
}

export async function validateNames(backtest: string, plan: Plan) {
  const rules = await readRules(backtest);
  for (const item of plan.watchlist) for (const setup of item.setups) {
    if (rules.books.get(setup.tradebook) !== setup.tradebookPath) throw new Error(`Unknown master tradebook for ${item.symbol}: ${setup.tradebook}`);
    if (setup.patterns.some(name => !rules.patterns[setup.direction].includes(name))) throw new Error(`Unknown ${setup.direction} Bookmap pattern for ${item.symbol}`);
  }
}

export async function loadPlan(backtest: string, selection: Selection, date = marketDate()): Promise<LoadedPlan> {
  const path = planPath(backtest, selection, date);
  const markdown = await readFile(path, 'utf8');
  if (markdown.length > 180_000) throw new Error('Plan file is too large');
  const plan = parsePlan(markdown);
  if (plan.mode !== selection.mode || plan.sessionDate !== (selection.mode === 'replay' ? selection.sessionDate : date) || (selection.mode === 'replay' && plan.replayRunId !== selection.replayRunId)) throw new Error('Plan does not match the selected session');
  await validateNames(backtest, plan);
  return { plan, hash: createHash('sha256').update(markdown).digest('hex'), path, markdown };
}

export async function publishPlan(backtest: string, markdown: string, expectedRevision: number) {
  const plan = parsePlan(markdown);
  await validateNames(backtest, plan);
  if (!Number.isInteger(expectedRevision) || expectedRevision < 0 || plan.revision !== expectedRevision + 1) throw new Error('Expected the next plan revision');
  const selection = selectionSchema.parse(plan.mode === 'live' ? { mode: 'live' } : { mode: 'replay', sessionDate: plan.sessionDate, replayRunId: plan.replayRunId });
  if (plan.mode === 'live' && plan.sessionDate !== marketDate()) throw new Error('A live plan can only be published for the current market date');
  const target = planPath(backtest, selection, plan.sessionDate);
  await mkdir(dirname(target), { recursive: true });
  const within = relative(await realpath(backtest), await realpath(dirname(target)));
  if (within.startsWith('..') || isAbsolute(within)) throw new Error('Plan directory resolves outside Backtest');
  const lockPath = `${target}.lock`;
  const lock = await open(lockPath, 'wx');
  const temp = `${target}.${randomUUID()}.tmp`;
  try {
    const current = await readFile(target, 'utf8').catch(error => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if ((current === null ? 0 : parsePlan(current).revision) !== expectedRevision) throw new Error('Plan revision changed');
    const output = await open(temp, 'wx');
    try { await output.writeFile(markdown, 'utf8'); await output.sync(); } finally { await output.close(); }
    await rename(temp, target);
  } finally {
    await lock.close();
    await Promise.all([unlink(lockPath), unlink(temp).catch(error => { if (error.code !== 'ENOENT') throw error; })]);
  }
  return target;
}

export function safeSourcePath(root: string, file: string) {
  const target = resolve(root, file);
  const subpath = relative(root, target);
  if (subpath.startsWith('..') || isAbsolute(subpath)) throw new Error('Source path is outside Backtest');
  return target;
}

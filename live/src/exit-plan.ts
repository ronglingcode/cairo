import { z } from 'zod';

export type Fill = { executionId: string; orderId?: string; timestamp: number; price: number; quantity: number; isBuy: boolean };
export function tradeExecutions(quantity: number, executions: Fill[]) {
  const direction = Math.sign(quantity);
  let balance = Math.abs(quantity);
  const records: Array<Fill & { action: 'entry' | 'add' | 'partial' }> = [];
  const seen = new Set<string>();
  for (const fill of [...executions].sort((a, b) => a.timestamp - b.timestamp).reverse()) {
    if (seen.has(fill.executionId)) continue;
    seen.add(fill.executionId);
    if ((fill.isBuy ? 1 : -1) === direction) {
      records.push({ ...fill, quantity: Math.min(balance, fill.quantity), action: 'add' });
      balance -= fill.quantity;
      if (balance <= 1e-8) {
        records.reverse();
        const entry = records[0];
        for (const record of records) {
          if (record === entry || (record.action === 'add' && entry.orderId && entry.orderId === record.orderId)) record.action = 'entry';
        }
        return { complete: true, records };
      }
    } else {
      records.push({ ...fill, action: 'partial' });
      balance += fill.quantity;
    }
  }
  return { complete: false, records: records.reverse() };
}

export function positionSizing(quantity: number, executions: Fill[]) {
  const remaining = Math.abs(quantity);
  const { complete, records } = tradeExecutions(quantity, executions);
  if (!complete) return { originalShares: null, remaining, taken: null, added: null };
  const taken = records.filter(item => item.action === 'partial').reduce((sum, item) => sum + item.quantity, 0);
  const openingSide = records.filter(item => item.action !== 'partial');
  if (openingSide.length > 1 && openingSide.some(item => !item.orderId)) return { originalShares: null, remaining, taken, added: null };
  const originalShares = openingSide.filter(item => item.action === 'entry').reduce((sum, item) => sum + item.quantity, 0);
  return { originalShares, remaining, taken, added: remaining + taken - originalShares };
}

export const exitInput = z.object({
  targets: z.array(z.object({
    price: z.number().finite().positive(), hint: z.string().trim().min(1).max(100),
    percent: z.number().finite().positive().max(100),
  }).strict()).max(8),
  notes: z.array(z.string().trim().min(1).max(240)).max(4),
}).strict();

export type ExitPlan = { targets: Array<{ price: number; hint: string; percent: number; shares: number }>; notes: string[]; originalShares: number | null; remaining: number };
type Target = ExitPlan['targets'][number];
export type ExitProgress = { target: Target; filled: number };
export type ExitRecord = { plan: ExitPlan; fillsSeen: string[]; progress: Record<string, ExitProgress>;
  targetCredits?: Record<string, { key: string; previouslyFilled: number }> };

export function exitTargetKey(target: Pick<Target, 'price' | 'hint'>) {
  return /^\s*vwap\b|\b(?:into|at|near)\s+(?:the\s+)?vwap\b/i.test(target.hint) ? 'vwap' : target.price.toFixed(4);
}

export function exitPriceBuffer(price: number) {
  return Math.min(1, price * 0.00625);
}

export function exitCreditKey(record: ExitRecord, target: Target) {
  const key = exitTargetKey(target);
  if (record.progress[key]) return key;
  let closest = Infinity;
  let matched = key;
  const references = [...record.plan.targets.map(previous => {
    const previousKey = exitTargetKey(previous);
    return [record.targetCredits?.[previousKey]?.key ?? previousKey, previous] as const;
  }), ...Object.entries(record.progress).map(([previousKey, previous]) => [previousKey, previous.target] as const)];
  for (const [previousKey, previous] of references) {
    const distance = Math.abs(target.price - previous.price);
    if (key === exitTargetKey(previous)) return previousKey;
    if (key === 'vwap' || previousKey === 'vwap' || distance > exitPriceBuffer(previous.price) + 1e-8 || distance >= closest) continue;
    closest = distance;
    matched = previousKey;
  }
  return matched;
}

function remainingAtTarget(record: ExitRecord, target: Target, progress = record.progress) {
  const targetKey = exitTargetKey(target);
  const credit = record.targetCredits?.[targetKey];
  const key = credit?.key ?? targetKey;
  const filled = progress[key]?.filled ?? 0;
  const initial = progress[key]?.target ?? target;
  const remaining = Math.min(initial.shares - filled, target.shares - (filled - (credit?.previouslyFilled ?? 0)));
  return { key, filled, initial, remaining: Math.max(0, remaining) };
}

export function outstandingExitPlan(record: ExitRecord, remaining: number): ExitPlan {
  const { plan } = record;
  const targets = plan.targets.flatMap(target => {
    const shares = remainingAtTarget(record, target).remaining;
    if (!shares) return [];
    if (shares === target.shares) return [target];
    const percent = plan.originalShares ? Number((shares * 100 / plan.originalShares).toFixed(4)) : target.percent;
    return [{ ...target, shares, percent }];
  });
  return targets.every((target, index) => target === plan.targets[index]) && targets.length === plan.targets.length
    ? plan : { ...plan, remaining, targets };
}

export function reconcileExitRecord(record: ExitRecord, fills: ReturnType<typeof tradeExecutions>['records'], quantity: number): ExitRecord {
  const seen = new Set(record.fillsSeen);
  const progress = { ...record.progress };
  for (const fill of fills) {
    if (seen.has(fill.executionId)) continue;
    seen.add(fill.executionId);
    if (fill.action !== 'partial') continue;
    let unassigned = fill.quantity;
    for (const target of record.plan.targets) {
      const adverseDistance = quantity > 0 ? target.price - fill.price : fill.price - target.price;
      if (adverseDistance > exitPriceBuffer(target.price) + 1e-8) continue;
      const { key, filled: alreadyFilled, initial, remaining } = remainingAtTarget(record, target, progress);
      const filled = Math.min(unassigned, remaining);
      if (filled > 0) progress[key] = { target: initial, filled: alreadyFilled + filled };
      unassigned -= filled;
      if (unassigned <= 0) break;
    }
  }
  return { ...record, fillsSeen: [...seen], progress };
}

export function validateExitPlan(input: z.infer<typeof exitInput>, sizing: ReturnType<typeof positionSizing>, quantity: number): ExitPlan {
  if (input.targets.length && sizing.originalShares === null) throw new Error('Original opening size is unverified. Return notes only.');
  const targets = input.targets.map(target => ({
    ...target, shares: Math.floor((sizing.originalShares ?? 0) * target.percent / 100 + 1e-8),
  })).sort((a, b) => quantity > 0 ? a.price - b.price : b.price - a.price);
  if (targets.some(target => target.shares === 0)) throw new Error('A target rounds down to zero shares. Adjust the percentage or omit it.');
  if (new Set(targets.map(target => target.price)).size !== targets.length) throw new Error('Combine targets at the same price.');
  if (new Set(targets.map(exitTargetKey)).size !== targets.length) throw new Error('Combine targets with the same exit purpose.');
  if (targets.reduce((total, target) => total + target.shares, 0) > sizing.remaining) throw new Error('Proposed exits exceed shares still open. Reduce allocations.');
  if (!targets.length && !input.notes.length) throw new Error('Include a target or a note explaining what is missing.');
  return { targets, notes: input.notes, originalShares: sizing.originalShares, remaining: sizing.remaining };
}

export function formatExitPlan(plan: ExitPlan) {
  const targets = plan.targets.map((target, index) =>
    `${index + 1}. $${target.price.toLocaleString('en-US', { maximumFractionDigits: 6 })} ${target.hint} (${target.percent}%, ${target.shares} shares)`);
  return [...targets, ...plan.notes.map(note => '- ' + note)].join('\n');
}

import { z } from 'zod';

export type Fill = { executionId: string; orderId?: string; timestamp: number; price: number; quantity: number; isBuy: boolean };
export function positionSizing(quantity: number, executions: Fill[]) {
  const direction = Math.sign(quantity);
  const remaining = Math.abs(quantity);
  let balance = remaining;
  let taken = 0;
  const openingSide: Array<{ fill: Fill; quantity: number }> = [];
  const seen = new Set<string>();
  const fills = [...executions].sort((a, b) => a.timestamp - b.timestamp);
  for (const fill of fills.reverse()) {
    if (seen.has(fill.executionId)) continue;
    seen.add(fill.executionId);
    if ((fill.isBuy ? 1 : -1) === direction) {
      openingSide.push({ fill, quantity: Math.min(balance, fill.quantity) });
      balance -= fill.quantity;
      if (balance <= 1e-8) {
        const original = openingSide.reverse();
        const entry = original[0];
        if (original.length > 1 && original.some(item => !item.fill.orderId)) {
          return { originalShares: null, remaining, taken, added: null };
        }
        const originalShares = original.reduce((sum, item, index) =>
          sum + (index === 0 || (entry.fill.orderId && item.fill.orderId === entry.fill.orderId) ? item.quantity : 0), 0);
        return { originalShares, remaining, taken, added: remaining + taken - originalShares };
      }
    } else {
      taken += fill.quantity;
      balance += fill.quantity;
    }
  }
  return { originalShares: null, remaining, taken: null, added: null };
}

export const exitInput = z.object({
  targets: z.array(z.object({
    price: z.number().finite().positive(), hint: z.string().trim().min(1).max(100),
    percent: z.number().finite().positive().max(100),
  }).strict()).max(8),
  notes: z.array(z.string().trim().min(1).max(240)).max(4),
}).strict();

export type ExitPlan = { targets: Array<{ price: number; hint: string; percent: number; shares: number }>; notes: string[]; originalShares: number | null; remaining: number };

export function validateExitPlan(input: z.infer<typeof exitInput>, sizing: ReturnType<typeof positionSizing>, quantity: number): ExitPlan {
  if (input.targets.length && sizing.originalShares === null) throw new Error('Original opening size is unverified. Return notes only.');
  const targets = input.targets.map(target => ({
    ...target, shares: Math.floor((sizing.originalShares ?? 0) * target.percent / 100 + 1e-8),
  })).sort((a, b) => quantity > 0 ? a.price - b.price : b.price - a.price);
  if (targets.some(target => target.shares === 0)) throw new Error('A target rounds down to zero shares. Adjust the percentage or omit it.');
  if (new Set(targets.map(target => target.price)).size !== targets.length) throw new Error('Combine targets at the same price.');
  if (targets.reduce((total, target) => total + target.shares, 0) > sizing.remaining) throw new Error('Proposed exits exceed shares still open. Reduce allocations.');
  if (!targets.length && !input.notes.length) throw new Error('Include a target or a note explaining what is missing.');
  return { targets, notes: input.notes, originalShares: sizing.originalShares, remaining: sizing.remaining };
}

export function formatExitPlan(plan: ExitPlan) {
  const targets = plan.targets.map((target, index) =>
    `${index + 1}. $${target.price.toLocaleString('en-US', { maximumFractionDigits: 6 })} ${target.hint} (${target.percent}%, ${target.shares} shares)`);
  return [...targets, ...plan.notes.map(note => '- ' + note)].join('\n');
}

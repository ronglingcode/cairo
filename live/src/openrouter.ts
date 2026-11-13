import { homedir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';

export async function openRouterKey() {
  const configured = process.env.OPENROUTER_API_KEY?.trim();
  if (configured) return configured;
  try {
    const db = new DatabaseSync(join(homedir(), '.local', 'share', 'opencode', 'opencode.db'), { readOnly: true });
    try {
      const row = db.prepare("SELECT value FROM credential WHERE integration_id = 'openrouter' AND active = 1 ORDER BY time_updated DESC LIMIT 1").get();
      if (typeof row?.value === 'string') {
        return z.object({ type: z.literal('key'), key: z.string().regex(/^sk-or-v1-[\w-]+$/) }).parse(JSON.parse(row.value)).key;
      }
    } finally { db.close(); }
  } catch { /* An explicit API key also supports OpenCode versions with a different credential store. */ }
  throw new Error('Set OPENROUTER_API_KEY or connect OpenRouter in your local OpenCode profile');
}

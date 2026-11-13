import assert from 'node:assert/strict';
import test from 'node:test';
import { Agent } from '../src/agent.ts';

test('questions and automatic reviews share OpenCode context in turn order', async () => {
  const agent = new Agent('', '', '', async () => '');
  const sessions = new Map();
  const order = [];
  agent.client = {
    session: {
      create: async () => {
        const id = String(sessions.size + 1);
        sessions.set(id, []);
        return { id };
      },
      prompt: async ({ sessionID, text, metadata }) => {
        const context = sessions.get(sessionID);
        context.push({ type: 'user', text, metadata },
          { type: 'assistant', content: [{ type: 'text', text: 'Turn ' + (1 + context.filter(message => message.type === 'user').length) }] },
          { type: 'idle', outcome: 'succeeded' });
      },
      context: async ({ sessionID }) => sessions.get(sessionID),
    },
  };
  const ask = (text, background = false, scope = '0') => agent.ask(() => {
    order.push(text);
    return text;
  }, scope, async () => {}, answer => {
    order.push(answer);
    return answer;
  }, { background });
  await Promise.all([ask('Manage NVDA long'), ask('125 shares filled at 152.06', true)]);
  await ask('What is my next exit?');
  assert.deepEqual(order, ['Manage NVDA long', 'Turn 1', '125 shares filled at 152.06', 'Turn 2', 'What is my next exit?', 'Turn 3']);
  assert.equal(sessions.size, 1);
  assert.equal(await ask('What is my AMD plan?', false, 'AMD'), 'Turn 1');
  assert.equal(await ask('And my NVDA stop?'), 'Turn 4');
  assert.equal(sessions.get('2').some(message => message.text?.includes('NVDA')), false);
  agent.reset();
  assert.equal(await ask('Start fresh', false, '1'), 'Turn 1');
});

test('a live turn resumes its persisted stock session and awaits fresh evidence', async () => {
  const agent = new Agent('', '', '', async () => '');
  const prior = [{ type: 'user', text: 'My stop is 150' }, { type: 'idle', outcome: 'succeeded' }];
  agent.client = { session: {
    list: async ({ search }) => ({ data: [{ id: 'other', title: search + 'X' }, { id: 'saved', title: search }] }),
    create: async () => assert.fail('The saved session should be reused'),
    prompt: async ({ sessionID, text, metadata }) => {
      assert.equal(sessionID, 'saved');
      assert.equal(text, 'Fresh data');
      prior.push({ type: 'user', text, metadata }, { type: 'assistant', content: [{ type: 'text', text: '150' }] },
        { type: 'idle', outcome: 'succeeded' });
    },
    context: async () => prior,
  } };
  const result = await agent.ask(async () => 'Fresh data', '2025-12-04 / NVDA', async () => {}, answer => answer, { resume: true });
  assert.equal(result, '150');
});

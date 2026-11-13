import { Plugin } from '@opencode/plugin';
import { z } from 'zod';
import { toolDefinitions, type ToolName } from './agent-tools.ts';

export default Plugin.define({
  id: 'cairo-live.tools',
  async setup(ctx) {
    const endpoint = process.env.CAIRO_LIVE_TOOL_URL;
    const token = process.env.CAIRO_LIVE_TOOL_TOKEN;
    if (!endpoint || !/^http:\/\/127\.0\.0\.1:\d+$/.test(endpoint) || !token) throw new Error('Cairo tool bridge is unavailable');
    await ctx.tool.transform(editor => {
      for (const tool of editor.list()) editor.remove(tool.id);
      editor.namespace({ name: 'cairo', description: 'Read-only Bookmap and Backtest evidence, with pending advisory proposals' });
      for (const name of Object.keys(toolDefinitions) as ToolName[]) {
        const definition = toolDefinitions[name];
        editor.add({
          name, description: definition.description, input: z.toJSONSchema(definition.input, { target: 'draft-7', io: 'input' }),
          options: { namespace: 'cairo', codemode: false, permission: 'cairo_tool' },
          async execute(input, context) {
            const reply = await fetch(endpoint, {
              method: 'POST', redirect: 'error', signal: context.signal,
              headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
              body: JSON.stringify({ name, input, sessionID: context.sessionID }),
            });
            if (!reply.ok) throw new Error('Cairo tool is unavailable for this session');
            return { content: await reply.text() };
          },
        });
      }
    });
  },
});

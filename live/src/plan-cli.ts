import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parsePlan, publishPlan, validateNames } from './plan.ts';

const [command, root, file, expected] = process.argv.slice(2);
try {
  if (!root || !file || !['validate', 'publish'].includes(command) || (command === 'publish' && expected === undefined)) {
    throw new Error('Usage: npm run plan -- validate|publish BACKTEST_ROOT DRAFT.md [EXPECTED_REVISION]');
  }
  const markdown = await readFile(resolve(file), 'utf8');
  if (command === 'publish') console.log(await publishPlan(resolve(root), markdown, Number(expected)));
  else {
    const plan = parsePlan(markdown);
    await validateNames(resolve(root), plan);
    console.log(`${plan.sessionDate} ${plan.mode} revision ${plan.revision} is valid`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}

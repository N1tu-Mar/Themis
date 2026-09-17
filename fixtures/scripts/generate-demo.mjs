import { writeFile } from 'node:fs/promises';
import { buildDemoFixtures } from './build-demo.mjs';
import { validateDemoFixtureSet } from './validate-demo.mjs';
const data = buildDemoFixtures();
validateDemoFixtureSet(data);
for (const [path, records] of Object.entries(data)) {
  await writeFile(new URL(`../${path}.json`, import.meta.url), JSON.stringify(records, null, 2) + '\n');
}
console.log('Generated and validated 50 customers, 1200 transactions, 40 merchants, 12 historical cases and scenarios A–E.');

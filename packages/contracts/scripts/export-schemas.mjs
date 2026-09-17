import { writeFile } from 'node:fs/promises';
import { z } from 'zod';
import * as contracts from '../dist/index.js';
const schemas = Object.fromEntries(Object.entries(contracts)
  .filter(([name]) => name.endsWith('Schema'))
  .map(([name, schema]) => [name.slice(0, -6), z.toJSONSchema(schema)]));
await writeFile(new URL('../schemas.json', import.meta.url), JSON.stringify(schemas, null, 2) + '\n');

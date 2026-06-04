// Switch the Prisma datasource provider between sqlite (dev/tests) and postgresql
// (managed cloud). Prisma's `provider` must be a static literal, so we rewrite it.
// Usage: node scripts/set-provider.mjs <sqlite|postgresql>
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const provider = process.argv[2];
if (provider !== 'sqlite' && provider !== 'postgresql') {
  console.error('usage: node scripts/set-provider.mjs <sqlite|postgresql>');
  process.exit(1);
}

const schemaPath = resolve(dirname(fileURLToPath(import.meta.url)), '../prisma/schema.prisma');
const schema = readFileSync(schemaPath, 'utf8');
const re = /(datasource\s+\w+\s*\{[\s\S]*?provider\s*=\s*")(sqlite|postgresql)(")/;
if (!re.test(schema)) {
  console.error('Could not find the datasource provider line in schema.prisma');
  process.exit(1);
}
writeFileSync(schemaPath, schema.replace(re, `$1${provider}$3`));
console.log(`datasource provider → ${provider}. Next: pnpm --filter @decant/db run db:generate, then push/migrate against your DATABASE_URL.`);

import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { createPrismaClient, PrismaReviewService } from '@decant/db';

// Prisma's CLI creates the SQLite file under prisma/ (schema-relative); point runtime there too.
// NOTE: assumes cwd is apps/web (true for next dev/build/start). For deploy, set DATABASE_URL.
const dbPath = resolve(process.cwd(), '../../packages/db/prisma/dev.db');
const url = process.env.DATABASE_URL ?? `file:${dbPath}`;
if (!process.env.DATABASE_URL && !existsSync(dbPath)) {
  console.warn(
    `[decant] dev.db not found at ${dbPath}. Run \`pnpm --filter @decant/db run db:push\` and ` +
      '`pnpm --filter @decant/web run seed`, or set DATABASE_URL.',
  );
}

// Singleton across hot-reloads (avoid exhausting connections in dev).
const g = globalThis as unknown as { __decantPrisma?: ReturnType<typeof createPrismaClient> };
export const prisma = g.__decantPrisma ?? createPrismaClient(url);
if (process.env.NODE_ENV !== 'production') g.__decantPrisma = prisma;

export const reviewService = new PrismaReviewService(prisma);

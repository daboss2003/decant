import { resolve } from 'node:path';
import { createPrismaClient, PrismaReviewService, type PrismaClient } from '@decant/db';

/**
 * DI tokens + factory providers. We inject by EXPLICIT token (not by type) so the
 * app needs no `emitDecoratorMetadata` — it runs under the repo's tsx/esbuild
 * toolchain unchanged. Both REST and the other adapters share the SAME db client +
 * ReviewService, so a correction over HTTP writes the identical Correction +
 * AuditEvent (plan §8).
 */
export const PRISMA = Symbol('PRISMA');
export const REVIEW = Symbol('REVIEW');

const dbUrl = (): string => process.env.DATABASE_URL ?? `file:${resolve(process.cwd(), '../../packages/db/prisma/dev.db')}`;

export const dbProviders = [
  { provide: PRISMA, useFactory: (): PrismaClient => createPrismaClient(dbUrl()) },
  { provide: REVIEW, useFactory: (prisma: PrismaClient): PrismaReviewService => new PrismaReviewService(prisma), inject: [PRISMA] },
];

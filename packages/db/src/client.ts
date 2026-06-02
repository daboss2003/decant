import { Prisma, PrismaClient } from '@prisma/client';

export { Prisma, PrismaClient } from '@prisma/client';

/** Create a PrismaClient, optionally overriding the datasource URL (tests use a temp DB). */
export function createPrismaClient(databaseUrl?: string): PrismaClient {
  return new PrismaClient(databaseUrl ? { datasources: { db: { url: databaseUrl } } } : undefined);
}

/** Coerce an arbitrary JS value into a Prisma Json input (JS null/undefined → JSON null). */
export function toJson(v: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  return v === undefined || v === null ? Prisma.JsonNull : (v as Prisma.InputJsonValue);
}

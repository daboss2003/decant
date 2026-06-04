import { Inject, Injectable } from '@nestjs/common';
import type { PrismaClient } from '@decant/db';
import { PRISMA } from './db.providers';

/** Read queries over the shared Prisma client (the same data the web UI + MCP read). */
@Injectable()
export class DocumentsService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  async reviewQueue(): Promise<Array<{ documentId: string; docType: string; flagged: string[] }>> {
    const docs = await this.prisma.document.findMany({
      where: { fields: { some: { status: 'needs_review' } } },
      include: { fields: { where: { status: 'needs_review' }, select: { fieldPath: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return docs.map((d) => ({ documentId: d.id, docType: d.docType, flagged: d.fields.map((f) => f.fieldPath) }));
  }

  document(id: string): Promise<unknown> {
    return this.prisma.document.findUnique({ where: { id }, include: { fields: true, upload: true } });
  }

  audit(id: string): Promise<unknown> {
    return this.prisma.auditEvent.findMany({ where: { documentId: id }, orderBy: { timestamp: 'asc' } });
  }
}

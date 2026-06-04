import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { UploadController } from './upload.controller';
import { dbProviders } from './db.providers';
import { ingestProviders } from './ingest.providers';

/**
 * Decant REST adapter (plan §8). A thin HTTP layer over the SAME domain core + db
 * the CLI / web / MCP use — no extraction or review logic is re-implemented here.
 */
@Module({
  controllers: [HealthController, DocumentsController, UploadController],
  providers: [...dbProviders, ...ingestProviders, DocumentsService],
})
export class AppModule {}

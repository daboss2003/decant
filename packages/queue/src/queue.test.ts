import { describe, it, expect } from 'vitest';
import { InProcessQueue, type IngestJob } from '@decant/core';
import { createQueue } from './index';

describe('job queue', () => {
  it('InProcessQueue runs the handler inline', async () => {
    const seen: IngestJob[] = [];
    const q = new InProcessQueue<IngestJob>(async (j) => {
      seen.push(j);
    });
    await q.add({ uploadId: 'u1', sourceType: 'pdf', pages: [] });
    await q.close();
    expect(seen).toHaveLength(1);
    expect(seen[0]?.uploadId).toBe('u1');
  });

  it('createQueue falls back to in-process when no REDIS_URL is configured', async () => {
    let ran = false;
    const q = createQueue<IngestJob>('ingest', async () => {
      ran = true;
    }, { redisUrl: undefined });
    expect(q).toBeInstanceOf(InProcessQueue);
    await q.add({ uploadId: 'u', sourceType: 'photo', pages: [] });
    expect(ran).toBe(true);
    await q.close();
  });
});

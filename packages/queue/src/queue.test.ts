import { describe, it, expect } from 'vitest';
import { InProcessQueue, type IngestJob } from '@decant/core';
import { createQueue } from './index';

describe('job queue', () => {
  it('InProcessQueue runs the handler inline', async () => {
    const seen: IngestJob[] = [];
    const q = new InProcessQueue<IngestJob>(async (j) => {
      seen.push(j);
    });
    await q.add({ jobId: 'j1', sourceType: 'pdf', pageImages: ['p0.png'], pageTexts: [''] });
    await q.close();
    expect(seen).toHaveLength(1);
    expect(seen[0]?.jobId).toBe('j1');
  });

  it('createQueue falls back to in-process when no REDIS_URL is configured', async () => {
    let ran = false;
    const q = createQueue<IngestJob>('ingest', async () => {
      ran = true;
    }, { redisUrl: undefined });
    expect(q).toBeInstanceOf(InProcessQueue);
    await q.add({ jobId: 'j', sourceType: 'photo', pageImages: [], pageTexts: [] });
    expect(ran).toBe(true);
    await q.close();
  });
});

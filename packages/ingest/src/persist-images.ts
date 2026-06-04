import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import sharp from 'sharp';

export interface PersistedPages {
  /** Public URL per page ('' positions → null for non-raster pages, e.g. text docs). */
  refs: Array<string | null>;
  /** The first non-null ref (for `Upload.imageRef`), or null. */
  firstRef: string | null;
}

/**
 * Copy raster page images into a web-served directory as PNGs and return their
 * public URLs — so an uploaded document's pages show in the review UI. Shared by
 * the CLI `--save` and the REST `POST /uploads` handler. Non-raster pages (text
 * documents) yield null (they have no scan). `dir` is the served filesystem dir,
 * `urlPrefix` the URL it maps to (e.g. '/uploads'), `id` the filename prefix.
 *
 * Inputs are untrusted uploads, so we decide raster-vs-skip by CONTENT (sharp
 * decode) rather than the user-supplied extension, cap the decoded pixel count to
 * blunt decompression bombs, and isolate each page so one unreadable/oversized
 * page yields null instead of failing the whole upload.
 */
export async function persistPageImages(
  pageImagePaths: string[],
  opts: { dir: string; urlPrefix: string; id: string },
): Promise<PersistedPages> {
  mkdirSync(opts.dir, { recursive: true });
  const refs = await Promise.all(
    pageImagePaths.map(async (p, i) => {
      const name = `${opts.id}-${i}.png`;
      try {
        await sharp(p, { limitInputPixels: 100_000_000, failOn: 'error' }).png().toFile(resolve(opts.dir, name));
        return `${opts.urlPrefix}/${name}`;
      } catch {
        return null; // non-raster (text doc) or unreadable/oversized image → no scan for this page
      }
    }),
  );
  return { refs, firstRef: refs.find((r) => r) ?? null };
}

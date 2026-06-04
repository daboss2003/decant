// @decant/ingest — turn an uploaded file into pipeline-ready pages: rasterize PDFs
// (mupdf), read born-digital text (PDF text layer + md/html/xml/svg/txt/csv/…),
// pass raster images through. Shared by the CLI and the REST API.
export * from './pdf';
export * from './doc-text';
export * from './fs-image-store';

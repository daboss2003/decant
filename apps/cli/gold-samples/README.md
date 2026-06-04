# Real-document gold set

A directory of **labeled real documents** for the eval harness — an alternative to
the synthetic generator. Each labeled document is a pair:

```
<name>.<ext>        the document  — image (.png/.jpg), .pdf, or any text format (.md/.html/.xml/.svg/.txt/.csv/…)
<name>.gold.json    the labels    — { "docType": "...", "fields": { "<path>": { "kind", "expected" } } }
```

`kind` is one of `string | money | number | date | currency | id | bool`. Field
`path` matches the pipeline's flattened field path (e.g. `total`, `companyName`,
`openingBalance`).

Run the eval over this directory:

```bash
pnpm --filter @decant/cli run eval --gold-dir gold-samples
# add real redacted docs here, then re-run; results.json feeds the calibration sidecar
```

The source file is ingested through the normal multi-format path (PDF → mupdf,
born-digital text → exact text, raster → vision), so redacted PDFs, scans, and
text documents all work.

**Keep everything here PII-free / redacted** — mask names, account numbers, etc.
(as in the samples). This directory is meant to be committable and shareable; the
labels are the ground truth you score against, so the `expected` values should
match the *redacted* text exactly (e.g. `"********1234"`).

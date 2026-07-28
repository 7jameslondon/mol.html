import assert from 'node:assert/strict';
import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadLegalNotices } from './legal-notices.mjs';

const BASELINE_BYTES = 865_951;
const MAX_ARTIFACT_BYTES = 950_000;
const { size } = await stat(resolve('dist/example.mol.html'));
const legal = await loadLegalNotices(resolve('.'));
const rendererBytes = Buffer.byteLength(legal.minifiedBundle);
const shellAndDocumentBytes = size - rendererBytes;

assert.ok(size <= MAX_ARTIFACT_BYTES,
  `artifact is ${size.toLocaleString()} bytes, above the ${MAX_ARTIFACT_BYTES.toLocaleString()} byte budget`);
console.log(
  `Artifact budget passed: ${size.toLocaleString()} bytes total `
  + `(${rendererBytes.toLocaleString()} bundled 3Dmol; ${shellAndDocumentBytes.toLocaleString()} first-party shell/document; `
  + `baseline ${BASELINE_BYTES.toLocaleString()}; ceiling ${MAX_ARTIFACT_BYTES.toLocaleString()}).`
);

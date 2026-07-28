import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadLegalNotices, validateBuiltLicenseNotices } from './legal-notices.mjs';

const root = resolve('.');
const html = await readFile(resolve(root, 'dist/example.mol.html'), 'utf8');
const legal = await loadLegalNotices(root);
const documentPattern = /(<script type="application\/molhtml\+json" id="molhtml-doc">\s*)([\s\S]*?)(\s*<\/script>)/i;
const licensePattern = /<script type="text\/plain" id="molhtml-license-notices" data-notice-sha256="([a-f0-9]{64})">\n([\s\S]*?)\n<\/script>/;

const documentMatch = html.match(documentPattern);
const licenseMatch = html.match(licensePattern);
assert.ok(documentMatch, 'built HTML contains the editable document block');
assert.ok(licenseMatch, 'built HTML contains the canonical license block');
assert.equal(licenseMatch[1], legal.canonicalSha256, 'built HTML identifies the reviewed notice hash');
assert.equal(licenseMatch[2], legal.canonicalNotices, 'built HTML contains the reviewed notices byte-for-byte');
assert.doesNotThrow(() => validateBuiltLicenseNotices(html, legal), 'canonical built HTML passes legal validation');
assert.throws(
  () => validateBuiltLicenseNotices(html.replace(licenseMatch[0], `${licenseMatch[0]}\n${licenseMatch[0]}`), legal),
  /exactly one canonical license block/,
  'build validation rejects duplicate license blocks'
);
assert.throws(
  () => validateBuiltLicenseNotices(html.replace(legal.canonicalNotices, 'ALTERED LICENSE NOTICES'), legal),
  /differs from the reviewed canonical notices/,
  'build validation rejects altered license text'
);

const doc = JSON.parse(documentMatch[2]);
doc.title = '</title><script>license attack</script>';
doc.structure.data += '\nREMARK </script><script>license attack</script>\n';
doc.revision += 1;
const editedJson = JSON.stringify(doc, null, 2).replace(/</g, '\\u003c');
const edited = html.replace(documentPattern, (_whole, opening, _document, closing) => `${opening}${editedJson}${closing}`);
const editedLicense = edited.match(licensePattern);

assert.ok(editedLicense, 'hostile document data cannot remove the license block');
assert.equal(editedLicense[0], licenseMatch[0], 'hostile document data cannot alter the license block');
assert.equal((edited.match(/id="molhtml-license-notices"/g) || []).length, 1, 'hostile document data cannot duplicate the license block');
assert.ok(!edited.includes('<script>license attack</script>'), 'hostile document data is escaped before entering the HTML shell');
assert.equal(
  edited.replace(documentPattern, (_whole, opening, _document, closing) => `${opening}__MOLHTML_EDITABLE_DOCUMENT__${closing}`),
  html.replace(documentPattern, (_whole, opening, _document, closing) => `${opening}__MOLHTML_EDITABLE_DOCUMENT__${closing}`),
  'agent-style document editing leaves the immutable shell unchanged'
);

console.log(`License integrity tests passed (${legal.canonicalSha256}).`);

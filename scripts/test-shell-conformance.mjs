import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadLegalNotices } from './legal-notices.mjs';

const DOCUMENT_ID = 'molhtml-doc';
const LICENSE_ID = 'molhtml-license-notices';
const artifact = await readFile(resolve('dist/example.mol.html'), 'utf8');
const legal = await loadLegalNotices(resolve('.'));

function attribute(tag, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = tag.match(new RegExp(`\\b${escaped}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return match ? (match[1] ?? match[2] ?? match[3]) : null;
}

function openingTagEnd(html, start) {
  let quote = null;
  for (let index = start; index < html.length; index += 1) {
    const character = html[index];
    if (quote) {
      if (character === quote) quote = null;
    } else if (character === '"' || character === "'") quote = character;
    else if (character === '>') return index + 1;
  }
  throw new Error('unterminated script opening tag');
}

function findRawTextEnd(html, contentStart) {
  const lower = html.toLowerCase();
  let searchFrom = contentStart;
  while (searchFrom < html.length) {
    const start = lower.indexOf('</script', searchFrom);
    if (start < 0) throw new Error('unterminated script raw-text element');
    const boundary = lower[start + 8];
    if (boundary === undefined || /[\t\n\f\r />]/.test(boundary)) {
      const end = html.indexOf('>', start + 8);
      if (end < 0) throw new Error('unterminated script closing tag');
      return { start, end: end + 1 };
    }
    searchFrom = start + 8;
  }
  throw new Error('unterminated script raw-text element');
}

function scanScripts(html) {
  const lower = html.toLowerCase();
  const scripts = [];
  let cursor = 0;
  let previousEnd = 0;
  while (cursor < html.length) {
    let start = lower.indexOf('<script', cursor);
    while (start >= 0 && !/[\t\n\f\r />]/.test(lower[start + 7] ?? '>')) {
      start = lower.indexOf('<script', start + 7);
    }
    if (start < 0) break;
    if (/<\/script[\t\n\f\r />]/i.test(html.slice(previousEnd, start))) {
      throw new Error('unexpected script closing tag outside a script element');
    }
    const openEnd = openingTagEnd(html, start);
    const rawEnd = findRawTextEnd(html, openEnd);
    const openingTag = html.slice(start, openEnd);
    scripts.push({
      start,
      openEnd,
      contentStart: openEnd,
      contentEnd: rawEnd.start,
      end: rawEnd.end,
      openingTag,
      id: attribute(openingTag, 'id'),
      type: attribute(openingTag, 'type') || ''
    });
    cursor = rawEnd.end;
    previousEnd = rawEnd.end;
  }
  if (/<\/script[\t\n\f\r />]/i.test(html.slice(previousEnd))) {
    throw new Error('unexpected script closing tag outside a script element');
  }
  return scripts;
}

function validateShell(html) {
  assert.ok(html.startsWith('<!DOCTYPE html>'), 'artifact is a complete HTML document');
  const scripts = scanScripts(html);
  const documents = scripts.filter(script => script.id === DOCUMENT_ID);
  const licenses = scripts.filter(script => script.id === LICENSE_ID);
  assert.equal(documents.length, 1, 'expected exactly one editable document block');
  assert.equal(licenses.length, 1, 'expected exactly one canonical license block');

  const documentBlock = documents[0];
  const documentText = html.slice(documentBlock.contentStart, documentBlock.contentEnd);
  assert.equal(documentBlock.type, 'application/molhtml+json', 'document block has the expected MIME type');
  assert.ok(!documentText.includes('<'), 'document raw text contains no literal less-than characters');
  const document = JSON.parse(documentText.trim());
  assert.equal(document.format, 'molhtml/document', 'document format is supported');
  assert.equal(document.version, 1, 'document version is supported');

  const licenseBlock = licenses[0];
  const licenseText = html.slice(licenseBlock.contentStart, licenseBlock.contentEnd);
  assert.equal(licenseBlock.type, 'text/plain', 'license block has the expected MIME type');
  assert.equal(attribute(licenseBlock.openingTag, 'data-notice-sha256'), legal.canonicalSha256,
    'license block has the reviewed hash');
  assert.equal(licenseText, `\n${legal.canonicalNotices}\n`, 'license notices are byte-exact');

  return { scripts, documentBlock, licenseBlock, document };
}

function replaceBlockContent(html, block, content) {
  return html.slice(0, block.contentStart) + content + html.slice(block.contentEnd);
}

function removeBlock(html, block) {
  return html.slice(0, block.start) + html.slice(block.end);
}

function shellWithPlaceholder(html) {
  const { documentBlock } = validateShell(html);
  return replaceBlockContent(html, documentBlock, '__MOLHTML_EDITABLE_DOCUMENT__');
}

function escapedDocument(document) {
  return `\n${JSON.stringify(document, null, 2).replace(/</g, '\\u003c')}\n`;
}

function expectRejected(label, candidate, expected) {
  assert.throws(() => validateShell(candidate), expected, label);
}

const validated = validateShell(artifact);
const hostileDocument = structuredClone(validated.document);
hostileDocument.documentId = 'document-shell-hostile-fixture';
hostileDocument.revision += 1;
hostileDocument.modified = '2026-07-27T00:00:02.000Z';
hostileDocument.modifiedBy = 'agent';
hostileDocument.unknownHostileField = {
  unicode: 'שלום 🧬 \u2028 \u2029',
  html: '</script><script id="molhtml-doc">forged</script>',
  replacements: "$1 $& $` $'",
  quotes: '"single\' ampersand &'
};
const hostileHtml = replaceBlockContent(artifact, validated.documentBlock, escapedDocument(hostileDocument));
const hostileValidated = validateShell(hostileHtml);
assert.deepEqual(hostileValidated.document.unknownHostileField, hostileDocument.unknownHostileField,
  'hostile and unknown values round-trip losslessly');
assert.equal(shellWithPlaceholder(hostileHtml), shellWithPlaceholder(artifact),
  'agent-style splicing changes only the editable document compartment');

const legacySplice = artifact.slice(0, validated.documentBlock.contentStart)
  + escapedDocument({ ...validated.document, title: 'Legacy splice $1 $&' })
  + artifact.slice(validated.documentBlock.contentEnd);
validateShell(legacySplice);

expectRejected(
  'unescaped script-close data is rejected',
  replaceBlockContent(artifact, validated.documentBlock,
    '\n{"format":"molhtml/document","version":1,"value":"</script><script>attack</script>"}\n'),
  /JSON|document|script/i
);
expectRejected(
  'a forged document opening tag is rejected',
  artifact.slice(0, validated.documentBlock.start)
    + '<script type="application/molhtml+json" id="molhtml-doc">{"format":"molhtml/document","version":1}</script>\n'
    + artifact.slice(validated.documentBlock.start),
  /exactly one editable document block/
);
expectRejected(
  'a duplicate document block is rejected',
  artifact.slice(0, validated.documentBlock.end)
    + artifact.slice(validated.documentBlock.start, validated.documentBlock.end)
    + artifact.slice(validated.documentBlock.end),
  /exactly one editable document block/
);
expectRejected('a missing license block is rejected', removeBlock(artifact, validated.licenseBlock), /exactly one canonical license block/);
expectRejected(
  'a duplicate license block is rejected',
  artifact.slice(0, validated.licenseBlock.end)
    + artifact.slice(validated.licenseBlock.start, validated.licenseBlock.end)
    + artifact.slice(validated.licenseBlock.end),
  /exactly one canonical license block/
);
expectRejected(
  'tampered license text is rejected',
  replaceBlockContent(artifact, validated.licenseBlock, '\nTAMPERED LICENSE\n'),
  /license notices are byte-exact/
);
expectRejected(
  'an invalid notice hash is rejected',
  artifact.slice(0, validated.licenseBlock.start)
    + validated.licenseBlock.openingTag.replace(legal.canonicalSha256, '0'.repeat(64))
    + artifact.slice(validated.licenseBlock.openEnd),
  /reviewed hash/
);
const lastScript = validated.scripts.at(-1);
expectRejected(
  'an unterminated raw-text script is rejected',
  artifact.slice(0, lastScript.contentEnd),
  /unterminated script/
);
expectRejected('a stray script close is rejected', `${artifact}\n</script>`, /unexpected script closing tag/);

console.log(`Shell conformance passed: ${validated.scripts.length} script elements and 9 adversarial controls.`);

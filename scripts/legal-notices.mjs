import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export function normalizeLegalText(text) {
  return String(text).replace(/\r\n?/g, '\n').trim();
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function assert(condition, message) {
  if (!condition) throw new Error(`License validation failed: ${message}`);
}

export function validateBuiltLicenseNotices(html, legal) {
  const ids = String(html).match(/\bid\s*=\s*(["'])molhtml-license-notices\1/gi) || [];
  assert(ids.length === 1, `built HTML must contain exactly one canonical license block, found ${ids.length}`);
  const exactBlock = `<script type="text/plain" id="molhtml-license-notices" data-notice-sha256="${legal.canonicalSha256}">\n${legal.canonicalNotices}\n</script>`;
  assert(String(html).includes(exactBlock), 'built HTML license block differs from the reviewed canonical notices');
  return true;
}

function bundledPackageNames(source) {
  const names = new Set();
  for (const match of source.matchAll(/node_modules\/((?:@[^/\s"!*]+\/)?[^/\s"!*]+)/g)) names.add(match[1]);
  return [...names].sort();
}

function extractPakoZlibNotice(source) {
  const lines = String(source).replace(/\r\n?/g, '\n').split('\n');
  const start = lines.findIndex(line => line.startsWith('// (C) 1995-2013'));
  const end = lines.findIndex((line, index) => index >= start && line.includes('This notice may not be removed or altered'));
  assert(start >= 0 && end >= start, 'could not extract the pako Zlib notice from its audited source');
  return normalizeLegalText(lines.slice(start, end + 1).map(line => line.replace(/^\/\/ ?/, '')).join('\n'));
}

export async function loadLegalNotices(root) {
  const manifest = JSON.parse(await readFile(resolve(root, 'legal/third-party-manifest.json'), 'utf8'));
  assert(manifest.schemaVersion === 1, 'unsupported legal manifest schema');

  const [projectPackageText, projectLicenseText, thirdPartyText, bundlePackageText, minifiedBundle, auditBundle] = await Promise.all([
    readFile(resolve(root, 'package.json'), 'utf8'),
    readFile(resolve(root, manifest.project.licensePath), 'utf8'),
    readFile(resolve(root, manifest.notices.path), 'utf8'),
    readFile(resolve(root, manifest.bundle.packagePath), 'utf8'),
    readFile(resolve(root, manifest.bundle.minifiedPath)),
    readFile(resolve(root, manifest.bundle.auditPath))
  ]);

  const projectPackage = JSON.parse(projectPackageText);
  const bundlePackage = JSON.parse(bundlePackageText);
  const projectLicense = normalizeLegalText(projectLicenseText);
  const thirdPartyNotices = normalizeLegalText(thirdPartyText);
  const auditSource = auditBundle.toString('utf8');

  assert(projectPackage.name === manifest.project.name, `expected project name ${manifest.project.name}`);
  assert(projectPackage.license === manifest.project.license, `expected project license ${manifest.project.license}`);
  assert(sha256(projectLicense) === manifest.project.licenseSha256, 'project LICENSE differs from the reviewed text');
  assert(bundlePackage.name === manifest.bundle.package, `expected bundle package ${manifest.bundle.package}`);
  assert(bundlePackage.version === manifest.bundle.version, `expected ${manifest.bundle.package} ${manifest.bundle.version}`);
  assert(bundlePackage.license === manifest.bundle.license, `expected bundle license ${manifest.bundle.license}`);
  assert(sha256(minifiedBundle) === manifest.bundle.minifiedSha256, 'minified 3Dmol.js bundle differs from the audited artifact');
  assert(sha256(auditBundle) === manifest.bundle.auditSha256, 'auditable 3Dmol.js bundle differs from the audited artifact');
  assert(sha256(thirdPartyNotices) === manifest.notices.sha256, 'THIRD_PARTY_NOTICES.txt differs from the reviewed text');

  const actualPackages = bundledPackageNames(auditSource);
  const expectedPackages = [...manifest.bundle.expectedBundledPackages].sort();
  assert(JSON.stringify(actualPackages) === JSON.stringify(expectedPackages),
    `bundled package set changed (expected ${expectedPackages.join(', ')}, found ${actualPackages.join(', ')})`);

  for (const attribution of manifest.bundle.attributionChecks) {
    assert(auditSource.includes(attribution.sourceMarker), `audited bundle attribution is missing: ${attribution.sourceMarker}`);
    assert(thirdPartyNotices.includes(attribution.noticeMarker), `notice coverage is missing for: ${attribution.noticeMarker}`);
  }

  for (const marker of manifest.notices.requiredMarkers) {
    assert(thirdPartyNotices.includes(marker), `required notice marker is missing: ${marker}`);
  }
  for (const reference of manifest.referenceLicenses) {
    const referenceText = normalizeLegalText(await readFile(resolve(root, reference.path), 'utf8'));
    assert(sha256(referenceText) === reference.sha256, `${reference.name} license differs from its audited text`);
    assert(thirdPartyNotices.includes(referenceText), `${reference.name} license is not reproduced verbatim`);
  }
  const zlibSource = await readFile(resolve(root, manifest.zlibReference.path), 'utf8');
  const zlibNotice = extractPakoZlibNotice(zlibSource);
  assert(sha256(zlibNotice) === manifest.zlibReference.sha256, 'pako Zlib notice differs from its audited text');
  assert(thirdPartyNotices.includes(zlibNotice), 'pako Zlib notice is not reproduced verbatim');
  for (const component of manifest.components) {
    assert(thirdPartyNotices.includes(component.name), `notice does not identify ${component.name}`);
  }

  const canonicalNotices = [
    `MOL.HTML PROJECT LICENSE\nSPDX-License-Identifier: ${manifest.project.license}\n\n${projectLicense}`,
    thirdPartyNotices
  ].join('\n\n==============================================================================\n\n');
  assert(!/<\/script/i.test(canonicalNotices), 'license text contains a script-close sequence');

  return {
    manifest,
    canonicalNotices,
    canonicalSha256: sha256(canonicalNotices),
    minifiedBundle: minifiedBundle.toString('utf8'),
    bundledPackages: actualPackages
  };
}

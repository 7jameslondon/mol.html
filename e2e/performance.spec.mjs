import { expect, guardUnexpectedNetwork, openArtifact, test } from './fixtures.mjs';

function largePdb(residueCount = 1_000) {
  const lines = ['HEADER    DETERMINISTIC PERFORMANCE FIXTURE'];
  let serial = 1;
  const atoms = [
    ['N', 'N', 0], ['CA', 'C', 1.3], ['C', 'C', 2.6], ['O', 'O', 3.2], ['CB', 'C', 1.3]
  ];
  for (let residue = 1; residue <= residueCount; residue += 1) {
    for (const [name, element, offset] of atoms) {
      const atomName = name.length < 4 ? ` ${name.padEnd(3)}` : name;
      const x = residue * 1.4 + offset;
      const y = Math.sin(residue / 8) * 4 + (name === 'CB' ? 1.4 : 0);
      const z = Math.cos(residue / 8) * 4;
      lines.push(
        `ATOM  ${String(serial).padStart(5)} ${atomName} ALA A${String(residue).padStart(4)}    `
        + `${x.toFixed(3).padStart(8)}${y.toFixed(3).padStart(8)}${z.toFixed(3).padStart(8)}`
        + `${'1.00'.padStart(6)}${'20.00'.padStart(6)}          ${element.padStart(2)}`
      );
      serial += 1;
    }
  }
  lines.push('END');
  return `${lines.join('\n')}\n`;
}

test('records deterministic large-document timing observations', async ({ context, page }, testInfo) => {
  test.slow();
  await guardUnexpectedNetwork(context);
  await openArtifact(page);
  const pdb = largePdb();
  const timings = await page.evaluate(async text => {
    const started = performance.now();
    await window.molhtml.importPDB('large-deterministic.pdb', text);
    const imported = performance.now();
    const next = window.molhtml.document;
    next.scene.representation = 'sticks';
    window.molhtml.loadDocument(next, 'performance-test');
    const represented = performance.now();
    const html = window.molhtml.serialize();
    const serialized = performance.now();
    return {
      atomCount: window.molhtml.getDataQuality().summary.atomCount,
      artifactBytes: new Blob([html]).size,
      parseToRenderMs: imported - started,
      representationMs: represented - imported,
      serializationMs: serialized - represented
    };
  }, pdb);
  const navigatorStarted = await page.evaluate(() => performance.now());
  await page.locator('[data-inspector-target="navigator"]').click();
  await expect(page.locator('#navigator-tree button').first()).toBeVisible();
  const navigatorFinished = await page.evaluate(() => performance.now());
  timings.navigatorMs = navigatorFinished - navigatorStarted;
  expect(timings.atomCount).toBe(5_000);
  expect(timings.artifactBytes).toBeGreaterThan(900_000);
  for (const key of ['parseToRenderMs', 'navigatorMs', 'representationMs', 'serializationMs']) {
    expect(Number.isFinite(timings[key])).toBe(true);
  }
  await testInfo.attach('performance-observations.json', {
    body: Buffer.from(`${JSON.stringify(timings, null, 2)}\n`),
    contentType: 'application/json'
  });
});

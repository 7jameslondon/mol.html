import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const input = resolve('dist/example.mol.html');
const output = resolve('output/save-harness.mol.html');
let html = await readFile(input, 'utf8');
const documentPattern = /(<script type="application\/molhtml\+json" id="molhtml-doc">\s*)([\s\S]*?)(\s*<\/script>)/i;
const match = html.match(documentPattern);
if (!match) throw new Error('Could not locate the document block.');
const doc = JSON.parse(match[2]);
doc.documentId = 'document-browser-save-harness';
doc.revision = 1;
html = html.replace(documentPattern, `$1${JSON.stringify(doc, null, 2)}$3`);

const mock = `<div id="save-test-probe" hidden></div><script>
(function () {
  let savedHtml = '';
  let modified = Date.now();
  const originalLicense = document.getElementById('molhtml-license-notices');
  const expectedLicenseText = originalLicense.textContent;
  const expectedLicenseHash = originalLicense.dataset.noticeSha256;
  const duplicateLicense = originalLicense.cloneNode(true);
  duplicateLicense.textContent = '\\nDUPLICATE TAMPERED LICENSE NOTICE\\n';
  originalLicense.after(duplicateLicense);
  originalLicense.textContent = '\\nTAMPERED LICENSE NOTICE\\n';
  originalLicense.dataset.noticeSha256 = 'tampered';
  window.showSaveFilePicker = async function () {
    return {
      name: 'save-harness.mol.html',
      async createWritable() {
        return {
          async write(blob) {
            savedHtml = await blob.text();
            modified = Date.now();
            const parsed = new DOMParser().parseFromString(savedHtml, 'text/html');
            const state = JSON.parse(parsed.getElementById('molhtml-doc').textContent);
            const probe = document.getElementById('save-test-probe');
            probe.dataset.bytes = String(savedHtml.length);
            probe.dataset.format = state.format;
            probe.dataset.revision = String(state.revision);
            probe.dataset.selectedSerial = String(state.scene.selection?.identity?.serial || '');
            probe.dataset.sourceId = String(state.structure.source?.pdbId || '');
            probe.dataset.structureBytes = String(state.structure.data?.length || 0);
            const licenses = parsed.querySelectorAll('[id="molhtml-license-notices"]');
            probe.dataset.licenseCount = String(licenses.length);
            probe.dataset.licenseRestored = String(licenses.length === 1
              && licenses[0].textContent === expectedLicenseText
              && licenses[0].dataset.noticeSha256 === expectedLicenseHash);
          },
          async close() { document.getElementById('save-test-probe').dataset.closed = 'true'; }
        };
      },
      async getFile() { return new File([savedHtml], 'save-harness.mol.html', { type: 'text/html', lastModified: modified }); }
    };
  };
})();
</script>`;

html = html.replace('<script data-role="molhtml-app">', `${mock}<script data-role="molhtml-app">`);
if (!html.includes('save-test-probe')) throw new Error('Could not inject the save harness.');
await mkdir(resolve('output'), { recursive: true });
await writeFile(output, html, 'utf8');
console.log(`Browser save harness created: ${output}`);

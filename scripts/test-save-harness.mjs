import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const input = resolve('dist/MolView.molecule.html');
const output = resolve('output/save-harness.molecule.html');
let html = await readFile(input, 'utf8');
const documentPattern = /(<script type="application\/molview\+json" id="molview-doc">\s*)([\s\S]*?)(\s*<\/script>)/i;
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
  window.showSaveFilePicker = async function () {
    return {
      name: 'save-harness.molecule.html',
      async createWritable() {
        return {
          async write(blob) {
            savedHtml = await blob.text();
            modified = Date.now();
            const parsed = new DOMParser().parseFromString(savedHtml, 'text/html');
            const state = JSON.parse(parsed.getElementById('molview-doc').textContent);
            const probe = document.getElementById('save-test-probe');
            probe.dataset.bytes = String(savedHtml.length);
            probe.dataset.format = state.format;
            probe.dataset.revision = String(state.revision);
            probe.dataset.selectedSerial = String(state.scene.selection?.identity?.serial || '');
            probe.dataset.sourceId = String(state.structure.source?.pdbId || '');
            probe.dataset.structureBytes = String(state.structure.data?.length || 0);
          },
          async close() { document.getElementById('save-test-probe').dataset.closed = 'true'; }
        };
      },
      async getFile() { return new File([savedHtml], 'save-harness.molecule.html', { type: 'text/html', lastModified: modified }); }
    };
  };
})();
</script>`;

html = html.replace('<script data-role="molview-app">', `${mock}<script data-role="molview-app">`);
if (!html.includes('save-test-probe')) throw new Error('Could not inject the save harness.');
await mkdir(resolve('output'), { recursive: true });
await writeFile(output, html, 'utf8');
console.log(`Browser save harness created: ${output}`);

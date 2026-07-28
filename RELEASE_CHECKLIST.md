# Manual release checklist

Automated validation proves the portable HTML, serialization, modeled workflows,
and mocked browser integrations. Complete these checks on supported desktop
hardware before a release because browser mocks cannot prove operating-system or
real-GPU behavior.

## Native file behavior

- Open the tracked `dist/example.mol.html` directly in current desktop Chromium.
- Use **Save as…** with the real file chooser and confirm the chosen `.mol.html`
  reopens with the same molecular state and one canonical notice block.
- Edit and save in place, then confirm the same file changes on disk.
- Deny picker permission and confirm the viewer reports the failure without
  claiming success or damaging the existing file.
- Modify a selected file externally and confirm the warning blocks overwrite
  until **Reload from disk** is used.

## Real-GPU molecular interaction

- Confirm the starter molecule is visible and rotate, pan, zoom, and fit work.
- Pick an atom and confirm the inspector identity matches the visible selection.
- Exercise cartoon, ball-and-stick, sticks, spacefill, lines, and surface modes.
- Confirm surface generation completes without a blank or lost WebGL context.
- Load `fixtures/ligand-pocket.pdb` and confirm ligand and pocket emphasis plus
  contact lines behave as described.

## Release record

Record the operating system, Chromium version, GPU/driver, date, tester, and any
exceptions in the release notes. Do not treat the mocked CI picker as evidence
for native file permission behavior.

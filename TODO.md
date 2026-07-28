
# TODO

This file is the project’s running to-do list. Agents should only edit it when a user explicitly asks for `TODO.md` to be changed. Do not edit this explanatory area. When there are no tasks, the list below should contain one empty bullet point.

----

- [ ] Rename the project from `molview/file` to `mol.html` before publication.
  - [ ] Use `mol.html` for the product name, package name, browser titles, interface branding, metadata, documentation, and demonstration content.
  - [ ] Use `molhtml` wherever a period cannot or should not be used.
  - [ ] Rename the document format from `molview/document` to `molhtml/document`.
  - [ ] Rename the embedded document script ID from `molview-doc` to `molhtml-doc`.
  - [ ] Rename the embedded document script type from `application/molview+json` to `application/molhtml+json`.
  - [ ] Rename the browser API from `window.molview` to `window.molhtml`.
  - [ ] Rename internal globals from `MolViewCore` and `MolViewPersistence` to `MolhtmlCore` and `MolhtmlPersistence`.
  - [ ] Rename related internal identifiers, including the IndexedDB name to `molhtml-autosave`, the file-picker ID to `molhtml-document`, and the application data role to `molhtml-app`.
  - [ ] Change the primary build artifact to `dist/example.mol.html`.
  - [ ] Change saved-document and test-artifact suffixes from `.molecule.html` to `.mol.html`.
  - [ ] Update the build, verifier, model, persistence layer, application initialization, tests, README, and agent guide for the new names and document contract.
  - [ ] Do not add legacy aliases, migration handling, or compatibility code that retains the old project name.
  - [ ] Build `dist/example.mol.html`, run the verifier, and run the complete test suite.
  - [ ] After the replacement builds successfully, remove the obsolete `dist/MolView.molecule.html` artifact.
  - [ ] Search project-owned source, documentation, tests, and generated artifacts case-insensitively for `molview`, `molview-file`, `molview/file`, and `.molecule.html`; confirm no old-name references remain.

- Remove the 3DMOL badge from the UI
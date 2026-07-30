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
- Load `fixtures/7ril-identity.cif`; confirm it renders, identifies the 5N0
  ligand as label instance C/entity 3 with author chain B, and distinguishes it
  from DNA with instance/entity/role coloring while author-chain coloring stays
  shared.
- Save and reopen that mmCIF document; confirm the original coordinate text and
  identity-aware selection survive without serialized runtime topology.
- Load `fixtures/multi-model.pdb`; confirm both coordinate models render and a
  saved selector for model 2 resolves despite duplicate atom serials.
- Load an mmCIF structure with `_struct_conn` hydrogen-bond and salt-bridge
  annotations. Confirm cyan and amber dashed overlays toggle independently,
  water inclusion updates counts, and no covalent sticks or connected
  components change.
- Save and reopen with interactions enabled, then apply a saved view with
  different interaction settings and confirm both states restore exactly.
- Confirm the Interactions inspector identifies explicit and inferred totals,
  labels safety-limited results as partial, and remains keyboard accessible.

## Native PNG export

- Export Current, 2x, and a changed-aspect Custom PNG; confirm their decoded
  pixel dimensions exactly match the inspector summary.
- Export once with the scene background and once transparent; confirm the first
  is opaque and the second has transparent background pixels around the molecule.
- Rotate, pan, and zoom, then export immediately; confirm the image uses the live
  camera while the visible viewer size, camera, document revision, and undo stack
  remain unchanged by export.
- Export a molecular surface and repeat several exports; confirm there is no
  blank frame, progressive slowdown, visible-viewer resize, or lost WebGL context.
- Copy an image into an application that accepts PNG clipboard data. Deny
  clipboard permission once and confirm mol.html offers an explicit download
  without starting a surprise download.

## Turntable video export

- Record Current, 720p-fit, and 1080p-fit videos in landscape and portrait
  layouts; confirm decoded dimensions exactly match the inspector summaries and
  every dimension is even and inside its advertised bounding box.
- Record clockwise and counterclockwise from an obviously asymmetric view.
  Confirm the directions are opposite, playback completes one turn, and looping
  has no duplicated pause or obvious angular jump at the seam.
- Rotate, pan, and zoom immediately before recording. Confirm frame zero matches
  that live camera and the visible viewer, document JSON, selection state, save
  state, and undo history remain unchanged afterward.
- Exercise sticks, cartoon, surface, labels, measurements, saved-selection
  emphasis, and interaction overlays. Confirm renderer-owned content appears and
  editor controls, measurement drafts, and story UI do not.
- Start recording, edit the live scene, close and reopen Export, then cancel.
  Confirm the accepted video snapshot does not change, progress and Cancel return
  when reopened, and PNG export still works afterward.
- Hide the tab during preparation and during recording. Confirm a clean
  cancellation, then repeat a successful PNG and video export without reload.
- Exercise both MP4 and WebM on platforms that expose them. Confirm Blob MIME,
  completion text, extension, decoded container, and codec description agree;
  do not require MP4 where it is unavailable.
- Play a successful file in the browser and one common desktop presentation or
  video player. Record actual duration and inspect for uneven holds on a loaded
  machine; duration and submitted fps are targets rather than encoded guarantees.
- Repeat ten 1080p six-second exports including a surface, with mid-recording and
  surface-preparation cancellations. Check for monotonic heap/WebGL growth,
  progressive slowdown, lingering download URLs, or a lost export context.
- Run offline and confirm recording causes no HTTP request and no camera,
  microphone, screen-capture, or other permission prompt.

## Release record

Record the operating system, Chromium version, GPU/driver, date, tester, and any
exceptions in the release notes. Do not treat the mocked CI picker as evidence
for native file permission behavior.

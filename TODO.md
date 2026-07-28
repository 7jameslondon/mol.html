# TODO

This file is the project’s running to-do list. Agents should only edit it when a user explicitly asks for `TODO.md` to be changed. Do not edit this explanatory area. When there are no tasks, the list below should contain one empty bullet point.

----

- Replace the generated starter structure with the complete DNA-only coordinates from the experimentally determined Dickerson–Drew dodecamer (PDB 1BNA). Remove crystallographic waters and excess PDB headers, retain all 486 DNA atoms and clear RCSB/PDB provenance. This will result in an approximately 22.8 KB coordinate-payload increase.
- Try loading PDP 7RIL. It has two strand of DNA and a PIP. When colored by chain the PIP and one strand of DNA are treated as one chain. Is this intended behavior? Should it be? Do not make changes just explain.
- Add persistent visual annotations anchored to atoms or residues, including labels, callouts, arrows, regions, and free-text notes
- Add publication and presentation exports, including high-resolution PNG, transparent backgrounds, copy image, turntable video, story autoplay, and read-only presentation output
- Add PDBx/mmCIF support while keeping structure loading format-neutral: provide one Open action for all supported local files and one unified Fetch action for both exact RCSB IDs and descriptive searches; automatically detect or choose the coordinate format, use the same loading, validation, viewing, and saving experience for PDB and mmCIF, and expose format details only as provenance or troubleshooting information
- Enable GitHub branch protection for `main` after the validation workflow lands: require the `validate` job and require the branch to be current before merge, or use a merge queue
- Obtain the first Linux CI artifact-diff evidence by completing a successful `validate` run that confirms the Linux build leaves `dist/example.mol.html` unchanged

# Supplemental distribution notices

`upstream/index.json` maps exact dependency versions to supplemental notices and
their public sources. These cover upstream packages whose published npm archive
omits a license file. Original package notices are retained as well.

Entries marked `projectLicense` preserve the project's published license and
copyright text; the declared license of the shipped version is recorded alongside
it. Git blob URLs identify the exact retrieved text. For packages that declare
MIT or ISC but publish no complete text, `declared-license` files preserve that
version's declaration, available attribution and README, followed by the standard
SPDX license text. Its template placeholders are not assertions of copyright
ownership. No copyright years or holders are invented.

`native.json` records notices for bundled native components. Flipper components
use the repository's original MIT license. Node, Electron/Chromium and JetBrains
Mono notices are copied separately from their distributions.

The packaging collector reads only dependencies of the shipped backend, renderer
and shipped plugins. It fails if any dependency has no notice. Adding a dependency
requires reviewing its license and preserving any required notices, including
those for code embedded in a dependency; a manifest license label alone is not a
complete review. These files are notices, not changes to upstream license terms.

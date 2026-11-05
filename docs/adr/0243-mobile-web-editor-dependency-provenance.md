# ADR-0243: Mobile Web Editor Dependency Provenance

Platform: mobile

## Status

Proposed; dependency remediation and native acceptance pending in TOL-97.

## Context

TenTap's published web entry contains bundled TipTap and ProseMirror code. Its
package dependency declarations do not establish which versions are embedded in
that artifact. Rebuilding Memoria's HTML while importing that entry can therefore
preserve vulnerable code even after the lockfile is updated.

The installed source also exposed a pre-existing mismatch: a TipTap text-style
extension requires a core export absent from the pinned core. Opaque prebundling
had hidden this incompatibility from the normal editor build.

## Decision

Resolve `@10play/tentap-editor/web` to the web source shipped in the installed,
integrity-checked TenTap package when building Memoria's editor HTML. Keep using
TenTap's implementation and bridges; do not fork or reimplement the editor.
Resolve React through the mobile package as before.

Build in memory and expose esbuild provenance metadata to the regression test.
Require a source-backed TenTap runtime with one TipTap core and one ProseMirror
state module, without a native React Native entry in the browser artifact.
Importing the builder must not rewrite the generated editor or change the process
working directory. Only the explicit CLI invocation writes the fixed output file.

Align security-sensitive editor dependencies before accepting the generated
bundle. A missing source entry, incompatible peer, or failed build is an error,
not a reason to silently fall back to the opaque bundled entry.

Align TipTap core, ProseMirror peers and unpatched extensions on the same
published release. Preserve Memoria's existing link/code patches on their
compatible caret peer ranges. Declare `@floating-ui/dom`, required by TipTap's
React peer contract, directly in the desktop and mobile packages. It is browser
editor positioning code, not a new native module or vault-storage dependency.

Keep Metro's 0.83.x packages on the upstream 0.83.8 security patch as a cohort.
Earlier Metro passes file paths to image-size's synchronous API; substituting
image-size 2.x globally breaks asset bundling because it accepts byte buffers
instead. Metro's upstream patch removes that dependency and vendors its supported
parsers, avoiding either a vulnerable downgrade or a locally invented adapter.
Protect the actual file-path asset flow with an Expo-resolved regression test.

## Consequences

Dependency fixes must be reflected in the actual WebView artifact, not only in
package metadata. Regenerate the editor HTML after the dependency fix and verify
editing, formatting, links, tables and math on native iPhone and iPad builds.
Existing package patches remain required unless independently superseded and
verified. Native SDK versions and vault formats are unchanged by this decision.

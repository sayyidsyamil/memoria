# Memoria — upstream attribution

Memoria is derived from [Tolaria](https://github.com/refactoringhq/tolaria),
created by Luca Rossi / Refactoring and its contributors.

The initial Memoria fork was cloned from upstream commit
`0632efab` on 2026-10-30. The inherited workspace implementation is upstream
work; renaming it does not constitute a new implementation.

The upstream AGPL-3.0-or-later licence and existing copyright and third-party
notices remain applicable. Tolaria's name and logo belong to their respective
owners. Memoria is a separate project, not an official Tolaria release.

## Initial fork verification

- Application and internal naming migrated to Memoria, including renamed module
  paths, packages, protocols, environment variables, and locale strings.
- Original upstream URLs, copyright lines, licence notices, and Git history are
  retained. Images may still depict the upstream product.
- Local identity and renamed-import verification passed (40 imports).
- Locale validation passed (21 catalogs, 1,365 English keys).
- Tauri CLI tests passed (8); release/launcher tests passed (16).
- Bundled agent documentation regenerated successfully (49 documents).
- `git diff --check` passed.
- Dependency packages were installed through a temporary local adapter that
  rewrites the configured mirror's broken tarball URLs to its working public
  proxy path. Lockfile configuration and patch hashes were reconciled.
- Frontend type checking (`tsc -b`) and production Vite build passed.
- Native debug Tauri app bundle built successfully and was installed as
  `~/Applications/Memoria Workspace.app`; Launch Services started the installed
  executable and macOS reported its process visible.
- pnpm 11 still reports ignored dependency lifecycle scripts through its automatic
  install check; the successful build invoked the installed tools directly.
- Screen Recording permission was unavailable, so rendered native UI was not
  visually verified.
- No changes have been committed, pushed, or published.

## Design references (inspiration only)

The black-and-white Memoria app icon is the user's existing artwork from the
separate Dock application, reproduced at native icon sizes for this workspace.
The preserved original Memoria decision engine is attributed to Sayyid Syamil;
integration adapters are separate from its historical evaluated configuration.

The November 2026 meeting-surface redesign (Record, Transcript, Summary, Ask and
Search views, pill tabs, speaker avatars, citation chips) was informed by the public
Aceternity UI site and a "Meeting Notes" reference page (Parley). No code, markup,
CSS, copy, images, icons or fonts from Aceternity UI (Pro or free registry) or Parley
are included; their terms restrict redistributing source and Memoria is licensed
under AGPL-3.0-or-later. All components are original implementations on the existing
Radix, Phosphor and project CSS foundations, and no dependency was added for them.
See [docs/UI-PATTERNS.md](docs/UI-PATTERNS.md). The earlier
[Unslop](docs/UNSLOP-PASS.md) pass credits its method separately (CC BY 4.0).

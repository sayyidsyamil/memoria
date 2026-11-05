# Contributing to Memoria

Memoria is an early meeting-intelligence research prototype. Contributions should
improve a specific workflow, preserve source evidence, and be easy to verify.

## Start a discussion

Use [GitHub Issues](https://github.com/sayyidsyamil/memoria/issues) for bugs and
feature proposals. Check existing issues first. Discuss significant architectural
or product changes before implementing them.

## Local setup

Follow [Development setup](docs/DEVELOPMENT.md).
Use a disposable vault with fictional meeting content; never include personal
recordings, credentials, voice profiles, or runtime journals in a pull request.

## Pull requests

- Branch from `main`; keep each pull request focused on one problem.
- Describe the user-visible change and any compatibility implications.
- Reuse existing components and conventions; read [UI patterns](docs/UI-PATTERNS.md)
  before changing meeting surfaces.
- Run `pnpm build`, `pnpm test:memoria`, and relevant engine or Rust checks.
- For a bug, add a meaningful regression test when practical.
- Describe native verification separately from browser/mock tests. List anything
  you could not test, including platform-specific behaviour.
- Preserve upstream copyright, AGPL-3.0-or-later licensing, and third-party notices.

The latest full-suite results are in
[Workspace product verification](docs/WORKSPACE-PRODUCT-VERIFICATION.md). Do not
describe scoped passing tests as a green full suite.

## Bug reports

Include the commit or app version, OS and architecture, steps to reproduce,
expected and actual behaviour, and a small fictional fixture if useful. For
meeting-runtime problems, include which preparation step failed and relevant
redacted error messages.

Only attach screenshots or logs after removing private meeting content and local
credentials. Report security vulnerabilities through [SECURITY.md](SECURITY.md),
not a public issue.

# Upstream automation reference

These workflows and the funding configuration originated in Tolaria. They are
preserved as reference material outside `.github/workflows/` so a push to Memoria
does not invoke upstream release, signing, sponsor, or deployment infrastructure.

They are not runnable Memoria release instructions. The active development checks
are in [memoria-checks.yml](../../.github/workflows/memoria-checks.yml). Original
history and attribution remain in Git and [NOTICE.md](../../NOTICE.md).

The original Git hooks are retained here as `pre-commit` and `pre-push`. Active
hooks in `.husky/` run Memoria's staged whitespace check and scoped local build/test
checks, without requiring upstream CodeScene, Codacy, or signing accounts.

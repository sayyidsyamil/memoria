# Golden Vault Fixtures

This directory contains golden JSON fixtures capturing the expected output of the Rust vault scanner (`list_vault`, `src-tauri/src/vault/`) for test vaults. These fixtures serve as the source of truth for the TypeScript vault index implementation (packages/vault-index) to ensure web/desktop parity.

## Purpose

Golden fixtures enable:

1. **Regression testing**: Detect unintended changes to the vault scanner output format or behavior
2. **Cross-platform parity**: Provide deterministic, machine-independent snapshots that work across different filesystems and operating systems
3. **TypeScript implementation reference**: Serve as the specification for the upcoming TypeScript vault index (card TOL-B1-2)

## Files

- `demo-vault-v2.json` - Golden output for `demo-vault-v2/` (35 entries as of 2026-10-22)

## Format

Each golden file contains an array of `NormalizedVaultEntry` objects with:

- **Deterministic ordering**: Entries sorted by path for stable diffs
- **Relative paths**: All paths are relative to vault root with forward slashes (e.g. `"note.md"`, `"folder/note.md"`)
- **No machine-specific data**: Excludes absolute paths, timestamps (`modifiedAt`, `createdAt`), and other system-dependent values
- **Omitted empty fields**: Default/empty values are excluded for cleaner output

## Regenerating Golden Fixtures

To update the golden fixtures after intentional changes to the vault scanner:

```bash
cd src-tauri
PKG_CONFIG_PATH=/usr/lib/x86_64-linux-gnu/pkgconfig \
  REGENERATE_GOLDEN=1 \
  cargo test --lib vault::golden_vault_fixtures
```

**When to regenerate:**

- After adding new fields to `VaultEntry`
- After changing frontmatter parsing logic
- After updating `demo-vault-v2` contents intentionally
- After fixing bugs that change scanner output

**When NOT to regenerate:**

- During routine development without scanner changes
- When tests fail unexpectedly (investigate the root cause first)

## Verifying Against Golden Fixtures

The standard test run validates current scanner output against the golden files:

```bash
cd src-tauri
PKG_CONFIG_PATH=/usr/lib/x86_64-linux-gnu/pkgconfig \
  cargo test --lib vault::golden_vault_fixtures
```

If the test fails:

1. **Review the diff** shown in the test output
2. **Determine if the change is intentional**:
   - If yes: regenerate the golden fixtures and commit them
   - If no: fix the regression in the vault scanner
3. **Never regenerate blindly** to make tests pass without understanding why they failed

## Adding New Test Vaults

To add golden fixtures for edge cases or additional test vaults:

1. Create a new test vault directory (e.g., `src-tauri/tests/fixtures/edge-cases/`)
2. Add a new test function in `golden_vault_fixtures.rs`:

```rust
#[test]
fn test_edge_cases_golden_fixture() {
    let vault_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests")
        .join("fixtures")
        .join("edge-cases");
    let golden_path = fixtures_dir().join("edge-cases.json");
    
    if should_regenerate() {
        write_golden_fixture(&vault_path, &golden_path).expect("Failed to write");
    } else {
        verify_against_golden(&vault_path, &golden_path).expect("Verification failed");
    }
}
```

3. Run with `REGENERATE_GOLDEN=1` to create the initial golden file
4. Commit both the test vault and the golden JSON

## Integration with CI

These tests run in CircleCI as part of the standard Rust test suite. Golden fixtures are checked into git and versioned alongside the code they validate.

---

Last updated: 2026-10-22
Maintained by: Memoria Web team (TOL project)
Related cards: TOL-147 (fixtures creation), TOL-B1-2 (TypeScript vault index)

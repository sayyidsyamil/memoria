# Install smoke test of the release build (v0.1.0-uat)

Done by the build agent on 14 Oct 2026 on the development Mac. It does NOT replace the clean-account test (AC7), which needs a second macOS user and a person at the screen.

| Step | Result |
|---|---|
| `bash scripts/build-release.sh` on a clean working tree, no telemetry keys | built; record in `app/docs/RELEASE_RECORD.md` (commit `0ffced8`, dmg SHA-256 `3ff78afa0bb95c240562452c56d6af5835960305c7c5f3ac9ec39773e52b9e88`) |
| Bundle contents (`Contents/Resources`) | `demo-vault/` (with `views/active-projects.yml`), `python/` (7 files including `requirements.txt`), `engine/memoria_engine/` (with `evaluation/`), `mcp-server/`, `agent-docs/`; no `__pycache__` |
| First release build | **failed the nested-file check that did not exist yet**: resources declared as globs were flattened (DEF-21 in `defect_log.md`); fixed and rebuilt |
| `codesign -dv` | ad-hoc signature (`flags=0x10002(adhoc,runtime)`), identifier `com.memoria.app` |
| Install: mount the .dmg, copy `Memoria.app` to a new folder | works |
| `scripts/memoria-doctor.sh` with `MEMORIA_ENGINE_DIR` pointing at the bundled engine | READY (python packages, engine starts, models cached, git) |
| Import of the bundled engine with `PYTHONPATH=<bundle>/engine` | OK (checked by the build script) |
| Launch of the installed app with `HOME=/tmp/memoria-clean-home` (a fresh home folder) and `HF_HOME` pointing at the existing model cache | starts, stayed running for 25 minutes, created `Library/Application Support/com.memoria.app/{settings.json,ai-workspace-sessions.json}` in the fresh home |
| Not verified | the first-run screens, creation of the starter vault from the packaged resources, and task T1 in the GUI (the capture of the screen was not possible from the build session) |

To finish AC7: create a second macOS user, install the .dmg there, run `docs/DEPLOYMENT.md` step "clean account", open the app, choose Get started, open Decisions & commitments, load the sample setup and add the three meetings; keep the screen recording and the doctor output (UAT runbook, section 1).

# UAT fixture tools

The private participant protocol, forms and analysis are in `Memoria-FYP/report/uat/`.
These scripts prepare fictional data; they do not produce participant results.

## Core T1–T5

`build_demo_vault.py` creates the three recorded, reviewed procurement meetings and tracked-item setup.
`reset-demo.sh` copies that pristine starter to a disposable working folder before each participant.
`memoria-doctor.sh` checks the installed app and local runtime setup. `dry_run.sh` and `score_demo.py`
are developer checks, not user acceptance evidence.

`smoke_installed.py` verifies the installed bundle and its running resident workers on a fresh demo copy:

```sh
python3.11 -B scripts/uat/smoke_installed.py --pid <test-app-pid> --expected-version 0.3.2 \
  --pristine <pristine-demo-vault> --output <new-smoke-result.json> --restart-worker
```

It requires a test app launched with `--memoria-vault-instance`. The optional restart check terminates
only that instance's Qwen child, then checks replacement and a subsequent request. Results include
value/key and quote-provenance checks, Alpha→Beta history, T4/T5, live-check probes and the bundle signature.
It also checks manual correction reasons in Ask, live Ask and the brief, then verifies that the saved
Markdown retains the reason and the corrected fact dependency.
This does not establish native UI/audio behaviour, source entailment or participant acceptance.
It also saves a separate `advantage-demo` workspace from the actual model proposals, with Alpha approved
and one Beta change awaiting review. Other suggestions are reviewed by the setup script. Use this only
for the presenter's opening demonstration; participant T1–T5 must start from the pristine starter.

## Separate C1 review challenge

Run core T1–T5 and collect SUS before this additional diagnostic. It has its own workspace and results.
Two short fictional recordings establish a known baseline and a follow-up. The follow-up has two
researcher-written proposals: one unsupported attribution and one supported change. This tests review
decisions; it does not estimate a language model's error rate. Accept-all and reject-all both fail.

Create a **new empty folder** and keep the facilitator receipt outside it:

```sh
python3.11 -B scripts/uat/review_challenge.py build "$HOME/Documents/Memoria C1-P01" \
  --receipt "$HOME/Documents/Memoria-UAT-results/P01-fixture.json"
```

The builder uses macOS `say` (Samantha by default) and `ffmpeg` to write synthetic audio to files,
without playing it or loading a language model. `--voice` selects another installed macOS voice.
It refuses a nonempty target or an existing receipt. Build a fresh fixture for each participant.

Close the previous test instance before opening this workspace. On the 16 GB Mac, run one Memoria
instance at a time. The separate-workspace launch flag preserves the usual active workspace:

```sh
open -a Memoria --args --memoria-vault-instance "$HOME/Documents/Memoria C1-P01"
```

After the participant finishes, create a grading receipt:

```sh
python3.11 -B scripts/uat/review_challenge.py grade "$HOME/Documents/Memoria C1-P01" \
  --receipt "$HOME/Documents/Memoria-UAT-results/P01-fixture.json" \
  --output "$HOME/Documents/Memoria-UAT-results/P01-challenge.json"
```

The `passed` JSON field reports the stored decision/state checks. Exit code zero means the grading
command succeeded, not that the participant passed. The grader catches acceptance of the unsupported
proposal even if its value is subsequently corrected. It checks the positive control and final values
too. Source-reading explanations, assistance and elapsed time must be recorded by the observer;
this automatic result alone does not establish that the participant understood the evidence.

The challenge helper can import the installed app's resources explicitly:

```sh
export MEMORIA_MEMORY_DIR=/Applications/Memoria.app/Contents/Resources/memory
```

The helper also falls back to that installed location when copied outside the repository. Record
the actual app version/build on the observer form. The fixture receipt records source and audio hashes
and stays outside the participant's searchable workspace.

### Checks

```sh
python3.11 -B -m unittest discover -s scripts/uat -p 'test_review_challenge.py' -v
```

These exercise the real app adapter and ledger on temporary fixtures: pending state, correct review,
accept-all, reject-all, later correction after a wrong acceptance, source changes, damaged receipts,
and preservation of existing folders. They use silent test audio; actual `say`/`ffmpeg` fixture building
is checked separately. No participant data or protected engine files are modified.

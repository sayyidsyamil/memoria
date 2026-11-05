# Checkpoint attribution and outage recovery

The accepted `42ad04c4489e48a4b83a36fb26e4657ce7d79fae` snapshot described the bounded
checkpoint as “the user closed” the study. That attribution was inaccurate: the
**coordinating assistant** set that checkpoint; the user had requested continued
work. This correction records the provenance without rewriting the dated snapshot,
its manifests, or any measurements.

The fixed strength-2 qualification was frozen in `64829416d` before model calls.
After the GitHub Copilot DNS outage, inspection found that commit at HEAD, a clean
worktree, and no qualification result directory or measurements. The first transfer
lease had not been started; there were no completed measurements to rerun.

The coordinator's `research/REVIEW-2026-11-03.md` on current main was read for context.
No current-main application code, coordinator harness, number-word repair or pinned
import implementation was adopted here. The accepted archive's 150 recorded file
hashes still verify, and the same historical app/model/cache identity is used.

This resumption changes no strength, direction, random control, prompt, source control,
or qualification criterion. A failed transfer or recovery gate still closes the path.

---
type: ADR
id: "0188"
title: "Claude Code Skills in every agent permission mode"
status: active
date: 2026-10-14
---

## Context

The AI panel passes an explicit Claude Code tool allowlist. Omitting `Skill` prevents users from invoking installed Claude Code skills in either permission mode. Luca approved treating this as a bug on 2026-10-14 (Todoist 6hhVP2Cf6fqhM7rv).

## Decision

Supersede the Claude Code tool mapping in ADR-0092: include `Skill` in both Safe and Power User agent allowlists. Safe allows `Read,Edit,MultiEdit,Write,Glob,Grep,LS,Skill`; Power User adds `Bash`. Keep the allowlists centralized in `claude_invocation.rs`, including compatibility invocations.

## Consequences

Installed skills can supply instructions in both modes. Safe still excludes Bash, and Power User retains its existing Bash approval policy. Skills do not enable dangerous permission bypass flags or change the separate chat-only tool policy.

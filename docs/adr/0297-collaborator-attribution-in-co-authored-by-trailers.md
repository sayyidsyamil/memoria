---
type: ADR
id: "0297"
title: "Shared edits name their collaborators in Co-authored-by trailers; the identity comes from the access ticket"
status: active
date: 2026-10-25
---

## Context

TOL-238 (B5-4). Since TOL-18 (ADR 0296) other users can edit a shared vault or note through Memoria Web, but the server commits every change as the vault's single git identity, so the history does not say who changed a file. The server knows a collaborator only by the opaque `sub` of their access ticket; user records (identities, emails) stay in the private front end (`memoria-cloud`), which talks to the open server only over the protocol (`docs/web/licensing-boundary.md`). The front end and the server deploy separately, in either order, and the owner's commits are read by the desktop app, which must see no change.

## Decision

**The access ticket gets an optional `author: { name, email }` (protocol 1.10, ticket version unchanged), and every commit a non-owner subject with an author causes ends with a `Co-authored-by: <name> <<email>>` trailer paragraph. The commit itself is still made by the vault's git identity.**

- Covered: file writes and imports, deletes, renames, folder create/rename/delete, and the flushes of a live document, which name each author who edited it since its last write (each address once, in first-edit order). A replay of unpushed commits onto a moved upstream keeps their trailers.
- Not covered on purpose: the bearer token, `owner` tickets and tickets without `author` add nothing, so the owner's commit messages are byte-for-byte those of 1.9. No `Signed-off-by` (neither AGENTS.md nor CONTRIBUTING asks for it).
- The server validates the author like the rest of the ticket: one line each, no control characters, `<` or `>`, bounded lengths; a malformed author spoils the ticket (`401`), so a trailer can never be injected.
- **Identity format (hosted front end).** A user with a linked GitHub identity is `<login> <<login>@users.noreply.github.com>`: GitHub's own no-reply form, which never exposes an email address even when the user has a verified one. Otherwise the user's verified email is used, with its local part as the name; that is the address the owner shared with. A user with neither gets no `author`, and their edits are committed unattributed, as before.

## Options considered

- **Author in the ticket** (chosen): the front end already mints one per request from its records, the field is additive (older servers ignore it, older front ends omit it), and the server needs no user database.
- **Server looks the user up from the front end**: a new internal API and a network call on the commit path, and user records flowing the other way across the boundary.
- **Commit as the collaborator (author field) instead of a trailer**: the author line would no longer be the vault's identity, which the desktop and existing tooling expect, and a commit mixing the owner's and a collaborator's live edits has no single author.
- **Always the verified email**: more people would be linked by address, but a collaborator's address would land in the owner's history, possibly a public repository, without the collaborator choosing that. GitHub users get the no-reply form instead.

## Consequences

- `git log` and GitHub show who took part in every shared edit; GitHub links the no-reply address to the account when it matches the account's no-reply form. The login-only form (`login@users.noreply.github.com`) is GitHub's older one; accounts created after mid-2017 use `<id>+<login>@…`, which needs the numeric GitHub id the front end does not store yet, so such commits name the login without linking the profile. Storing the id at sign-in would fix that.
- A trailer is a claim made by the front end that holds the token; anyone with the token could write any trailer anyway.
- Email-only collaborators' addresses appear in the owner's history. A per-user setting (a no-reply form, or a chosen display name) can come later without a protocol change.
- Re-evaluate if the front end gains user display names, or if collaborators should be the commit authors.

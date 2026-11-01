# Meeting API and service boundary

## Request path

React meeting screens → `src/features/meetings/meetingService.ts` → Tauri
`meetings_api` → existing subprocess transport → Python `MeetingService` →
`MeetingRepository` (SQLite) and generated Markdown.

No HTTP listener is needed for the desktop boundary. The frontend client is the
only owner of meeting CRUD IPC calls. Shared DTOs live in `meetingTypes.ts`, not in
React components. The client validates responses and exposes `MeetingServiceError`.

## Operations

All requests contain `vaultPath` and an explicit `operation`:

| Operation | Input | Result |
| --- | --- | --- |
| `list` | workspace | Meeting records, newest first in the frontend |
| `get` | `id` | One meeting record |
| `save` | `record` | Created/updated record with generated document identity |
| `delete` | `id` | `{ deleted, id }`; absent records are idempotent |

Save is an explicit upsert for capture publication and transcript review. UUIDs,
field names, statuses, transcript times, marks, workspace paths, and document
hashes are checked at the backend boundary. The Tauri command validates workspace
access before invoking the worker.

Errors contain a stable `code` and display `message`: `INVALID_REQUEST`,
`MEETING_NOT_FOUND`, `MEETING_EXTERNALLY_MODIFIED`, `WORKSPACE_UNAVAILABLE`,
`RUNTIME_UNAVAILABLE`, `PERSISTENCE_FAILED`, or frontend `INVALID_RESPONSE`.

The Python API returns `{ ok, data }` or `{ ok: false, error }`; Tauri converts this
to its standard resolved/rejected IPC promise. No component parses exception text
to identify a CRUD error.

## Persistence and compatibility

Meeting CRUD implementations have moved out of `engine.py` into
`meetings_service.py`. Older action names delegate to that same service; there is
one persistence implementation. SQLite record access belongs to the repository;
the service coordinates generated document validation and publication.

Runtime failures attempt to restore the prior generated document when SQLite
publication fails. This is exception compensation, **not yet a crash-atomic
transaction across SQLite and the filesystem**. Process termination during a write
still needs a durable write-ahead recovery protocol. Delete preserves audio,
reviewed sources, voice profiles, and approved proposal history.

## Scope of this migration

Meeting list/get/save/delete are migrated. Transcription, speaker memory,
capture-chunk commands, approved knowledge, Search, Ask, and Briefs retain their
existing transports. They should be migrated as subsequent vertical slices;
they are not silently claimed to use this contract. Restore/trash is not introduced
in this pass.

Coverage: frontend client contract tests, existing meeting UI regressions, Python
service CRUD/restart/validation tests, existing persistence tests, and Rust request
deserialization tests. Native microphone recording is not a contract test.

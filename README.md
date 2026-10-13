# Memoria

Memoria is a local-first AI meeting memory system built for my final year project.

The goal is simple: help a knowledge worker capture meeting discussions, imported documents, and source material, then turn that raw information into an organized, queryable knowledge base.

Memoria is currently tailored around corporate knowledge work, especially meeting-heavy environments such as Khazanah Nasional Berhad, where decisions, updates, people, organizations, projects, and topics need to be preserved clearly.

## Core Flow

1. Capture raw information in the Inbox.
2. Record a meeting, upload a file, or import a link.
3. Compile the Inbox into structured knowledge.
4. Store original material as Sources.
5. Organize extracted knowledge into the Wiki.
6. Ask questions through the AI panel using the generated knowledge base.

## Main Areas

- Inbox: raw notes, meeting captures, uploaded files, links, and unprocessed material.
- Wiki: organized knowledge notes such as decisions, people, organizations, projects, topics, and general notes.
- Sources: original imported material used as evidence for compiled knowledge.
- Briefs: generated summaries and reusable context.
- Archive: material that is no longer active but should remain available.

## AI-Oriented Features

- Local live meeting transcription pipeline.
- Source import from files, web pages, and YouTube links.
- Inbox-to-Wiki compilation workflow.
- Typed knowledge notes for decisions, people, organizations, projects, topics, and notes.
- Evidence-preserving source notes.
- AI panel for querying the knowledge base.

## Tech Stack

- Tauri v2
- React
- TypeScript
- Rust
- Python transcription pipeline with MLX
- Markdown files with YAML frontmatter

## Development

Install dependencies:

```bash
pnpm install
```

Run the frontend dev server:

```bash
vite --port 5202 --strictPort
```

Run the native app:

```bash
pnpm tauri dev
```

Rebuild and reinstall the macOS app:

```bash
bash scripts/rebuild-app.sh
```

The live transcription bridge is implemented in `src-tauri/src/commands/transcribe.rs` and calls:

```text
src-tauri/resources/python/transcribe_server.py
```

## Project Status

This is an FYP prototype. The current priority is making the AI knowledge workflow clear and reliable:

- capture
- transcribe/import
- compile
- organize
- query

General note-taking features are secondary to the AI meeting memory workflow.

## License

This project is based on Memoria and remains licensed under AGPL-3.0-or-later.

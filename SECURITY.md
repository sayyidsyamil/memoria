# Security policy

## Supported scope

Memoria is a research prototype. Security fixes on the current `main` branch are
best effort; there is no supported stable binary release yet. Historical branches
and inherited release artifacts are not maintained Memoria distributions.

## Reporting a vulnerability

Use [GitHub private vulnerability reporting](https://github.com/sayyidsyamil/memoria/security/advisories/new).
Do not post working exploits, credentials, private recordings, or sensitive meeting
content in public issues.

Include:

- The affected commit and operating system.
- A concise impact description and reproducible steps using fictional data.
- The relevant entry point: imported file, vault path, model output, local command,
  or inherited remote integration.
- Suggested mitigation, if known.

Reports are assessed on a best-effort basis. Please coordinate disclosure before
publishing details; this project does not promise an enterprise support SLA.

## Data and trust boundaries

Meeting inference is designed to use local processes and cached models. Vaults can
contain microphone audio, speaker templates, quotes, and publication journals.
Imported documents and model outputs must be treated as untrusted input. A valid
quote proves provenance, not factual truth or safe instructions.

The inherited workspace includes optional network-facing integrations; local
meeting inference is not a claim that every application feature is offline.

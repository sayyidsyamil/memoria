# ADR 0214: Consent-bound mobile usage events

Date: 2026-10-11
Status: Accepted

## Context

Mobile swipe actions, appearance and foreground Git controls need adoption
signals, but vaults contain private documents and repository metadata.
Analytics must not delay local interactions or become a prerequisite for using
the app. The desktop analytics client depends on browser storage and is not a
native transport.

## Decision

- Usage analytics is off by default and controlled in installation Settings.
  Loading a vault, opening Settings or declining consent performs no analytics
  request and creates no analytics identifier.
- A small typed boundary accepts only enumerated action, setting, operation,
  and platform values. It explicitly projects those fields instead of
  spreading caller data. Never include document content, note IDs, paths,
  repository names, credentials, commit messages or raw error text.
- Consented builds with a public project key use PostHog's documented capture
  endpoint with an ephemeral random session identifier. Person profiles and
  GeoIP enrichment are disabled. No persistent identifier, replay, autocapture,
  durable queue or background worker is introduced.
- Revoking consent immediately aborts in-flight requests and discards the
  session identifier, before persisting the preference. Missing configuration
  stays disabled. At most eight requests are in flight; each has a five-second
  timeout. Errors are dropped and never block a user action.
- Emit `mobile_note_swipe_used`, `mobile_setting_changed` and
  `mobile_git_operation_requested`. Failed/cancelled settings writes do not
  count as successful setting changes. Git requests distinguish manual sync,
  local commits and automatic sync without transmitting repository details;
  these adoption events do not claim that a remote operation succeeded.

## Consequences

The transport follows the public [PostHog capture API](https://posthog.com/docs/api/capture).
Configure `EXPO_PUBLIC_POSTHOG_KEY` and optionally `EXPO_PUBLIC_POSTHOG_HOST` for
a consenting deployment. The default host is the EU ingestion origin. These are
public project settings, never personal API credentials. Unconfigured QA builds
do not transmit events even when exercising the consent switch.

Unit tests verify consent, property allowlisting, bounded requests, timeout and
opt-out cancellation. Native tests verify preference persistence and revocation.
Aggregate adoption counts are intentionally approximate: unavailable networks
lose events instead of retaining a history of activity on the device.

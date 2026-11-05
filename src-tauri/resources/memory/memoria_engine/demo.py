"""Run with:  python3 -m memoria_engine.demo

A CRM vendor decision that changes over three meetings, an older recording imported late, a
proposal a reviewer rejects, and an audit-trail view. Dates are 2026; the fake clock plays the
part of "when the pipeline ingested it".
"""
from __future__ import annotations

import os
import tempfile
from datetime import datetime, timezone

from . import Evidence, Ledger, ts


class Clock:
    t = 0

    def __call__(self) -> int:
        return self.t


def day(us):
    return "forever" if us is None else datetime.fromtimestamp(us / 1e6, tz=timezone.utc).strftime("%d %b")


def show_timeline(ledger, title, **kw):
    print(f"\n{title}")
    for b in ledger.timeline("crm_vendor", "outcome", **kw):
        print(f"   {day(b.valid_from):>7} -> {day(b.valid_to):<8} {b.value:<34} [fact {b.fact_id}, {b.change_type}]")


def main() -> None:
    clock = Clock()
    with tempfile.TemporaryDirectory() as tmp:
        log = os.path.join(tmp, "events.jsonl")
        L = Ledger(":memory:", log_path=log, clock=clock)
        L.define_meeting_attributes()
        L.create_object("crm_issue", "issue", label="Which CRM do we buy?")
        L.create_object("crm_vendor", "decision", issue_id="crm_issue")
        L.create_object("crm_rollout", "commitment", issue_id="crm_issue")

        def ev(meeting, when, span, speaker):
            source = L.add_source(f"{meeting} transcript chunk", meeting, ts(when))
            return Evidence(source, span, speaker_id=speaker, asr_model="parakeet-tdt-0.6b-v3")

        clock.t = ts("2026-01-10T12:00:00Z")
        L.assert_fact("crm_vendor", "outcome", "Vendor A", ev("m1", "2026-01-10T09:00:00Z", "We go with Vendor A.", "chair"))
        L.assert_fact("crm_rollout", "deadline", "2026-03-01", ev("m1", "2026-01-10T09:00:00Z", "Ali, live by 1 March.", "chair"))

        clock.t = ts("2026-02-14T12:00:00Z")
        pid = L.propose("crm_rollout", "deadline", "2026-04-15", ev("m2", "2026-02-14T09:00:00Z", "Let's push it to mid-April.", "ali"),
                        confidence=0.81, reason="later meeting moves the deadline")
        print("Proposal pending, belief unchanged:", L.current("crm_rollout", "deadline").value)
        L.accept(pid, "najib")
        print("After Najib accepts:              ", L.current("crm_rollout", "deadline").value)

        clock.t = ts("2026-03-20T12:00:00Z")
        pid = L.propose("crm_vendor", "outcome", "Vendor B", ev("m3", "2026-03-20T09:00:00Z", "Vendor A failed security. Switch to B.", "chair"),
                        kind_hint="REVERSE", confidence=0.93)
        L.accept(pid, "najib")

        clock.t = ts("2026-03-28T12:00:00Z")
        pid = L.propose("crm_vendor", "outcome", "Vendor C", ev("m4", "2026-03-28T09:00:00Z", "What if we looked at C?", "ali"), confidence=0.55)
        L.reject(pid, "najib", note="a hypothetical, not a decision")

        clock.t = ts("2026-04-05T12:00:00Z")
        L.assert_fact("crm_vendor", "outcome", "Vendor A (pending security review)",
                      ev("m1b", "2026-01-20T09:00:00Z", "Vendor A, but only after security signs off.", "chair"))

        show_timeline(L, "What we believe today about the CRM vendor (the 20 Jan recording was imported late, on 5 Apr):")
        show_timeline(L, "What we believed on 1 Mar (before meeting 3 was ingested):", tx_at=ts("2026-03-01T00:00:00Z"))

        probe = ts("2026-03-25T00:00:00Z")
        then = L.as_of("crm_vendor", "outcome", valid_at=probe, tx_at=ts("2026-03-01T00:00:00Z"))
        now = L.as_of("crm_vendor", "outcome", valid_at=probe)
        print(f"\nWhat was true on 25 Mar?  believed on 1 Mar: {then.value!r}   believed now: {now.value!r}")

        print("\nAudit trail (every claim ever made, oldest decision first):")
        for h in L.history("crm_vendor", "outcome"):
            ev0 = h["evidence"][0]
            print(f"   fact {h['fact_id']} {h['change_type']:<8} {h['value']!r:<38} decided {day(h['decided_at'])}  "
                  f"{ev0['speaker_id']}: \"{ev0['span_text']}\"")

        print("\nReview statistics:", {k: v for k, v in L.review_stats().items() if v is not None})
        print("Invariant violations:", L.check_invariants() or "none")
        rebuilt = Ledger(":memory:", log_path=log)
        print("Rebuilt from the event log alone is identical:", rebuilt.dump() == L.dump())


if __name__ == "__main__":
    main()

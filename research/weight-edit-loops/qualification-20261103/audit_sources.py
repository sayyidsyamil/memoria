"""CPU source/chronology closeout; no model calls or changed qualification criteria."""
import json

from qual_common import HERE, frozen, write_new_json
from context import load_chain, read_jsonl


def main():
    plan = frozen()
    rows = {r["condition"]: r for r in read_jsonl(HERE / "results" / "transfer.jsonl")}
    base, edit, random, restored = (rows[k] for k in ("base-before", "edit", "random", "base-after"))
    chain = load_chain("TS3006")
    meeting = next(m.meeting for m in chain.meetings if m.meeting.meeting_id == "TS3006d")
    losses = edit["versus_before"]["lost_source_controls"]
    assert set(losses) == {"chip-t8", "energy-t8", "speech-t8", "single-curve-t23"}
    assert edit["natural_eos"] and edit["audit"]["strict_raw_schema"]
    assert edit["raw_text"] == edit["text"] and not edit["early_stopped"]
    assert edit["repeat_detected"] is None
    assert edit["raw_text"].endswith("]}") and base["raw_text"].startswith(edit["raw_text"][:-2])
    for row in (base, random, restored):
        assert row["matches_historical_bytes"] and row["audit"]["source_control_hits"] == base["audit"]["source_control_hits"]
    controls = []
    for control in plan["source_controls"]:
        controls.append({**control, "source_turn_text": meeting.turns[control["turn"]].text,
                         "preserved_by_edit": control["id"] in edit["audit"]["source_control_hits"]})
    result = {"outcome": "failed-collateral", "development_candidate": False,
              "reason": "Natural EOS transfers by terminating after two distinct source-supported entries and losing four prespecified source controls, including the later single-curve decision.",
              "source_controls": controls, "chronology_excerpt": [{"turn": i, "text": meeting.turns[i].text} for i in range(22, 26)],
              "edit_raw": edit["raw_text"], "edit_has_exact_repeated_event": False,
              "edit_is_first_two_base_event_objects_then_natural_closure": True,
              "baseline_first_exact_repeat_start_char": base["repeat_start_char"],
              "baseline_unique_parsed": len(base["audit"]["unique_parsed"]),
              "edit_unique_parsed": len(edit["audit"]["unique_parsed"]),
              "lost_unique_parsed_count": len(edit["versus_before"]["lost_unique_parsed"]),
              "count_caveat": "Not all 14 omitted baseline candidates are correct; many are tentative or wrong. The decisive loss is the four source controls fixed before inference.",
              "quote_caveat": "The first three omitted items are still mentioned inside the retained full turn8 quote, but their structured event records are absent. The later turn23 decision and its quote are absent entirely.",
              "zero_valid_event_trap": "All four conditions have zero valid ledger candidates and zero gold hits because replies mark entries unresolved. Those coarse counts alone would hide the source-event loss.",
              "stop_after_first_lease": True,
              "unrun_due_to_failure": ["six normal prompts", "distinct-event enumeration overrun", "generated and forced-prefix recovery, including long unresolved cycle", "narrow Ask/guard/router probes", "further development or validation generation"],
              "shipping_or_newval_authorised": False}
    write_new_json(HERE / "results" / "source_audit_verdict.json", result)
    print(json.dumps({k: v for k, v in result.items() if k not in ("source_controls", "edit_raw", "chronology_excerpt")}, indent=2))


if __name__ == "__main__":
    main()

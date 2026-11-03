"""Freeze small cross-task smoke probes before any edited-model results."""
from context import HERE, load_chain, write_new_json
from lm import APP_SYSTEM
from memoria_engine.evaluation import baselines
from memoria_engine.evaluation.router import build_prompt
import live_guard


def main():
    guard_cases = [
        ("battery-conflict", "We will use kinetic energy.", "Battery type is rechargeable. Approved quote: We will use rechargeable batteries.", True),
        ("battery-agree", "We will use rechargeable batteries.", "Battery type is rechargeable. Approved quote: We will use rechargeable batteries.", False),
        ("case-conflict", "The case will be made of wood.", "Case material is plastic. Approved quote: We decided on a plastic case.", True),
        ("case-question", "Could we use wood for the case?", "Case material is plastic. Approved quote: We decided on a plastic case.", False),
        ("unrelated-price", "The train ticket cost 30 euros.", "Remote-control price is 25 euros. Approved quote: We will sell the remote control for 25 euros.", False),
        ("case-agree", "The case is plastic.", "Case material is plastic. Approved quote: We decided on a plastic case.", False),
    ]
    probes = [{"id": name, "kind": "guard", "source": "synthetic smoke probe", "messages": live_guard.question(statement, decision),
               "expected_conflict": conflict, "threshold": 2.0} for name, statement, decision, conflict in guard_cases]
    transcript = ("[00:20] Chair: We choose rechargeable batteries for the remote control.\n"
                  "[00:45] Designer: We have decided that the case will be plastic.\n"
                  "[01:10] Chair: We will review the prototype on Friday.")
    probes += [
        {"id": "ask-battery", "kind": "meeting", "source": "synthetic smoke probe", "transcript": transcript,
         "question": "Which battery type did we choose?", "maxTokens": 200, "required_phrase": "rechargeable", "requires_citation": True},
        {"id": "ask-case", "kind": "meeting", "source": "synthetic smoke probe", "transcript": transcript,
         "question": "What material will the case use?", "maxTokens": 200, "required_phrase": "plastic", "requires_citation": True},
        {"id": "ask-unknown", "kind": "meeting", "source": "synthetic smoke probe", "transcript": transcript,
         "question": "What retail price did we approve?", "maxTokens": 200, "required_phrase": "not said", "requires_citation": False},
    ]
    for name in ("ES2003", "TS3004"):
        chain = load_chain(name)
        for kind in ("current", "n_changes"):
            q = next(q for q in chain.questions if q.type == kind)
            probes.append({"id": f"route:{name}:{q.qid}", "kind": "route", "source": "frozen development question",
                           "series": name, "qid": q.qid, "question": q.ask, "system": APP_SYSTEM,
                           "prompt": build_prompt(chain.registry, baselines.today_iso(chain), q.ask), "max_tokens": 1800})
    write_new_json(HERE / "data" / "cross_task_probes.json", {
        "scope": "13 narrow smoke probes, not a population/task benchmark; synthetic labels are evaluation only",
        "probes": probes})


if __name__ == "__main__":
    main()

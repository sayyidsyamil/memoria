import re
import unittest
from datetime import date

from memoria_engine.evaluation import padding
from memoria_engine.evaluation.dataset import load_chains
from memoria_engine.evaluation.oracle import ledger_answer, values_equal
from memoria_engine.evaluation.run_eval import run_pipeline
from memoria_engine.extractors import OracleExtractor
from test_pipeline import DATA

CHAINS = {c.chain_id: c for c in load_chains(str(DATA))}
MALAY = re.compile(r"\b(kita|tarikh|bajet|siap|projek|awak|uruskan|saya|nanti|kalau|baik)\b", re.I)


def day(us):
    import time
    return date(*time.gmtime(us / 1e6)[:3])


class TestPadding(unittest.TestCase):
    def test_k0_is_the_base_chain_and_padding_is_deterministic(self):
        for c in CHAINS.values():
            self.assertIs(padding.pad_chain(c, 0), c)
        a, b = padding.render_filler(CHAINS["hiring"], 12, 0), padding.render_filler(CHAINS["hiring"], 12, 0)
        self.assertEqual(a, b)
        self.assertNotEqual(a, padding.render_filler(CHAINS["hiring"], 12, 1))
        self.assertNotEqual(a, padding.render_filler(CHAINS["tender"], 12, 0))

    def test_padded_chains_keep_the_base_questions_and_gain_meetings_and_objects(self):
        for c in CHAINS.values():
            for k in (8, 24):
                p = padding.pad_chain(c, k)
                self.assertEqual(p.questions, c.questions)
                self.assertEqual(len(p.meetings), len(c.meetings) + k)
                self.assertTrue(set(c.registry.objects) < set(p.registry.objects))
                self.assertEqual(p.now, c.now)
                self.assertIn("synthetic", p.note)
                self.assertEqual(len({gm.meeting.meeting_id for gm in p.meetings}), len(p.meetings))

    def test_oracle_pipeline_answers_every_base_question_at_every_length(self):
        for c in CHAINS.values():
            for k in (8, 24, 48):
                p = padding.pad_chain(c, k)
                pipe = run_pipeline(p, OracleExtractor(p), "immediate")["pipeline"]
                self.assertEqual(pipe.ledger.check_invariants(), [])
                for q in p.questions:
                    got = ledger_answer(pipe.ledger, q, p.now)
                    self.assertTrue(values_equal(got, q.gold), f"{c.chain_id} K={k} {q.qid}: {got!r} != {q.gold!r}")

    def test_filler_never_touches_a_base_slot_and_object_counts_grow(self):
        for c in CHAINS.values():
            sizes = []
            for k in (8, 24, 48):
                p = padding.pad_chain(c, k)
                base_ids = set(c.registry.objects)
                base_meetings = {gm.meeting.meeting_id for gm in c.meetings}
                for gm in p.meetings:
                    if gm.meeting.meeting_id not in base_meetings:
                        self.assertTrue(all(e.object_id not in base_ids for e in gm.events))
                sizes.append(len(p.registry.objects))
            self.assertEqual(sizes, sorted(sizes))
            self.assertLess(sizes[0], sizes[-1])

    def test_dates_are_distinct_in_2026_and_before_now(self):
        for c in CHAINS.values():
            p = padding.pad_chain(c, 48)
            days = [day(gm.meeting.occurred_at) for gm in p.meetings]
            self.assertEqual(len(set(days)), len(days))
            self.assertTrue(all(d.year == 2026 and d <= day(p.now) for d in days), c.chain_id)
            self.assertTrue(all(gm.meeting.ingested_at >= gm.meeting.occurred_at for gm in p.meetings))

    def test_filler_turns_are_either_gold_events_or_labelled_distractors(self):
        for c in CHAINS.values():
            base = {gm.meeting.meeting_id for gm in c.meetings}
            for gm in padding.pad_chain(c, 24).meetings:
                if gm.meeting.meeting_id in base:
                    continue
                for t in gm.meeting.turns:
                    has_event = any(e.turn == t.index for e in gm.events)
                    self.assertNotEqual(has_event, t.index in gm.distractors, f"{gm.meeting.meeting_id} turn {t.index}: {t.text}")

    def test_event_mix_and_dates_and_values_are_valid(self):
        kinds = set()
        for c in CHAINS.values():
            p = padding.pad_chain(c, 48)
            base = {gm.meeting.meeting_id for gm in c.meetings}
            for gm in p.meetings:
                if gm.meeting.meeting_id in base:
                    continue
                for e in gm.events:
                    kinds.add(e.kind)
                    spec = p.registry.spec(e.object_id, e.attribute)
                    if spec.type == "date":
                        self.assertEqual(date.fromisoformat(e.value).year, 2026)
                        if e.kind in ("INITIAL", "REVISE"):
                            self.assertGreater(date.fromisoformat(e.value), day(gm.meeting.occurred_at))
                    if spec.type == "number":
                        self.assertGreater(e.value, 0)
        self.assertTrue({"INITIAL", "REVISE", "CONFIRM", "REVERSE"} <= kinds, kinds)

    def test_malay_only_in_code_switched_chains(self):
        def malay_lines(c):
            base = {gm.meeting.meeting_id for gm in c.meetings}
            return [t.text for gm in padding.pad_chain(c, 48).meetings if gm.meeting.meeting_id not in base for t in gm.meeting.turns if MALAY.search(t.text)]
        self.assertGreater(len(malay_lines(CHAINS["tender"])), 5)
        self.assertGreater(len(malay_lines(CHAINS["portfolio"])), 5)
        for cid in ("hiring", "crm", "datacentre"):
            self.assertEqual(malay_lines(CHAINS[cid]), [])

    def test_each_filler_object_family_is_used_and_labels_do_not_collide_with_base_topics(self):
        hiring = padding.pad_chain(CHAINS["hiring"], 48)
        labels = [o.label for o in hiring.registry.objects.values()]
        self.assertTrue(any(l.startswith("Hire a") or l.startswith("Hire an") for l in labels[3:]))
        self.assertTrue(any(l.endswith("team headcount") for l in labels[3:]))
        self.assertFalse(any("data scientist" in l or "data engineer" in l for l in labels[3:]))
        base_words = {"crm": ["crm"], "datacentre": ["data centre", "phase one"], "hiring": ["data scientist", "data engineer", "data team"],
                      "portfolio": ["logistics", "divest", "stake", "buyer"], "tender": ["tender"]}
        for cid, c in CHAINS.items():
            p = padding.pad_chain(c, 48)
            filler = [o.label.casefold() for oid, o in p.registry.objects.items() if oid not in c.registry.objects]
            self.assertTrue(filler)
            for word in base_words[cid]:
                self.assertFalse(any(word in label for label in filler), f"{cid}: filler label mentions {word!r}")
            self.assertEqual(len(filler), len(set(filler)), f"{cid}: duplicate filler labels")

    def test_too_many_filler_meetings_for_the_window_is_an_error(self):
        with self.assertRaises(ValueError):
            padding.pad_chain(CHAINS["crm"], 500)


if __name__ == "__main__":
    unittest.main()

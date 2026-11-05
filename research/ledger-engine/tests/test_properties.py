import random
import unittest

from helpers import Env
from memoria_engine import Claim, Piece, envelope


def C(fact_id, rank, value, start, end):
    return Claim(fact_id, (rank, fact_id), value, start, end)


class TestEnvelope(unittest.TestCase):
    def test_empty(self):
        self.assertEqual(envelope([]), [])

    def test_gaps_stay_empty(self):
        self.assertEqual(envelope([C(1, 1, "a", 0, 10), C(2, 2, "b", 20, 30)]),
                         [Piece(1, 0, 10), Piece(2, 20, 30)])

    def test_the_latest_decision_wins_where_claims_overlap(self):
        self.assertEqual(envelope([C(1, 1, "a", 0, None), C(2, 2, "b", 5, None)]),
                         [Piece(1, 0, 5), Piece(2, 5, None)])

    def test_an_older_claim_never_hides_a_newer_one(self):
        self.assertEqual(envelope([C(1, 2, "a", 0, None), C(2, 1, "b", 5, None)]), [Piece(1, 0, None)])

    def test_a_losing_claims_boundaries_do_not_split_a_piece(self):
        self.assertEqual(envelope([C(1, 5, "a", 0, None), C(2, 1, "b", 3, 6)]), [Piece(1, 0, None)])

    def test_a_same_value_reconfirmation_merges_into_the_fact_that_covers_the_stretch(self):
        self.assertEqual(envelope([C(1, 1, "x", 0, None), C(2, 3, "x", 10, None)]), [Piece(1, 0, None)])

    def test_same_value_without_one_covering_claim_stays_split_per_fact(self):
        claims = [C(1, 5, "x", 0, 10), C(2, 1, "y", 3, 6), C(3, 2, "x", 10, 20)]
        self.assertEqual(envelope(claims), [Piece(1, 0, 10), Piece(3, 10, 20)])

    def test_claim_order_does_not_matter(self):
        claims = [C(1, 1, "a", 0, None), C(2, 2, "b", 5, 9), C(3, 3, "a", 7, None), C(4, 4, "c", 2, 3)]
        expected = envelope(claims)
        rnd = random.Random(1)
        for _ in range(20):
            rnd.shuffle(claims)
            self.assertEqual(envelope(claims), expected)


def value_at(live, t):
    """Brute-force oracle: among claims covering t, the one decided last wins."""
    covering = [(rank, value) for rank, value, start, end in live.values()
                if start <= t and (end is None or t < end)]
    return max(covering)[1] if covering else None


class TestAgainstTheOracle(unittest.TestCase):
    """Random sequences of assert / correct / retract; every as-of answer must match the oracle."""

    def run_scenario(self, seed):
        rnd = random.Random(seed)
        E = Env()
        decided_pool = rnd.sample(range(1, 61), 40)  # unique, so the oracle needs no tie-break
        live, live_ids, snapshots = {}, [], []

        def snapshot():
            snapshots.append((E.L._meta("last_tx"), dict(live)))

        snapshot()
        for step in range(12):
            E.clock.t += 100
            roll = rnd.random()
            if roll < 0.7 or not live_ids:
                decided = decided_pool.pop()
                value = rnd.choice("ABC")
                valid_from = rnd.choice([None, rnd.randint(1, 60)])
                start = decided if valid_from is None else valid_from
                valid_to = rnd.choice([None, None, start + rnd.randint(1, 20)])
                out = E.say("dec1", "outcome", value, decided, valid_from=valid_from, valid_to=valid_to)
                live[out.fact_id] = (decided, value, start, valid_to)
                live_ids.append(out.fact_id)
            elif roll < 0.85:
                fact_id = rnd.choice(live_ids)
                E.L.retract(fact_id, "reviewer", "wrong")
                del live[fact_id]
                live_ids.remove(fact_id)
            else:
                fact_id = rnd.choice(live_ids)
                rank, _, start, end = live[fact_id]
                changes = {"value": rnd.choice("ABC")}
                if rnd.random() < 0.5:
                    start = rnd.randint(1, 60)
                    end = None if rnd.random() < 0.6 else start + rnd.randint(1, 20)
                    changes.update(valid_from=start, valid_to=end)
                out = E.L.correct(fact_id, "reviewer", "fix", **changes)
                del live[fact_id]
                live_ids.remove(fact_id)
                live[out.fact_id] = (rank, changes["value"], start, end)
                live_ids.append(out.fact_id)
            snapshot()
            self.assertEqual(E.L.check_invariants(), [], f"seed {seed}, step {step}")
        for tx, state in snapshots:
            for tx_at in (tx, tx + 50):
                later = [s for s in snapshots if s[0] <= tx_at][-1][1]
                for t in range(0, 85, 3):
                    expected = value_at(later, t)
                    belief = E.L.as_of("dec1", "outcome", valid_at=t, tx_at=tx_at)
                    self.assertEqual(belief.value if belief else None, expected, f"seed {seed}, tx {tx_at}, t {t}")
        return len(snapshots)

    def test_random_histories_match_the_oracle(self):
        for seed in range(150):
            self.run_scenario(seed)

    def test_ingestion_order_does_not_change_the_final_beliefs(self):
        for seed in range(60):
            rnd = random.Random(seed)
            decided = rnd.sample(range(1, 61), 8)
            claims = []
            for d in decided:
                valid_from = rnd.choice([None, rnd.randint(1, 60)])
                start = d if valid_from is None else valid_from
                claims.append((d, rnd.choice("ABC"), valid_from, rnd.choice([None, None, start + rnd.randint(1, 20)])))
            answers = []
            for _ in range(2):
                rnd.shuffle(claims)
                E = Env()
                for d, value, valid_from, valid_to in claims:
                    E.say("dec1", "outcome", value, d, valid_from=valid_from, valid_to=valid_to)
                self.assertEqual(E.L.check_invariants(), [])
                answers.append(E.values("dec1", "outcome", range(0, 85)))
            self.assertEqual(answers[0], answers[1], f"seed {seed}")


if __name__ == "__main__":
    unittest.main()

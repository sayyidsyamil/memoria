from memoria_engine import Evidence, Ledger


class Clock:
    def __init__(self, t: int = 0) -> None:
        self.t = t

    def __call__(self) -> int:
        return self.t


class Env:
    """A ledger with the meeting attributes defined and a few objects, driven by a fake clock."""

    def __init__(self, **kw):
        self.clock = Clock()
        self.L = Ledger(clock=self.clock, **kw)
        self.L.define_meeting_attributes()
        self.L.create_object("issue1", "issue")
        for object_id, kind in (("dec1", "decision"), ("dec2", "decision"), ("c1", "commitment"), ("c2", "commitment")):
            self.L.create_object(object_id, kind, issue_id="issue1")

    def ev(self, at: int, span: str = "agreed", **kw) -> Evidence:
        return Evidence(self.L.add_source(f"chunk@{at}", "m1", at), span, **kw)

    def say(self, object_id, attribute, value, at, **kw):
        ev_kw = kw.pop("ev", {})
        return self.L.assert_fact(object_id, attribute, value, self.ev(at, **ev_kw), **kw)

    def values(self, object_id, attribute, times, tx_at=None, **kw):
        out = []
        for t in times:
            belief = self.L.as_of(object_id, attribute, valid_at=t, tx_at=tx_at, **kw)
            out.append(belief.value if belief else None)
        return out

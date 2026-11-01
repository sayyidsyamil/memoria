"""Deterministic long-chain generator: pads a chain with K template-written filler meetings.

Purpose: make the history long and crowded while leaving every base question's gold untouched. The filler tracks *other*
items with the same shapes as the base ones (other projects with vendor/budget/rollout, other hires, other teams'
headcount), reuses the chain's people as owners, and adds distractors, anaphora, relative dates and amounts, and
(for en-ms chains) Bahasa Malaysia / English code-switching. Filler never touches a base slot.

Limits, stated on purpose: this text is written by templates, so it is far more regular than real speech. It tests
length, crowding and look-alike items, not language understanding. Filler gold events are exact by construction.
"""
from __future__ import annotations

import calendar
import random
import time
from dataclasses import dataclass, field, replace
from datetime import date, timedelta
from typing import Any, Dict, List, Optional, Tuple

from ..pipeline import Registry
from .dataset import Chain, parse_chain

GENERATOR_VERSION = "g1"
YEAR = 2026
MONTHS_MS = ["Januari", "Februari", "Mac", "April", "Mei", "Jun", "Julai", "Ogos", "September", "Oktober", "November", "Disember"]
TOPICS = ["ERP upgrade", "payroll migration", "office relocation", "security audit", "data lake build", "mobile app",
          "website revamp", "training programme", "supplier onboarding", "disaster recovery drill", "cloud migration",
          "warehouse automation", "branch refurbishment", "compliance review", "brand refresh", "call-centre outsourcing",
          "network refresh", "records archive", "expense system", "visitor management"]
ROLES = ["security engineer", "product designer", "QA lead", "finance officer", "legal counsel", "cloud architect", "HR partner",
         "compliance analyst", "frontend developer", "DevOps engineer", "business analyst", "UX researcher"]
TEAMS = ["Finance", "Security", "Platform", "Legal", "Operations", "Marketing", "Compliance", "Procurement", "Risk", "Audit"]
VENDOR_SETS = [("Vendor Delta", "Vendor Epsilon", "Vendor Zeta"), ("Vendor Kappa", "Vendor Lambda", "Vendor Sigma"),
               ("Vendor Omega", "Vendor Theta", "Vendor Iota"), ("Vendor Nova", "Vendor Orion", "Vendor Vega"),
               ("Vendor Atlas", "Vendor Helios", "Vendor Titan"), ("Vendor Cedar", "Vendor Maple", "Vendor Birch"),
               ("Vendor Quartz", "Vendor Onyx", "Vendor Opal"), ("Vendor Falcon", "Vendor Heron", "Vendor Osprey"),
               ("Vendor Summit", "Vendor Ridge", "Vendor Peak"), ("Vendor Coral", "Vendor Reef", "Vendor Tide")]
# things the base chains track, used only for "any update on X?" distractors that carry no decision
ECHOES = {"crm": ["CRM vendor", "CRM budget", "CRM rollout"], "datacentre": ["data centre site", "data centre budget", "phase one build"],
          "hiring": ["data team headcount", "data scientist hire", "data engineer hire"],
          "portfolio": ["logistics stake", "preferred buyer", "divestment"], "tender": ["tender vendor", "tender contract cap", "tender submission"]}
WORDS = {1: "one", 2: "two", 3: "three", 4: "four", 5: "five", 6: "six", 7: "seven", 8: "eight", 9: "nine", 10: "ten"}

QUESTIONS = ["Do we have a view yet on the timing for {r}?", "Is the money for {r} still enough, do we know?", "Who else needs to sign off on {r}?"]
HYPOTHETICALS = ["What if we split {r} into two phases?", "We could look at a second option for {r}, maybe.", "Should we consider pausing {r} for a quarter?"]
HEARSAY = ["I heard {r} might slip, but nobody has confirmed that.", "Finance mentioned they may revisit the numbers for {r}."]
TENTATIVE = ["I think {r} is on track, though I haven't checked the details.", "{w} might be free to help with {r}, we'll see."]
UNTRACKED = ["I'll send the minutes after this.", "Facilities will book the room for next time.", "I'll update the risk register.",
             "Procurement is chasing the paperwork."]
IGNORABLE = ["Thanks, noted.", "Understood.", "Good.", "Okay.", "Let's move on.", "Right."]
MS_DISTRACTORS = [("hearsay", "Saya dengar {r} mungkin lewat, belum pasti."), ("untracked", "Nanti saya hantar minit mesyuarat."),
                  ("hypothetical", "Kalau kita tukar rancangan macam mana?"), ("ignorable", "Baik, saya faham.")]
OPENINGS = ["Let's get started.", "Right, shall we begin?", "Morning all.", "Okay, quick run through today."]
CLOSINGS = ["Thanks everyone.", "That's all for today.", "Good, see you next time.", "Okay, we're done."]


@dataclass
class Ev:
    slot: str
    value: Any
    kind: str
    quote: Optional[str] = None
    tags: Tuple[str, ...] = ()


@dataclass
class Say:
    speaker: str
    text: str
    events: List[Ev] = field(default_factory=list)
    distractor: Optional[str] = None

    def line(self) -> str:
        if not self.events:
            ann = f"  ## distractor {self.distractor}" if self.distractor else ""
            return f"{self.speaker}: {self.text}{ann}"
        parts = []
        for e in self.events:
            quote = f" | quote=\"{e.quote}\"" if e.quote else ""
            tags = f" | tags={','.join(e.tags)}" if e.tags else ""
            parts.append(f"event {e.slot} = {e.value} | {e.kind}{quote}{tags}")
        return f"{self.speaker}: {self.text}  ## " + " ;; ".join(parts)


def article(noun: str) -> str:
    return "an" if noun[0].lower() in "aeiou" or noun.startswith("HR") else "a"


def money(n: int, ms: bool) -> str:
    if n >= 1_000_000:
        return f"RM{(n / 1e6):.2f}".rstrip("0").rstrip(".") + (" juta" if ms else " million")
    return f"RM{n // 1000}k"


def fmt_date(d: date, ms: bool) -> str:
    return f"{d.day} {MONTHS_MS[d.month - 1] if ms else calendar.month_name[d.month]}"


def last_day(d: date) -> date:
    return date(d.year, d.month, calendar.monthrange(d.year, d.month)[1])


class Gen:
    """State shared by every filler item while one chain is padded."""

    def __init__(self, base: Chain, k: int, seed: int) -> None:
        self.rng = random.Random(f"padding-{GENERATOR_VERSION}-{base.chain_id}-{k}-{seed}")
        self.base, self.k = base, k
        self.people = dict(base.registry.people)
        self.chair = next(iter(self.people))
        self.others = [p for p in self.people if p != self.chair]
        self.malay = base.language == "en-ms"
        self.day = date(YEAR, 1, 5)
        self.ids = 0

    def pick(self, options):
        return self.rng.choice(options)

    def ms(self) -> bool:
        return self.malay and self.rng.random() < 0.4

    def name(self, pid: str) -> str:
        return self.people[pid]

    def future(self, lo: int, hi: int, floor: Optional[date] = None) -> date:
        base = floor or self.day
        return min(base + timedelta(days=self.rng.randint(lo, hi)), date(YEAR, 12, 31))

    def amount(self) -> int:
        return self.rng.randrange(400_000, 6_000_001, 50_000)


class Item:
    """One filler thing being tracked. Subclasses define the objects, the order of moves and how each move is said."""

    def __init__(self, g: Gen, key: str) -> None:
        self.g, self.key, self.stage, self.moves, self.closed, self.value = g, key, 0, 0, False, {}

    @property
    def plan_obj(self) -> str:
        return self.key

    def phrase(self) -> str:
        raise NotImplementedError

    def object_lines(self) -> List[str]:
        raise NotImplementedError

    def next_moves(self, late: bool) -> List[str]:
        moves = self.plan(late)
        self.moves += len(moves)
        return moves

    def plan(self, late: bool) -> List[str]:
        raise NotImplementedError

    def render(self, move: str, ref: str, ms: bool) -> Say:
        raise NotImplementedError

    def say(self, text: str, events: List[Ev], speaker: Optional[str] = None) -> Say:
        return Say(speaker or self.g.chair, text, events)

    def ev(self, attribute: str, value: Any, kind: str, quote: Optional[str] = None, tags: Tuple[str, ...] = ()) -> Ev:
        return Ev(f"{self.plan_obj}.{attribute}", value, kind, quote, tags)

    def closing_moves(self, late: bool) -> List[Tuple[str, float]]:
        return [("finish", 1.0), ("cancel", 0.2)] if late and self.stage >= 2 and self.moves >= 3 else []

    # shared moves on a commitment (owner, deadline, status) ------------------------------------------------------
    def owner_and_deadline(self, ref: str, ms: bool, what: str) -> Say:
        g = self.g
        owner = g.pick(g.others or [g.chair])
        d = g.future(21, 90)
        shown = fmt_date(d, ms)
        self.value["owner"], self.value["deadline"] = owner, d
        if ms:
            first, second = f"{g.name(owner)} akan uruskan {what}", f"siap sebelum {shown}"
            text = f"{first}, {second}."
        elif g.rng.random() < 0.5:
            first, second = f"{g.name(owner)}, you own {what}", f"I want it done by {shown}"
            text = f"{first}, and {second}."
        else:
            first, second = f"{g.name(owner)} takes {what}", f"Target is {shown}"
            text = f"{first}. {second}."
        tags = ("codeswitch",) if ms else ()
        return self.say(text, [self.ev("owner", owner, "INITIAL", first, tags), self.ev("deadline", d.isoformat(), "INITIAL", second, tags)])

    def move_deadline(self, ref: str, ms: bool) -> Say:
        g, cur = self.g, self.value["deadline"]
        anaphoric = ref == "it"
        live = cur > g.day + timedelta(days=5)  # a deadline that already lapsed can only be reset, not "pushed"
        mode = g.pick(["push", "push", "eom", "weeks"] + (["pull"] if cur - timedelta(days=14) > g.day + timedelta(days=3) else [])) if live else "reset"
        tags: Tuple[str, ...] = ()
        if mode == "weeks":
            n = g.pick([1, 2, 3])
            new, tags = cur + timedelta(days=7 * n), ("relative_date",)
            text = f"Push {ref} back by {n} week{'s' if n > 1 else ''}."
        elif mode == "eom":
            new, tags = last_day(max(cur, g.day) + timedelta(days=g.rng.randint(20, 60))), ("relative_date",)
            text = (f"Let's say the end of {calendar.month_name[new.month]}." if anaphoric
                    else f"Let's make {ref} due at the end of {calendar.month_name[new.month]}.")
        elif mode == "pull":
            new = cur - timedelta(days=g.rng.randint(3, 14))
            text = f"We can pull {ref} forward to {fmt_date(new, False)}."
        elif mode == "reset":
            new = g.day + timedelta(days=g.rng.randint(14, 45))
            text = f"New date for {ref}: {fmt_date(new, False)}." if not anaphoric else f"Let's reset it to {fmt_date(new, False)}."
        else:
            new = cur + timedelta(days=g.rng.randint(7, 30))
            text = (f"Tarikh akhir {ref} kita tangguh ke {fmt_date(new, True)}." if ms else
                    g.pick([f"Push {ref} back to {fmt_date(new, False)}.", f"Move {ref} to {fmt_date(new, False)}."]))
        if new == cur or new.year != YEAR or new <= g.day:
            return self.confirm_deadline(self.phrase() if anaphoric else ref)
        self.value["deadline"] = new
        return self.say(text, [self.ev("deadline", new.isoformat(), "REVISE", tags=tags + (("codeswitch",) if ms else ()))])

    def confirm_deadline(self, ref: str) -> Say:
        cur = self.value["deadline"]
        if cur <= self.g.day:
            return self.handover(ref if ref != "it" else self.phrase(), False)
        return self.say(f"The date for {ref} stays {fmt_date(cur, False)}, no change.", [self.ev("deadline", cur.isoformat(), "CONFIRM")])

    def handover(self, ref: str, ms: bool) -> Say:
        g = self.g
        new = g.pick([p for p in g.people if p != self.value["owner"]])
        self.value["owner"] = new
        if ms:
            return self.say(f"{g.name(new)}, awak ambil alih {ref}.", [self.ev("owner", new, "REVISE", tags=("codeswitch",))])
        return self.say(g.pick([f"{g.name(new)} takes over {ref} from now on.", f"{g.name(new)}, you take over {ref}."]), [self.ev("owner", new, "REVISE")])

    def finish(self, ref: str, ms: bool, cancel: bool) -> Say:
        g = self.g
        self.closed = True
        tags = ("codeswitch",) if ms else ()
        if cancel:
            text = f"Projek {ref} kita batalkan." if ms else g.pick([f"We're dropping {ref}.", f"{ref.capitalize()} is cancelled."])
            return self.say(text, [self.ev("status", "cancelled", "CANCEL", tags=tags)])
        text = f"{ref.capitalize()} dah siap." if ms else g.pick([f"{ref.capitalize()} is complete, everything went live.", f"We finished {ref} yesterday."])
        return self.say(text, [self.ev("status", "done", "COMPLETE", tags=tags)], speaker=self.value.get("owner"))


class Project(Item):
    def __init__(self, g: Gen, key: str, topic: str, vendors: Tuple[str, ...]) -> None:
        super().__init__(g, key)
        self.topic, self.vendors = topic, vendors

    @property
    def plan_obj(self) -> str:
        return f"{self.key}_plan"

    def phrase(self) -> str:
        return f"the {self.topic}"

    def object_lines(self) -> List[str]:
        t = self.topic[0].upper() + self.topic[1:]
        return [f"object: {self.key}_vendor | decision | Which {self.topic} vendor | outcome:enum[{','.join(self.vendors)}]!reverse",
                f"object: {self.key}_budget | decision | {t} budget in MYR | amount:number",
                f"object: {self.key}_plan | commitment | {t} rollout | deadline:date, owner:person, status:enum[done,cancelled]"]

    def plan(self, late: bool) -> List[str]:
        if self.stage == 0:
            self.stage = 1
            return ["vendor_initial", "budget_initial"]
        if self.stage == 1:
            self.stage = 2
            return ["plan_initial"]
        options = [("budget_revise", 3.0), ("budget_confirm", 1.0), ("deadline_revise", 4.0), ("deadline_confirm", 1.0),
                   ("vendor_reverse", 1.0), ("owner_revise", 1.0)] + self.closing_moves(late)
        return [self.g.rng.choices([o for o, _ in options], weights=[w for _, w in options])[0]]

    def render(self, move: str, ref: str, ms: bool) -> Say:
        g, t = self.g, self.topic
        tags = ("codeswitch",) if ms else ()
        if move == "vendor_initial":
            v = g.pick(self.vendors)
            self.value["vendor"] = v
            text = f"Kita pilih {v} untuk {ref}." if ms else g.pick([f"On {ref}, we go with {v}.", f"Let's pick {v} for {ref}."])
            return self.say(text, [Ev(f"{self.key}_vendor.outcome", v, "INITIAL", tags=tags)])
        if move == "vendor_reverse":
            v = g.pick([x for x in self.vendors if x != self.value["vendor"]])
            self.value["vendor"] = v
            text = f"Kita tukar kepada {v} untuk {ref}." if ms else g.pick([f"We're switching {ref} to {v}. That is decided.", f"Scrap that, {ref} goes to {v} instead."])
            return self.say(text, [Ev(f"{self.key}_vendor.outcome", v, "REVERSE", tags=("reversal",) + tags)])
        if move == "budget_initial":
            n = g.amount()
            self.value["budget"] = n
            text = f"Bajet {t} kita tetapkan {money(n, True)}." if ms else g.pick([f"Budget for {ref}: cap it at {money(n, False)}.", f"We'll allocate {money(n, False)} to {ref}."])
            return self.say(text, [Ev(f"{self.key}_budget.amount", n, "INITIAL", tags=tags)])
        if move == "budget_revise":
            cur = self.value["budget"]
            if g.rng.random() < 0.25 and not ms:
                delta = g.pick([100_000, 200_000, 300_000, 500_000])
                n, text, tags = cur + delta, f"Bump the budget for {ref} up by {delta // 1000}k.", ("relative_amount",)
            else:
                n = max(100_000, round(cur * g.rng.uniform(0.7, 1.4) / 50_000) * 50_000)
                n = n + 50_000 if n == cur else n
                text = (f"Bajet {t} kita ubah kepada {money(n, True)}." if ms else
                        f"{'Raise' if n > cur else 'Cut'} the budget for {ref} {'to' if n > cur else 'down to'} {money(n, False)}.")
            self.value["budget"] = n
            return self.say(text, [Ev(f"{self.key}_budget.amount", n, "REVISE", tags=tags)])
        if move == "budget_confirm":
            n = self.value["budget"]
            return self.say(f"The budget for {ref} stays at {money(n, False)}.", [Ev(f"{self.key}_budget.amount", n, "CONFIRM")])
        if move == "plan_initial":
            return self.owner_and_deadline(ref, ms, f"the {t} rollout")
        if move == "deadline_revise":
            return self.move_deadline(ref, ms)
        if move == "deadline_confirm":
            return self.confirm_deadline(ref)
        if move == "owner_revise":
            return self.handover(f"the {t} rollout", ms)
        return self.finish(ref, ms, cancel=move == "cancel")


class Hire(Item):
    def __init__(self, g: Gen, key: str, role: str) -> None:
        super().__init__(g, key)
        self.role = role

    def phrase(self) -> str:
        return f"the {self.role} hire"

    def object_lines(self) -> List[str]:
        return [f"object: {self.key} | commitment | Hire {article(self.role)} {self.role} | owner:person, deadline:date, status:enum[done,cancelled]"]

    def plan(self, late: bool) -> List[str]:
        if self.stage == 0:
            self.stage = 2
            return ["plan_initial"]
        options = [("deadline_revise", 4.0), ("deadline_confirm", 1.0), ("owner_revise", 1.5)] + self.closing_moves(late)
        return [self.g.rng.choices([o for o, _ in options], weights=[w for _, w in options])[0]]

    def render(self, move: str, ref: str, ms: bool) -> Say:
        if move == "plan_initial":
            return self.owner_and_deadline(ref, ms, f"the {self.role} hire")
        if move == "deadline_revise":
            return self.move_deadline(ref, ms)
        if move == "deadline_confirm":
            return self.confirm_deadline(ref)
        if move == "owner_revise":
            return self.handover(self.phrase(), ms)
        if move == "finish":
            self.closed = True
            return self.say(f"The {self.role} signed the offer.", [self.ev("status", "done", "COMPLETE")])
        return self.finish(ref, ms, cancel=True)


class Team(Item):
    def __init__(self, g: Gen, key: str, team: str) -> None:
        super().__init__(g, key)
        self.team = team

    def phrase(self) -> str:
        return f"the {self.team} headcount"

    def object_lines(self) -> List[str]:
        return [f"object: {self.key} | decision | {self.team} team headcount | headcount:number"]

    def plan(self, late: bool) -> List[str]:
        if self.stage == 0:
            self.stage = 2
            return ["initial"]
        return [self.g.rng.choices(["revise", "confirm"], weights=[3, 1])[0]]

    def render(self, move: str, ref: str, ms: bool) -> Say:
        g = self.g
        shown = lambda n: WORDS[n] if n in WORDS and g.rng.random() < 0.5 else str(n)
        if move == "initial":
            n = g.rng.randint(2, 30)
            self.value["n"], word = n, shown(n)
            return self.say(f"{self.team} headcount is approved at {word}.", [Ev(f"{self.key}.headcount", n, "INITIAL", tags=("number_words",) if word != str(n) else ())])
        cur = self.value["n"]
        if move == "confirm":
            return self.say(f"{self.team} headcount stays at {cur}, no change.", [Ev(f"{self.key}.headcount", cur, "CONFIRM")])
        n = max(1, cur + g.pick([-3, -2, -1, 1, 2, 3, 4]))
        n = n + 1 if n == cur else n
        self.value["n"], word = n, shown(n)
        return self.say(f"{self.team} headcount goes {'up' if n > cur else 'down'} to {word}.", [Ev(f"{self.key}.headcount", n, "REVISE", tags=("number_words",) if word != str(n) else ())])


def build_items(g: Gen) -> List[Item]:
    if g.base.chain_id == "hiring":
        n = max(2, min(12, 1 + g.k // 6))
        roles, teams = g.rng.sample(ROLES, min(len(ROLES), n)), g.rng.sample(TEAMS, min(len(TEAMS), n))
        return [Hire(g, f"h{i + 1:02d}_hire", roles[i % len(roles)]) if i % 2 == 0 else Team(g, f"t{i + 1:02d}_hc", teams[i % len(teams)]) for i in range(n)]
    n = max(2, min(10, 1 + g.k // 7))
    topics, vendors = g.rng.sample(TOPICS, n), g.rng.sample(VENDOR_SETS, n)
    return [Project(g, f"p{i + 1:02d}", topics[i], vendors[i]) for i in range(n)]


def meeting_dates(base: Chain, k: int, rng: random.Random) -> List[date]:
    now = date(*time.gmtime(base.now / 1e6)[:3])
    taken = {date(*time.gmtime(gm.meeting.occurred_at / 1e6)[:3]) for gm in base.meetings}
    first = date(YEAR, 1, 5)
    days = [d for d in (first + timedelta(days=i) for i in range((now - first).days)) if d not in taken]
    if k > len(days):
        raise ValueError(f"cannot place {k} filler meetings before {now} in {base.chain_id}: only {len(days)} free days")
    return sorted(rng.sample(days, k))


def compose_meeting(g: Gen, items: List[Item], introduced: List[Item], index: int) -> List[Say]:
    rng = g.rng
    late = index >= g.k * 0.5
    untouched = [i for i in items if i.stage == 0]
    half_done = [i for i in introduced if not i.closed and i.stage == 1]
    live = [i for i in introduced if not i.closed and i.stage >= 2]
    if untouched and (index < len(items) or not live or rng.random() < 0.1):
        active = [untouched[0]]
    elif half_done and rng.random() < 0.7:
        active = [half_done[0]]
    else:
        pool = live or half_done
        active = rng.sample(pool, min(len(pool), 1 if rng.random() < 0.55 else 2)) if pool else []
    chatter = lambda: rng.choice(g.others or [g.chair])
    turns = [Say(g.chair, g.pick(OPENINGS), [], "ignorable")]
    for item in active:
        if item not in introduced:
            introduced.append(item)
        ref = item.phrase()
        turns.append(Say(g.chair, f"On {ref}." if rng.random() < 0.5 else f"Next, {ref}.", [], "ignorable"))
        for j, move in enumerate(item.next_moves(late)):
            ms = g.ms()
            anaphora = j == 0 and move == "deadline_revise" and not ms and rng.random() < 0.3
            turn = item.render(move, "it" if anaphora else ref, ms)
            if anaphora:
                turn.events = [replace(e, tags=e.tags + ("anaphora",)) for e in turn.events]
            turns.append(turn)
        if rng.random() < 0.5:
            turns.append(Say(chatter(), g.pick(IGNORABLE), [], "ignorable"))
        if rng.random() < 0.7:
            kind = rng.choice(["question", "hypothetical", "hearsay", "tentative"])
            pool = {"question": QUESTIONS, "hypothetical": HYPOTHETICALS, "hearsay": HEARSAY, "tentative": TENTATIVE}[kind]
            turns.append(Say(chatter(), g.pick(pool).format(r=ref, w=g.name(chatter())), [], kind))
    if g.malay and rng.random() < 0.3:
        kind, text = g.pick(MS_DISTRACTORS)
        turns.append(Say(chatter(), text.format(r=active[0].phrase() if active else "projek tu"), [], kind))
    if rng.random() < 0.5:
        turns.append(Say(chatter(), g.pick(UNTRACKED), [], "untracked"))
    echoes = ECHOES.get(g.base.chain_id)
    if echoes and rng.random() < 0.35:
        turns.append(Say(chatter(), f"Any update on the {g.pick(echoes)}?", [], "question"))
        turns.append(Say(g.chair, "I'll find out and come back to you.", [], "untracked"))
    turns.append(Say(g.chair, g.pick(CLOSINGS), [], "ignorable"))
    for t in turns:
        for e in t.events:
            if e.quote and e.quote not in t.text:
                raise AssertionError(f"quote {e.quote!r} not in {t.text!r}")
    return turns


def render_filler(base: Chain, k: int, seed: int) -> str:
    g = Gen(base, k, seed)
    items = build_items(g)
    dates = meeting_dates(base, k, g.rng)
    now_iso = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(base.now / 1e6))
    lines = [f"chain: {base.chain_id}-filler", f"language: {base.language}", f"now: {now_iso}",
             "people: " + ", ".join(f"{p}={n}" for p, n in base.registry.people.items())]
    for item in items:
        lines += item.object_lines()
    introduced: List[Item] = []
    for index, day in enumerate(dates):
        g.day = day
        lines.append(f"\nmeeting: f{index + 1:03d} | {day.isoformat()}T09:00:00Z | ingested={day.isoformat()}T12:00:00Z")
        lines += [t.line() for t in compose_meeting(g, items, introduced, index)]
    return "\n".join(lines) + "\n"


def pad_chain(base: Chain, k: int, seed: int = 0) -> Chain:
    """The base chain plus k filler meetings and the filler's objects; questions and gold are the base chain's."""
    if k == 0:
        return base
    filler = parse_chain(render_filler(base, k, seed), f"<padding {base.chain_id} k={k} seed={seed}>")
    clash = set(filler.registry.objects) & set(base.registry.objects)
    if clash:
        raise ValueError(f"filler objects clash with base objects: {sorted(clash)}")
    registry = Registry({**base.registry.objects, **filler.registry.objects}, dict(base.registry.people))
    meetings = tuple(sorted(base.meetings + filler.meetings, key=lambda m: m.meeting.ingested_at))
    note = f"{base.note} PADDED with {k} template-generated filler meetings (generator {GENERATOR_VERSION}, seed {seed}); filler is synthetic and more regular than real speech."
    return replace(base, registry=registry, meetings=meetings, note=note)

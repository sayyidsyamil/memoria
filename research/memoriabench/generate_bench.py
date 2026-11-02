"""MemoriaBench generator: 336 probe statements about the 28 unseen AMI test series.

For each test series (every complete AMI scenario series that is not a development series) the history is its
meetings a-c: the annotators' decisions, each cited to the moment in the meeting it rests on (ami_loader.py,
which cannot open meeting d of these series at all). Twelve probes are made per series, two for each class:

    SUPPORTED_CURRENT      restates an active decision
    OUTDATED               asserts something an active decision replaced  (an alert)
    CONTRADICTS            asserts the opposite of an active decision     (an alert)
    UPDATES                proposes a feature no decision covers
    IRRELEVANT             banter and meeting logistics
    INSUFFICIENT_EVIDENCE  a claim about progress or results that no decision can confirm or refute

Every gold label is true by construction, not by a model's opinion. No language model is used anywhere, so the
benchmark is not written by the model it will test and running this script again gives the same bytes.
    - SUPPORTED: a decision's own words, or a template for the fact it states.
    - CONTRADICTS: the fact with its value swapped for another (a different battery, material, price, market) or
      its polarity flipped (will have -> will not have), refused when the series says anything about that
      attribute that the swap could also match.
    - UPDATES / INSUFFICIENT_EVIDENCE: from fixed pools, used only in a series whose decisions never mention what
      the item is about.
    - OUTDATED needs a decision that replaced an earlier one. The annotators wrote decisions per meeting and almost
      never recorded a change of mind, so only five replaced decisions exist in all 28 series (REAL_SUPERSESSIONS).
      The other 51 OUTDATED probes use a SYNTHETIC replacement: an active decision is given a "(replaces X)" note,
      as Memoria's own approval step would write it, and the probe asserts X. These are labelled
      synthetic-supersession in data/memoria_bench.provenance.jsonl, together with the exact note memory_text()
      must show the auditor; without the notes no auditor can know anything was replaced.

The dataset file holds exactly the six schema fields. How each row was made lives in the provenance file.

Run: python3.11 generate_bench.py [--force]   (then python3.11 validate_bench.py)
"""

import argparse
import hashlib
import json
import random
import re
import sys
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path

from ami_loader import DEV_SERIES, Series, test_series

HERE = Path(__file__).resolve().parent
DATA = HERE / "data"
BENCH_FILE = DATA / "memoria_bench.jsonl"
PROVENANCE_FILE = DATA / "memoria_bench.provenance.jsonl"
HASH_FILE = DATA / "memoria_bench.sha256"
DEV_FILE = DATA / "memoria_bench_dev.jsonl"  # the same recipe on the five development series: for tuning baselines, never for the test
DEV_PROVENANCE_FILE = DATA / "memoria_bench_dev.provenance.jsonl"
SEED = 20261015

CLASSES = ("SUPPORTED_CURRENT", "OUTDATED", "CONTRADICTS", "UPDATES", "IRRELEVANT", "INSUFFICIENT_EVIDENCE")
CODES = {"SUPPORTED_CURRENT": "S", "OUTDATED": "O", "CONTRADICTS": "C", "UPDATES": "U", "IRRELEVANT": "I", "INSUFFICIENT_EVIDENCE": "E"}
ALERTS = ("OUTDATED", "CONTRADICTS")
PER_CLASS = 2
FIELDS = ("id", "series_id", "statement", "gold_label", "gold_citation", "expected_alert")


# --- small text helpers -----------------------------------------------------------------------------

TYPOS = {"accomodate": "accommodate", "radiaclly": "radically", "reserach": "research", "changable": "changeable", "proft": "profit", "mext": "next"}


def tidy(text: str) -> str:
    text = " ".join(text.replace(" -", " ").split()).strip(" -")
    for wrong, right in TYPOS.items():
        text = re.sub(wrong, right, text, flags=re.I)
    text = text[:1].upper() + text[1:]
    return text if text.endswith((".", "!", "?")) else text + "."


def lower_first(text: str) -> str:
    return text if re.match(r"[A-Z]{2}", text) or text.startswith(("I ", "I'")) else text[:1].lower() + text[1:]


def sentences_of(text: str) -> list[str]:
    return [s.strip(" -") for s in re.split(r"(?<=[.!?])\s+(?=[A-Z-])", text) if s.strip(" -")]


def stable(*parts: object) -> int:
    return int(hashlib.sha256("|".join(str(p) for p in (SEED, *parts)).encode()).hexdigest()[:12], 16)


# --- what a decision says: facts -------------------------------------------------------------------

SOFT = re.compile(r"\b(possibly|consider\w*|could|might|perhaps|research\w*|good idea|preferable|would be|would like|can be|can also|can allow|"
                  r"maybe|if (?:the|it|there|used|budget)|not sure|look further|next meeting|for the time being|later|as well as|thus far|so far|can|the idea|mentioned|suggested|wondered)\b", re.I)
VERB = re.compile(r"\b(will|would|must|should|is|are|was|were|decided|going to|has|have|had|can|cannot|need|needs|agreed|realized|consider\w*|be|been)\b", re.I)
HEDGE_START = re.compile(r"^(?:thus far|so far|for now|currently|at the moment)\b", re.I)


def clauses(text: str) -> list[str]:
    return [c.strip() for c in re.split(r"[;,]| but | and (?=an? |the |it |they |will |there |rubber )", text) if c.strip()]


def money_facts(text: str) -> dict[str, str]:
    t = text.lower()
    if SOFT.search(t):
        return {}
    found = {}
    if re.search(r"\b(sell|selling|sold|price)\b", t) and re.search(r"\b(25|twenty[ -]five)\b", t):
        found["price"] = "25"
    if re.search(r"\b(production costs?|costs?|produce|make)\b", t) and re.search(r"\b(12\.5|12\.50|twelve)\b", t):
        found["cost"] = "12.50" if re.search(r"cannot exceed|maximum|no more than|at most|\bmax\b", t) else "12.50 exact"
    if "profit" in t:
        if re.search(r"\b(50|fifty) million\b", t):
            found["profit"] = "50 million"
        elif re.search(r"\b(15|fifteen) million\b", t):
            found["profit"] = "15 million"
    if re.search(r"\binternational", t) and re.search(r"\b(sold|sell|selling|target|market|focus)\w*", t):
        found["market"] = "international"
    return found


def clause_facts(clause: str) -> dict[str, str]:
    c = re.sub(r"\binstead of \w+( \w+)?", " ", clause, flags=re.I)  # the option a decision turned down is not what it decided
    t = c.lower()
    if SOFT.search(t):
        return {}
    found: dict[str, str] = {}

    # power
    kinds = [k for k, rx in (("kinetic", r"\bkinetic\b"), ("solar", r"\bsolar\b"), ("rechargeable", r"\brechargeable\b")) if re.search(rx, t)]
    explicit = re.search(r"\b(regular|normal|standard|conventional|simple|ordinary)\b[^.]{0,12}\bbatter", t)
    generic = re.search(r"\bbatter(y|ies)\b|\bpower source\b", t)
    if re.search(r"combination|backup|batteries and (kinetic|solar)", t) or len(kinds) + bool(explicit) > 1:
        pass
    elif kinds:
        found["power"] = kinds[0]
    elif explicit:
        found["power"] = "regular"  # a bare "battery" says too little to restate or to contradict, so it is left unread

    # material of the case
    if re.search(r"\b(case|casing|covered|shell|made (of|from)|materials?)\b", t) and not (re.search(r"\bbuttons?\b", t) and "made" not in t):
        materials = {m for m, rx in (("rubber", r"\b(rubber|rubberi[sz]ed)\b"), ("latex", r"\blatex\b"), ("plastic", r"\bplastic\b"), ("wood", r"\bwood\w*\b"),
                                     ("titanium", r"\btitanium\b"), ("metal", r"\bmetal\b")) if re.search(rx, t)}
        if len(materials) == 1:
            found["material"] = materials.pop()
        elif materials == {"plastic", "rubber"}:
            found["material"] = "plastic+rubber"

    # shape of the case
    shapes = {s for s, rx in (("single", r"\bsingle[- ]curved\b"), ("double", r"\bdouble[- ]curved\b")) if re.search(rx, t)}
    if len(shapes) == 1:
        found["shape"] = shapes.pop()

    # chip
    if re.search(r"\bchips?\b", t) and not re.search(r"chip[- ]on[- ]print", t):
        if re.search(r"\b(advanced|smart|expensive)\b", t):
            found["chip"] = "advanced"
        elif re.search(r"\b(simple|regular|standard|basic|low[- ]level|normal)\b", t):
            found["chip"] = "simple"

    # which devices it controls
    if re.search(r"back-?up|devices connected", t):
        pass
    elif re.search(r"\b(only|just)\b[^.]*\b(tv|televisions?)\b|\b(television|tv)s? only\b|single function design|\brestrict\w*\s+the remote to (?:tv|television)", t):
        found["devices"] = "tv_only"
    elif re.search(r"\bmultiple devices\b", t):
        found["devices"] = "multi"

    # who it is for
    if re.search(r"sixty to eighty|\belderly\b", t):
        found["target"] = "elderly"
    elif re.search(r"\b(young|youth|younger|under forty|below 40|20-40|fifteen to thirty)", t) and not re.search(r"\bnew technology\b", t):
        found["target"] = "young"

    # things the remote has or has not
    if re.search(r"\b(locator|locating|recovery when lost|find the remote)\b", t):
        found["locator"] = "yes"
    if re.search(r"\b(changeable|interchangeable|removable|alternative|multiple) (?:covers?|fronts?|face ?plates?|fascias?|skins?|casings?|cases)\b", t):
        found["covers"] = "no" if re.search(r"\bnot with\b|\bno\b", t) else "yes"
    if re.search(r"\b(corporate|company) (?:image|logo|colou?rs?|slogan)\b", t) and not re.search(r"\b(boot|flash|brief)\w*", t):
        found["corporate"] = "yes"
    if re.search(r"\b(docking station|recharging (?:stand|station|cradle)|charging station)\b", t):
        found["dock"] = "yes"
    if re.search(r"\b(lcd|display|screen)\b", t) and "touch" not in t and not re.search(r"\blcd buttons?\b|\b(?:boot|start)[- ]?up screen\b", t):
        if re.search(r"\b(no (lcd|display)|not (have|feature|include|implement\w*)|not going to be implemented|ruled out)\b", t):
            found["lcd"] = "no"
        else:
            found["lcd"] = "yes"  # a screen that is placed, sized or given a menu is a screen the remote has
    if re.search(r"\b(speech|voice) (recognition|recogni[sz]er|activation)\b|\basr\b", t) and not re.search(r"\blocator|finder|other functions\b", t):
        if re.search(r"\b(no (speech|voice)|not (include|contain|use|incorporat\w*)|cannot do|ruled out|asr have been ruled)\b", t):
            found["speech"] = "no"
        else:
            found["speech"] = "yes"
    return found


def firm_clauses(text: str) -> list[str]:
    """The clauses of a decision that state something firmly: not hedged ("possibly", "consider", "can"), not a list
    item that continues a hedged clause, and not in a sentence that opens with "thus far"."""
    firm = []
    for part in sentences_of(text):
        if HEDGE_START.match(part):
            continue
        soft = False
        for clause in clauses(part):
            has_verb = bool(VERB.search(clause))
            soft = bool(SOFT.search(clause)) if has_verb else soft or bool(SOFT.search(clause))
            if not soft:
                firm.append(clause)
    return firm


def facts_of(text: str) -> dict[str, str]:
    found = dict(money_facts(text))
    for part in sentences_of(text):
        for clause in firm_clauses(part):
            for key, value in clause_facts(clause).items():
                found.setdefault(key, value)
    for part in sentences_of(text):
        if re.search(r"teletext", part, re.I) and re.search(r"\b(not|no longer|eliminate|outdated)\b", part, re.I) and not SOFT.search(part):
            found["teletext"] = "no"
    if re.search(r"\bno (lcd|display)\b", text, re.I) and "lcd" not in found:
        found["lcd"] = "no"
    if re.search(r"\bno voice recognition\b", text, re.I):
        found["speech"] = "no"
    return found


KEYWORD = {
    "power": r"batter|kinetic|solar|energy|power source|powered|rechargeable",
    "material": r"plastic|rubber|latex|wood|titanium|metal|\bmaterials?\b",
    "shape": r"curved|curvy",
    "chip": r"\bchip",
    "devices": r"multiple devices|devices connected|(?:only|just)\b[^.]*\b(?:tv|television)|(?:tv|television)s? only|single function|\brestrict\w*\s+the remote to|\buniversal\b",
    "target": r"target group|age group|young|youth|sixty|everybody|widest market|all age|under forty|below 40|consumers",
    "teletext": r"teletext",
    "lcd": r"\blcd\b|\bdisplay\b|\bscreen\b",
    "speech": r"speech|voice|\basr\b",
    "price": r"\bsell|\bsold\b|price",
    "cost": r"production cost|\bcosts?\b",
    "profit": r"profit",
    "market": r"international",
    "locator": r"locator|locating|find the remote|recovery when lost|easy to find",
    "covers": r"changeable|interchangeable|removable|fascias|face ?plates|alternative cases|multiple casings|skins",
    "corporate": r"\bcorporate\b|company (?:logo|colo|slogan|image)",
    "dock": r"docking|recharging (?:stand|station|cradle)|charging station",
}


# --- what can be said about a fact ----------------------------------------------------------------------

def _money(template: str, numbers: list[str]):
    return {n: ([template.format(n=n)], None) for n in numbers}


# attribute -> value -> (statement variants, what a decision "replaces" when this was the old value, a regex that
# finds this value mentioned anywhere in a decision). A statement may only use a value that no decision mentions.
LEXICON: dict[str, dict[str, tuple[list[str], str, str]]] = {
    "power": {
        "regular": (["The remote will use regular batteries.", "We will power the remote with regular batteries."], "regular batteries",
                    r"\b(regular|normal|standard|conventional|simple|ordinary)\b[^.]{0,12}\bbatter|batteries because"),
        "kinetic": (["The remote will be powered by a kinetic battery.", "We will use a kinetic battery in the remote."], "a kinetic battery", r"kinetic"),
        "solar": (["The remote will run on solar power.", "We will use solar cells to power the remote."], "solar power", r"solar"),
        "rechargeable": (["The remote will use rechargeable batteries.", "We will power the remote with rechargeable batteries."], "rechargeable batteries", r"rechargeable|recharg"),
    },
    "material": {
        "rubber": (["The case will be made of rubber.", "We will make the case out of rubber."], "a rubber case", r"rubber|latex"),
        "latex": (["The case will be made of latex.", "We will make the case out of latex."], "a latex case", r"latex|rubber"),
        "plastic": (["The case will be made of plastic.", "We will make the case out of plastic."], "a plastic case", r"plastic"),
        "wood": (["The case will be made of wood.", "We will make the case out of wood."], "a wooden case", r"wood"),
        "titanium": (["The case will be made of titanium.", "We will make the case out of titanium."], "a titanium case", r"titanium"),
        "metal": (["The case will be made of metal.", "We will make the case out of metal."], "a metal case", r"metal"),
        "plastic+rubber": (["The case will be made of plastic and rubber.", "We will make the case from plastic and rubber."], "a plastic and rubber case", r"plastic|rubber|latex"),
    },
    "shape": {
        "single": (["The case will be single curved.", "We will use a single curved case."], "a single curved case", r"single[- ]curved"),
        "double": (["The case will be double curved.", "We will use a double curved case."], "a double curved case", r"double[- ]curved"),
    },
    "chip": {
        "simple": (["The remote will use a simple chip.", "A simple chip is enough for the remote."], "a simple chip", r"(simple|regular|standard|basic|low[- ]level)\b[^.]{0,10}chip"),
        "advanced": (["The remote will use an advanced chip.", "We need an advanced chip in the remote."], "an advanced chip", r"(advanced|smart)\b[^.]{0,12}chip"),
    },
    "devices": {
        "tv_only": (["The remote will only control televisions.", "This remote is for televisions only."], "a television-only remote", r"only\b[^.]*\b(tv|television)|(tv|television)s? only|single function"),
        "multi": (["The remote will control multiple devices, not just the television.", "The remote will work with several devices."], "controlling multiple devices", r"multiple devices|several devices|other devices"),
    },
    "target": {
        "young": (["The remote is aimed at young people.", "We are targeting young people with this remote."], "targeting young people", r"young|youth|under forty|below 40|20-40|fifteen to thirty"),
        "elderly": (["The remote is aimed at people over sixty.", "We are targeting people over sixty with this remote."], "targeting people over sixty", r"sixty|eighty|elderly|older"),
    },
    "teletext": {
        "no": (["The team will not work with teletext.", "Teletext will not be part of the design."], "working with teletext", r"teletext"),
        "yes": (["The remote will have a teletext button.", "We will include teletext in the design."], "including teletext", r"teletext"),
    },
    "lcd": {
        "no": (["The remote will not have an LCD screen.", "There will be no LCD screen on the remote."], "a remote without a screen", r"\blcd\b|\bdisplay\b|\bscreen\b"),
        "yes": (["The remote will have an LCD screen.", "We will put an LCD screen on the remote."], "an LCD screen", r"\blcd\b|\bdisplay\b|\bscreen\b"),
    },
    "speech": {
        "no": (["The remote will not include speech recognition.", "There will be no voice recognition in the remote."], "a remote without speech recognition", r"speech|voice|\basr\b"),
        "yes": (["The remote will include speech recognition.", "We will add voice recognition to the remote."], "speech recognition", r"speech|voice|\basr\b"),
    },
}
for _n in ("30", "35", "40", "45", "50", "25"):
    LEXICON.setdefault("price", {})[_n] = ([f"The remote will sell for {_n} Euro.", f"We are pricing the remote at {_n} Euro."], f"a {_n} Euro selling price", rf"\b{_n}\b")
LEXICON["cost"] = {"12.50": (["The production cost cannot exceed 12.50 Euro.", "Each remote must cost no more than 12.50 Euro to produce."], "a 12.50 Euro cost cap", r"\b12\.5"),
                  "12.50 exact": (["The production cost will be 12.50 Euro per remote.", "We will produce each remote for 12.50 Euro."], "a 12.50 Euro production cost", r"\b12\.5")}
for _n in ("15", "18", "20"):  # figures above the cap are stated as what production will cost, so that they plainly break it
    LEXICON["cost"][_n] = ([f"Each remote will cost about {_n} Euro to produce.", f"Production will cost us {_n} Euro per remote."], f"a {_n} Euro production cost", rf"\b{_n}\b")
for _n in ("20", "30", "50", "60", "15"):
    LEXICON.setdefault("profit", {})[_n + " million"] = ([f"Our profit aim is {_n} million Euro.", f"We are aiming for a profit of {_n} million Euro."], f"a profit aim of {_n} million Euro", rf"\b{_n} million\b")
LEXICON["locator"] = {
    "yes": (["The remote will have a locator function so it can be found when lost.", "We will add a locator function to the remote."], "a locator function", r"locator"),
    "no": (["The remote will not have a locator function.", "There will be no locator function on the remote."], "a remote without a locator function", r"locator"),
}
LEXICON["covers"] = {
    "yes": (["The remote will come with changeable covers.", "We will offer changeable covers for the remote."], "changeable covers", r"changeable"),
    "no": (["The remote will not have changeable covers.", "There will be no changeable covers."], "a remote without changeable covers", r"changeable"),
}
LEXICON["corporate"] = {
    "yes": (["The corporate image will be shown on the remote.", "We will put the corporate image on the remote."], "the corporate image on the remote", r"corporate|company"),
    "no": (["The corporate image will not be shown on the remote.", "We will leave the corporate image off the remote."], "a remote without the corporate image", r"corporate|company"),
}
LEXICON["dock"] = {  # decisions say docking station, charging station, recharging stand or cradle; "recharging dock" is all of them
    "yes": (["The remote will come with a recharging dock.", "We will bundle a recharging dock with the remote."], "a recharging dock", r"dock"),
    "no": (["The remote will not come with a recharging dock.", "We will not include a recharging dock."], "a remote without a recharging dock", r"dock"),
}
LEXICON["market"] = {
    "international": (["The remote will be sold on the international market.", "We are targeting an international market."], "an international market", r"international"),
    "europe": (["The remote will only be sold in Europe.", "We are only selling the remote in the European market."], "a Europe-only market", r"\beurope"),
    "home": (["The remote will only be sold in our home market.", "We are only selling the remote in the home market."], "a home-market-only launch", r"home market"),
}

# swaps that contradict a value (the old value for OUTDATED is drawn from the same list): attribute -> value -> alternatives
ALTERNATIVES = {
    "power": {"regular": ["kinetic", "solar"], "kinetic": ["solar", "regular"], "solar": ["kinetic", "regular"], "rechargeable": ["solar", "kinetic"]},
    "material": {"rubber": ["wood", "titanium", "metal"], "latex": ["wood", "titanium", "metal"], "plastic": ["wood", "titanium", "metal"], "wood": ["plastic", "metal", "titanium"], "plastic+rubber": ["wood", "titanium", "metal"],
                 "titanium": ["wood", "rubber", "plastic"], "metal": ["wood", "rubber", "plastic"]},
    "shape": {"single": ["double"], "double": ["single"]},
    "chip": {"simple": ["advanced"], "advanced": ["simple"]},
    "devices": {"tv_only": ["multi"], "multi": ["tv_only"]},
    "target": {"young": ["elderly"], "elderly": ["young"]},
    "teletext": {"no": ["yes"]},
    "lcd": {"no": ["yes"], "yes": ["no"]},
    "speech": {"no": ["yes"], "yes": ["no"]},
    "price": {"25": ["35", "40", "30", "45", "50"]},
    "cost": {"12.50": ["15", "18", "20"], "12.50 exact": ["15", "18", "20"]},
    "profit": {"50 million": ["20 million", "30 million", "60 million"], "15 million": ["50 million", "30 million", "60 million"]},
    "market": {"international": ["europe", "home"]},
    "locator": {"yes": ["no"], "no": ["yes"]},
    "covers": {"yes": ["no"], "no": ["yes"]},
    "corporate": {"yes": ["no"], "no": ["yes"]},
    "dock": {"yes": ["no"], "no": ["yes"]},
}
# Money is only swapped as a contradiction; a "replaced" money value would be a made-up history about a figure
# the brief fixed, so OUTDATED draws on the other attributes.
NO_SYNTHETIC_OLD = {"price", "cost", "profit", "market"}
BOOLEAN = {"teletext", "lcd", "speech", "locator", "covers", "corporate", "dock"}  # a polarity flip is the swap, so nothing else need be absent


# --- generic flips: polarity of a decision's own sentence ----------------------------------------------------

GERUNDS = {"include": "including", "have": "having", "feature": "featuring", "use": "using", "contain": "containing", "create": "creating",
           "work with": "working with", "implement": "implementing", "incorporate": "incorporating", "control": "controlling", "keep": "keeping"}
SUBJECT_MODAL = re.compile(r"^(?:The [A-Za-z' -]{2,28}?|We)\s+(?:will|must|should|is going to|are going to|has to|needs to)\b")


def core(text: str) -> str | None:
    """One plain assertion with an explicit subject: the first clause of a decision's first sentence. "It ..." is
    refused (what it stood for is lost without the meeting), and so is anything that is not a plain statement
    of what the remote will be or do."""
    t = sentences_of(text)[0]
    t = re.sub(r"^It was (?:also )?decided that ", "", t)
    t = t[:1].upper() + t[1:]
    t = re.sub(r"^(?:The group|The team|They)\s+(?:also\s+)?decided\s+(not\s+)?to\s+", lambda m: "We will not " if m.group(1) else "We will ", t)
    t = re.sub(r"^They\b", "We", t)
    t = re.sub(r"^((?:The [A-Za-z' -]{2,28}?|We))\s+would\b", r"\1 will", t)  # "the remote would feature" in a reported decision; a "would" deeper in is kept
    t = re.sub(r",? (?:because|since|as|so that) .*$", "", t.rstrip("."))
    t = re.split(r",? and (?=an? |the |it |they |will |there |rubber )|, (?:but|which|including|with|while|although|so|especially) ", t)[0]
    if "," in t:  # a list: cutting it anywhere would leave nonsense
        return None
    if not SUBJECT_MODAL.match(t) or re.match(r"^The (group|team) (?:also )?(?:will|must) (?:look|research|consider)", t) or ";" in t or ":" in t or "?" in t \
            or SOFT.search(t) or not 4 <= len(t.split()) <= 24:
        return None
    return tidy(t)


def negation_flip(text: str):
    """(the positive statement, what a decision of this kind replaces) for a decision that rules something out, or None."""
    t = core(text)
    m = re.search(r"\b(will not|is not going to|are not going to|must not)\s+(work with|\w+)\s+(.+?)\.$", t) if t else None
    if not m or "," in m.group(3) or re.search(r"\b(?:without|unless|instead|rather|except|despite|although|neither|nor|but)\b", m.group(3), re.I):
        return None
    positive = t.replace(m.group(1), m.group(1).replace(" not", ""), 1)
    gerund = GERUNDS.get(m.group(2))
    rest = m.group(3)
    return tidy(positive), (f"{gerund} {rest}" if gerund and len(rest.split()) <= 8 else None)


def affirmation_flip(text: str):
    """The negated statement for a plain 'will <verb> ...' decision, or None. (A contradiction only: an "old position"
    of not doing something reads too oddly as a replaced decision.)"""
    t = core(text)
    if not t or re.search(r"\bnot\b|\bno\b|\bonly\b|\bnever\b|cannot|,|\b(?:without|unless|instead|rather|except|despite|although|neither|nor|but)\b|"
                          r"\b(?:and|or) (?:have|be|feature|include|use|contain|come|carry|offer|support|keep)\b", t, re.I):
        return None
    m = re.search(r"\b(will|must|should|is going to|are going to)\s+(?:also\s+)?(\w+)(\s+to\b)?", t)
    if not m or m.group(2) in ("need", "decide", "look", "research", "consider", "try", "seem") or (m.group(2) == "have" and m.group(3)):
        return None
    modal = m.group(1)
    negated = modal.replace("going to", "not going to", 1) if "going" in modal else f"{modal} not"
    return tidy(t[:m.start()] + negated + " " + t[m.start(2):])


# --- replaced decisions that really are in the annotations ---------------------------------------------------
# (the earlier decision, the decision that replaced it, a statement of the old position, what the new one replaces).
# Read from the annotators' own sentences; only changes that no one could read as a mere refinement.
REAL_SUPERSESSIONS = {
    "ES2007": [("ES2007b:23:43", "ES2007c:28:10", "The remote will run on regular batteries.", "regular batteries")],
    "ES2009": [("ES2009b:17:55", "ES2009c:21:36", "We are keeping the touch screen interface.", "keeping the touch screen interface"),
               ("ES2009b:10:42", "ES2009c:25:19", "The remote casing will be made of plastic.", "a plastic casing")],
    "TS3003": [("TS3003a:22:05", "TS3003b:17:41", "The remote will be able to control multiple devices.", "controlling multiple devices")],
    "TS3009": [("TS3009c:12:36", "TS3009c:26:39", "The remote needs an advanced chip to work with the LCD screen.", "an advanced chip")],
}


# --- the pools: probes that are about no decision ---------------------------------------------------------

# (a feature, a regex over a series' decisions: if it matches, the series says something about this, so the item is not used there)
FEATURES = [
    ("a built-in clock", r"clock"), ("a sleep timer button", r"timer|sleep"),
    ("a backlight for the buttons", r"light|\blit\b|glow|illuminat|\bled\b|lamp|dark"),
    ("a small speaker that beeps when you press a button", r"speaker|beep|sound|audio|alarm"),
    ("a child lock", r"lock|child|parent"), ("favourite-channel shortcut buttons", r"favou?rite|preset|shortcut"),
    ("a dedicated mute button", r"mute"), ("a wrist strap", r"strap|wrist|loop|hang"),
    ("a motion sensor that wakes the remote when it is picked up", r"motion|sensor|wake|kinetic|standby|idle"),
    ("a magnetic back so it sticks to the fridge", r"magnet"), ("a quick-start card in the box", r"manual|instruction|quick|guide|\bcard\b|\bbox\b"),
    ("splash-proof seals", r"water|splash|proof|damage|shock"), ("a simple games menu", r"game|\bkids?\b|child"),
    ("a subtitles button", r"subtitle|teletext"), ("a language switch for international users", r"language|multilingual"),
    ("a vibration alert for low battery", r"vibrat|indicator|low battery"), ("a one-touch button for the programme guide", r"guide|\bepg\b|programme|program"),
    ("a record button", r"record|\bvcr\b|\bdvd\b"), ("a picture-in-picture button", r"picture"),
    ("a sleep-mode button", r"sleep|standby"), ("a button to jump back to the previous channel", r"previous channel|switch between|two channels|swap"),
    ("an emergency call button for elderly users", r"emergency|elderly|older|young|youth|target|age group"), ("large-print labels", r"large print|\blabel|symbol|enlarge"),
    ("a tiny flashlight at the tip", r"flash|light|\blit\b|lamp|\bled\b|glow|illuminat"), ("Bluetooth pairing with a phone app", r"bluetooth|\bapp\b|phone|wireless"),
    ("a phone app that can find the remote", r"\bapp\b|phone|locat|find|finder|lost"), ("voice feedback that reads out the channel", r"voice|speech|feedback|audio"),
    ("anti-slip grips on the sides", r"grip|rubber|latex|slip"), ("a layout that works for left-handed users", r"handed|adaptable"),
    ("a battery cover that opens without tools", r"cover|batter|tool"), ("recycled plastic for the case", r"recycl|environment|plastic|material|\bcase|casing|rubber|latex|wood|titanium|metal"),
    ("a laser-engraved owner name", r"engrav|\bname\b|personal"), ("a pocket-size travel pouch", r"travel|pouch|pocket|\bbag\b"),
    ("a screen lock so buttons are not pressed by accident", r"lock|accident"), ("a profile switch for different family members", r"profile|famil|user account|personal"),
    ("a macro button that runs several commands", r"macro|sequence|several commands"), ("an eco-mode that dims the display", r"eco|dim|display|screen|lcd"),
    ("a firmware update through a cable", r"firmware|update|cable|\busb\b"), ("a hidden compartment for spare batteries", r"compartment|spare|batter"),
    ("a text-size setting for the on-screen menu", r"text size|menu|screen|lcd|display"), ("a wall mount", r"wall|mount|hang"),
    ("glow-in-the-dark numbers", r"glow|dark|\blit\b|illuminat|light"), ("a sliding cover that hides the less used buttons", r"cover|hide|hidden|flip|panel"),
    ("a built-in thermometer", r"thermo|temperature"), ("a pairing button for a second television", r"second|multiple devices|pairing"),
    ("a shake-to-wake gesture", r"shake|gesture|wake|motion|kinetic|sensor"), ("a fingerprint sensor for personal profiles", r"fingerprint|profile|biometric"),
    ("a coloured ring around the main buttons", r"\bring\b|colou?r|changeable|face ?plate|skin|front"), ("a rotating volume knob", r"knob|dial|wheel|scroll|volume"),
    ("a countdown timer", r"timer|countdown"), ("a button that opens the television's settings menu", r"settings|menu"),
    ("a built-in stand so it can stand up on the table", r"stand\b|dock|station|cradle|holder"), ("braille markings on the main buttons", r"braille|marking|blind|disab"),
    ("a scratch-resistant coating", r"scratch|coating|finish|damage|protect|proof|water|shock|durable"), ("haptic feedback when a button is pressed", r"haptic|vibrat|feedback"),
    ("an auto-off after ten minutes of no use", r"auto|shut|\boff\b|standby|idle"), ("a sports channel shortcut", r"sport|shortcut|favou?rite|preset"),
    ("a night mode with dimmer colours", r"night|dim|light|dark|glow"), ("a high-contrast colour scheme for the buttons", r"contrast|colou?r"),
    ("a one-button movie mode", r"movie|dim|light|mode"), ("a replaceable button set", r"replace|\bbutton"),
    ("a weighted base so it does not tip over", r"weight|\btip\b|stable|stand"), ("a tilt sensor that rotates the on-screen menu", r"tilt|rotate|sensor|screen|lcd|display"),
    ("a bigger central confirm button", r"central|confirm|\benter\b|\bok\b"), ("a recess for the thumb", r"thumb|recess|ergonomic|grip"),
    ("a built-in bottle opener", r"bottle|opener"), ("a one-touch weather channel", r"weather|channel"),
]
UPDATE_LEADS = ["Let's add {f}.", "We should add {f}.", "What about adding {f}?", "Can we add {f}?", "How about {f}?",
                "I'd like us to include {f}.", "We could include {f}.", "Why don't we add {f}?"]

# (a claim about progress, results or events, a regex over a series' decisions: if it matches, the claim touches a decision)
CLAIMS = [
    ("The supplier has confirmed it can deliver the casings within six weeks.", r"supplier|casing|\bcase\b|deliver"),
    ("The first prototype passed the one-metre drop test yesterday.", r"prototype|drop|shock"),
    ("Marketing says most customers prefer a glossy finish.", r"glossy|finish|marketing"),
    ("The focus group loved the first sketches.", r"focus|sketch"),
    ("Legal has not cleared the slogan yet.", r"slogan|legal"),
    ("The usability test showed that people find it easy to learn.", r"usability|learn|simple|easy"),
    ("Our main competitor is launching a similar product next spring.", r"competitor|launch"),
    ("The factory already has capacity booked for our first run.", r"factory|capacity|production"),
    ("The patent office has approved our button layout.", r"patent|button"),
    ("Last month's survey says nine in ten users lose their remote every week.", r"survey|lose|lost|locat|find|finder"),
    ("The test group found the prototype comfortable to hold.", r"test group|prototype|comfort|ergonomic|\bhand"),
    ("The retailer wants a first order of fifty thousand units.", r"retailer|order|units"),
    ("The prototype has been running for three days without a fault.", r"prototype"),
    ("The quote from the chip manufacturer came back this morning.", r"chip|manufacturer|quote"),
    ("The design team finished the first colour mock-ups on Tuesday.", r"mock|colou?r"),
    ("Customer service has already received complaints about the old model.", r"complaint|customer|service"),
    ("The safety lab has not signed off on the casing yet.", r"safety|\blab\b|casing|\bcase\b"),
    ("The advertising agency is preparing a campaign for the launch.", r"advertis|campaign|launch|marketing"),
    ("Three of the testers could not find the power button.", r"tester|power|button"),
    ("The packaging supplier is two weeks behind schedule.", r"packag|supplier"),
    ("The board has approved extra budget for tooling.", r"board|budget|tooling"),
    ("Sales expects strong demand over the holiday season.", r"sales|demand|holiday"),
    ("The manufacturer says the mould will be ready in March.", r"mou?ld|manufacturer|march"),
    ("Only two units out of five hundred came back from the pilot customers.", r"pilot|return"),
    ("The engineering lead says the circuit board is already in its second revision.", r"circuit|board|engineering|revision"),
    ("The distributor in Asia has asked for a sample next week.", r"distributor|asia|sample"),
    ("The reviewers at the trade fair gave the mock-up four stars.", r"trade fair|review|mock|stars"),
    ("The accounting team found a small error in last quarter's cost sheet.", r"accounting|cost sheet|\bcosts?\b|quarter"),
    ("The tooling vendor has not replied to our email since Monday.", r"tooling|vendor|email"),
    ("The pilot run finished two days earlier than planned.", r"pilot|run|planned"),
    ("Someone in procurement says the foam inserts are on back order.", r"procurement|foam|insert|order"),
    ("Our test lab measured a response time of under a second.", r"test lab|response|measured"),
    ("The translators have finished the first draft of the instructions.", r"translat|draft|instruction"),
    ("The photographer is booked for the product shoot on Thursday.", r"photograph|shoot"),
    ("Finance has already signed off on the second phase.", r"finance|phase|signed"),
    ("The warehouse can hold the first two thousand units.", r"warehouse|units"),
    ("The regulator in Germany has asked for an extra safety document.", r"regulator|germany|safety|document"),
    ("A journalist from a trade magazine called to ask about the launch.", r"journalist|magazine|trade|launch"),
    ("The first user interviews ran longer than expected.", r"interview|user"),
    ("The shipping company quoted a three-week transit time.", r"shipping|transit|quote"),
    ("The industrial designer has sent over the second batch of drawings.", r"drawing|batch|designer"),
    ("The pilot users reported no problems with the first batch.", r"pilot|batch|problem"),
    ("Quality control rejected one box out of every hundred last week.", r"quality|reject|\bbox\b"),
    ("The software team says the demo build is almost ready.", r"software|demo|build"),
    ("The tooling deposit has already been paid.", r"tooling|deposit|paid"),
    ("A large retailer has asked us for an exclusive colour.", r"retailer|exclusive|colou?r"),
    ("The pilot survey has just closed with three hundred answers.", r"survey|pilot|answers"),
    ("Our trademark application is still waiting for a decision.", r"trademark|application"),
    ("The sample units arrived late from the supplier.", r"sample|supplier|arriv"),
    ("The project manager from the other team has asked for a progress report.", r"project manager|progress|report"),
    ("The prototype box was crushed during the courier test.", r"prototype|\bbox\b|courier|crush"),
    ("A customer wrote to say her old remote still works after ten years.", r"customer|old remote|years"),
    ("The mould maker believes the first samples will be perfect.", r"mou?ld|sample|maker"),
    ("The cost estimate for the tooling came in last Friday.", r"tooling|estimate|\bcosts?\b"),
    ("The design review has been moved to the end of the month.", r"review|moved|month"),
    ("The new intern has finished cataloguing all the competitor remotes.", r"intern|competitor|catalogu"),
    ("The graphic designer is still waiting for the logo files.", r"graphic|logo|files"),
    ("Our proposal for the trade stand was accepted.", r"trade|stand|proposal"),
    ("The sound lab says the click of the buttons is quite loud.", r"sound|click|loud|button"),
    ("The pilot customers in Spain asked for a bigger instruction sheet.", r"spain|instruction|sheet|pilot"),
    ("The delivery truck for the samples broke down on the way.", r"delivery|truck|sample"),
    ("The pre-order page got two hundred visits on its first day.", r"pre-order|page|visits"),
    ("The line manager at the factory is on holiday until next week.", r"line manager|factory|holiday"),
    ("The humidity test results are expected on Wednesday.", r"humidity|test|results"),
    ("The usability lab has no free slot before the end of the month.", r"usability|\blab\b|slot"),
    ("Two of the product photos still need to be retouched.", r"photo|retouch"),
    ("The lawyers are reviewing the supplier contract this week.", r"lawyer|contract|supplier"),
    ("The data from the second field trial has been uploaded.", r"field trial|data|uploaded"),
    ("The final sample sheet from the printer was not what we ordered.", r"sample sheet|printer|ordered"),
]

CHATTER = [
    "Did anyone catch the match last night?", "It's freezing in here, can someone turn the heating up?", "Is there any coffee left?",
    "Sorry I'm late, the train was delayed again.", "Has anyone seen my pen?", "The weather is lovely today, isn't it?",
    "Could we open a window? It's very warm in this room.", "What is everyone having for lunch?", "I'm so tired, I barely slept last night.",
    "The projector keeps flickering.", "Who is bringing the biscuits next week?", "How was your weekend?", "I think it's going to rain this afternoon.",
    "Does anyone know where the whiteboard markers are?", "My bus was packed this morning.", "I'm thinking of taking up running.",
    "Is anyone watching that new series everyone is talking about?", "The air conditioning is far too loud.", "Is the cafeteria still open?",
    "I forgot my umbrella again.", "Anyone fancy a quick walk after this meeting?", "The sun is blinding me through that window.",
    "Where did you go on holiday in the end?", "I can't believe how busy the roads were today.", "Is it just me or is it really stuffy in here?",
    "My neighbour's dog barked all night.", "Let's grab a sandwich from the corner shop afterwards.", "Do you know if the printer is working again?",
    "That was a fantastic goal on Saturday.", "I'm trying to cut down on sugar this month.", "Who has a charger I can borrow for my laptop?",
    "It's supposed to snow on Friday, apparently.", "Happy birthday to Sam, by the way!", "My train pass runs out next week.",
    "Could someone close the door, there's a draught.", "I left my lunch in the fridge, please don't touch it.", "Did you see that crazy sunset last night?",
    "The lift is out of order again.", "I'm hopeless at parallel parking.", "Is anyone going to the gym later?", "We're out of tea bags in the kitchen.",
    "It was so windy on my way in.", "I really need a holiday.", "My phone battery died on the way here.", "The meeting room next door is far too small.",
    "I heard the new cafe on the corner is excellent.", "Did your team win the quiz last night?", "How is your garden doing this year?",
    "I think the heating just came on.", "What time does the canteen close today?", "Someone has taken my seat again.",
    "I'm baking a cake for the weekend.", "Did you manage to get tickets for the concert?", "Can you believe how early it gets dark now?",
    "That coffee machine is on its last legs.", "The carpet in this room is really loud.", "I'm completely out of milk at home.",
    "Is it lunch yet?", "My daughter starts school on Monday.", "The football on the radio this morning was terrible.",
    "Does anyone have a spare umbrella?", "I just saw the biggest rainbow outside.", "The room is a bit dim, can someone switch on the other light?",
    "Parking was a nightmare this morning.", "The pastries in the lobby smell amazing.", "I'm still jet-lagged from last week.",
    "Have you tried the soup in the canteen today?", "That clock on the wall is ten minutes slow.", "Let's keep an eye on the time, I have a call at four.",
    "I loved the film we saw on Sunday.", "My bike got a flat tyre on the way in.", "Is anyone else getting a lot of spam today?",
]


# --- one series ------------------------------------------------------------------------------------------

@dataclass
class Cand:
    decision: object
    attr: str
    statement: str
    method: str
    key: tuple  # what is being asserted; no two probes of a series may assert the same thing
    replaces: str | None = None
    detail: dict = field(default_factory=dict)


FRAMES = ["", "", "", "So ", "Right, ", "I think ", "Okay, ", "Well, "]  # neutral: the same set is used for every decision-based class


def framed(statement: str, rng: random.Random) -> str:
    frame = rng.choice(FRAMES)
    if frame == "I think " and (statement.endswith("?") or re.match(r"(I\b|I'|Let's|Why |What |How |Can |Could |Is |Did |Does |Do |Who |Anyone |Has )", statement)):
        frame = ""  # "I think why don't we ...?" is not English
    return tidy(frame + lower_first(statement)) if frame else statement


def series_view(decisions: list, superseded: set[str]):
    """Active decisions, their facts, and the attributes the series is not clear about (those are never used)."""
    active = [d for d in decisions if d.citation not in superseded]
    facts = {d.citation: facts_of(d.text) for d in decisions}
    values: dict[str, set[str]] = {}
    ambiguous: set[str] = set()
    for d in active:
        for attr in KEYWORD:
            got = facts[d.citation].get(attr)
            if got:
                values.setdefault(attr, set()).add(got)
            elif attr not in ("price", "cost", "profit", "market") and any(mentions(attr, c) for c in firm_clauses(d.text)):
                ambiguous.add(attr)
    ambiguous |= {attr for attr, found in values.items() if len(found) > 1}
    return active, facts, ambiguous


def mentions(attr: str, clause: str) -> bool:
    if not re.search(KEYWORD[attr], clause, re.I):
        return False
    if attr == "material":  # "rubber buttons" and "rubber skins" are not the case
        return bool(re.search(r"\b(case|casing|covered|shell|made (?:of|from)|materials?)\b", clause, re.I))
    return True


def candidates(decisions: list, superseded: set[str]):
    active, facts, ambiguous = series_view(decisions, superseded)
    text = " ".join(d.text.lower() for d in active)
    support, contradict, outdated = [], [], []

    def free(attr, value):  # nothing in the series mentions this value, so a statement about it cannot also be supported
        if attr in BOOLEAN:
            return True
        return not re.search(LEXICON[attr][value][2], text, re.I)

    for d in active:
        found = facts[d.citation]
        for attr, value in found.items():
            if attr in ambiguous or attr not in LEXICON or value not in LEXICON[attr]:
                continue
            for variant in LEXICON[attr][value][0]:
                support.append(Cand(d, attr, variant, "template", ("fact", attr, value), detail={"value": value}))
            for alt in ALTERNATIVES.get(attr, {}).get(value, []):
                if alt not in LEXICON[attr] or not free(attr, alt):
                    continue
                for variant in LEXICON[attr][alt][0]:
                    contradict.append(Cand(d, attr, variant, "value-swap", ("fact", attr, alt), detail={"value": value, "swapped_to": alt}))
                    if attr not in NO_SYNTHETIC_OLD:
                        outdated.append(Cand(d, attr, variant, "synthetic-supersession", ("fact", attr, alt), replaces=LEXICON[attr][alt][1],
                                             detail={"value": value, "old_value": alt}))
        sentence = core(d.text)
        if not sentence or facts_of(sentence):
            continue  # what a decision says about an attribute is only used in that attribute's wording
        if any(mentions(attr, clause) for attr in ambiguous for clause in firm_clauses(d.text)):
            continue  # and a decision about an attribute the series is unclear on is not used at all
        if len(sentence.split()) <= 18:
            support.append(Cand(d, "verbatim", sentence, "verbatim", ("text", sentence)))
        negated = negation_flip(d.text)
        if negated:
            flipped, replaces = negated
            contradict.append(Cand(d, "negation", flipped, "polarity-flip", ("text", flipped)))
            if replaces:
                outdated.append(Cand(d, "negation", flipped, "synthetic-supersession", ("text", flipped), replaces=replaces, detail={"old_value": "the ruled-out option"}))
        affirmed = affirmation_flip(d.text)
        if affirmed:
            contradict.append(Cand(d, "affirmation", affirmed, "polarity-flip", ("text", affirmed)))
    return support, contradict, outdated


def pick(cands: list[Cand], count: int, avoid: set[str], usage: Counter, series: str, taken_keys: set) -> list[Cand]:
    """Choose count candidates that assert something new in this series: different decisions and attributes where the
    series allows, and the attributes the whole dataset has used least, so that one kind of fact does not stand for it."""
    chosen: list[Cand] = []
    for _ in range(count):
        taken_decisions = {c.decision.citation for c in chosen}
        taken_attrs = {c.attr for c in chosen}
        open_ = [c for c in cands if c.key not in taken_keys]
        tiers = [
            [c for c in open_ if c.decision.citation not in avoid | taken_decisions and c.attr not in taken_attrs],
            [c for c in open_ if c.decision.citation not in taken_decisions and c.attr not in taken_attrs],
            [c for c in open_ if c.decision.citation not in taken_decisions],
            open_,
        ]
        pool = next((t for t in tiers if t), [])
        if not pool:
            break
        best = min(pool, key=lambda c: (usage[(c.attr, c.method == "verbatim")], stable(series, c.decision.citation, c.attr, c.statement)))
        chosen.append(best)
        taken_keys.add(best.key)
        usage[(best.attr, best.method == "verbatim")] += 1
    return chosen


def row(series: str, label: str, number: int, statement: str, citation: str | None) -> dict:
    return {"id": f"{series}-{CODES[label]}-{number:02d}", "series_id": series, "statement": statement, "gold_label": label,
            "gold_citation": f"[{citation}]" if citation else None, "expected_alert": label in ALERTS}


def build_series(name: str, decisions: list, usage: dict, pools: dict) -> tuple[list[dict], list[dict], dict]:
    rng = random.Random(stable("series", name))
    by_citation = {d.citation: d for d in decisions}
    rows, notes, superseded = [], [], set()
    real = REAL_SUPERSESSIONS.get(name, [])
    for old, new, statement, replaces in real:
        assert old in by_citation and new in by_citation, f"{name}: {old} or {new} is not a decision with evidence"
        assert (old[:7], old[8:]) < (new[:7], new[8:]), f"{name}: {old} must come before {new}"
        superseded.add(old)

    support, contradict, outdated = candidates(decisions, superseded)
    used: set[str] = {new for _, new, _, _ in real}
    taken_keys: set = {("text", statement) for _, _, statement, _ in real}

    outs = []  # (statement, citation, provenance)
    for old, new, statement, replaces in real:
        outs.append((framed(statement, rng), new, {"basis": "real-supersession", "method": "replaced-decision", "decision": new, "old_decision": old,
                                                      "old_text": by_citation[old].text, "replaces": replaces}))
    for c in pick(outdated, PER_CLASS - len(real), used, usage["O"], name, taken_keys):
        outs.append((framed(c.statement, rng), c.decision.citation, {"basis": "synthetic-supersession", "method": c.method, "attribute": c.attr,
                                                                    "decision": c.decision.citation, "replaces": c.replaces, **c.detail}))
    used |= {o[1] for o in outs}

    cons = pick(contradict, PER_CLASS, used, usage["C"], name, taken_keys)
    used |= {c.decision.citation for c in cons}
    sups = pick(support, PER_CLASS, used, usage["S"], name, taken_keys)
    if len(outs) < PER_CLASS or len(cons) < PER_CLASS or len(sups) < PER_CLASS:
        raise RuntimeError(f"{name}: only {len(sups)} supported, {len(outs)} outdated, {len(cons)} contradicts candidates")

    provenance = []
    for n, c in enumerate(sups, 1):
        rows.append(row(name, "SUPPORTED_CURRENT", n, framed(c.statement, rng), c.decision.citation))
        provenance.append({"basis": "restatement", "method": c.method, "attribute": c.attr, "decision": c.decision.citation, "decision_text": c.decision.text})
    for n, (statement, citation, info) in enumerate(outs, 1):
        rows.append(row(name, "OUTDATED", n, statement, citation))
        provenance.append({**info, "decision_text": by_citation[citation].text})
    for n, c in enumerate(cons, 1):
        rows.append(row(name, "CONTRADICTS", n, framed(c.statement, rng), c.decision.citation))
        provenance.append({"basis": c.method, "method": c.method, "attribute": c.attr, "decision": c.decision.citation, "decision_text": c.decision.text, **c.detail})

    text = " ".join(d.text.lower() for d in decisions)
    for label, source in (("UPDATES", "update"), ("INSUFFICIENT_EVIDENCE", "claim"), ("IRRELEVANT", "chatter")):
        pool = pools[source]
        taken = []
        for index in list(pool["order"]):
            if index in pool["used"]:
                continue
            tags = pool["tags"][index]
            if tags and re.search(tags, text):
                continue
            taken.append(index)
            pool["used"].add(index)
            if len(taken) == PER_CLASS:
                break
        if len(taken) < PER_CLASS:
            raise RuntimeError(f"{name}: the {label} pool ran out")
        for n, index in enumerate(taken, 1):
            statement = framed(pool["text"](index, rng), rng)  # the same frames as the decision-based classes, so a frame says nothing about the class
            rows.append(row(name, label, n, statement, None))
            provenance.append({"basis": "pool", "method": source, "pool_index": index})

    old_citations = sorted(superseded)
    replaced = {}
    for r, p in zip(rows, provenance):
        if r["gold_label"] == "OUTDATED":
            replaced.setdefault(p["decision"], []).append(p["replaces"])
    order = [CLASSES.index(r["gold_label"]) for r in rows]
    ranked = sorted(range(len(rows)), key=lambda i: (order[i], rows[i]["id"]))
    rows = [rows[i] for i in ranked]
    provenance = [{"id": rows[k]["id"], **provenance[i]} for k, i in enumerate(ranked)]
    return rows, provenance, {"replaced": replaced, "dropped": old_citations}


def make_pools(seed: int = SEED) -> dict:
    rng = random.Random(seed)
    updates = [(f, t) for f, t in FEATURES]
    claims = list(CLAIMS)
    chatter = [(c, "") for c in CHATTER]
    pools = {}
    for source, items, text in (
        ("update", updates, lambda i, r: UPDATE_LEADS[stable("lead", i) % len(UPDATE_LEADS)].format(f=updates[i][0])),
        ("claim", claims, lambda i, r: claims[i][0]),
        ("chatter", chatter, lambda i, r: chatter[i][0]),
    ):
        order = list(range(len(items)))
        rng.shuffle(order)
        pools[source] = {"order": order, "used": set(), "tags": [t for _, t in items], "text": text}
    return pools


def memory_text(decisions: list, replaced: dict[str, list[str]], dropped: list[str]) -> str:
    """decisions.md as the auditor should read a series: the replaced decisions gone (the way Memoria's approval step
    drops them) and each replacing decision carrying its "(replaces ...)" note."""
    lines = []
    for d in decisions:
        if d.citation in dropped:
            continue
        note = f" (replaces {'; '.join(replaced[d.citation])})" if d.citation in replaced else ""
        lines.append(f"- [{d.citation}] {d.text}{note}")
    return "\n".join(lines) + "\n"


def memory_for(series: str, decisions: list, rows: list[dict], provenance: list[dict]) -> str:
    """decisions.md for one series as an auditor should read it, from the dataset's own provenance: what a probe of the
    series asserts as replaced is in a "(replaces ...)" note, and a real replaced decision is no longer listed."""
    by_id = {p["id"]: p for p in provenance}
    replaced: dict[str, list[str]] = {}
    dropped: set[str] = set()
    for r in rows:
        if r["series_id"] == series and r["gold_label"] == "OUTDATED":
            p = by_id[r["id"]]
            replaced.setdefault(p["decision"], []).append(p["replaces"])
            if p["basis"] == "real-supersession":
                dropped.add(p["old_decision"])
    return memory_text(decisions, replaced, sorted(dropped))


# --- the dataset --------------------------------------------------------------------------------------------

def load_history() -> dict[str, list]:
    """{test series: its decisions with evidence}, from meetings a-c only."""
    return {name: list(Series(name, history_only=True).decisions) for name in test_series()}


def build(history: dict[str, list] | None = None, pools_seed: int = SEED) -> tuple[list[dict], list[dict], dict[str, dict], dict[str, list]]:
    history = history or load_history()
    usage = {k: Counter() for k in "SOC"}
    pools = make_pools(pools_seed)
    rows, provenance, memory = [], [], {}
    for name in sorted(history):
        r, p, m = build_series(name, history[name], usage, pools)
        rows += r
        provenance += p
        memory[name] = m
    return rows, provenance, memory, history


def write_lines(path: Path, items: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    scratch = path.with_name(path.name + ".tmp")
    scratch.write_bytes(serialise(items))
    scratch.replace(path)


def serialise(items: list[dict]) -> bytes:
    return "".join(json.dumps(item, ensure_ascii=False) + "\n" for item in items).encode("utf-8")


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="Generate data/memoria_bench.jsonl")
    parser.add_argument("--force", action="store_true", help="replace a dataset that has already been frozen")
    parser.add_argument("--verify", action="store_true", help="regenerate in memory and say whether the files on disk are byte for byte the same")
    parser.add_argument("--dev", action="store_true", help="make the development set (5 series x 12) that baselines are tuned on, instead of the benchmark")
    args = parser.parse_args(argv)
    if args.dev:
        history = {name: list(Series(name, history_only=True).decisions) for name in DEV_SERIES}
        rows, provenance, _, _ = build(history, pools_seed=SEED + 1)  # other pool items than the benchmark's, so no probe is shared
        write_lines(DEV_PROVENANCE_FILE, provenance)
        write_lines(DEV_FILE, rows)
        print(f"Development set: {len(rows)} probes on {', '.join(DEV_SERIES)} -> {DEV_FILE.relative_to(HERE)} (not frozen; never part of the benchmark)")
        return 0
    if args.verify:
        rows, provenance, _, _ = build()
        same = BENCH_FILE.read_bytes() == serialise(rows) and PROVENANCE_FILE.read_bytes() == serialise(provenance)
        print("The files on disk are exactly what this script generates." if same else "The files on disk differ from what this script generates.")
        return 0 if same else 1
    if HASH_FILE.exists() and BENCH_FILE.exists() and not args.force:
        print(f"{BENCH_FILE.name} is frozen ({HASH_FILE.name} exists). Pass --force to replace it, then run validate_bench.py --refreeze.", file=sys.stderr)
        return 1
    print("[MemoriaBench Generation]")
    rows, provenance, memory, history = build()
    print(f"  ├── Processing {len(history)} AMI test series (history only: meetings a, b, c; meeting d is never opened)...")
    print(f"  ├── Extracted {sum(len(v) for v in history.values())} approved decisions from meetings a, b, c")
    write_lines(PROVENANCE_FILE, provenance)
    write_lines(BENCH_FILE, rows)
    basis = Counter(p["basis"] for p, r in zip(provenance, rows) if r["gold_label"] == "OUTDATED")
    print(f"  ├── OUTDATED rests on a replaced decision in the annotations for {basis['real-supersession']} items; the other {basis['synthetic-supersession']} use a synthetic replacement note")
    print(f"  └── Generated {len(rows)} probe statements -> saved to {BENCH_FILE.relative_to(HERE)} (how each was made: {PROVENANCE_FILE.relative_to(HERE)})")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

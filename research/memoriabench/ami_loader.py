"""MemoriaBench loader: the AMI Meeting Corpus as approved memory and as a live meeting.

An AMI scenario series is four meetings, a to d, held by the same team on the same project. For a series,
meetings a, b and c are history: their human-written summary decisions become approved memory (decisions.md),
each cited to the moment in the meeting it rests on. Meeting d is the live meeting: only its plain transcript
is read, as a stream of timestamped utterances, the way a speech recogniser would deliver it.

The rule that keeps the benchmark honest, no look-ahead, is enforced by construction. All reading goes through
two readers. The memory reader will not open anything about meeting d. The live reader will open nothing about
meeting d except its words and segments: no summaries, no topics, no decisions. Both raise LookaheadError, and
a Decision for meeting d cannot even be constructed.

The development series load in full. The unseen-test series (every other complete scenario series) open for
history only, which is what building the frozen MemoriaBench needs: their meeting d cannot be opened by any
code path, so nothing about how those series end can leak into the questions asked about them.

Source: AMI Meeting Corpus manual annotations 1.6.2 (Carletta et al., 2005), CC BY 4.0,
https://groups.inf.ed.ac.uk/ami/corpus/. Downloaded once, checked against a pinned SHA-256 and cached outside
the project (the project folder is backed up to git, and the corpus is 23 MB).

Run: python3.11 ami_loader.py [SERIES]   (seeds decisions.md from the series; the old file is kept once)
"""

import hashlib
import os
import re
import shutil
import sys
import time
import urllib.error
import urllib.request
import zipfile
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Iterator

AMI_URL = "https://groups.inf.ed.ac.uk/ami/AMICorpusAnnotations/ami_public_manual_1.6.2.zip"
AMI_BYTES = 22_887_865
AMI_SHA256 = "b56e5babb2496b8795deeeda7e71178d7fbc9963f94276cf2a3f4b56ebbc9f9d"  # of the file served on 15 Oct 2026
CACHE_DIR = "~/Library/Caches/Memoria/ami"  # override with MEMORIA_AMI_DIR

DEV_SERIES = ("ES2003", "ES2011", "IS1008", "TS3004", "TS3006")  # the official AMI development series
MEMORY_MEETINGS = "abc"
LIVE_MEETING = "d"
SPEAKERS = "ABCD"
DECISIONS_FILE = "decisions.md"  # as in memoria.py, which is not imported here: that would load the model libraries
BACKUP_FILE = "decisions.before-ami.md"
NS = "{http://nite.sourceforge.net/}"
_STOP = frozenset("the a an to of and or in on for will be is are it that this with as at by from have has we".split())


def scenario_series(archive: zipfile.ZipFile) -> dict[str, str]:
    """{series: the meeting letters the corpus has summaries for}, from the file names alone; nothing is opened."""
    found: dict[str, str] = {}
    for member in archive.namelist():
        match = re.fullmatch(r"abstractive/((?:ES|IS|TS)\d{4})([a-d])\.abssumm\.xml", member)
        if match:
            found[match.group(1)] = "".join(sorted(found.get(match.group(1), "") + match.group(2)))
    return found


def test_series(archive: zipfile.ZipFile | None = None) -> tuple[str, ...]:
    """The unseen-test series: every scenario series with all four meetings that is not a development series.
    (IS1002 has no meeting a and IS1005 no meeting d, so neither can make a history-and-live pair.)"""
    own = archive is None
    archive = archive or zipfile.ZipFile(ensure_corpus())
    try:
        return tuple(sorted(name for name, letters in scenario_series(archive).items() if letters == "abcd" and name not in DEV_SERIES))
    finally:
        if own:
            archive.close()


class LookaheadError(Exception):
    """Something about a meeting that has not happened yet was about to be read or remembered."""


# --- the corpus file -------------------------------------------------------------------------------


def cache_path() -> Path:
    return Path(os.environ.get("MEMORIA_AMI_DIR") or CACHE_DIR).expanduser() / Path(AMI_URL).name


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def _intact(path: Path) -> bool:
    return path.is_file() and path.stat().st_size == AMI_BYTES and _sha256(path) == AMI_SHA256


def ensure_corpus(progress: Callable[[int, int], None] | None = None) -> Path:
    """The path of the corpus zip, downloading it first if it is not cached. Whatever is returned has been
    checked against the pinned size and SHA-256, so a truncated or changed file is never read."""
    target = cache_path()
    if _intact(target):
        return target
    target.parent.mkdir(parents=True, exist_ok=True)
    scratch = target.with_name(target.name + ".part")
    try:
        request = urllib.request.Request(AMI_URL, headers={"User-Agent": "MemoriaBench/1.0"})
        with urllib.request.urlopen(request, timeout=60) as response, open(scratch, "wb") as out:
            total, done = int(response.headers.get("Content-Length") or AMI_BYTES), 0
            for block in iter(lambda: response.read(1 << 18), b""):
                out.write(block)
                done += len(block)
                if progress:
                    progress(done, total)
    except (urllib.error.URLError, TimeoutError, OSError) as error:
        scratch.unlink(missing_ok=True)
        raise RuntimeError(f"could not download the AMI corpus from {AMI_URL} ({error}). Download it by hand and "
                           f"save it as {target}") from error
    if not _intact(scratch):
        found = (scratch.stat().st_size, _sha256(scratch))
        scratch.unlink(missing_ok=True)
        raise RuntimeError(f"the downloaded corpus is not the file this benchmark is pinned to: expected "
                           f"{AMI_BYTES} bytes and sha256 {AMI_SHA256}, got {found[0]} bytes and {found[1]}")
    os.replace(scratch, target)
    return target


# --- the two readers: this is where look-ahead is made impossible ----------------------------------


class _Reader:
    """Opens members of the corpus zip, but only the ones this role is allowed to see, and remembers which."""

    def __init__(self, archive: zipfile.ZipFile, role: str, allowed: re.Pattern) -> None:
        self._archive, self.role, self._allowed = archive, role, allowed
        self._present = frozenset(archive.namelist())
        self.opened: list[str] = []

    def has(self, member: str) -> bool:
        """Whether this role may open it and the corpus has it (a few annotation files are missing)."""
        return bool(self._allowed.fullmatch(member)) and member in self._present

    def read(self, member: str) -> bytes:
        if not self._allowed.fullmatch(member):
            raise LookaheadError(f"the {self.role} reader may not open {member}")
        self.opened.append(member)
        return self._archive.read(member)


def _memory_pattern(series: str) -> re.Pattern:
    """History: meetings a-c of this series, and nothing at all about d."""
    kinds = r"(?:words|segments|dialog-act|abssumm|summlink)"
    return re.compile(rf"(?:(?:words|segments|dialogueActs|abstractive|extractive)/{series}[{MEMORY_MEETINGS}](?:\.[A-D])?\.{kinds}\.xml"
                      rf"|corpusResources/meetings\.xml)")


def _live_pattern(series: str) -> re.Pattern:
    """The live meeting: its plain transcript, as speech recognition would give it, and who sits where."""
    return re.compile(rf"(?:(?:words|segments)/{series}{LIVE_MEETING}\.[A-D]\.(?:words|segments)\.xml|corpusResources/meetings\.xml)")


# --- reading the transcript ------------------------------------------------------------------------


@dataclass(frozen=True)
class _Token:
    tag: str  # w, vocalsound, gap or disfmarker
    start: float
    end: float
    text: str
    punc: bool


class _Words:
    """One speaker's words in one meeting, in the order the transcribers made them."""

    def __init__(self, xml: bytes) -> None:
        self.tokens: dict[str, _Token] = {}
        for element in ET.fromstring(xml):
            identifier = element.get(NS + "id")
            if identifier:
                self.tokens[identifier] = _Token(
                    element.tag,
                    float(element.get("starttime", "nan")),
                    float(element.get("endtime", "nan")),
                    (element.text or "").strip(),
                    element.get("punc") == "true",
                )
        self._position = {identifier: i for i, identifier in enumerate(self.tokens)}
        self._order = list(self.tokens)

    def span(self, href: str) -> list[_Token]:
        """The tokens a pointer such as 'X.words.xml#id(words5)..id(words14)' covers."""
        found = re.search(r"id\(([^)]*)\)(?:\.\.id\(([^)]*)\))?", href)
        first, last = found.group(1), found.group(2) or found.group(1)
        return [self.tokens[i] for i in self._order[self._position[first] : self._position[last] + 1]]


def _spell(word: str) -> str:
    """The corpus writes spelled-out letters as T_V_ or L_C_D_; a recogniser would say TV and LCD."""
    return re.sub(r"(?<=[A-Za-z])_(?=[A-Za-z']|$)", "", word)  # also TV_'s, the possessive


def _say(tokens: list[_Token]) -> str:
    """The words of a span as one clean line: no noises, gaps or false starts, punctuation tight to the word."""
    words: list[str] = []
    for token in tokens:
        if token.tag != "w":
            continue
        if token.punc:
            if words:
                words[-1] += token.text
        else:
            words.append(_spell(token.text))
    return " ".join(words)


def _spoken(tokens: list[_Token]) -> tuple[float, float] | None:
    """When the words of a span were spoken: from the start of the first to the end of the last."""
    timed = [t for t in tokens if t.tag == "w" and not t.punc and t.start == t.start]
    return (min(t.start for t in timed), max(t.end for t in timed)) if timed else None


def _roles(reader: _Reader) -> dict[str, dict[str, str]]:
    """{'ES2003a': {'A': 'UI', 'B': 'PM', ...}}: who sits where, which is known before a meeting starts."""
    roles: dict[str, dict[str, str]] = {}
    for meeting in ET.fromstring(reader.read("corpusResources/meetings.xml")).iter("meeting"):
        roles[meeting.get("observation")] = {s.get("nxt_agent"): s.get("role") for s in meeting.iter("speaker")}
    return roles


def _utterances(reader: _Reader, meeting: str, roles: dict[str, str], min_words: int = 1) -> list[dict]:
    """Every utterance of a meeting, from the transcribers' own segmentation, in the order it was spoken."""
    found = []
    for speaker in SPEAKERS:
        words = _Words(reader.read(f"words/{meeting}.{speaker}.words.xml"))
        for segment in ET.fromstring(reader.read(f"segments/{meeting}.{speaker}.segments.xml")):
            child = segment.find(NS + "child")
            tokens = words.span(child.get("href")) if child is not None else []
            text = _say(tokens)
            if len(text.split()) < min_words:
                continue
            start, end = _spoken(tokens) or (float(segment.get("transcriber_start")), float(segment.get("transcriber_end")))
            found.append({"meeting": meeting, "speaker": speaker, "role": roles.get(speaker, ""), "start": start, "end": end, "text": text})
    return sorted(found, key=lambda u: (u["start"], u["end"], u["speaker"]))


# --- the decisions ---------------------------------------------------------------------------------


@dataclass(frozen=True)
class Link:
    """An utterance that the annotators tied to a decision."""

    speaker: str
    role: str
    start: float
    end: float
    text: str


@dataclass(frozen=True)
class Decision:
    """One approved decision: the annotators' sentence, and the moment in the meeting that it rests on."""

    meeting: str  # such as ES2003b
    number: int  # its place among that meeting's decisions, from 1
    text: str
    citation: str  # such as ES2003b:28:58; a second decision from the same moment gets #2, and so on
    evidence: tuple[Link, ...]  # every utterance the annotators linked to it, earliest first
    cited: Link  # the one the citation points at

    def __post_init__(self) -> None:
        if self.meeting[-1] not in MEMORY_MEETINGS:
            raise LookaheadError(f"{self.meeting} is not history: only meetings {', '.join(MEMORY_MEETINGS)} may become memory")

    @property
    def line(self) -> str:
        return f"- [{self.citation}] {self.text}"


def _stamp(seconds: float) -> str:
    minutes, rest = divmod(int(seconds), 60)
    return f"{minutes:02d}:{rest:02d}"


def _content(text: str) -> set[str]:
    return {word for word in re.findall(r"[a-z0-9]+", text.lower()) if word not in _STOP}


def _decision_sentences(reader: _Reader, meeting: str) -> list[str]:
    root = ET.fromstring(reader.read(f"abstractive/{meeting}.abssumm.xml"))
    sentences = [" ".join("".join(s.itertext()).split()) for block in root.iter("decisions") for s in block.iter("sentence")]
    return [s if s.endswith((".", "!", "?")) else s + "." for s in sentences if s]


def _decision_evidence(reader: _Reader, meeting: str, roles: dict[str, str]) -> dict[int, list[Link]]:
    """{decision number: its linked utterances}, from the human links between summary sentences and dialogue acts."""
    sentence_ids = [
        s.get(NS + "id")
        for block in ET.fromstring(reader.read(f"abstractive/{meeting}.abssumm.xml")).iter("decisions")
        for s in block.iter("sentence")
        if "".join(s.itertext()).strip()
    ]
    words, acts = {}, {}
    for speaker in SPEAKERS:
        words[speaker] = _Words(reader.read(f"words/{meeting}.{speaker}.words.xml"))
        for act in ET.fromstring(reader.read(f"dialogueActs/{meeting}.{speaker}.dialog-act.xml")):
            child = act.find(NS + "child")
            if child is not None:
                acts[act.get(NS + "id")] = (speaker, child.get("href"))

    by_sentence: dict[str, dict[tuple[str, float], Link]] = {}
    links_file = f"extractive/{meeting}.summlink.xml"  # TS3012c has none: its decisions then have no evidence and are left out
    for link in ET.fromstring(reader.read(links_file)) if reader.has(links_file) else ():
        pointers = {p.get("role"): p.get("href") for p in link.findall(NS + "pointer")}
        if "extractive" not in pointers or "abstractive" not in pointers:
            continue
        act = acts.get(re.search(r"id\(([^)]*)\)", pointers["extractive"]).group(1))
        if act is None:
            continue
        speaker, href = act
        tokens = words[speaker].span(href)
        spoken, text = _spoken(tokens), _say(tokens)
        if spoken and text:
            sentence = re.search(r"id\(([^)]*)\)", pointers["abstractive"]).group(1)
            by_sentence.setdefault(sentence, {})[(speaker, spoken[0])] = Link(speaker, roles.get(speaker, ""), spoken[0], spoken[1], text)
    return {number: sorted(by_sentence.get(identifier, {}).values(), key=lambda l: l.start) for number, identifier in enumerate(sentence_ids, 1)}


# --- a series --------------------------------------------------------------------------------------


class Series:
    """A series: meetings a-c as approved memory, meeting d as a live stream (development series only).
    An unseen-test series opens with history_only=True and then has no live meeting at all."""

    def __init__(self, name: str, history_only: bool = False) -> None:
        if not re.fullmatch(r"(?:ES|IS|TS)\d{4}", name):
            raise ValueError(f"{name!r} is not a development series; MemoriaBench loads {', '.join(DEV_SERIES)}")
        self._archive = zipfile.ZipFile(ensure_corpus())
        if name not in DEV_SERIES:
            tests = test_series(self._archive)
            if name not in tests:
                self._archive.close()
                raise ValueError(f"{name!r} is not a development series; MemoriaBench loads {', '.join(DEV_SERIES)}")
            if not history_only:
                self._archive.close()
                raise ValueError(f"{name!r} is an unseen test series: it opens for history only (history_only=True), never as a live meeting")
        self.name = name
        self.history_only = history_only
        self._memory = _Reader(self._archive, "memory", _memory_pattern(name))
        self._live = _Reader(self._archive, "live", re.compile(r"(?!)") if history_only else _live_pattern(name))  # (?!) matches nothing
        self.roles = _roles(self._memory)
        self.decisions: list[Decision] = []
        self.skipped: list[tuple[str, int, str]] = []  # (meeting, number, sentence): annotators gave it no evidence
        self._read_memory()

    @property
    def memory_reads(self) -> list[str]:
        return list(self._memory.opened)

    @property
    def live_reads(self) -> list[str]:
        return list(self._live.opened)

    def _read_memory(self) -> None:
        taken: dict[str, int] = {}
        for letter in MEMORY_MEETINGS:
            meeting = self.name + letter
            roles = self.roles[meeting]
            sentences = _decision_sentences(self._memory, meeting)
            evidence = _decision_evidence(self._memory, meeting, roles)
            for number, sentence in enumerate(sentences, 1):
                links = evidence[number]
                if not links:  # nothing to cite, so it cannot be verified memory
                    self.skipped.append((meeting, number, sentence))
                    continue
                wanted = _content(sentence)
                cited = max(links, key=lambda link: (len(wanted & _content(link.text)), -link.start))
                base = f"{meeting}:{_stamp(cited.start)}"
                taken[base] = taken.get(base, 0) + 1
                citation = base if taken[base] == 1 else f"{base}#{taken[base]}"
                self.decisions.append(Decision(meeting, number, sentence, citation, tuple(links), cited))

    def memory_text(self) -> str:
        """decisions.md as the auditor reads it: one cited bullet per decision, oldest first."""
        return "".join(decision.line + "\n" for decision in self.decisions)

    def write_memory(self, decisions_file: str | os.PathLike = DECISIONS_FILE) -> Path:
        """Replace the decisions file with this series' memory. Written whole and swapped in, so a reader
        (the HUD, the MCP server) sees the old file or the new one, never half of either."""
        path = Path(__file__).parent / decisions_file  # a relative name lives next to the code, as in memoria.py
        scratch = path.with_name(path.name + ".tmp")
        scratch.write_text(self.memory_text(), encoding="utf-8")
        os.replace(scratch, path)
        return path

    def transcript(self, letter: str, min_words: int = 1) -> list[dict]:
        """A meeting that has already happened, as utterances. Meeting d is refused."""
        return _utterances(self._memory, self.name + letter, self.roles.get(self.name + letter, {}), min_words)

    def live_stream(self, realtime: bool = False, speed: float = 1.0, min_words: int = 1) -> Iterator[dict]:
        """The live meeting: its utterances in the order they were spoken, each as
        {"meeting", "speaker", "role", "start", "end", "text"} with times in seconds from the start of the recording
        (the shape audio.py yields, plus who spoke). With realtime, each arrives when it would have been spoken,
        divided by speed. Only the plain transcript of meeting d is read; nothing the annotators wrote about it."""
        meeting = self.name + LIVE_MEETING
        utterances = _utterances(self._live, meeting, _roles(self._live).get(meeting, {}), min_words)
        started = time.monotonic()
        for utterance in utterances:
            if realtime:
                time.sleep(max(0.0, started + utterance["start"] / speed - time.monotonic()))
            yield utterance


def load_series(name: str, decisions_file: str | os.PathLike | None = None) -> Series:
    """Load a development series. With decisions_file, its memory is written there as well."""
    series = Series(name)
    if decisions_file is not None:
        series.write_memory(decisions_file)
    return series


# --- command line ----------------------------------------------------------------------------------


def _bar(done: int, total: int) -> None:
    sys.stderr.write(f"\r  downloading the AMI corpus: {done / 1e6:5.1f} of {total / 1e6:.1f} MB")
    if done >= total:
        sys.stderr.write("\n")


def main(argv: list[str]) -> int:
    name = argv[0] if argv else DEV_SERIES[0]
    try:
        ensure_corpus(_bar)
        series = load_series(name)
    except (ValueError, RuntimeError) as error:
        print(f"ami_loader: {error}", file=sys.stderr)
        return 1
    target = Path(__file__).parent / DECISIONS_FILE
    backup = target.with_name(BACKUP_FILE)
    if target.exists() and target.read_text(encoding="utf-8") != series.memory_text() and not backup.exists():
        shutil.copy2(target, backup)  # once: the first memory you had is the one worth keeping
        print(f"  ├── Kept your previous {DECISIONS_FILE} as {BACKUP_FILE}")
    series.write_memory()
    print(f"  ├── Loaded series '{name}' (Meetings {', '.join(MEMORY_MEETINGS)} -> Memory; Meeting {LIVE_MEETING} -> Live Stream)")
    print(f"  ├── Seeded {DECISIONS_FILE} with {len(series.decisions)} approved decisions from {name}{MEMORY_MEETINGS[0]}-{MEMORY_MEETINGS[-1]}")
    for meeting, number, sentence in series.skipped:
        print(f"  ├── Left out {meeting} decision {number}, which the annotators gave no evidence: {sentence}")
    stream = series.live_stream()
    first = next(stream)
    count = 1 + sum(1 for _ in stream)
    print(f"  └── {name}{LIVE_MEETING} is the live meeting: {count} utterances, the first at {first['start']:.1f}s: {first['text']!r}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

"""MemoriaBench loader test: the real AMI corpus as memory and as a live meeting.

For the development series ES2003 (and a parse check of the other four):
  - meetings a-c become cited approved decisions in decisions.md,
  - meeting d streams as timestamped utterances,
  - nothing about meeting d reaches memory (no look-ahead), proven four ways,
  - the auditor, reading that memory, passes a historical fact and flags a contradicted one, citing the decision.

Run: python3.11 test_ami_loader.py   (downloads the 23 MB corpus once; rewrites decisions.md and then restores it)
"""

import re
import sys
import tempfile
import time
import xml.etree.ElementTree as ET
from pathlib import Path

import ami_loader
from ami_loader import DEV_SERIES, LookaheadError, Series, ensure_corpus
from memoria import active_decisions, check_statement

DECISIONS = Path(__file__).with_name("decisions.md")
NS = ami_loader.NS
CITATION = re.compile(r"[A-Z]{2}\d{4}[abc]:\d{2}:\d{2}(?:#\d+)?")
BULLET = re.compile(r"- \[([^\[\]]+)\] (.+)")

HISTORICAL = "We agreed the remote will be sold for 25 euros."  # ES2003a: "The remote will sell for 25 Euro."
CONTRADICTED = "We will sell the remote for 30 euros."  # contradicts the same decision

passed: list[str] = []


def check(name: str, condition: bool, detail: object = "") -> None:
    assert condition, f"{name}: {detail}"
    passed.append(name)


def parse_memory(text: str) -> list[tuple[str, str]]:
    return [m.groups() for line in text.splitlines() if (m := BULLET.fullmatch(line))]


def future_sentences(series: Series) -> list[str]:
    """The decisions of the live meeting, which only a test may read: the answer key to what must not leak."""
    archive = series._archive
    root = ET.fromstring(archive.read(f"abstractive/{series.name}d.abssumm.xml"))
    return [" ".join("".join(s.itertext()).split()) for block in root.iter("decisions") for s in block.iter("sentence")]


# ------------------------------------------------------------------ the loader, without a model


def unit_checks() -> None:
    check("spelled-out letters read as a recogniser would say them", [ami_loader._spell(w) for w in ("T_V_", "L_C_D_", "TV_'s", "don't")] == ["TV", "LCD", "TV's", "don't"])
    check("a citation timestamp is minutes and seconds", [ami_loader._stamp(s) for s in (0, 59.9, 60, 687.4, 3600)] == ["00:00", "00:59", "01:00", "11:27", "60:00"])
    for meeting in ("ES2003d", "ES2011d"):
        try:
            ami_loader.Decision(meeting, 1, "x.", f"{meeting}:00:01", (), None)
        except LookaheadError:
            passed.append(f"a decision for {meeting} cannot be built")
        else:
            raise AssertionError(f"a decision for {meeting} was built")
    for name in ("nonsense", "", "ES20040", "es2004"):
        try:
            Series(name)
        except ValueError:
            passed.append(f"{name or 'an empty name'!r} is not a series")
        else:
            raise AssertionError(f"{name!r} was loaded")
    check("the five development series are AMI's scenario-only development partition (SB)", DEV_SERIES == ("ES2003", "ES2011", "IS1008", "TS3004", "TS3006"), DEV_SERIES)


def corpus_checks() -> Series:
    path = ensure_corpus()
    check("the corpus on disk is the pinned file", path.stat().st_size == ami_loader.AMI_BYTES and ami_loader._sha256(path) == ami_loader.AMI_SHA256)
    check("it is cached outside the project, which is backed up to git", Path(__file__).parent not in path.parents, path)

    with tempfile.TemporaryDirectory() as scratch:  # the download path itself: a wrong file is refused, never read
        original, ami_loader.AMI_SHA256 = ami_loader.AMI_SHA256, "0" * 64
        try:
            import os

            os.environ["MEMORIA_AMI_DIR"] = scratch
            Path(scratch, Path(ami_loader.AMI_URL).name).write_bytes(b"not the corpus")
            try:
                ami_loader.ensure_corpus()
            except RuntimeError as error:
                check("a file that is not the pinned corpus is refused", "pinned to" in str(error) or "could not download" in str(error), error)
            else:
                raise AssertionError("a wrong corpus was accepted")
            check("and nothing half-downloaded is left behind", not [p for p in Path(scratch).iterdir() if p.name.endswith(".part")], list(Path(scratch).iterdir()))
        finally:
            ami_loader.AMI_SHA256 = original
            os.environ.pop("MEMORIA_AMI_DIR", None)
    return Series("ES2003")


def decision_checks(series: Series) -> list[ami_loader.Decision]:
    decisions = series.decisions
    check("at least 5 decisions come from ES2003a-c", len(decisions) >= 5, len(decisions))
    check("they come from all three meetings", {d.meeting for d in decisions} == {"ES2003a", "ES2003b", "ES2003c"}, {d.meeting for d in decisions})
    check("the text is the annotators' own, and unchanged", [d.text for d in decisions][:2] == ["The remote will cost 12.50 Euro to produce.", "The remote will sell for 25 Euro."], [d.text for d in decisions][:2])
    check("every citation is meeting:minutes:seconds", all(CITATION.fullmatch(d.citation) for d in decisions), [d.citation for d in decisions])
    check("every citation is unique, so each decision can be told apart", len({d.citation for d in decisions}) == len(decisions), [d.citation for d in decisions])
    check("a decision from the same moment gets a numbered citation", any("#2" in d.citation for d in decisions) and any("#3" in d.citation for d in decisions), [d.citation for d in decisions if "#" in d.citation])
    check("decisions are in the order the meetings happened", [d.citation.split("#")[0] for d in decisions] == sorted(d.citation.split("#")[0] for d in decisions), [d.citation for d in decisions])
    check("every decision rests on at least one real utterance, with a speaker and a role", all(d.evidence and d.cited in d.evidence and d.cited.text and d.cited.role in {"PM", "UI", "ID", "ME"} for d in decisions))
    check("the cited utterance is the one the citation's timestamp names", all(ami_loader._stamp(d.cited.start) == d.citation.split("#")[0].split(":", 1)[1] for d in decisions),
          [(d.citation, ami_loader._stamp(d.cited.start)) for d in decisions if ami_loader._stamp(d.cited.start) != d.citation.split("#")[0].split(":", 1)[1]][:3])
    check("a decision the annotators gave no evidence is left out, and reported", [(m, n) for m, n, _ in series.skipped] == [("ES2003b", 7)] and all(d.text != series.skipped[0][2] for d in decisions), series.skipped)
    return decisions


def evidence_checks(series: Series, decisions: list[ami_loader.Decision]) -> None:
    """Each citation must point at speech that really happened. Checked against the transcribers' own segments,
    a different layer of the corpus from the dialogue acts the citations were computed from."""
    transcript = {letter: series.transcript(letter) for letter in "abc"}
    wrong = []
    for d in decisions:
        spoken = [u for u in transcript[d.meeting[-1]] if u["speaker"] == d.cited.speaker and u["start"] - 0.5 <= d.cited.start <= u["end"] + 0.5]
        if not spoken or not (ami_loader._content(d.cited.text) & ami_loader._content(" ".join(u["text"] for u in spoken))):
            wrong.append((d.citation, d.cited.speaker, d.cited.text[:50]))
    check("every citation lands on a real segment of that speaker saying those words", not wrong, wrong)
    check("the quotes read as speech, not as markup", all("_" not in d.cited.text and "<" not in d.cited.text for d in decisions))
    price = next(d for d in decisions if d.text == "The remote will sell for 25 Euro.")
    check("the price decision cites the project manager saying it", price.cited.role == "PM" and "twenty five" in price.cited.text, price.cited)


# ------------------------------------------------------------------ the live meeting


def stream_checks(series: Series) -> list[dict]:
    stream = list(series.live_stream())
    check("ES2003d streams utterances", len(stream) > 100, len(stream))
    check("each has a speaker, a role, a start and an end in seconds, and text", all(u["speaker"] in "ABCD" and u["role"] and isinstance(u["start"], float) and isinstance(u["end"], float) and u["start"] <= u["end"] and u["text"].strip() for u in stream))
    check("they arrive in the order they were spoken", all(a["start"] <= b["start"] for a, b in zip(stream, stream[1:])))
    check("it is the whole meeting, about 39 minutes, with all four people", 30 * 60 < stream[-1]["end"] < 50 * 60 and {u["speaker"] for u in stream} == set("ABCD"), (stream[-1]["end"], {u["speaker"] for u in stream}))
    check("it is labelled as meeting d", {u["meeting"] for u in stream} == {"ES2003d"})
    check("the text is clean: no underscores, noises or empty lines", not any("_" in u["text"] or "vocalsound" in u["text"] for u in stream))
    check("it is the shape audio.py yields, so the HUD can take it", all({"start", "end", "text"} <= set(u) for u in stream))

    began = time.monotonic()
    first = list(__import__("itertools").islice(series.live_stream(realtime=True, speed=400.0), 6))
    check("in real time it paces itself to the meeting's clock", time.monotonic() - began >= first[-1]["start"] / 400.0 - 0.01 and len(first) == 6, (time.monotonic() - began, first[-1]["start"]))
    check("a filter drops the backchannel", len(list(series.live_stream(min_words=3))) < len(stream) and all(len(u["text"].split()) >= 3 for u in series.live_stream(min_words=3)))
    return stream


# ------------------------------------------------------------------ no look-ahead, four ways


def lookahead_checks(series: Series, decisions: list[ami_loader.Decision], stream: list[dict]) -> None:
    # 1. by construction: the readers refuse
    refused = 0
    for reader, member in (
        (series._memory, "abstractive/ES2003d.abssumm.xml"), (series._memory, "words/ES2003d.A.words.xml"), (series._memory, "extractive/ES2003d.summlink.xml"),
        (series._live, "abstractive/ES2003d.abssumm.xml"), (series._live, "extractive/ES2003d.summlink.xml"), (series._live, "dialogueActs/ES2003d.A.dialog-act.xml"),
        (series._live, "topics/ES2003d.topic.xml"), (series._live, "decision/manual/ES2003d.decision.xml"), (series._live, "participantSummaries/ES2003d.A.participantsumm.xml"),
    ):
        try:
            reader.read(member)
        except LookaheadError:
            refused += 1
    check("the readers refuse to open anything about meeting d beyond its plain transcript", refused == 9, refused)
    try:
        series.transcript("d")
    except LookaheadError:
        passed.append("a finished-meeting transcript is refused for d")
    else:
        raise AssertionError("transcript('d') worked")

    # 2. by record: what was actually opened
    memory = series.memory_reads
    check("memory read only meetings a, b and c", memory and all(re.search(r"ES2003[abc]", m) or m == "corpusResources/meetings.xml" for m in memory) and not any("ES2003d" in m for m in memory), [m for m in memory if "ES2003d" in m])
    live = series.live_reads
    check("the live meeting read only words and segments of d", live and all(m.startswith(("words/ES2003d", "segments/ES2003d")) or m == "corpusResources/meetings.xml" for m in live), [m for m in live if not m.startswith(("words/", "segments/"))])
    check("no annotation of meeting d was opened by either reader", not [m for m in memory + live if "ES2003d" in m and not m.startswith(("words/", "segments/"))])

    # 3. by content: the future answer key is not in memory
    memory_text = DECISIONS.read_text(encoding="utf-8")
    future = future_sentences(series)
    check("the live meeting has decisions that could leak", len(future) >= 4, future)
    check("none of the live meeting's decisions are in decisions.md", not [s for s in future if s.rstrip(".").lower() in memory_text.lower()], future)
    check("no citation in decisions.md points at meeting d", "ES2003d" not in memory_text and ":d:" not in memory_text)
    check("memory holds nothing that was said in the live meeting", not [u["text"] for u in stream if len(u["text"].split()) >= 8 and u["text"].lower().rstrip(".?,") in memory_text.lower()])

    # 4. the future reverses the past, so a leak would have been visible
    before = {d.text for d in decisions}
    check("the live meeting reverses two decisions that memory holds", "The remote will have a case made of rubber." in before and "The remote will have a double curved design." in before
          and "The remote will be made of plastic instead of rubber." in future and "The case for the remote will be single curved." in future, future)
    check("and memory still holds the old ones, not the new", "plastic" not in memory_text.lower() and "single curved" not in memory_text.lower())


# ------------------------------------------------------------------ the auditor on this memory


def auditor_checks(series: Series, decisions: list[ami_loader.Decision]) -> None:
    check("decisions.md is populated with the series' memory", len(parse_memory(DECISIONS.read_text(encoding="utf-8"))) == len(decisions) >= 5)
    check("the HUD and the MCP server read it as approved decisions", len(active_decisions().splitlines()) == len(decisions), active_decisions()[:200])
    check("every line is a cited bullet", all(CITATION.fullmatch(c) for c, _ in parse_memory(DECISIONS.read_text(encoding="utf-8"))))

    price = next(d for d in decisions if d.text == "The remote will sell for 25 Euro.")
    check("the historical fact is one the meeting really decided, and memory cites it", price.citation == "ES2003a:11:36" and (price.citation, price.text) in parse_memory(DECISIONS.read_text(encoding="utf-8")), price.citation)

    check_statement("warm up")
    started = time.perf_counter()
    historical = check_statement(HISTORICAL)
    check("the historical fact passes", not historical["alert"] and historical["label"] == "SUPPORTED_CURRENT", historical)
    check("an unalarming verdict has no citation to show", historical["citation"] == "", historical)

    contradicted = check_statement(CONTRADICTED)
    known = {c for c, _ in parse_memory(DECISIONS.read_text(encoding="utf-8"))}
    check("the contradicted fact raises an alert", contradicted["alert"] and contradicted["label"] in ("CONTRADICTS", "OUTDATED"), contradicted)
    check("its citation exists in memory", contradicted["citation"].strip("[]") in known, (contradicted["citation"], sorted(known)))
    check("and it is the decision that was contradicted", contradicted["citation"] == f"[{price.citation}]", (contradicted["citation"], price.citation))
    check("with a reason", len(contradicted["reason"].split()) >= 3, contradicted)
    elapsed = time.perf_counter() - started
    print(f'  ├── historical:   "{HISTORICAL}" -> PASS | {historical["label"]} ({historical["latency_ms"]:.0f}ms)')
    print(f'  ├── contradicted: "{CONTRADICTED}" -> ALERT | {contradicted["label"]} | {contradicted["reason"]} | {contradicted["citation"]} ({contradicted["latency_ms"]:.0f}ms)')
    check("both were audited in a few seconds", elapsed < 20, elapsed)


# ------------------------------------------------------------------ the other four series


def other_series_checks() -> None:
    summary = []
    for name in DEV_SERIES:
        series = Series(name)
        stream = list(series.live_stream())
        decisions = series.decisions
        ok = (
            len(decisions) >= 5
            and all(CITATION.fullmatch(d.citation) for d in decisions)
            and len({d.citation for d in decisions}) == len(decisions)
            and all(d.meeting[:-1] == name for d in decisions)
            and len(stream) > 100
            and all(a["start"] <= b["start"] for a, b in zip(stream, stream[1:]))
            and not any("_" in u["text"] for u in stream)
            and not any(f"{name}d" in m and not m.startswith(("words/", "segments/")) for m in series.memory_reads + series.live_reads)
            and not any(f"{name}d" in d.citation for d in decisions)
        )
        check(f"{name} loads: cited decisions from a-c, a timestamped stream for d, no look-ahead", ok, (name, len(decisions), len(stream)))
        summary.append((name, len(decisions), len(series.skipped), len(stream)))
    print("  ├── all five development series load: " + "; ".join(f"{n} {d} decisions ({s} unlinked left out), {u} utterances" for n, d, s, u in summary))


# ------------------------------------------------------------------ the unseen test series, for history only


def history_only_checks() -> None:
    import zipfile

    archive = zipfile.ZipFile(ensure_corpus())
    scenario = ami_loader.scenario_series(archive)
    complete = [name for name, letters in scenario.items() if letters == "abcd"]
    check("the corpus has 35 scenario series, 33 with all four meetings", len(scenario) == 35 and len(complete) == 33, (len(scenario), len(complete)))
    check("IS1002 has no meeting a and IS1005 no meeting d", scenario["IS1002"] == "bcd" and scenario["IS1005"] == "abc", (scenario["IS1002"], scenario["IS1005"]))
    tests = ami_loader.test_series(archive)
    check("the test series are the 28 complete series that are not development series", len(tests) == 28 and not set(tests) & set(DEV_SERIES) and not {"IS1002", "IS1005"} & set(tests), tests)
    check("AMI's five unseen evaluation series are among them", {"ES2004", "ES2014", "IS1009", "TS3003", "TS3007"} <= set(tests), tests)
    check("with the development series they are all 33 complete series, and nothing is counted twice", set(tests) | set(DEV_SERIES) == set(complete) and len(tests) + len(DEV_SERIES) == 33)

    for name in ("ES2004", "TS3012"):
        try:
            Series(name)
        except ValueError as error:
            check(f"{name} is refused as a live series", "history only" in str(error), error)
        else:
            raise AssertionError(f"{name} opened as a live series")
    series = Series("ES2004", history_only=True)
    check("a test series opens for history only: cited decisions from meetings a-c", series.decisions and all(re.match(r"ES2004[abc]:\d\d:\d\d", d.citation) for d in series.decisions), [d.citation for d in series.decisions])
    try:
        list(series.live_stream())
    except LookaheadError:
        passed.append("and it has no live meeting: asking for one is refused")
    else:
        raise AssertionError("a test series streamed a meeting d")
    check("nothing about its meeting d was opened by anything", not any("ES2004d" in m for m in series.memory_reads) and series.live_reads == [], series.memory_reads)
    try:
        series._memory.read("abstractive/ES2004d.abssumm.xml")
    except LookaheadError:
        passed.append("even asking the memory reader for its meeting d summary is refused")
    else:
        raise AssertionError("the memory reader opened a test series' meeting d")
    dev = Series("ES2003", history_only=True)
    try:
        list(dev.live_stream())
    except LookaheadError:
        passed.append("history_only takes the live meeting away from a development series too")
    else:
        raise AssertionError("history_only left the live meeting open")

    last = Series("TS3012", history_only=True)  # TS3012c has no summary-link file in the corpus
    missing = [s for m, _, s in last.skipped if m == "TS3012c"]
    check("TS3012c has no summary links, so its decisions are left out and reported rather than guessed", len(missing) == 9 and not any(d.citation.startswith("TS3012c") for d in last.decisions), (len(missing), last.skipped[:2]))
    check("and the other two meetings of TS3012 still load", {d.citation[6] for d in last.decisions} == {"a", "b"}, {d.citation[:7] for d in last.decisions})


# ------------------------------------------------------------------ run it


def main() -> int:
    kept = DECISIONS.read_bytes() if DECISIONS.exists() else None  # the tests rewrite decisions.md; leave it as found
    try:
        unit_checks()
        series = corpus_checks()
        decisions = decision_checks(series)
        series.write_memory()  # the real file, the one the HUD, the wingman and the MCP server read
        evidence_checks(series, decisions)
        stream = stream_checks(series)
        lookahead_checks(series, decisions, stream)
        print("[Part 1: MemoriaBench Loader]")
        auditor_checks(series, decisions)
        other_series_checks()
        history_only_checks()
        total = len(decisions) + len(series.skipped)
        print(f"  ├── Loaded series 'ES2003' (Meetings a, b, c -> Memory; Meeting d -> Live Stream: {len(stream)} utterances over {stream[-1]['end'] / 60:.0f} min)")
        print(f"  ├── Seeded decisions.md with {len(decisions)} approved decisions from ES2003a-c ({total} written by the annotators; {len(series.skipped)} had no evidence to cite)")
        print(f"  ├── Verified zero lookahead leaks into meeting d (readers refuse, nothing opened, none of its {len(future_sentences(series))} decisions in memory)")
        print(f"  └── Test checks passed against real AMI data ({len(passed)} checks, exit code 0)")
    finally:
        if kept is None:
            DECISIONS.unlink(missing_ok=True)
        else:
            DECISIONS.write_bytes(kept)
    return 0


if __name__ == "__main__":
    sys.exit(main())

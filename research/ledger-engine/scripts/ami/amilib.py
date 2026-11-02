"""AMI NXT readers: turns, abstracts, and human-made links from abstract sentences to transcript utterances.
AMI Meeting Corpus, CC BY 4.0 (https://groups.inf.ed.ac.uk/ami/corpus/license.shtml)."""
import html, re, xml.etree.ElementTree as ET
from pathlib import Path

ANN = Path.home() / "Desktop/FYP/data/ami/annotations"
NS = "{http://nite.sourceforge.net/}"
SPEAKERS = "ABCD"


def _w(meeting, spk):
    f = ANN / "words" / f"{meeting}.{spk}.words.xml"
    if not f.exists():
        return {}
    out = {}
    for e in ET.parse(f).getroot():
        wid = e.get(NS + "id")
        if wid is None:
            continue
        if e.tag == "w":
            out[wid] = (float(e.get("starttime", "nan")), float(e.get("endtime", "nan")), (e.text or "").strip(), e.get("punc") == "true")
        else:
            st, en = e.get("starttime"), e.get("endtime")
            out[wid] = (float(st) if st else float("nan"), float(en) if en else float("nan"), "", True)
    return out


def _range(ids_in_order, href):
    """words0..words5 -> list of ids using the file order."""
    m = re.search(r"id\(([^)]*)\)(?:\.\.id\(([^)]*)\))?", href)
    a, b = m.group(1), m.group(2) or m.group(1)
    i, j = ids_in_order.index(a), ids_in_order.index(b)
    return ids_in_order[i:j + 1]


def segments(meeting):
    """[(speaker, start, end, text)] from the transcriber segments, time-ordered."""
    out = []
    for spk in SPEAKERS:
        words = _w(meeting, spk)
        if not words:
            continue
        order = list(words)
        f = ANN / "segments" / f"{meeting}.{spk}.segments.xml"
        for seg in ET.parse(f).getroot():
            child = seg.find(NS + "child")
            if child is None:
                continue
            ids = _range(order, child.get("href"))
            toks = [words[i] for i in ids]
            text = " ".join(t[2] for t in toks if not t[3] or t[2] in ",.?!")
            text = re.sub(r"\s+([,.?!])", r"\1", text).strip()
            if text:
                out.append((spk, float(seg.get("transcriber_start")), float(seg.get("transcriber_end")), text))
    return sorted(out, key=lambda s: (s[1], s[0]))


def turns(meeting, merge_gap=2.0, min_words=2):
    """Merge a speaker's consecutive segments (gap <= merge_gap s); drop turns shorter than min_words words (backchannels)."""
    merged = []
    for spk, a, b, text in segments(meeting):
        if merged and merged[-1][0] == spk and a - merged[-1][2] <= merge_gap:
            merged[-1] = (spk, merged[-1][1], b, merged[-1][3] + " " + text)
        else:
            merged.append((spk, a, b, text))
    return [t for t in merged if len(re.findall(r"[A-Za-z0-9']+", t[3])) >= min_words]


def abstract_sentences(meeting):
    """{'decisions': [(id, text)], 'actions': [...], 'problems': [...], 'abstract': [...]}"""
    t = (ANN / "abstractive" / f"{meeting}.abssumm.xml").read_text(encoding="iso-8859-1")
    out = {}
    for tag in ("abstract", "actions", "decisions", "problems"):
        sents = []
        for block in re.findall(rf"<{tag}[^>]*>(.*?)</{tag}>", t, flags=re.S):
            for m in re.finditer(r'<sentence nite:id="([^"]+)"[^>]*>(.*?)</sentence>', block, flags=re.S):
                sents.append((m.group(1), html.unescape(re.sub(r"<[^>]+>", "", m.group(2))).strip()))
        out[tag] = sents
    return out


def linked_times(meeting):
    """{abstract sentence id: [(speaker, start, end), ...]} via the human summlink + dialogue acts."""
    link = ANN / "extractive" / f"{meeting}.summlink.xml"
    if not link.exists():
        return {}
    dact_times, words_cache = {}, {}
    out = {}
    for sl in ET.parse(link).getroot():
        ext = abs_ = None
        for p in sl.findall(NS + "pointer"):
            if p.get("role") == "extractive":
                ext = p.get("href")
            elif p.get("role") == "abstractive":
                abs_ = p.get("href")
        if not ext or not abs_:
            continue
        spk = re.search(rf"{meeting}\.([A-D])\.dialog-act", ext).group(1)
        if spk not in dact_times:
            words_cache[spk] = _w(meeting, spk)
            d = {}
            for da in ET.parse(ANN / "dialogueActs" / f"{meeting}.{spk}.dialog-act.xml").getroot():
                ch = da.find(NS + "child")
                if ch is not None:
                    d[da.get(NS + "id")] = ch.get("href")
            dact_times[spk] = d
        da_id = re.search(r"id\(([^)]*)\)", ext).group(1)
        href = dact_times[spk].get(da_id)
        if not href:
            continue
        order = list(words_cache[spk])
        ids = _range(order, href)
        ts_ = [words_cache[spk][i] for i in ids if words_cache[spk][i][0] == words_cache[spk][i][0]]
        if not ts_:
            continue
        sid = re.search(r"id\(([^)]*)\)", abs_).group(1)
        out.setdefault(sid, []).append((spk, min(t[0] for t in ts_), max(t[1] for t in ts_)))
    return out

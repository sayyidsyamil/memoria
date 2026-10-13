#!/usr/bin/env /opt/homebrew/bin/python3.11
"""Memoria source importer — turn a web page, YouTube video, or file into a
markdown note. Spawned by Memoria's Rust backend; emits newline-delimited JSON:

    {"type":"status","msg":"fetching web page"}
    {"type":"final","title":"...","markdown":"...","sourceType":"web"}
    {"type":"error","msg":"..."}

Detection:
  - YouTube URL  -> youtube-transcript-api (fast), else yt-dlp audio + local MLX
  - other URL    -> trafilatura (clean article text)
  - file path    -> liteparse (pdf, docx, pptx, xlsx, images w/ OCR, …)

Adapted from the user's convert.py, but returns markdown to the app (which saves
it into the active vault) rather than writing to a raw/ directory.
"""

import argparse
import json
import re
import sys
import urllib.parse
from datetime import datetime
from pathlib import Path


def emit(obj):
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()


def is_url(s):
    return s.startswith("http://") or s.startswith("https://")


def is_youtube(url):
    return bool(re.match(
        r"^https?://((www\.)?youtube\.com/(watch\?v=|shorts/|embed/)|youtu\.be/)", url))


def youtube_id(url):
    p = urllib.parse.urlparse(url)
    if "youtube.com" in p.netloc:
        return urllib.parse.parse_qs(p.query).get("v", [""])[0]
    if "youtu.be" in p.netloc:
        return p.path.strip("/")
    return ""


def format_segments(segments):
    """segments: list of (start, end, speaker, text) -> readable markdown."""
    lines = []
    last = None
    for s, e, spk, txt in segments:
        txt = txt.strip()
        if not txt:
            continue
        if spk != last:
            lines.append(f"\n**{spk}** · {int(s // 60)}:{int(s % 60):02d}\n{txt}")
            last = spk
        else:
            lines.append(txt)
    return "\n".join(lines).strip()


def import_youtube(url):
    vid = youtube_id(url)
    title = f"YouTube {vid}"
    try:
        from youtube_transcript_api import YouTubeTranscriptApi
        emit({"type": "status", "msg": "fetching captions"})
        snips = YouTubeTranscriptApi().fetch(vid, languages=["en", "ms"])
        merged = []
        for sn in snips:
            start = float(sn.start)
            end = start + float(sn.duration)
            text = sn.text.strip()
            if not text:
                continue
            if merged:
                merged[-1] = (merged[-1][0], end, "Speaker 0", merged[-1][3] + " " + text)
            else:
                merged.append((start, end, "Speaker 0", text))
        body = format_segments(merged)
        if body:
            title = youtube_title(url) or title
            return title, body, "youtube"
    except Exception as e:
        emit({"type": "status", "msg": f"no captions ({type(e).__name__}); transcribing audio"})

    # fallback: download audio + local diarized transcription
    return import_youtube_audio(url)


def youtube_title(url):
    try:
        import yt_dlp
        opts = {"quiet": True, "no_warnings": True,
                "extractor_args": {"youtube": {"player_client": ["android_vr"]}}}
        with yt_dlp.YoutubeDL(opts) as ydl:
            return ydl.extract_info(url, download=False).get("title")
    except Exception:
        return None


def import_youtube_audio(url):
    import tempfile
    import yt_dlp
    tmp = Path(tempfile.gettempdir()) / "memoria_yt"
    opts = {"format": "bestaudio/best", "outtmpl": str(tmp) + ".%(ext)s",
            "quiet": True, "no_warnings": True,
            "extractor_args": {"youtube": {"player_client": ["android_vr"]}}}
    emit({"type": "status", "msg": "downloading audio"})
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(url, download=True)
        title = info.get("title", "YouTube video")
    files = list(tmp.parent.glob(f"{tmp.name}*"))
    if not files:
        raise RuntimeError("audio download failed")
    body = transcribe_file(files[0])
    for f in files:
        f.unlink(missing_ok=True)
    return title, body, "youtube"


def transcribe_file(path):
    """Diarized transcript of an audio file via the local MLX pipeline."""
    import librosa
    import mlx.core as mx
    from transcribe_v3 import STT, DIAR, aligned_words, build_turns, diarize
    from mlx_audio.stt.utils import load as load_stt
    from mlx_audio.vad.utils import load_model as load_vad

    emit({"type": "status", "msg": "loading models"})
    audio, _ = librosa.load(str(path), sr=16000, mono=True)
    stt, diar = load_stt(STT), load_vad(DIAR)
    emit({"type": "status", "msg": "transcribing & diarizing"})
    result = stt.generate(mx.array(audio), chunk_duration=120.0)
    spk = diarize(diar, audio)
    words, labels = aligned_words(result, spk)
    turns = [(s, e, f"Speaker {k}", t) for s, e, k, t in build_turns(words, labels)]
    return format_segments(turns)


def import_web(url):
    import trafilatura
    emit({"type": "status", "msg": "fetching web page"})
    downloaded = trafilatura.fetch_url(url)
    if not downloaded:
        raise RuntimeError(f"failed to fetch {url}")
    text = trafilatura.extract(downloaded, include_comments=False,
                               include_tables=True, deduplicate=True)
    if not text:
        raise RuntimeError("no readable content extracted")
    meta = trafilatura.extract_metadata(downloaded)
    title = getattr(meta, "title", None) or urllib.parse.urlparse(url).netloc
    return title, text, "web"


TEXT_EXTS = {".txt", ".md", ".markdown", ".csv", ".tsv", ".json", ".log"}
IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".gif", ".bmp", ".tiff", ".tif", ".webp"}
TESS_DIR = Path.home() / ".memoria" / "tessdata"
TESS_URL = "https://github.com/tesseract-ocr/tessdata_fast/raw/main/eng.traineddata"


def ensure_tessdata():
    """Download the Tesseract English model once (for OCR of images/scans)."""
    target = TESS_DIR / "eng.traineddata"
    if not target.exists():
        TESS_DIR.mkdir(parents=True, exist_ok=True)
        import urllib.request
        urllib.request.urlretrieve(TESS_URL, target)
    return str(TESS_DIR)


def liteparse_text(path, ocr):
    from liteparse import LiteParse
    kwargs = dict(output_format="text", quiet=True, ocr_enabled=ocr)
    if ocr:
        kwargs["ocr_language"] = "eng"
        kwargs["tessdata_path"] = ensure_tessdata()
    return (LiteParse(**kwargs).parse(str(path)).text or "").strip()


def ocr_image(path):
    """OCR a standalone image. Convert to PDF with Pillow first so liteparse uses
    its bundled pdfium renderer (no ImageMagick system dependency required)."""
    import tempfile
    from PIL import Image
    tmp = Path(tempfile.mkdtemp()) / "memoria_ocr.pdf"
    try:
        Image.open(path).convert("RGB").save(tmp, "PDF")
        return liteparse_text(tmp, ocr=True)
    finally:
        tmp.unlink(missing_ok=True)


def import_file(path):
    p = Path(path)
    if not p.exists():
        raise RuntimeError(f"file not found: {path}")
    emit({"type": "status", "msg": "converting file"})
    ext = p.suffix.lower()

    if ext in (".html", ".htm"):
        import trafilatura
        raw = p.read_text(encoding="utf-8", errors="replace")
        text = (trafilatura.extract(raw) or raw).strip()
    elif ext in TEXT_EXTS:
        text = p.read_text(encoding="utf-8", errors="replace").strip()
    elif ext in IMAGE_EXTS:
        emit({"type": "status", "msg": "reading image (OCR)"})
        text = ocr_image(p)
    else:
        # liteparse: accurate, fully-local parsing for PDF & Office docs
        text = liteparse_text(p, ocr=False)
        if not text:  # likely a scanned PDF -> fall back to OCR
            emit({"type": "status", "msg": "scanned document — running OCR"})
            text = liteparse_text(p, ocr=True)

    if not text:
        raise RuntimeError("no content extracted from file")
    return p.stem, text, "file"


def run(source):
    if is_url(source):
        title, body, kind = import_youtube(source) if is_youtube(source) else import_web(source)
    else:
        title, body, kind = import_file(source)

    ref = f"> Imported {datetime.now().strftime('%Y-%m-%d %H:%M')}"
    if is_url(source):
        ref += f"  ·  [source]({source})"
    markdown = f"{ref}\n\n{body}\n"
    emit({"type": "final", "title": title, "markdown": markdown, "sourceType": kind})


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("source", help="URL or file path")
    args = ap.parse_args()
    run(args.source)


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        emit({"type": "error", "msg": f"{type(e).__name__}: {e}"})
        sys.exit(1)

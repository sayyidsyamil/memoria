#!/usr/bin/env python3
"""Supplementary probe for engine/results/asr/app_path_check.md: does the INPUT LEVEL change what the app's streaming
diarization finds?

Why. The library's one-shot generate() peak-normalises the audio inside the model call, x / (max|x| + 1e-3);
generate_stream() for this model does not, and neither does the app's streaming path
(transcribe_v3.diarize_with_info(mode="stream")). The five AMI headset mixes differ a lot in level (peak 1.0 ... 0.19),
and in the `compare` step of diar_app_check.py the one meeting where streaming was clearly worse than the one-shot
call (TS3003a) is one of the two quietest. That is an observation on five meetings; this probe changes only the
level, on identical audio.

What. The clips of that `compare` step (CLIP_STARTS of diar_app_check.py, lengths 30 / 60 / 120 s, every clip a
recording of its own), diarized by the app's own streaming path at
    original    the audio as it is (must reproduce the streaming result of `compare` exactly)
    peaknorm    x / (max|x| + 1e-3) over the clip: the library's one-shot normalisation, applied before the call
    minus20db   x * 0.1
The forced one-shot result of `compare` (the library normalises internally, so its level does not matter) is the
reference. DER as in diar_app_check.py: pyannote.metrics, collar 0.25 s, overlapped speech scored, optimal mapping.
The clips of one start are nested (30 s inside 60 s inside 120 s), so the confidence intervals resample the 15 starts,
not the 45 clips.

Usage (the run loads the diarization model on the GPU: only when the GPU is free)
    engine/.venv-asr/bin/python engine/scripts/diar_level_probe.py all
        run         model pass in the app's python (/opt/homebrew/bin/python3.11), diarization model only
        evaluate    scoring and tables from the saved segments (no model; needs jiwer/pyannote: the .venv-asr python)
        selftest    CPU only: the level variants and the aggregation on synthetic data

Outputs: engine/results/asr/app_path_level_probe.md / .json; raw segments in engine/results/asr/app_path_raw/level_probe/
"""

import sys

sys.dont_write_bytecode = True

import argparse
import json
import os
import subprocess
import time
from collections import defaultdict
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import asr_der_eval as ev  # noqa: E402
import diar_app_check as dac  # noqa: E402

LENGTHS = (30, 60, 120)                       # seconds; a subset of diar_app_check.CLIP_LENGTHS
VARIANTS = ("original", "peaknorm", "minus20db")
OUT_JSON, OUT_MD = dac.OUT_DIR / "app_path_level_probe.json", dac.OUT_DIR / "app_path_level_probe.md"
RAW_FILE = dac.RAW_DIR / "level_probe" / "raw.json"


def apply_variant(name, x):
    if name == "original":
        return x
    if name == "peaknorm":
        return (x / (np.abs(x).max() + 1e-3)).astype(np.float32)
    if name == "minus20db":
        return (x * 0.1).astype(np.float32)
    raise ValueError(name)


def level_stats(x):
    peak = float(np.abs(x).max())
    rms = float(np.sqrt(np.mean(np.square(x, dtype=np.float64))))
    return {"peak": peak, "rms_dbfs": 20 * float(np.log10(rms + 1e-12))}


# --------------------------------------------------------------------------------------------------
# Model pass (runs in the app's python; imports mlx through diar_app_check.load_real_env)
# --------------------------------------------------------------------------------------------------
def cmd_run(args):
    env = dac.load_real_env()
    mx, tv = env.mx, env.tv
    env.start_guard(dac.MEM_LIMIT_GB)
    ev.AUDIO_DIR = dac.ami_audio_dir()
    avail = ev.complete_meetings()
    levels, clips = {}, []
    for meeting, starts in dac.CLIP_STARTS.items():
        if meeting not in avail:
            continue
        audio = dac.load_audio(ev.AUDIO_DIR / f"{meeting}.wav")
        levels[meeting] = {**level_stats(audio), "seconds": len(audio) / ev.SAMPLE_RATE}
        for start in starts:
            for length in LENGTHS:
                lo, hi = int(start * ev.SAMPLE_RATE), int((start + length) * ev.SAMPLE_RATE)
                if hi <= len(audio):
                    clips.append((f"{meeting}@{start}+{length}", {"meeting": meeting, "start": start, "length": length},
                                  audio[lo:hi].copy()))
        del audio
    diar = env.load_diar()
    dac.warm_up(env, diar, clips[0][2])
    runs = []
    for label, extra, audio in clips:
        for variant in VARIANTS:
            x = apply_variant(variant, audio)
            mx.clear_cache()
            mx.reset_peak_memory()
            t = time.perf_counter()
            segments, info = tv.diarize_with_info(diar, x, mode="stream")
            seconds = time.perf_counter() - t
            assert info["mode"] == "stream", info
            runs.append({"label": label, "variant": variant, "audio_s": len(audio) / ev.SAMPLE_RATE, "seconds": seconds,
                         "mlx_peak_gb": mx.get_peak_memory() / 1e9, "clip_level": level_stats(x),
                         "segments": [list(s) for s in segments], **extra})
        print(f"{label:>22s} " + "  ".join(f"{r['variant']}: {len(r['segments'])} seg"
                                           for r in runs[-len(VARIANTS):]), flush=True)
    RAW_FILE.parent.mkdir(parents=True, exist_ok=True)
    RAW_FILE.write_text(json.dumps({
        "models": {"diarization": env.ts.DIAR}, "app": dac.app_parameters(env), "lengths_s": list(LENGTHS),
        "variants": list(VARIANTS), "meeting_levels": levels, "runs": runs, "interpreter": sys.executable,
        "versions": ev.lib_versions(), "machine": ev.machine_info(), "finished": dac.now_iso()}, indent=1))
    print(f"wrote {RAW_FILE}", flush=True)


# --------------------------------------------------------------------------------------------------
# Evaluation (CPU)
# --------------------------------------------------------------------------------------------------
def pooled(rows):
    tot = sum(r["der"]["total_s"] for r in rows)
    comp = {k: sum(r["der"][k] for r in rows) for k in ("miss_s", "fa_s", "conf_s")}
    return {"n_clips": len(rows), "ref_speech_s": tot, **comp, "der": sum(comp.values()) / tot,
            "miss": comp["miss_s"] / tot, "fa": comp["fa_s"] / tot, "conf": comp["conf_s"] / tot}


def error_s(r):
    return r["der"]["miss_s"] + r["der"]["fa_s"] + r["der"]["conf_s"]


def by_start(scored, a, b):
    """[(ref speech s, error s of a, error s of b)] per start (meeting, start second), summed over the clip lengths."""
    groups = defaultdict(lambda: [0.0, 0.0, 0.0])
    for (meeting, start, length), d in scored.items():
        if a in d and b in d:
            g = groups[(meeting, start)]
            g[0] += d[a]["der"]["total_s"]
            g[1] += error_s(d[a])
            g[2] += error_s(d[b])
    return [tuple(g) for _, g in sorted(groups.items())]


def paired(scored, a, b):
    """DER of `a` minus DER of `b` (points; positive: b is better) over the starts, bootstrap 95 % interval, and the
    number of starts where each is better."""
    groups = by_start(scored, a, b)
    ci = dac.delta_der_ci(groups)
    return {"a": a, "b": b, "n_starts": len(groups), "delta_der": ci["point"], "ci95": ci["ci95"],
            "starts_b_better": sum(1 for _, ea, eb in groups if eb < ea - 1e-9),
            "starts_a_better": sum(1 for _, ea, eb in groups if ea < eb - 1e-9)}


def score_rows(runs, cache):
    scored = defaultdict(dict)        # (meeting, start, length) -> {variant: row with "der"}
    for r in runs:
        ref = dac.crop_shift(dac.reference_for({"kind": "ami", "meeting": r["meeting"]}, cache)["ann"],
                             r["start"], r["audio_s"])
        c = ev.der_components(ref, ev.hyp_annotation(r["segments"], r["label"]), r["audio_s"], dac.COLLAR, False)
        scored[(r["meeting"], r["start"], r["length"])][r["variant"]] = {**r, "der": c}
    return scored


def cmd_evaluate(args):
    dac.ensure_metrics()
    raw = json.loads(RAW_FILE.read_text())
    cmp_path = dac.RAW_DIR / "compare.json"
    compare = json.loads(cmp_path.read_text())
    cache = {}
    scored = score_rows(raw["runs"], cache)
    stream_runs = {(r["meeting"], r["start"], r["length"]): r for r in compare["runs"]
                   if r["kind"] == "clip" and r["mode"] == "stream"}
    oneshot = [dict(r, variant="oneshot") for r in compare["runs"]
               if r["kind"] == "clip" and r["mode"] == "oneshot" and r["length"] in LENGTHS]
    for key, d in score_rows(oneshot, cache).items():
        scored[key]["oneshot"] = d["oneshot"]
    reproduces = set(scored) <= set(stream_runs) and all(
        sorted(map(tuple, scored[k]["original"]["segments"])) == sorted(map(tuple, stream_runs[k]["segments"])) for k in scored)
    meetings = [m for m in dac.CLIP_STARTS if m in raw["meeting_levels"]]
    cols = ("oneshot",) + VARIANTS
    table = {m: {v: pooled([d[v] for k, d in scored.items() if k[0] == m and v in d]) for v in cols} for m in meetings}
    overall = {v: pooled([d[v] for d in scored.values() if v in d]) for v in cols}
    gains = defaultdict(list)
    for r in raw["runs"]:
        if r["variant"] in ("original", "peaknorm"):
            gains[(r["label"], r["variant"])] = r["clip_level"]["peak"]
    gain_db = {m: float(np.mean([20 * np.log10(gains[(k, "peaknorm")] / gains[(k, "original")])
                                 for (k, v) in gains if v == "original" and k.startswith(f"{m}@")])) for m in meetings}
    comparisons = [paired(scored, "original", "peaknorm"), paired(scored, "original", "minus20db"),
                   paired(scored, "oneshot", "original"), paired(scored, "oneshot", "peaknorm")]
    by_length = {L: {v: pooled([d[v] for k, d in scored.items() if k[2] == L and v in d]) for v in cols} for L in LENGTHS}
    out = {"task": "Input level versus the app's streaming diarization (supplementary to app_path_check.md)",
           "lengths_s": list(LENGTHS), "variants": list(VARIANTS), "collar_s": dac.COLLAR, "skip_overlap": False,
           "clips": len(scored), "starts": len({(k[0], k[1]) for k in scored}),
           "original_reproduces_compare_stream_segments": reproduces,
           "code_check": dac.code_check({"level_probe": raw["app"]}), "meeting_levels": raw["meeting_levels"],
           "peaknorm_gain_db_by_meeting": gain_db, "by_meeting": table, "overall": overall, "by_length": {str(k): v for k, v in by_length.items()},
           "paired_over_starts": comparisons, "seconds_per_clip": {v: float(np.mean([r["seconds"] for r in raw["runs"]
                                                                                      if r["variant"] == v])) for v in VARIANTS},
           "app": raw["app"], "models": raw["models"], "interpreter_run": raw["interpreter"],
           "versions": raw["versions"], "machine": raw["machine"], "run_finished": raw["finished"],
           "bootstrap": {"resamples": dac.BOOTSTRAP_RESAMPLES, "seed": dac.BOOTSTRAP_SEED, "unit": "start"},
           "evaluated": dac.now_iso()}
    OUT_JSON.write_text(json.dumps(out, indent=1))
    OUT_MD.write_text(render(out))
    print(f"wrote {OUT_MD} and {OUT_JSON}", flush=True)


NAMES = {"oneshot": "one-shot", "original": "stream", "peaknorm": "stream, peak-normalised", "minus20db": "stream, -20 dB"}


def render(o):
    pc = lambda x: f"{100 * x:.1f}"
    cols = ("oneshot",) + VARIANTS
    rms = [lv["rms_dbfs"] for lv in o["meeting_levels"].values()]
    span = max(rms) - min(rms)
    L = ["# Input level versus the app's streaming diarization", "",
         "Supplementary probe to `app_path_check.md` (script `engine/scripts/diar_level_probe.py`). The library's one-shot "
         "call peak-normalises its input (`x / (max|x| + 1e-3)`); the streaming path of the app does not. The five AMI "
         f"meetings differ in RMS level by {span:.0f} dB (section 1). This probe changes only the level of identical clips.", "",
         f"- Clips: lengths {', '.join(str(x) for x in o['lengths_s'])} s at {o['starts']} starts of 5 meetings "
         f"({o['clips']} clips, each a recording of its own, as in `compare`); diarization by the app's streaming "
         "path (`transcribe_v3.diarize_with_info(mode=\"stream\")`) at `original` level, `peaknorm` "
         "(the clip divided by its own peak + 1e-3) and `minus20db` (x 0.1). The one-shot column is the forced one-shot "
         "result of `compare` on the same clips (level-independent by construction).",
         f"- DER with pyannote.metrics, collar {o['collar_s']} s, overlap scored; pooled = total errors / total "
         f"reference speech. Run {o['run_finished']}; models: `{o['models']['diarization']}`.",
         f"- Check: the `original` streaming segments are identical to those of `compare` for every clip: "
         f"**{o['original_reproduces_compare_stream_segments']}**.",
         "- App code: sha256 of the app scripts at the time of the run "
         + ("match the files on disk now." if not o["code_check"]["runs_not_matching_files_now"]
            else "**do NOT match the files on disk now (the app changed after the run; re-run the probe).**"), "",
         "## 1. DER by meeting (pooled over 9 clips of 30 / 60 / 120 s)", "",
         "| meeting | peak | RMS dBFS | peak-norm gain dB | " + " | ".join(f"{NAMES[v]} DER %" for v in cols) + " |",
         "|---|---|---|---|" + "---|" * len(cols)]
    for m, d in o["by_meeting"].items():
        lv = o["meeting_levels"][m]
        L.append(f"| {m} | {lv['peak']:.2f} | {lv['rms_dbfs']:.1f} | {o['peaknorm_gain_db_by_meeting'][m]:+.1f} | "
                 + " | ".join(pc(d[v]["der"]) for v in cols) + " |")
    L.append("| **all** | | | | " + " | ".join(f"**{pc(o['overall'][v]['der'])}**" for v in cols) + " |")
    L += ["", "Peak and RMS: the whole meeting file (RMS over all samples, silence included). Peak-norm gain: mean over "
          "the clips of the boost the peak normalisation applies (clip peak before / after).", "",
          "## 2. Error components, all clips pooled", "", "| variant | DER % | missed % | false alarm % | confusion % |",
          "|---|---|---|---|---|"]
    for v in cols:
        d = o["overall"][v]
        L.append(f"| {NAMES[v]} | {pc(d['der'])} | {pc(d['miss'])} | {pc(d['fa'])} | {pc(d['conf'])} |")
    L += ["", "By clip length (DER %):", "", "| clip s | " + " | ".join(NAMES[v] for v in cols) + " |",
          "|---|" + "---|" * len(cols)]
    for length, d in o["by_length"].items():
        L.append(f"| {length} | " + " | ".join(pc(d[v]["der"]) for v in cols) + " |")
    L += ["", "## 3. Paired differences over the 15 starts", "",
          "Difference = DER of A minus DER of B in points (positive: B is better), 95 % percentile bootstrap resampling "
          "starts; the last two columns count starts where B / A has the lower DER.", "",
          "| A | B | A - B pts [95 % CI] | starts B better / A better |", "|---|---|---|---|"]
    for c in o["paired_over_starts"]:
        lo, hi = c["ci95"]
        L.append(f"| {NAMES[c['a']]} | {NAMES[c['b']]} | {100 * c['delta_der']:+.1f} [{100 * lo:+.1f}, {100 * hi:+.1f}] | "
                 f"{c['starts_b_better']} / {c['starts_a_better']} |")
    L += ["", "Streaming time per clip (mean, seconds): " +
          ", ".join(f"{NAMES[v]} {s:.2f}" for v, s in o["seconds_per_clip"].items()) +
          " (the GPU was shared with another agent's build; timing only indicative).", "",
          f"Interpreter of the model run: `{o['interpreter_run']}`; libraries: "
          + ", ".join(f"{k} {v}" for k, v in o["versions"].items() if v and k in ("python", "mlx", "mlx-audio", "numpy")) + ".", ""]
    return "\n".join(L)


# --------------------------------------------------------------------------------------------------
# Driver and selftest
# --------------------------------------------------------------------------------------------------
def cmd_all(args):
    RAW_FILE.parent.mkdir(parents=True, exist_ok=True)
    log = RAW_FILE.parent / "run.log"
    with open(log, "w") as f:
        proc = subprocess.run([dac.APP_PYTHON, "-u", str(Path(__file__).resolve()), "run"], stdout=f, stderr=subprocess.STDOUT,
                              env={**os.environ, "PYTHONDONTWRITEBYTECODE": "1"})
    print(log.read_text()[-600:])
    if proc.returncode:
        raise SystemExit(f"model pass failed (exit {proc.returncode}), see {log}")
    cmd_evaluate(args)


def cmd_selftest(args):
    x = np.array([0.0, 0.1, -0.2, 0.05], np.float32)
    assert apply_variant("original", x) is x
    p = apply_variant("peaknorm", x)
    assert p.dtype == np.float32 and abs(np.abs(p).max() - 0.2 / (0.2 + 1e-3)) < 1e-6
    assert np.allclose(apply_variant("minus20db", x), x * 0.1) and apply_variant("minus20db", x).dtype == np.float32
    assert abs(level_stats(x)["peak"] - 0.2) < 1e-7
    row = lambda ref, miss, fa, conf: {"der": {"total_s": ref, "miss_s": miss, "fa_s": fa, "conf_s": conf}}
    scored = {("M", 0, 30): {"a": row(10, 2, 0, 0), "b": row(10, 1, 0, 0)},
              ("M", 0, 60): {"a": row(20, 4, 0, 0), "b": row(20, 2, 0, 0)},
              ("M", 5, 30): {"a": row(10, 1, 0, 0), "b": row(10, 3, 0, 0)}}
    assert by_start(scored, "a", "b") == [(30.0, 6.0, 3.0), (10.0, 1.0, 3.0)]
    c = paired(scored, "a", "b")
    assert c["n_starts"] == 2 and c["starts_b_better"] == 1 and c["starts_a_better"] == 1
    assert abs(c["delta_der"] - (7 - 6) / 40) < 1e-12
    d = pooled([dct["a"] for dct in scored.values()])
    assert d["n_clips"] == 3 and abs(d["der"] - 7 / 40) < 1e-12
    assert set(VARIANTS) <= set(NAMES) and set(LENGTHS) <= set(dac.CLIP_LENGTHS)
    print("selftest OK")


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    for name, fn in (("all", cmd_all), ("run", cmd_run), ("evaluate", cmd_evaluate), ("selftest", cmd_selftest)):
        sub.add_parser(name).set_defaults(fn=fn)
    args = ap.parse_args()
    args.fn(args)


if __name__ == "__main__":
    main()

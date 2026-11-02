"""Charts for report Chapter 6 and the slides, drawn from the result files (no numbers typed by hand).

    python3 scripts/report/make_figures.py            # run with the system python3 (matplotlib); writes ../report/figures/chart_*.png
"""
import json
import re
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

ENGINE = Path(__file__).resolve().parents[2]
OUT = ENGINE.parent / "report" / "figures"
RES = ENGINE / "results"
COL = {"Memoria": "#1f6f78", "Memoria + reviewer": "#7fb7be", "Full-context + CoT": "#e08a2c", "BM25 retrieval": "#8a8f98", "Perfect extractor": "#d9d9d9"}
plt.rcParams.update({"font.size": 10, "axes.spines.top": False, "axes.spines.right": False, "figure.dpi": 150})


def pct_err(c):
    return 100 * c["accuracy"], (100 * (c["accuracy"] - c["ci_95"][0]), 100 * (c["ci_95"][1] - c["accuracy"]))


def ami_accuracy():
    mem = json.loads((RES / "ami" / "memoria_test.json").read_text())["memoria"]["qa"]
    bl = json.loads((RES / "ami" / "baselines_test.json").read_text())["baselines"]
    systems = [("Memoria", mem["ext+router"]), ("Full-context + CoT", bl["full-context+cot"]["qa"]), ("BM25 retrieval", bl["bm25-rag(k=12)"]["qa"])]
    review = RES / "ami" / "memoria_test_review.json"
    if review.exists():
        systems.insert(1, ("Memoria + reviewer", json.loads(review.read_text())["memoria"]["qa"]["ext+router"]))
    kinds = [("overall", "All (96)"), ("current", "Current (34)"), ("as_of_valid", "As of a past date (29)"), ("n_changes", "Number of changes (33)")]
    fig, ax = plt.subplots(figsize=(8.2, 3.9))
    width = 0.8 / len(systems)
    for i, (name, qa) in enumerate(systems):
        ys, es = zip(*[pct_err(qa[k]) for k, _ in kinds])
        xs = [j + (i - (len(systems) - 1) / 2) * width for j in range(len(kinds))]
        ax.bar(xs, ys, width * 0.92, yerr=[[e[0] for e in es], [e[1] for e in es]], capsize=2, color=COL[name], label=name, error_kw={"lw": 0.8})
        for x, y, e in zip(xs, ys, es):
            ax.text(x, min(y + e[1] + 1.2, 108), f"{y:.0f}", ha="center", va="bottom", fontsize=7.5)
    ax.set_xticks(range(len(kinds)), [l for _, l in kinds])
    ax.set_ylabel("Correct answers (%)")
    ax.set_ylim(0, 112)
    ax.legend(ncol=len(systems), loc="upper center", bbox_to_anchor=(0.5, 1.13), frameon=False)
    ax.set_title("Question answering on the AMI test split (same 4B model; whiskers show 95% intervals)", fontsize=9, pad=26)
    fig.tight_layout()
    fig.savefig(OUT / "chart_ami_accuracy.png")
    plt.close(fig)


def scaling():
    text = (RES / "test" / "scaling_report.txt").read_text()
    rows = {}
    for label, key in (("Memoria (LLM extractor + LLM router)", "Memoria"), ("full-context+cot *", "Full-context + CoT"), ("bm25-rag(k=12) *", "BM25 retrieval")):
        m = re.search(r"^\| " + re.escape(label) + r" \| (.+)$", text, re.M)
        cells = [c.strip() for c in m.group(1).split("|") if c.strip()]
        vals = []
        for c in cells:
            p = re.match(r"(\d+)% \[(\d+)-(\d+)\]", c)
            vals.append((int(p.group(1)), int(p.group(2)), int(p.group(3))))
        rows[key] = vals
    ks = [0, 8, 24, 48]
    fig, ax = plt.subplots(figsize=(6.2, 3.6))
    for name, vals in rows.items():
        y = [v[0] for v in vals]
        lo = [v[0] - v[1] for v in vals]
        hi = [v[2] - v[0] for v in vals]
        ax.errorbar(ks, y, yerr=[lo, hi], marker="o", capsize=3, color=COL[name], label=name, lw=1.6)
    ax.set_xlabel("Extra meetings added to each series (K)")
    ax.set_ylabel("Correct answers (%)")
    ax.set_xticks(ks)
    ax.set_ylim(0, 100)
    ax.legend(frameon=False, loc="lower left")
    ax.set_title("Synthetic series: accuracy as the history grows (37 questions)", fontsize=9)
    fig.tight_layout()
    fig.savefig(OUT / "chart_scaling.png")
    plt.close(fig)


def asr():
    rows = []
    for line in (RES / "asr" / "wer_der_table.md").read_text().splitlines():
        m = re.match(r"^\| ([A-Z]{2}\d{4}[a-d]) \| \w+ \| ([\d.]+) \| ([\d.]+) \| \d+ \| \d+ \| \d+ \| ([\d.]+) \|", line)
        if m:
            rows.append((m.group(1), float(m.group(3)), float(m.group(4))))
    fig, ax = plt.subplots(figsize=(6.4, 3.4))
    xs = range(len(rows))
    ax.bar([x - 0.2 for x in xs], [r[1] for r in rows], 0.38, color=COL["Memoria"], label="WER (%)")
    ax.bar([x + 0.2 for x in xs], [r[2] for r in rows], 0.38, color=COL["Full-context + CoT"], label="DER (%)")
    ax.set_xticks(list(xs), [r[0] for r in rows], rotation=25)
    ax.set_ylabel("Error rate (%)")
    ax.legend(frameon=False)
    ax.set_title("Speech recognition (WER) and speaker separation (DER) on AMI headset audio", fontsize=9)
    fig.tight_layout()
    fig.savefig(OUT / "chart_asr.png")
    plt.close(fig)


def error_breakdown():
    rows = json.loads((RES / "ami" / "memoria_test.json").read_text())["memoria"]["rows"]
    wrong = [r for r in rows if not r["answers"]["ext+router"]["correct"]]
    cats = {"A different value is recorded\n(current value wrong)": 0, "Nothing recorded\n(a decision was missed)": 0, "Counted too many changes\n(a spurious extra decision)": 0}
    for r in wrong:
        a = r["answers"]["ext+router"]["answer"]
        if r["type"] == "current":
            cats["Nothing recorded\n(a decision was missed)" if a is None else "A different value is recorded\n(current value wrong)"] += 1
        elif r["type"] == "n_changes":
            cats["Counted too many changes\n(a spurious extra decision)"] += 1
    fig, ax = plt.subplots(figsize=(6.4, 2.8))
    names, vals = list(cats), list(cats.values())
    ax.barh(names, vals, color=COL["Memoria"])
    for y, v in enumerate(vals):
        ax.text(v + 0.3, y, str(v), va="center")
    ax.invert_yaxis()
    ax.set_xlabel("Wrong answers (of %d)" % len(wrong))
    ax.set_title("Where Memoria's 37 wrong answers on the AMI test split come from", fontsize=9)
    fig.tight_layout()
    fig.savefig(OUT / "chart_error_breakdown.png")
    plt.close(fig)


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    for fn in (ami_accuracy, scaling, asr, error_breakdown):
        fn()
        print("ok", fn.__name__)

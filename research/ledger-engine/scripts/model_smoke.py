"""Post-screen diagnostic: can the same checkpoint extract an explicit decision?

Not a benchmark and not used for promotion. Separates basic capability from the
observed AMI/prompt failure. Outputs are retained beside the screening run.
"""
import json
from pathlib import Path

from huggingface_hub import snapshot_download

from memoria_engine.evaluation.dataset import parse_chain
from memoria_engine.extractors import build_prompt, parse_events
from memoria_engine.llmcache import CachingMLX
from memoria_engine.pipeline import MeetingContext
from scripts.hybrid_experiment import save
from scripts.model_bakeoff import MODELS, ROOT


def main():
    model = MODELS["minicpm5"]
    checkpoint = snapshot_download(model["repo"], revision=model["revision"], local_files_only=True)
    llm = CachingMLX(str(ROOT / "results/model_bakeoff/minicpm5_dev/diagnostic_calls.jsonl"), model_id=checkpoint)
    rows = []
    for language, text in (("en", "We have decided to use Beta as the supplier. This is final."),
                           ("ms", "Kita telah memutuskan untuk memilih Beta sebagai pembekal. Ini keputusan muktamad.")):
        chain = parse_chain(f"""chain: diagnostic
now: 2026-04-01
people: sam=Sam
object: vendor | decision | Supplier | outcome:enum[Acme,Beta]!reverse
meeting: m1 | 2026-01-01 | ingested=2026-01-01
sam: {text}
""")
        prompt = build_prompt(MeetingContext(chain.meetings[0].meeting, chain.registry, {}))
        out = llm.complete(prompt, max_tokens=900)
        candidates, clean = parse_events(out["text"])
        rows.append({"language": language, "raw": out["text"], "parsed_cleanly": clean,
                     "candidates": [vars(c) for c in candidates], "seconds": out["seconds"]})
    save(ROOT / "results/model_bakeoff/minicpm5_dev/diagnostic.json", rows)
    print(json.dumps(rows, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()

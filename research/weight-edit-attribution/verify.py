"""No-model checks for split isolation, prompt/cache provenance, balance and rank-one math."""
import ast
import json

from common import HERE, ROOT, sha, load_dev


def main():
    for path in HERE.glob("*.py"):
        ast.parse(path.read_text(), filename=str(path))
    manifest = json.loads((HERE / "data/snapshot.json").read_text())
    assert sha((HERE / "data/cache-dev.jsonl").read_bytes()) == manifest["dev_cache_sha256"]
    for path, digest in manifest["inputs"].items():
        assert sha((ROOT / path).read_bytes()) == digest, path
    cases = json.loads((HERE / "data/cases.json").read_text())
    prompts = json.loads((HERE / "data/prompts.json").read_text())
    for records in prompts.values():
        for p in records:
            assert sha(p["prompt"]) == p["prompt_sha256"] == p["baseline"]["prompt_sha256"]
    for split in ("derive", "check"):
        part = [c for c in cases if c["split"] == split]
        assert len(part) == 16 and sum(c["expected_support"] for c in part) == 8
    for c in cases:
        assert f"[{c['turn']}] " in c["full_prompt"]
        assert any(t["index"] == c["turn"] for t in c["source"])
    for forbidden in ("ES2004", "ES2002", "TS3011"):
        try:
            load_dev([forbidden])
        except ValueError:
            pass
        else:
            raise AssertionError("held-out/reserve loader did not fail")
    base = json.loads((HERE / "results/baselines.json").read_text())
    assert (base["app"]["qa_exact"], base["app"]["tp"], base["app"]["values"]["wrong"]) == ("90/124", 26, 46)
    a = base["app-nosys-numwords-loopstop+modevalue"]
    assert (a["qa_exact"], a["tp"], a["values"]["wrong"]) == ("100/124", 28, 31)
    checks = ["syntax", "input hashes", "exact prompt reconstruction", "balanced source labels",
              "explicit dev-only loader", "app/A baseline parity"]
    patch = HERE / "data/patch-spec.json"
    if patch.exists():
        import numpy as np
        spec = json.loads(patch.read_text())
        path = HERE / "data/rank-one-patch.npz"
        assert sha(path.read_bytes()) == spec["patch_sha256"]
        arrays = np.load(path)
        u, random_u, p = arrays["u"], arrays["random_u"], arrays["p"]
        assert abs(np.linalg.norm(u)-1) < 1e-5
        assert abs(np.linalg.norm(random_u)-1) < 1e-5
        assert abs(u @ random_u) < 1e-5
        assert np.isclose(np.linalg.norm(np.outer(u, p)), np.linalg.norm(np.outer(random_u, p)))
        # A small independent matrix verifies the adapter's algebra without
        # dequantizing a model or loading an accelerator runtime.
        rng = np.random.default_rng(42)
        w, x = rng.normal(size=(7, 11)), rng.normal(size=(3, 11))
        tiny_u, tiny_p, idx = rng.normal(size=7), rng.normal(size=3), [1, 3, 9]
        delta = np.zeros_like(w)
        delta[:, idx] = -.5*np.outer(tiny_u, tiny_p)
        assert np.allclose(x @ (w+delta).T, x @ w.T - .5*(x[:, idx] @ tiny_p)[:, None]*tiny_u)
        checks += ["patch hash", "matched random Frobenius norm", "static weight-delta equivalence"]
    print(json.dumps({"passed": checks, "n": len(checks)}, indent=2))


if __name__ == "__main__":
    main()

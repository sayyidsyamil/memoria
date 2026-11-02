"""Opt-in LFM3/OptiQ development screen in a separate Python environment.

python -m scripts.lfm3_bakeoff --preflight
python -m scripts.lfm3_bakeoff --allow-download
Requires mlx-optiq >= 0.7.8. No monkey-patching of the production runtime.
"""
import argparse
import importlib
import importlib.metadata
import json

from scripts import model_bakeoff

REPO = "mlx-community/LFM3-1.7B-OptiQ-4bit"
REVISION = "82d0e45972a9343db2ab5534b257b2d6fb3edd46"


def require_runtime(version):
    from packaging.version import Version
    if Version(version) < Version("0.7.8"):
        raise RuntimeError(f"LFM3 requires mlx-optiq >= 0.7.8; installed {version}. Use an isolated environment with the supported release.")


def preflight():
    version = importlib.metadata.version("mlx-optiq")
    require_runtime(version)
    from optiq.models import install_vendored
    install_vendored()
    module = importlib.import_module("mlx_lm.models.lfm3")
    return {"mlx-optiq": version, "mlx-lm": importlib.metadata.version("mlx-lm"),
            "mlx": importlib.metadata.version("mlx"), "implementation": module.__file__,
            "model": REPO, "revision": REVISION}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--preflight", action="store_true")
    parser.add_argument("--allow-download", action="store_true")
    parser.add_argument("--out", default="results/model_bakeoff/lfm3_optiq_dev")
    args = parser.parse_args()
    runtime = preflight()
    print(json.dumps(runtime, indent=2))
    if args.preflight:
        return
    # Register only in this process, then reuse the existing dev-only evaluator.
    model_bakeoff.MODELS["lfm3-optiq"] = {"repo": REPO, "revision": REVISION}
    args.model = "lfm3-optiq"
    model_bakeoff.run(args)
    from scripts.hybrid_experiment import save
    save(model_bakeoff.ROOT / args.out / "runtime.json", runtime)
    args.reference = "results/ami/memoria_dev.json"
    model_bakeoff.report(args)


if __name__ == "__main__":
    main()

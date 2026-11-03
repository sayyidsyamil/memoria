"""Check the exact failure prompt with a zero-norm adapter and native base regeneration."""
import json
import signal

from common import HERE, write_json
from experiment import Runtime, install, preflight, timeout
from extract_screen import generate, selected_windows


def main():
    check = preflight()
    signal.signal(signal.SIGALRM, timeout)
    signal.alarm(450)
    rt = Runtime()
    window = next(w for w in selected_windows() if w["meeting"] == "IS1008b")
    rows = []
    try:
        rows.append(generate(rt, window, "native-before"))
        restore = install(rt, 0.0)
        try:
            rows.append(generate(rt, window, "zero-norm"))
        finally:
            restore()
        rows.append(generate(rt, window, "native-after"))
        expected = window["baseline"]["text"]
        result = {"preflight": check, "original_key": window["key"], "baseline_text": expected, "rows": rows,
                  "all_byte_identical_to_cached_base": all(r["text"] == expected for r in rows),
                  "native_repeat_identical": rows[0]["text"] == rows[2]["text"],
                  "zero_equals_native": rows[1]["text"] == rows[0]["text"]}
        write_json(HERE / "results/zero-control.json", result)
        print(json.dumps({k: v for k, v in result.items() if k not in ("rows", "baseline_text")}, indent=2))
    finally:
        rt.close()
        signal.alarm(0)


if __name__ == "__main__":
    main()

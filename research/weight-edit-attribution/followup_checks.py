"""One short exclusive lease: signed probe follow-up, then chronology / scope checks."""
from amplify_probes import main as probes
from contracts import model_run


if __name__ == "__main__":
    probes()  # closes and frees the first runtime before the next load
    model_run(("amplify",))

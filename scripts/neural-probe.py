"""One bounded, read-only FlyWire sequence for the home's research workbench.

The four gameplay channels are engineering assignments. This entrypoint neither
trains synapses nor calls the social-operation decision/feedback database.
"""

import argparse
import json
import math
from pathlib import Path
import sys
import time

PROTOCOL_VERSION = "home-probe-v1"
CHANNELS = {"feed": 0, "mist": 1, "chime": 2}
CHANNEL_NAMES = ["gameplay_food", "gameplay_mist", "gameplay_chime", "reserved"]


def read_request():
    raw = sys.stdin.buffer.read(4097)
    if len(raw) > 4096:
        raise ValueError("research input exceeds 4096 bytes")
    request = json.loads(raw.decode("utf-8"))
    if not isinstance(request, dict) or set(request) != {"stimulus", "intensity", "seed"}:
        raise ValueError("expected stimulus, intensity and server seed")
    if request["stimulus"] not in CHANNELS:
        raise ValueError("unsupported gameplay stimulus")
    intensity = request["intensity"]
    if type(intensity) not in (int, float) or not math.isfinite(intensity) or intensity not in (0.25, 0.5, 1):
        raise ValueError("intensity must be 0.25, 0.5 or 1")
    if type(request["seed"]) is not int or not 0 <= request["seed"] <= 0xFFFFFFFF:
        raise ValueError("seed must be an unsigned 32-bit integer")
    return request


def run(model_path, request):
    started = time.perf_counter()
    # -B and PYTHONDONTWRITEBYTECODE are also set by the Node launcher. Set the
    # interpreter flag here before importing local modules for direct CLI use.
    sys.dont_write_bytecode = True
    project = Path(__file__).resolve().parents[2]
    sys.path.insert(0, str(project))
    import numpy as np
    from fly_shadow.neural import NeuralBackend
    from experiments.behavior.probe import run_sequence

    backend = NeuralBackend(model_path)
    stimulus = np.zeros((32, 4), dtype=float)
    stimulus[8:16, CHANNELS[request["stimulus"]]] = request["intensity"]
    response = run_sequence(backend, stimulus, seed=request["seed"], mode="real")
    if response.shape != (32, 16) or not np.isfinite(response).all() or (response < 0).any():
        raise ValueError("neural backend returned an invalid response")
    return {
        **request,
        "activation": float(response[8:16].mean()),
        "recovery": float(response[16:32].mean()),
        "baseline": float(response[:8].mean()),
        "peak": float(response.max()),
        "response": response.tolist(),
        "modelFingerprint": backend.fingerprint,
        "protocolVersion": PROTOCOL_VERSION,
        "computeSeconds": round(time.perf_counter() - started, 6),
        "simulationSeconds": round(run_sequence.last_seconds, 6),
        "neuralSeconds": 1.6,
        "binMs": 50,
        "neurons": len(backend.ids),
        "edges": len(backend.pre),
        "mapping": {
            "channels": CHANNEL_NAMES,
            "activeChannel": CHANNELS[request["stimulus"]],
            "baselineBins": 8,
            "stimulusBins": 8,
            "recoveryBins": 16,
            "notice": "游戏刺激到神经输入的工程映射；未验证生物感觉语义，无长期学习。",
        },
    }


def main():
    parser = argparse.ArgumentParser(description="Read-only bounded home neural experiment")
    parser.add_argument("--model", type=Path, required=True)
    args = parser.parse_args()
    try:
        request = read_request()
        result = run(args.model, request)
        print(json.dumps(result, ensure_ascii=False, allow_nan=False, separators=(",", ":")))
        return 0
    except Exception as error:
        print(json.dumps({"error": str(error), "code": "neural_probe_failed"}, ensure_ascii=False), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

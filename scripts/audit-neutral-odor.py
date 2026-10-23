"""Independent, standard-library audit of raw neutral-cue experiment evidence.

Product 8.3.0. This reader never imports the JavaScript runner or trusts its pass flag.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
import statistics
import sys
import unittest


def checked_weights(value):
    fields = {"format", "modelVersion", "graphHash", "efficacy"}
    graph = "0b5de2a6c6b6d6265830ec91a65c8a5d11688ef01ba96c63bf75d239d4d89e3f"
    if (not isinstance(value, dict) or set(value) != fields or value["format"] != 1
            or value["modelVersion"] != "0.0.1a" or value["graphHash"] != graph
            or not isinstance(value["efficacy"], list) or len(value["efficacy"]) != 946):
        raise ValueError("Invalid weight-only neural checkpoint")
    if any(not finite(q) or not .05 <= q <= 1 for q in value["efficacy"]):
        raise ValueError("Nonfinite or out-of-range neural efficacy")
    return tuple(value["efficacy"])


def finite(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def pi(plus, minus):
    if not finite(plus) or not finite(minus) or min(plus, minus) < 0:
        raise ValueError("Invalid cue distance")
    return (minus - plus) / (minus + plus) if plus + minus else 0.0


def raw_preference(samples, rewarded_cue, protocol, mapping):
    probe = protocol["probe"]
    end, window, interval = probe["seconds"], probe["analysisWindowSeconds"], probe["sampleEverySeconds"]
    if rewarded_cue not in ("A", "B") or not isinstance(samples, list) or len(samples) < 2:
        raise ValueError("Missing complete raw probe samples")
    sources = {odor: protocol["cueSources"][side]["position"] for side, odor in protocol["mappings"][mapping].items()}
    other = "B" if rewarded_cue == "A" else "A"
    values = []
    for frame in samples:
        position, elapsed = frame.get("position"), frame.get("elapsed")
        if (not finite(elapsed) or not isinstance(position, list) or len(position) != 3
                or not all(finite(v) for v in position)):
            raise ValueError("Invalid raw position or timestamp")
        distances = {odor: math.dist(position, point) for odor, point in sources.items()}
        values.append((elapsed, pi(distances[rewarded_cue], distances[other]), distances))
    if abs(values[0][0]) > 1e-7 or abs(values[-1][0] - end) > 1e-7:
        raise ValueError("Probe does not span its declared duration")
    area = duration = 0.0
    for left, right in zip(values, values[1:]):
        dt = right[0] - left[0]
        if dt <= 0 or dt > interval + 1e-7:
            raise ValueError("Nonmonotonic or missing probe samples")
        start_at, end_at = max(end - window, left[0]), min(end, right[0])
        if end_at <= start_at:
            continue
        def interpolate(time):
            return left[1] + (right[1] - left[1]) * (time - left[0]) / dt
        area += (interpolate(start_at) + interpolate(end_at)) * .5 * (end_at - start_at)
        duration += end_at - start_at
    if abs(duration - window) > 1e-7:
        raise ValueError("Incomplete analysis window")
    return {"preferenceIndex": area / duration, "endpointPreference": values[-1][1],
            "distances": [entry[2] for entry in values], "analysisWindowSeconds": duration}


def mapping_metrics(rows, protocol):
    expected, criteria = protocol["seeds"], protocol["criteria"]
    lookup = {row["seed"]: row for row in rows}
    valid = [lookup[seed] for seed in expected if seed in lookup and lookup[seed].get("valid")]
    positive = sum(row["paired"] - row["baseline"] > 0 for row in valid)
    mean = lambda values: statistics.fmean(values) if values else None
    baseline = mean([row["baseline"] for row in valid])
    versus_unpaired = mean([row["paired"] - row["unpaired"] for row in valid])
    versus_frozen = mean([row["paired"] - row["frozen"] for row in valid])
    causal = len(valid) == len(expected) and all(row.get("causal") is True for row in valid)
    result = {"nExpectedSeeds": len(expected), "nValidSeeds": len(valid), "positiveSeeds": positive,
              "positiveFraction": positive / len(expected), "meanBaselinePreference": baseline,
              "meanPairedChange": mean([row["paired"] - row["baseline"] for row in valid]),
              "meanPairedOverUnpaired": versus_unpaired, "meanPairedOverFrozen": versus_frozen,
              "causalControlsPass": causal, "seeds": rows}
    result["pass"] = (len(valid) == len(expected) and len(lookup) == len(rows) == len(expected)
                      and positive / len(expected) >= criteria["directionFractionMin"]
                      and abs(baseline) <= criteria["baselineMeanAbsMax"]
                      and versus_unpaired > criteria["meanPairedOverUnpairedMin"]
                      and versus_frozen > criteria["meanPairedOverFrozenMin"] and causal)
    result["rewardedCueGroups"] = {}
    for cue in ("A", "B"):
        group = [row for row in valid if ("A" if row["seed"] % 2 == 0 else "B") == cue]
        result["rewardedCueGroups"][cue] = {"nExpectedSeeds": sum(("A" if seed % 2 == 0 else "B") == cue for seed in expected),
                                            "nValidSeeds": len(group), "positiveSeeds": sum(row["paired"] > row["baseline"] for row in group),
                                            "meanPairedChange": mean([row["paired"] - row["baseline"] for row in group])}
    return result


def read_json(file):
    def unique(pairs):
        value = {}
        for key, item in pairs:
            if key in value:
                raise ValueError(f"Duplicate JSON key: {key}")
            value[key] = item
        return value
    return json.loads(Path(file).read_text(encoding="utf-8"), object_pairs_hook=unique,
                      parse_constant=lambda token: (_ for _ in ()).throw(ValueError("Nonfinite JSON token: " + token)))


def first_value(record, names):
    return next((record[name] for name in names if name in record), None)


class RawAuditor:
    def __init__(self, directory):
        self.directory = Path(directory).resolve()
        self.root = Path(__file__).resolve().parents[1]
        self.lock_path = self.directory / "run-lock.json"
        self.lock = read_json(self.lock_path)
        self.protocol = self.lock["protocol"]
        self.issues, self.limits, self.files = [], [], {}
        self.mapping_rows = {name: [] for name in self.protocol["mappings"]}
        self.training_runs = self.probes = 0

    def expect(self, condition, code, context, detail):
        if not condition:
            self.issues.append({"code": code, "context": context, "detail": detail})
        return bool(condition)

    def read(self, name):
        file = self.directory / name
        raw = file.read_bytes()
        self.files[name] = hashlib.sha256(raw).hexdigest()
        return read_json(file)

    def checked(self, value, context):
        try:
            return checked_weights(value)
        except (ValueError, KeyError, TypeError) as error:
            self.expect(False, "weights", context, str(error))
            return None

    def audit_training(self, record, name, seed, paired=None):
        self.training_runs += 1
        before = len(self.issues)
        context = f"seed-{seed}/training/{name}"
        protocol, dt = self.protocol["training"], self.protocol["probe"]["stepSeconds"]
        initial = self.checked(record.get("initialWeights"), context + "/initial")
        final = self.checked(record.get("finalWeights"), context + "/final")
        self.expect(record.get("status") == "complete", "incomplete", context, "Training did not complete")
        self.expect(initial and all(q == 1 for q in initial), "initial-training-q", context, "Training must start from q=1")
        if name == "frozen":
            self.expect(final and all(q == 1 for q in final), "frozen-q", context, "Frozen experience changed efficacy")
        trials, consumes, rewards = record.get("trials", []), record.get("consumptionEvents", []), record.get("rewardEvents", [])
        count = protocol["trials"]
        self.expect(len(trials) == len(consumes) == len(rewards) == count, "training-event-count", context, "Expected exactly six trials, bites and PAM events")
        amounts, exposures, durations, gap_records = [], [], [], []
        for index, (trial, event, reward) in enumerate(zip(trials, consumes, rewards)):
            item = context + f"/trial-{index}"
            self.expect(event.get("resource", {}).get("id") == protocol["food"], "training-food", item, "Bite must consume actual declared food")
            duration = event.get("deltaAteSeconds")
            self.expect(finite(duration) and abs(duration - dt) < 1e-8, "bite-duration", item, "Only one actual physics consumption tick is allowed")
            durations.append(duration if finite(duration) else 0)
            amount = first_value(event, ("consumedAmount", "deltaConsumedAmount", "consumedAmountDelta", "amount"))
            self.expect(finite(amount) and amount > 0, "missing-raw-consumed-amount", item, "Record actual per-bite amount, not only a summary total")
            amounts.append(amount if finite(amount) else None)
            scale = first_value(event, ("bodyScale", "bodyScaleAtConsumption", "bodyScaleBeforeStep"))
            if finite(scale) and finite(amount) and finite(duration):
                expected_amount = duration * .25 * (.1 + .15 * (scale / .0483018))
                self.expect(abs(expected_amount - amount) <= 1e-10, "nutrient-amount", item, "Bite amount disagrees with original physical consumption rate")
            elif not finite(scale):
                self.limits.append(item + ": bodyScale not recorded; original consumption rate cannot be independently recalculated")
            self.expect(reward.get("trial") == index and reward.get("pulse") == index + 1
                        and reward.get("consumedThisStep") is True and finite(event.get("time"))
                        and finite(reward.get("time")) and abs(event["time"] - reward["time"]) < 1e-8,
                        "reward-causality", item, "PAM must follow the genuine bite in the same step")
            self.expect(trial.get("bite") == event, "trial-bite-link", item, "Trial and raw bite ledger disagree")
            self.expect(abs(trial.get("simulatedSeconds", -1) - protocol["trialSeconds"]) < 1e-7,
                        "training-window", item, "Trial duration changed")
            cue_ticks = trial.get("cueTicks")
            self.expect(isinstance(cue_ticks, int) and cue_ticks > 0
                        and abs(trial.get("cueExposureMs", -1) - cue_ticks * dt * 1000) < 1e-7,
                        "cue-exposure", item, "Invalid cue duration")
            exposures.append(cue_ticks)
            on = first_value(trial, ("cueStartStep", "actualCueStartStep"))
            off = first_value(trial, ("cueEndStep", "actualCueEndStep"))
            transitions = trial.get("cueTransitions")
            if isinstance(transitions, list):
                on_events = [entry for entry in transitions if entry.get("event") == "on"]
                off_events = [entry for entry in transitions if entry.get("event") == "off"]
                if on is None and len(on_events) == 1:
                    on = on_events[0].get("step")
                if off is None and len(off_events) == 1:
                    off = off_events[0].get("step")
                self.expect(len(transitions) == 2 and len(on_events) == len(off_events) == 1,
                            "cue-transition-count", item, "Exactly one cue onset and offset are required")
                for transition in transitions:
                    step, start_clock, start_time = transition.get("step"), trial.get("startClock"), trial.get("startTime")
                    clock = first_value(transition, ("clockMsBeforeStep", "clockMs"))
                    time = first_value(transition, ("simSecondsBeforeStep", "time"))
                    self.expect(isinstance(step, int) and finite(start_clock) and finite(start_time)
                                and finite(clock) and finite(time) and abs(clock - start_clock - step * dt * 1000) <= 1e-7
                                and abs(time - start_time - step * dt) <= 1e-7,
                                "cue-transition-clock", item, "Raw onset/offset times do not match their declared step clocks")
            self.expect(isinstance(on, int) and isinstance(off, int) and off - on == cue_ticks,
                        "cue-time-ledger", item, "Exact cue-on/off steps are needed to verify temporal control")
            self.expect(isinstance(transitions, list) and len(transitions) >= 2,
                        "cue-transition-ledger", item, "Cue timing must have raw onset and offset events")
            if isinstance(on, int) and isinstance(off, int):
                self.expect(off * dt <= protocol["trialSeconds"] - protocol["unpairedGapSeconds"] + 1e-8,
                            "between-trial-gap", item, "Cue cannot overlap the next trial reward eligibility")
                if name == "paired":
                    self.expect(on <= event.get("step", -1) < off, "paired-overlap", item, "Paired cue absent at the actual bite")
                if name == "unpaired":
                    actual_gap = (on - event.get("step", -1) - 1) * dt * 1000
                    gap_records.append(actual_gap)
                    self.expect(actual_gap >= protocol["unpairedGapSeconds"] * 1000 - 1e-7,
                                "unpaired-gap", item, "Unpaired cue starts before the natural blank finishes")
            if name == "unpaired":
                for trace_name, trace in (("pre-cue", trial.get("unpairedTrace")),
                                          ("pre-bite", first_value(event, ("preBiteTrace", "traceBeforeBite", "unpairedTraceBeforeStep"))
                                           or first_value(trial, ("preBiteTrace", "traceBeforeBite")))):
                    valid_trace = isinstance(trace, dict) and all(key in trace for key in ("eligibilityMax", "dopamineMean", "dopamineMax"))
                    self.expect(valid_trace and all(finite(v) and 0 <= v <= protocol["traceTolerance"] for v in trace.values()),
                                "natural-trace-decay", item + "/" + trace_name, "Both reward-to-cue and cue-to-next-reward residuals must be measured below threshold")
        if paired:
            for index, (amount, expected) in enumerate(zip(amounts, paired["amounts"])):
                self.expect(finite(amount) and finite(expected) and abs(amount - expected) <= 1e-10,
                            "matched-food-dose", context + f"/trial-{index}", "Control real food amount differs from paired training")
            self.expect(exposures == paired["cueTicks"], "matched-cue-dose", context, "Control exposure differs from paired training")
        return {"valid": len(self.issues) == before, "amounts": amounts, "cueTicks": exposures,
                "ateSeconds": sum(durations), "totalConsumedAmount": sum(v for v in amounts if finite(v)),
                "naturalGapsMs": gap_records, "weights": final,
                "maximumWeightChange": max((1 - q for q in final), default=None) if final else None}

    def audit_probe(self, record, name, mapping, seed, rewarded):
        self.probes += 1
        before = len(self.issues)
        context = f"seed-{seed}/{mapping}/{name}"
        self.expect(record.get("status") == "complete", "incomplete-probe", context, "Probe did not complete")
        initial = self.checked(record.get("initialWeights"), context + "/initial")
        final = self.checked(record.get("finalWeights"), context + "/final")
        self.expect(initial is not None and initial == final, "probe-q-drift", context, "Frozen probe changed synapses")
        weight_canonical = record.get("initialWeightCanonical")
        weight_sha = None
        if isinstance(weight_canonical, str):
            weight_sha = hashlib.sha256(weight_canonical.encode("utf-8")).hexdigest()
            self.expect(json.loads(weight_canonical) == record.get("initialWeights")
                        and record.get("finalWeightCanonical") == weight_canonical
                        and record.get("initialWeightSHA256") == weight_sha,
                        "canonical-weights", context, "Canonical raw weight bytes, schema or fingerprint differ")
        else:
            self.expect(False, "canonical-weights", context, "Raw canonical neural checkpoint bytes are missing")
        support = record.get("initialSupport", {})
        self.expect(support.get("supportedFeet") == 6 and support.get("foodContact") is None,
                    "release-support", context, "Food-free release must have six supported feet and no food contact")
        samples = record.get("samples", [])
        try:
            metric = raw_preference(samples, rewarded, self.protocol, mapping)
        except (ValueError, KeyError, TypeError) as error:
            self.expect(False, "raw-preference", context, str(error))
            metric = {"preferenceIndex": None, "endpointPreference": None, "distances": []}
        stored = record.get("summary", {}).get("preferenceIndex")
        self.expect(finite(stored) and finite(metric["preferenceIndex"]) and abs(stored - metric["preferenceIndex"]) < 1e-10,
                    "stored-pi", context, "Runner preference disagrees with independent raw-coordinate integration")
        physical = []
        for index, frame in enumerate(samples):
            item = context + f"/sample-{index}"
            self.expect(isinstance(frame.get("foodStock"), dict) and len(frame["foodStock"]) == 7
                        and all(value == 0 for value in frame["foodStock"].values()), "probe-food", item, "All seven actual food stocks must remain zero")
            home_food = first_value(frame, ("homeFood", "homeFoodTotal"))
            self.expect(home_food == 0, "probe-home-food", item, "The aggregate food supply must be recorded and zero")
            self.expect(frame.get("rewardPulses") == 0, "probe-pam", item, "Probe reward pulse counter must remain zero")
            self.expect(frame.get("ateSeconds") == samples[0].get("ateSeconds"), "probe-consumption", item, "Probe must not consume food")
            route = frame.get("route")
            self.expect(not isinstance(route, dict) or not str(route.get("targetId", "")).startswith(("cue-", "neutral-")),
                        "cue-route", item, "Cue must never become an original navigation target")
            if index < len(metric["distances"]):
                for odor, expected in metric["distances"][index].items():
                    value = frame.get("distances", {}).get(odor)
                    self.expect(finite(value) and abs(value - expected) <= 1e-10,
                                "stored-distance", item, "Raw position disagrees with recorded cue distance")
            for signal in frame.get("cueSignals", []):
                self.expect(signal.get("resourceKind") is None, "cue-food-tag", item, "Independent cue was labeled as a food resource")
            physical.append({key: frame.get(key) for key in ("elapsed", "position", "velocity", "heading", "action", "ateSeconds", "foodStock", "rewardPulses", "route", "motor", "originalMotorStep", "originalMotorRNG")})
        self.expect(samples and samples[-1].get("originalMotorStep", 0) > 0,
                    "original-motor", context, "Original neural motor must actually advance")
        full_trace = record.get("physicsTrace", [])
        expected_ticks = round(self.protocol["probe"]["seconds"] / self.protocol["probe"]["stepSeconds"])
        self.expect(len(full_trace) == expected_ticks, "full-physics-trace", context, "Complete per-physics-tick evidence is required")
        trajectory_digest = hashlib.sha256()
        physical_ticks = []
        for index, step in enumerate(full_trace):
            item = context + f"/physics-{index + 1}"
            canonical, trajectory, invariants = step.get("trajectoryCanonical"), step.get("trajectory"), step.get("invariants", {})
            self.expect(step.get("step") == index + 1
                        and finite(step.get("elapsed"))
                        and abs(step["elapsed"] - (index + 1) * self.protocol["probe"]["stepSeconds"]) < 1e-8,
                        "physics-clock", item, "Missing or out-of-order physics ticks")
            if isinstance(canonical, str):
                trajectory_digest.update(canonical.encode("utf-8"))
                self.expect(json.loads(canonical) == trajectory, "canonical-trajectory", item, "Recorded canonical tick does not encode its raw physical data")
            else:
                self.expect(False, "canonical-trajectory", item, "Canonical full-tick physical data is missing")
            vector = lambda values: isinstance(values, list) and len(values) == 3 and all(finite(value) for value in values)
            motor = trajectory.get("motor", {}) if isinstance(trajectory, dict) else {}
            self.expect(isinstance(trajectory, dict) and vector(trajectory.get("position"))
                        and vector(trajectory.get("velocity")) and finite(trajectory.get("heading"))
                        and isinstance(motor, dict) and vector(motor.get("local"))
                        and finite(motor.get("drive")) and 0 <= motor["drive"] <= 1.4,
                        "finite-physics", item, "Every recorded physical position and original neural motor output must be finite")
            physical_ticks.append(trajectory)
            self.check_probe_invariants(invariants, weight_sha, item)
            sample_interval = round(self.protocol["probe"]["sampleEverySeconds"] / self.protocol["probe"]["stepSeconds"])
            if (index + 1) % sample_interval == 0 and len(samples) > (index + 1) // sample_interval:
                sampled = samples[(index + 1) // sample_interval]
                linked = {"position": "position", "velocity": "velocity", "heading": "heading", "action": "action", "motor": "motor", "step": "originalMotorStep", "rng": "originalMotorRNG", "route": "route", "ate": "ateSeconds"}
                self.expect(isinstance(trajectory, dict) and all(trajectory.get(raw_key) == sampled.get(sample_key) for raw_key, sample_key in linked.items()),
                            "sample-physics-link", item, "0.1-second sample does not match the recorded underlying physics tick")
        self.check_probe_invariants(record.get("initialIntegrity", {}), weight_sha, context + "/initial-invariants")
        self.expect(trajectory_digest.hexdigest() == record.get("trajectoryHash"),
                    "trajectory-digest", context, "Independent SHA256 of full raw tick ledger differs")
        return {"valid": len(self.issues) == before, "preference": metric["preferenceIndex"],
                "endpointPreference": metric["endpointPreference"], "weights": initial,
                "physical": physical, "trajectoryHash": record.get("trajectoryHash"),
                "physicsTicks": physical_ticks,
                "initialStateHash": record.get("summary", {}).get("initialStateHash")}

    def check_probe_invariants(self, values, weight_sha, context):
        self.expect(values.get("homeFood") == 0 and isinstance(values.get("foodStock"), dict)
                    and len(values["foodStock"]) == 7 and all(value == 0 for value in values["foodStock"].values()),
                    "physics-food", context, "Real per-tick food supply must stay empty")
        self.expect(values.get("ateSeconds") == 0 and values.get("consumedAmount") == 0,
                    "physics-consumption", context, "Actual food was consumed during the probe")
        self.expect(values.get("rewardEnabled") is False and values.get("rewardPulses") == 0 and values.get("rewardUntilMs") == 0,
                    "physics-pam", context, "Teaching must be off at every physics tick")
        self.expect(values.get("frozen") is True and values.get("weightSHA256") == weight_sha,
                    "physics-plasticity", context, "Probe was not frozen or changed neural weights")
        self.expect(values.get("synapticForaging") is False
                    and not any(str(values.get(key, "")).startswith(("cue-", "neutral-")) for key in ("navigationTarget", "routeTarget")),
                    "physics-navigation", context, "Original food navigation must remain enabled and independent cues must not become route targets")

    def audit_seed(self, seed):
        record = self.read(f"seed-{seed}.json")
        before = len(self.issues)
        context = f"seed-{seed}"
        self.expect(record.get("seed") == seed and record.get("status") == "complete", "seed-complete", context, "Missing or incomplete declared seed")
        hashes = self.lock["sourceHashes"]
        self.expect(record.get("sourceHashesBefore") == hashes and record.get("sourceHashesAfter") == hashes,
                    "historic-source-drift", context, "Seed source hashes differ from preregistration")
        rewarded = "A" if seed % 2 == 0 else "B"
        self.expect(record.get("rewardedCue") == rewarded, "reward-counterbalance", context, "Reward identity violates the predeclared seed rule")
        trainings = {}
        for name in ("paired", "unpaired", "frozen"):
            raw = self.read(f"seed-{seed}-{name}-training.json")
            self.expect(raw == record.get("training", {}).get(name), "training-file-link", context + "/" + name, "Per-condition evidence and seed file disagree")
            trainings[name] = self.audit_training(raw, name, seed, trainings.get("paired") if name != "paired" else None)
        no_cue_record = self.read(f"seed-{seed}-no-cue.json")
        no_cue = self.audit_probe(no_cue_record, "no-cue", "native", seed, rewarded)
        for mapping in self.protocol["mappings"]:
            probes = {}
            group_before = len(self.issues)
            for name in self.protocol["conditions"]:
                raw = self.read(f"seed-{seed}-{name}-{mapping}.json")
                self.expect(raw == record.get("mappings", {}).get(mapping, {}).get("conditions", {}).get(name),
                            "probe-file-link", context + "/" + mapping + "/" + name, "Per-condition evidence and seed file disagree")
                probes[name] = self.audit_probe(raw, name, mapping, seed, rewarded)
            baseline = probes["baseline"]
            for name in ("baseline", "frozen", "erased"):
                probe = probes[name]
                self.expect(probe["physical"] == no_cue["physical"] and probe["physicsTicks"] == no_cue["physicsTicks"] and probe["trajectoryHash"] == no_cue["trajectoryHash"],
                            "neutral-trajectory", context + "/" + mapping + "/" + name, "Untrained/frozen/erased cue must reproduce the no-cue physical trajectory")
                self.expect(probe["weights"] and all(q == 1 for q in probe["weights"]),
                            "neutral-q", context + "/" + mapping + "/" + name, "Baseline/frozen/erased weights must all equal one")
            self.expect(probes["paired"]["physical"] == probes["restored"]["physical"]
                        and probes["paired"]["physicsTicks"] == probes["restored"]["physicsTicks"]
                        and probes["paired"]["trajectoryHash"] == probes["restored"]["trajectoryHash"],
                        "weight-restoration", context + "/" + mapping, "Weight restoration did not reproduce the learned physical trajectory")
            for name, probe in probes.items():
                self.expect(probe["physical"] and probe["physical"][0] == baseline["physical"][0]
                            and probe["initialStateHash"] == baseline["initialStateHash"],
                            "initial-state", context + "/" + mapping + "/" + name, "Probe initial physical/motor state differs")
                if name in ("paired", "restored", "unpaired", "frozen"):
                    expected = trainings["paired" if name == "restored" else name]["weights"]
                    self.expect(probe["weights"] == expected, "weight-transplant", context + "/" + mapping + "/" + name,
                                "Probe did not load the declared training-only weights")
            valid = all(probe["valid"] for probe in probes.values()) and all(finite(probe["preference"]) for probe in probes.values())
            self.mapping_rows[mapping].append({"seed": seed, "rewardedCue": rewarded, "valid": valid,
                                               "causal": len(self.issues) == group_before and all(t["valid"] for t in trainings.values()) and no_cue["valid"],
                                               **{name: probe["preference"] for name, probe in probes.items()}})
        return {"seed": seed, "issues": len(self.issues) - before,
                "training": {name: {key: value for key, value in training.items() if key != "weights"} for name, training in trainings.items()}}

    def run(self):
        protocol = self.protocol
        expected = list(range(3100, 3102)) if protocol.get("phase") == "development-pilot" else list(range(6100, 6108))
        self.expect(protocol.get("seeds") == expected, "declared-seeds", "run-lock", "Pilot/formal seeds must stay separate and use the declared independent denominator")
        seeds = []
        for seed in protocol["seeds"]:
            try:
                seeds.append(self.audit_seed(seed))
            except (OSError, ValueError, KeyError, TypeError, IndexError) as error:
                self.expect(False, "seed-evidence-error", f"seed-{seed}", str(error))
        source_changes = []
        for name, expected_sha in self.lock["sourceHashes"].items():
            file = (self.root / name).resolve()
            try:
                file.relative_to(self.root)
                actual = hashlib.sha256(file.read_bytes()).hexdigest()
                if actual != expected_sha:
                    source_changes.append(name)
            except (OSError, ValueError):
                source_changes.append(name)
        self.expect(not source_changes, "current-source-drift", "source-hashes", str(source_changes))
        self.expect(self.lock["sourceHashes"].get("src/functional-connectome.json") == "bb60bd82b8274e9530c3534ebe02f12284b6baabcddd8d2535088cfb56e6be2c",
                    "original-connectome", "source-hashes", "Original 4386-cell control graph changed")
        mappings = {name: mapping_metrics(rows, protocol) for name, rows in self.mapping_rows.items()}
        stored_summary = self.read("summary.json")
        for name, values in mappings.items():
            for key in ("positiveSeeds", "meanBaselinePreference", "meanPairedChange", "meanPairedOverUnpaired", "meanPairedOverFrozen"):
                stored = stored_summary.get("mappings", {}).get(name, {}).get(key)
                actual = values[key]
                self.expect(finite(actual) and finite(stored) and abs(actual - stored) < 1e-9,
                            "summary-recalculation", name + "/" + key, "Stored metric disagrees with independent coordinate/event audit")
        evidence_pass = not any(issue["code"] != "current-source-drift" for issue in self.issues)
        behavior_pass = all(value["pass"] for value in mappings.values())
        return {"format": 1, "productVersion": "8.3.0", "phase": protocol["phase"],
                "auditedAt": datetime.now(timezone.utc).isoformat(),
                "method": "Independent Python standard-library integration from raw positions and locked cue locations; actual bite/reward/cue-event ledgers, neural efficacy and source SHA256 verification. Does not import the JS evaluator or rely on summary.pass.",
                "scope": "Both cue layouts reuse the same declared individuals; do not add their seed denominators. The comparison odor was not presented during training, not a trained CS-minus. A+ and B+ are counterbalanced across individuals. Cue preference is distinct from autonomous food discovery or biological memory.",
                "nIndependentSeeds": len(protocol["seeds"]), "nTrainingRuns": self.training_runs, "nProbes": self.probes,
                "runLockSHA256": hashlib.sha256(self.lock_path.read_bytes()).hexdigest(),
                "auditorSHA256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
                "lockedSourceCount": len(self.lock["sourceHashes"]), "currentSourceChanges": source_changes,
                "evidenceFilesSHA256": self.files, "issues": self.issues, "verificationLimits": sorted(set(self.limits)) + [
                    "All recorded physical ticks and their canonical SHA256 are independently checked; per-tick neural weights are represented by canonical checkpoint hashes rather than 946 raw values at every tick.",
                    "Complete initial membrane arrays are represented by the writer's initial-state hash; independently compared initial raw physical/motor samples corroborate the fresh-instance design."],
                "mappings": mappings, "seeds": seeds, "rawEvidenceIntegrityPass": evidence_pass,
                "predeclaredBehaviorPass": behavior_pass, "currentSourcesMatchLock": not source_changes,
                "pass": evidence_pass and behavior_pass and not source_changes}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run", required=True, type=Path, help="Existing preregistered output directory")
    parser.add_argument("--out", type=Path, help="New audit JSON path; existing files are never overwritten")
    args = parser.parse_args()
    output = args.out or args.run / "independent-audit.json"
    if output.exists():
        parser.error("Audit output already exists; use a new --out filename")
    report = RawAuditor(args.run).run()
    with output.open("x", encoding="utf-8", newline="\n") as handle:
        json.dump(report, handle, ensure_ascii=False, indent=2, allow_nan=False)
        handle.write("\n")
    print(json.dumps({"pass": report["pass"], "rawEvidenceIntegrityPass": report["rawEvidenceIntegrityPass"],
                      "predeclaredBehaviorPass": report["predeclaredBehaviorPass"],
                      "currentSourcesMatchLock": report["currentSourcesMatchLock"],
                      "nIndependentSeeds": report["nIndependentSeeds"],
                      "nTrainingRuns": report["nTrainingRuns"], "nProbes": report["nProbes"],
                      "issues": len(report["issues"]), "output": str(output)}, ensure_ascii=False))
    return 0 if report["pass"] else 1


class IndependentAuditTests(unittest.TestCase):
    def test_weight_schema_rejects_nonfinite_out_of_range_and_extra_state(self):
        valid = {"format": 1, "modelVersion": "0.0.1a", "graphHash": "0b5de2a6c6b6d6265830ec91a65c8a5d11688ef01ba96c63bf75d239d4d89e3f", "efficacy": [1.0] * 946}
        self.assertEqual(len(checked_weights(valid)), 946)
        for corrupt in ({**valid, "v": []}, {**valid, "efficacy": [1.0] * 945},
                        {**valid, "efficacy": [float("nan")] * 946},
                        {**valid, "efficacy": [.049] * 946},
                        {**valid, "efficacy": [1.001] * 946}):
            with self.assertRaises(ValueError):
                checked_weights(corrupt)

    def test_preference_uses_locked_positions_and_tail_window_not_stored_distances(self):
        protocol = {"probe": {"seconds": 20, "analysisWindowSeconds": 10, "sampleEverySeconds": 5},
                    "cueSources": {"left": {"position": [-1, 0, 0]}, "right": {"position": [1, 0, 0]}},
                    "mappings": {"native": {"left": "A", "right": "B"}}}
        samples = [{"elapsed": 0, "position": [-1, 0, 0]}, {"elapsed": 5, "position": [-1, 0, 0]},
                   {"elapsed": 10, "position": [-1, 0, 0]}, {"elapsed": 15, "position": [1, 0, 0]},
                   {"elapsed": 20, "position": [1, 0, 0]}]
        value = raw_preference(samples, "A", protocol, "native")
        self.assertAlmostEqual(value["preferenceIndex"], -.5)
        self.assertEqual(value["endpointPreference"], -1)

    def test_missing_or_nonmonotonic_samples_are_not_integrated(self):
        p = {"probe": {"seconds": 20, "analysisWindowSeconds": 10, "sampleEverySeconds": .1},
             "cueSources": {"left": {"position": [-1, 0, 0]}, "right": {"position": [1, 0, 0]}},
             "mappings": {"native": {"left": "A", "right": "B"}}}
        for samples in ([{"elapsed": 0, "position": [0, 0, 0]}, {"elapsed": 20, "position": [0, 0, 0]}],
                        [{"elapsed": 0, "position": [0, 0, 0]}, {"elapsed": 0, "position": [0, 0, 0]}]):
            with self.assertRaises(ValueError):
                raw_preference(samples, "A", p, "native")

    def test_primary_gate_keeps_eight_seed_denominator_and_strict_point_two(self):
        p = {"seeds": list(range(6100, 6108)), "criteria": {"directionFractionMin": .75,
             "meanPairedOverUnpairedMin": .2, "meanPairedOverFrozenMin": .2, "baselineMeanAbsMax": .2}}
        rows = [{"seed": seed, "baseline": 0, "paired": .5, "unpaired": 0, "frozen": 0,
                 "causal": True, "valid": True} for seed in p["seeds"]]
        self.assertTrue(mapping_metrics(rows, p)["pass"])
        self.assertFalse(mapping_metrics(rows[:-1], p)["pass"])
        for row in rows:
            row["paired"] = .2
        self.assertFalse(mapping_metrics(rows, p)["pass"])

    def synthetic_probe(self):
        weights = {"format": 1, "modelVersion": "0.0.1a", "graphHash": "0b5de2a6c6b6d6265830ec91a65c8a5d11688ef01ba96c63bf75d239d4d89e3f", "efficacy": [1] * 946}
        canonical = json.dumps(weights, separators=(",", ":"))
        digest = hashlib.sha256(canonical.encode()).hexdigest()
        foods = dict.fromkeys(("apple", "banana", "burger", "pizza", "fries", "sandwich", "fig"), 0)
        protocol = {"probe": {"seconds": 2, "analysisWindowSeconds": 1, "sampleEverySeconds": .5, "stepSeconds": .5},
                    "cueSources": {"left": {"position": [-1, 0, 0]}, "right": {"position": [1, 0, 0]}},
                    "mappings": {"native": {"left": "A", "right": "B"}}}
        invariant = {"homeFood": 0, "foodStock": foods, "ateSeconds": 0, "consumedAmount": 0,
                     "rewardEnabled": False, "rewardPulses": 0, "rewardUntilMs": 0, "frozen": True,
                     "weightSHA256": digest, "navigationTarget": None, "routeTarget": None, "synapticForaging": False}
        record = {"status": "complete", "initialWeights": weights, "finalWeights": weights,
                  "initialWeightCanonical": canonical, "finalWeightCanonical": canonical, "initialWeightSHA256": digest,
                  "initialSupport": {"supportedFeet": 6, "foodContact": None}, "samples": [], "physicsTrace": [],
                  "initialIntegrity": invariant, "summary": {"preferenceIndex": 0, "initialStateHash": "fixed"}}
        trace_hash = hashlib.sha256()
        for i in range(5):
            motor = {"local": [0, 0, 0], "drive": 0}
            record["samples"].append({"elapsed": i * .5, "position": [0, 0, 0], "velocity": [0, 0, 0],
                                      "heading": 0, "action": "observe", "distances": {"A": 1, "B": 1},
                                      "ateSeconds": 0, "foodStock": foods, "rewardPulses": 0, "homeFood": 0,
                                      "route": None, "motor": motor, "originalMotorStep": i * 400, "originalMotorRNG": 1})
            if i:
                physical = {"position": [0, 0, 0], "velocity": [0, 0, 0], "heading": 0, "action": "observe",
                            "motor": motor, "step": i * 400, "rng": 1, "route": None, "ate": 0}
                serialized = json.dumps(physical, separators=(",", ":"))
                trace_hash.update(serialized.encode())
                record["physicsTrace"].append({"step": i, "elapsed": i * .5, "trajectory": physical,
                                                "trajectoryCanonical": serialized, "invariants": invariant})
        record["trajectoryHash"] = trace_hash.hexdigest()
        return protocol, record

    def test_full_tick_audit_recomputes_hash_and_detects_reward_weight_or_geometry_tampering(self):
        def audit(record, protocol):
            auditor = RawAuditor.__new__(RawAuditor)
            auditor.protocol, auditor.issues, auditor.limits, auditor.probes = protocol, [], [], 0
            result = auditor.audit_probe(record, "paired", "native", 6100, "A")
            return result, auditor.issues
        protocol, clean = self.synthetic_probe()
        self.assertTrue(audit(clean, protocol)[0]["valid"])
        for change in (lambda value: value["physicsTrace"][0]["invariants"].update(rewardPulses=1),
                       lambda value: value["physicsTrace"][0]["invariants"].update(weightSHA256="wrong"),
                       lambda value: value["samples"][2]["distances"].update(A=99),
                       lambda value: value["physicsTrace"][0]["trajectory"].update(heading=1)):
            corrupted = json.loads(json.dumps(clean))
            change(corrupted)
            self.assertFalse(audit(corrupted, protocol)[0]["valid"])


if __name__ == "__main__":
    if "--self-test" in sys.argv:
        unittest.main(argv=[sys.argv[0]])
    else:
        raise SystemExit(main())

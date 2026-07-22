"""Generate the Pythagorean three-body playback with AMBER 0.4.4.

The three masses begin at rest at the vertices of a 3-4-5 triangle. A tiny
Plummer softening length regularizes otherwise singular near-collisions. Each
AMBER step advances a fixed output interval using adaptive RK4 substeps. A run
stops for playback only after a bound pair and an outward, positive-energy
escaper persist for ten simulated time units. The browser later renders
exported RunResults; it does not integrate.

Run from the repository root:
    python blog/generate_amber_three_body_frames.py
"""

from __future__ import annotations

import hashlib
import json
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import ambr as am
import numpy as np
import polars as pl


G = 1.0
SOFTENING = 1e-4
OUTPUT_DT = 0.02
MAX_STEPS = 40000
EXPORT_STRIDE = 5
MAX_SUBSTEP = 0.01
MIN_SUBSTEP = 1e-14
WORKERS = 5
STABILITY_WINDOW = 10.0
MIN_ESCAPER_DISTANCE = 12.0
MIN_DISTANCE_RATIO = 8.0
MASS3_VALUES = (2.9, 2.95, 3.0, 3.05, 3.1)
DX_VALUES = (-0.001, -0.0005, 0.0, 0.001)
RTOL = 1e-9
BASE_X = np.array([1.0, -2.0, 1.0])
BASE_Y = np.array([3.0, -1.0, -1.0])


def initial_conditions(mass3, dx):
    masses = np.array([mass3, 4.0, 5.0])
    x = BASE_X.copy(); y = BASE_Y.copy()
    x[0] += dx
    x -= np.sum(masses * x) / np.sum(masses)
    y -= np.sum(masses * y) / np.sum(masses)
    return x, y, masses


def accelerations(x, y, masses):
    dx = x[None, :] - x[:, None]
    dy = y[None, :] - y[:, None]
    r2 = dx * dx + dy * dy + SOFTENING * SOFTENING
    np.fill_diagonal(r2, np.inf)
    inv_r3 = r2**-1.5
    return (
        G * np.sum(masses[None, :] * dx * inv_r3, axis=1),
        G * np.sum(masses[None, :] * dy * inv_r3, axis=1),
    )


def derivatives(state, masses):
    x, y, vx, vy = np.split(state, 4)
    ax, ay = accelerations(x, y, masses)
    return np.concatenate((vx, vy, ax, ay))


def rk4_step(state, h, masses):
    k1 = derivatives(state, masses)
    k2 = derivatives(state + 0.5 * h * k1, masses)
    k3 = derivatives(state + 0.5 * h * k2, masses)
    k4 = derivatives(state + h * k3, masses)
    return state + h * (k1 + 2 * k2 + 2 * k3 + k4) / 6


def total_energy(x, y, vx, vy, masses):
    kinetic = 0.5 * np.sum(masses * (vx * vx + vy * vy))
    potential = 0.0
    for i in range(3):
        for j in range(i + 1, 3):
            separation = np.hypot(x[j] - x[i], y[j] - y[i])
            potential -= G * masses[i] * masses[j] / np.sqrt(
                separation * separation + SOFTENING * SOFTENING
            )
    return float(kinetic + potential)


def minimum_separation(x, y):
    return float(min(
        np.hypot(x[j] - x[i], y[j] - y[i])
        for i in range(3) for j in range(i + 1, 3)
    ))


def energy_reporter(model):
    return total_energy(
        model.agents.numpy("x"), model.agents.numpy("y"),
        model.agents.numpy("vx"), model.agents.numpy("vy"),
        model.agents.numpy("mass")
    )


def separation_reporter(model):
    return minimum_separation(model.agents.numpy("x"), model.agents.numpy("y"))


def substeps_reporter(model):
    return model.last_substeps


class PythagoreanTriple(am.Model):
    params = {
        "rtol": (float, RTOL),
        "mass3": (float, 3.0),
        "dx": (float, 0.0),
    }
    model_reporters = {
        "energy": energy_reporter,
        "min_separation": separation_reporter,
        "substeps": substeps_reporter,
    }
    agent_reporters = ["x", "y", "vx", "vy"]
    record_initial = True

    def setup(self):
        self.last_substeps = 0
        self.next_substep = MAX_SUBSTEP
        x, y, masses = initial_conditions(self.p.mass3, self.p.dx)
        self.add_agents(
            3,
            x=x,
            y=y,
            vx=np.zeros(3),
            vy=np.zeros(3),
            mass=masses,
        )

    def step_vectorized(self):
        x, _ = self.agents.borrow("x"); y, _ = self.agents.borrow("y")
        vx, _ = self.agents.borrow("vx"); vy, _ = self.agents.borrow("vy")
        masses, _ = self.agents.borrow("mass")
        state = np.concatenate((x, y, vx, vy))
        remaining = OUTPUT_DT
        accepted = 0
        attempts = 0
        h = min(self.next_substep, remaining)
        while remaining > 1e-14:
            h = min(h, remaining)
            whole = rk4_step(state, h, masses)
            half = rk4_step(rk4_step(state, 0.5 * h, masses), 0.5 * h, masses)
            scale = (0.05 * self.p.rtol) + self.p.rtol * np.maximum(np.abs(state), np.abs(half))
            error = float(np.max(np.abs(half - whole) / (15 * scale)))
            attempts += 1
            if error <= 1:
                state = half + (half - whole) / 15
                remaining -= h
                accepted += 1
                factor = 2.0 if error == 0 else min(2.5, 0.9 * error**-0.2)
                h = min(MAX_SUBSTEP, h * factor)
            else:
                h *= max(0.1, 0.9 * error**-0.2)
                if h < MIN_SUBSTEP:
                    raise RuntimeError("Required substep fell below MIN_SUBSTEP")
            if attempts > 250000:
                raise RuntimeError("Adaptive integration failed to advance")

        self.next_substep = h
        self.last_substeps = accepted
        x, y, vx, vy = np.split(state, 4)
        self.agents.commit(x=x, y=y, vx=vx, vy=vy)


def stable_configuration(positions, velocities, masses):
    pair_states = []
    for first in range(3):
        for second in range(first + 1, 3):
            displacement = positions[second] - positions[first]
            relative_velocity = velocities[second] - velocities[first]
            separation = np.linalg.norm(displacement)
            reduced_mass = masses[first] * masses[second] / (masses[first] + masses[second])
            pair_energy = (
                0.5 * reduced_mass * np.dot(relative_velocity, relative_velocity)
                - G * masses[first] * masses[second]
                / np.sqrt(separation * separation + SOFTENING * SOFTENING)
            )
            pair_states.append((pair_energy, first, second, separation))

    pair_energy, first, second, binary_separation = min(pair_states)
    escaper = ({0, 1, 2} - {first, second}).pop()
    binary_mass = masses[first] + masses[second]
    binary_position = (
        masses[first] * positions[first] + masses[second] * positions[second]
    ) / binary_mass
    binary_velocity = (
        masses[first] * velocities[first] + masses[second] * velocities[second]
    ) / binary_mass
    escaper_position = positions[escaper] - binary_position
    escaper_velocity = velocities[escaper] - binary_velocity
    escaper_distance = np.linalg.norm(escaper_position)
    escaper_energy = (
        0.5 * np.dot(escaper_velocity, escaper_velocity)
        - G * (binary_mass + masses[escaper])
        / np.sqrt(escaper_distance * escaper_distance + SOFTENING * SOFTENING)
    )
    outward_speed = np.dot(escaper_position, escaper_velocity) / escaper_distance
    separated = (
        escaper_distance >= MIN_ESCAPER_DISTANCE
        and escaper_distance >= MIN_DISTANCE_RATIO * binary_separation
    )
    is_stable = pair_energy < 0 and escaper_energy > 0 and outward_speed > 0 and separated
    return (
        is_stable, (first, second), escaper, escaper_distance, binary_separation,
        pair_energy, escaper_energy, outward_speed, separated,
    )


def find_stability(sampled, masses):
    required_frames = round(STABILITY_WINDOW / (OUTPUT_DT * EXPORT_STRIDE))
    consecutive = 0
    previous_pair = None
    last_state = None
    for frame_index, (_, group) in enumerate(sampled.group_by("t", maintain_order=True)):
        positions = group.select("x", "y").to_numpy()
        velocities = group.select("vx", "vy").to_numpy()
        state = stable_configuration(positions, velocities, masses)
        is_stable, pair, *_ = state
        if is_stable and pair == previous_pair:
            consecutive += 1
        elif is_stable:
            consecutive = 1
        else:
            consecutive = 0
        previous_pair = pair if is_stable else None
        last_state = state
        if consecutive >= required_frames:
            return frame_index, state
    final_time = MAX_STEPS * OUTPUT_DT
    raise RuntimeError(
        f"No persistent binary-plus-escaper state by t={final_time:g}; "
        f"last diagnostic={last_state}"
    )


def run_case(mass3, dx):
    results = PythagoreanTriple({
        "steps": MAX_STEPS, "seed": 0, "rtol": RTOL, "mass3": mass3, "dx": dx
    }).cpu(
        mode="vectorized"
    ).run()
    sampled = results.agent_vars.filter(pl.col("t") % EXPORT_STRIDE == 0).sort(["t", "id"])
    metrics = results.model.filter(pl.col("t") % EXPORT_STRIDE == 0).sort("t")

    metric_by_step = {
        int(row[0]): [round(float(row[1]), 10), round(float(row[2]), 8), int(row[3])]
        for row in metrics.select("t", "energy", "min_separation", "substeps").iter_rows()
    }
    frames = []
    for key, group in sampled.group_by("t", maintain_order=True):
        step = int(key[0] if isinstance(key, tuple) else key)
        positions = [
            [round(float(row[0]), 7), round(float(row[1]), 7)]
            for row in group.select("x", "y").iter_rows()
        ]
        frames.append([step, positions, metric_by_step[step]])

    x0, y0, masses = initial_conditions(mass3, dx)
    initial_energy = total_energy(x0, y0, np.zeros(3), np.zeros(3), masses)
    stable_frame, stability = find_stability(sampled, masses)
    _, (first, second), escaper, escaper_distance, binary_separation, *_ = stability
    stable_step = frames[stable_frame][0]
    stable_energy = frames[stable_frame][2][0]
    return {
        "label": f"m3={mass3:g}; dx={dx:+g}",
        "mass3": mass3,
        "dx": dx,
        "rtol": RTOL,
        "stable_frame": stable_frame,
        "stable_at": stable_step * OUTPUT_DT,
        "stability_window": STABILITY_WINDOW,
        "energy_relative_drift": (stable_energy - initial_energy) / abs(initial_energy),
        "final_binary_masses": [float(masses[first]), float(masses[second])],
        "final_escaper_mass": float(masses[escaper]),
        "stable_escaper_distance": float(escaper_distance),
        "stable_binary_separation": float(binary_separation),
        "frames": frames,
    }, dict(results.info)


def run_case_safely(mass3, dx):
    try:
        case, info = run_case(mass3, dx)
        return case, info, None
    except Exception as error:
        return None, None, f"m3={mass3:g}; dx={dx:+g}: {error}"


def main():
    version = getattr(am, "__version__", "unknown")
    if version != "0.4.4":
        raise RuntimeError(f"Expected AMBER 0.4.4, found {version}")

    combinations = [(mass3, dx) for mass3 in MASS3_VALUES for dx in DX_VALUES]
    try:
        with ProcessPoolExecutor(max_workers=WORKERS) as executor:
            completed = list(executor.map(run_case_safely, *zip(*combinations)))
    except PermissionError:
        print("process workers unavailable; running cases sequentially", flush=True)
        completed = [run_case_safely(*combination) for combination in combinations]
    failures = [error for _, _, error in completed if error]
    if failures:
        raise RuntimeError("Unstable parameter choices:\n" + "\n".join(failures))
    cases = [case for case, _, _ in completed]
    last_info = completed[-1][1]
    for case in cases:
        print(
            f"completed {case['label']}: escaper={case['final_escaper_mass']:g}, "
            f"stable at t={case['stable_at']:g}, "
            f"|dE/E|={abs(case['energy_relative_drift']):.3e}",
            flush=True,
        )

    stable_steps = {round(case["stable_at"] / OUTPUT_DT) for case in cases}
    final_step = max(stable_steps)
    dense_until_step = round(80 / OUTPUT_DT)
    for case in cases:
        case["frames"] = [
            frame for frame in case["frames"]
            if frame[0] <= final_step and (
                frame[0] <= dense_until_step
                or frame[0] % 50 == 0
                or frame[0] in stable_steps
            )
        ]
        stable_step = round(case["stable_at"] / OUTPUT_DT)
        case["stable_frame"] = next(
            index for index, frame in enumerate(case["frames"])
            if frame[0] == stable_step
        )

    frame_blob = json.dumps(cases, separators=(",", ":"))
    payload = {
        "meta": {
            "generator": "blog/generate_amber_three_body_frames.py",
            "amber_version": version,
            "device": last_info["device"],
            "mode": last_info["mode"],
            "integrator": "adaptive fourth-order Runge-Kutta with step doubling",
            "gravity": f"Newtonian gravity with Plummer softening={SOFTENING:g}; G=1",
            "softening": SOFTENING,
            "max_steps": MAX_STEPS,
            "recorded_steps": final_step,
            "output_dt": OUTPUT_DT,
            "export_stride": EXPORT_STRIDE,
            "playback_sampling": "0.1 time units through t=80, then 1.0; every stability endpoint retained",
            "stopping_rule": (
                "bound pair plus outward positive-energy escaper, separated by at least "
                f"{MIN_ESCAPER_DISTANCE:g} units and {MIN_DISTANCE_RATIO:g} binary separations, "
                f"persistent for {STABILITY_WINDOW:g} time units"
            ),
            "parameter_grid": {"mass3": MASS3_VALUES, "dx": DX_VALUES, "rtol": RTOL},
            "precision_note": "all runs use float64; they are a sensitivity explorer, not arbitrary-precision references",
            "frame_sha256": hashlib.sha256(frame_blob.encode()).hexdigest(),
        },
        "cases": cases,
    }
    destination = Path(__file__).with_name("amber-three-body-frames.js")
    destination.write_text(
        "window.AMBER_THREE_BODY_RUN="
        + json.dumps(payload, separators=(",", ":"))
        + ";\n"
    )

    print(
        f"wrote {destination} with {len(cases)} × {len(cases[0]['frames'])} AMBER frames; "
        f"escapers={[case['final_escaper_mass'] for case in cases]}; "
        f"max |energy drift|={max(abs(case['energy_relative_drift']) for case in cases):.3e}; "
        f"sha256={payload['meta']['frame_sha256']}"
    )


if __name__ == "__main__":
    main()

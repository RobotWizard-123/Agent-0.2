import json
import sys
import time
from fractions import Fraction

from ortools.sat.python import cp_model


SEED = 20260728
MAX_CANDIDATES = 4
MAX_TIME_MS = 2000
MAX_DEVICE_COUNT = 100
MAX_ASSIGNMENT_VARIABLES = 20_000


class CpSatModelTooLarge(ValueError):
    code = "CP_SAT_MODEL_TOO_LARGE"


def _validated(payload):
    if payload.get("schema_version") != 1:
        raise ValueError("schema_version must equal 1")
    request = payload["request"]
    count = request.get("count")
    if isinstance(count, bool) or not isinstance(count, int) or count < 1 or count > MAX_DEVICE_COUNT:
        raise ValueError(f"request.count must be an integer from 1 to {MAX_DEVICE_COUNT}")
    racks = sorted(payload.get("racks", []), key=lambda rack: rack["id"])
    slots = sorted(payload.get("slots", []), key=lambda slot: slot["id"])
    rack_ids = {rack["id"] for rack in racks}
    if any(slot["rack_id"] not in rack_ids for slot in slots):
        raise ValueError("slot references an unknown rack")
    unique_slots = []
    physical_coordinates = set()
    for slot in slots:
        coordinate = (slot["rack_id"], slot["layer_id"], int(slot["start_u"]))
        if coordinate not in physical_coordinates:
            physical_coordinates.add(coordinate)
            unique_slots.append(slot)
    if count * len(unique_slots) > MAX_ASSIGNMENT_VARIABLES:
        raise CpSatModelTooLarge(
            f"{CpSatModelTooLarge.code}: assignment variable count exceeds {MAX_ASSIGNMENT_VARIABLES}"
        )
    return {
        **payload,
        "max_candidates": min(MAX_CANDIDATES, max(1, int(payload.get("max_candidates", MAX_CANDIDATES)))),
        "time_limit_ms": min(MAX_TIME_MS, max(50, int(payload.get("time_limit_ms", MAX_TIME_MS)))),
        "racks": racks,
        "slots": unique_slots,
    }


def _fraction(value):
    return Fraction(str(value))


def _strictly_below_limit(current, increment, capacity, count):
    current_value = _fraction(current)
    increment_value = _fraction(increment)
    capacity_value = _fraction(capacity)
    threshold = Fraction(4, 5) * capacity_value
    if capacity_value <= 0 or current_value >= threshold:
        return 0
    if increment_value <= 0:
        return count
    quotient = (threshold - current_value) / increment_value
    ceiling = (quotient.numerator + quotient.denominator - 1) // quotient.denominator
    return min(count, max(0, ceiling - 1))


def _consolidated_rack_limit(rack, request, count):
    metrics = [
        ("current_power_w", "rated_power_w", "design_power_w"),
        ("current_weight_kg", "weight_kg", "max_weight_kg"),
        ("current_ports", "network_ports", "port_limit"),
        ("current_u", "u_size", "usable_u"),
    ]
    limits = [
        _strictly_below_limit(rack[current], request[increment], rack[capacity], count)
        for current, increment, capacity in metrics
        if current in rack and capacity in rack
    ]
    return min(limits, default=count)


def _status_name(status):
    if status == cp_model.OPTIMAL:
        return "optimal"
    if status == cp_model.FEASIBLE:
        return "feasible"
    if status == cp_model.INFEASIBLE:
        return "infeasible"
    return "unknown"


def solve_problem(raw_payload):
    started = time.monotonic()
    try:
        payload = _validated(raw_payload)
    except CpSatModelTooLarge as error:
        return {
            "schema_version": 1,
            "engine": "cp_sat",
            "status": "unknown",
            "error_code": error.code,
            "duration_ms": int(round((time.monotonic() - started) * 1000)),
            "candidates": [],
        }
    request = payload["request"]
    racks = payload["racks"]
    slots = payload["slots"]
    count = int(request["count"])
    if not slots:
        return {
            "schema_version": 1,
            "engine": "cp_sat",
            "status": "infeasible",
            "duration_ms": int(round((time.monotonic() - started) * 1000)),
            "candidates": [],
        }
    model = cp_model.CpModel()
    assignments = {
        (device_index, slot_index): model.new_bool_var(f"x_{device_index}_{slot_index}")
        for device_index in range(count)
        for slot_index in range(len(slots))
    }

    for device_index in range(count):
        model.add_exactly_one(assignments[device_index, slot_index] for slot_index in range(len(slots)))

    for rack in racks:
        rack_slot_indexes = [index for index, slot in enumerate(slots) if slot["rack_id"] == rack["id"]]
        for unit in sorted({
            unit
            for index in rack_slot_indexes
            for unit in range(int(slots[index]["start_u"]), int(slots[index]["end_u"]) + 1)
        }):
            model.add(sum(
                assignments[device_index, slot_index]
                for device_index in range(count)
                for slot_index in rack_slot_indexes
                if int(slots[slot_index]["start_u"]) <= unit <= int(slots[slot_index]["end_u"])
            ) <= 1)
        chosen = sum(
            assignments[device_index, slot_index]
            for device_index in range(count)
            for slot_index in rack_slot_indexes
        )
        model.add(chosen * int(request["rated_power_w"]) <= int(rack["remaining_power_w"]))
        model.add(chosen * int(request["weight_kg"]) <= int(rack["remaining_weight_kg"]))
        model.add(chosen * int(request["network_ports"]) <= int(rack["remaining_ports"]))
        if payload["strategy_id"] == "consolidated":
            model.add(chosen <= _consolidated_rack_limit(rack, request, count))

    if request.get("replica_group"):
        for field in ("source_id", "network_switch_id"):
            for domain in sorted({slot[field] for slot in slots}):
                model.add(sum(
                    assignments[device_index, slot_index]
                    for device_index in range(count)
                    for slot_index, slot in enumerate(slots)
                    if slot[field] == domain
                ) <= 1)

    selected_slot_indexes = []
    for device_index in range(count):
        selected = model.new_int_var(0, max(0, len(slots) - 1), f"selected_slot_{device_index}")
        model.add(selected == sum(
            slot_index * assignments[device_index, slot_index]
            for slot_index in range(len(slots))
        ))
        selected_slot_indexes.append(selected)
    for device_index in range(count - 1):
        model.add(selected_slot_indexes[device_index] < selected_slot_indexes[device_index + 1])

    used_racks = {}
    utilization = []
    for rack in racks:
        rack_slot_indexes = [index for index, slot in enumerate(slots) if slot["rack_id"] == rack["id"]]
        chosen = sum(
            assignments[device_index, slot_index]
            for device_index in range(count)
            for slot_index in rack_slot_indexes
        )
        used = model.new_bool_var(f"used_{rack['id']}")
        model.add(chosen >= used)
        model.add(chosen <= count * used)
        used_racks[rack["id"]] = used
        ratio = model.new_int_var(0, 10000, f"power_ratio_{rack['id']}")
        projected = int(rack["current_power_w"]) + chosen * int(request["rated_power_w"])
        model.add(ratio * int(rack["design_power_w"]) >= projected * 10000)
        utilization.append(ratio)

    slot_costs = [int(slot["soft_cost"]) for slot in slots]
    minimum_slot_cost = min(slot_costs, default=0)
    maximum_slot_cost = max(slot_costs, default=minimum_slot_cost)
    soft_cost_span = count * (maximum_slot_cost - minimum_slot_cost)
    soft_cost = sum(
        (int(slot["soft_cost"]) - minimum_slot_cost) * assignments[device_index, slot_index]
        for device_index in range(count)
        for slot_index, slot in enumerate(slots)
    )
    strategy = payload["strategy_id"]
    if strategy == "consolidated":
        new_racks = sum(
            used_racks[rack["id"]]
            for rack in racks
            if not rack["activated"]
        )
        used_rack_coefficient = soft_cost_span + 1
        used_rack_span = min(count, len(racks))
        new_rack_coefficient = used_rack_span * used_rack_coefficient + soft_cost_span + 1
        model.minimize(
            new_racks * new_rack_coefficient
            + sum(used_racks.values()) * used_rack_coefficient
            + soft_cost
        )
    elif strategy == "load_balanced":
        max_utilization = model.new_int_var(0, 10000, "max_power_utilization")
        model.add_max_equality(max_utilization, utilization)
        model.minimize(max_utilization * (soft_cost_span + 1) + soft_cost)
    else:
        model.minimize(soft_cost)

    candidates = []
    last_status = cp_model.UNKNOWN
    deadline = started + payload["time_limit_ms"] / 1000
    while len(candidates) < payload["max_candidates"]:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            break
        solver = cp_model.CpSolver()
        solver.parameters.max_time_in_seconds = remaining
        solver.parameters.num_search_workers = 1
        solver.parameters.random_seed = SEED
        status = solver.solve(model)
        last_status = status
        if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
            break
        chosen_variables = []
        placements = []
        for device_index in range(count):
            for slot_index, slot in enumerate(slots):
                variable = assignments[device_index, slot_index]
                if solver.value(variable):
                    chosen_variables.append(variable)
                    placements.append({
                        "device_index": device_index,
                        "rack_id": slot["rack_id"],
                        "layer_id": slot["layer_id"],
                        "start_u": int(slot["start_u"]),
                    })
        placements.sort(key=lambda item: item["device_index"])
        candidates.append({
            "objective_value": int(round(solver.objective_value)),
            "placements": placements,
        })
        model.add(sum(chosen_variables) <= count - 1)

    if candidates:
        result_status = "optimal" if last_status == cp_model.OPTIMAL else "feasible"
    else:
        result_status = _status_name(last_status)
    return {
        "schema_version": 1,
        "engine": "cp_sat",
        "status": result_status,
        "duration_ms": int(round((time.monotonic() - started) * 1000)),
        "candidates": candidates,
    }


def main():
    payload = json.load(sys.stdin)
    json.dump(solve_problem(payload), sys.stdout, ensure_ascii=False, separators=(",", ":"))
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()

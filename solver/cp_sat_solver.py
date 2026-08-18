import json
import sys
import time

from ortools.sat.python import cp_model


SEED = 20260728
MAX_CANDIDATES = 4
MAX_TIME_MS = 2000
MAX_ASSIGNMENT_VARIABLES = 20_000


def _positive_int(value, field, allow_zero=False):
    minimum = 0 if allow_zero else 1
    if isinstance(value, bool) or not isinstance(value, int) or value < minimum:
        raise ValueError(f"{field} must be an integer >= {minimum}")
    return value


def _unique_ids(items, field):
    identifiers = [item.get("id") for item in items]
    if any(not isinstance(identifier, str) or not identifier for identifier in identifiers):
        raise ValueError(f"{field} IDs must be non-empty strings")
    if len(identifiers) != len(set(identifiers)):
        raise ValueError(f"{field} IDs must be unique")


def _validated(raw_payload):
    if raw_payload.get("schema_version") != 2:
        raise ValueError("schema_version must equal 2")
    payload = dict(raw_payload)
    assignment_count = _positive_int(
        payload.get("assignment_variable_count"),
        "assignment_variable_count",
        allow_zero=True,
    )
    if assignment_count > MAX_ASSIGNMENT_VARIABLES:
        raise ValueError(
            f"MODEL_BUDGET_EXCEEDED: assignment variables exceed {MAX_ASSIGNMENT_VARIABLES}"
        )
    racks = sorted(payload.get("racks", []), key=lambda item: item["id"])
    devices = sorted(payload.get("devices", []), key=lambda item: item["device_key"])
    power_outlets = sorted(payload.get("power_outlets", []), key=lambda item: item["id"])
    network_ports = sorted(payload.get("network_ports", []), key=lambda item: item["id"])
    _unique_ids(racks, "rack")
    _unique_ids(power_outlets, "power resource")
    _unique_ids(network_ports, "network resource")
    device_keys = [item.get("device_key") for item in devices]
    if any(not isinstance(key, str) or not key for key in device_keys) or len(device_keys) != len(set(device_keys)):
        raise ValueError("device_key values must be non-empty and unique")
    rack_ids = {rack["id"] for rack in racks}
    for device in devices:
        if device.get("kind") not in {"new", "existing"}:
            raise ValueError("device.kind is invalid")
        for field in ("u_size", "rated_power_w", "weight_kg", "network_ports"):
            value = device.get(field)
            if isinstance(value, bool) or not isinstance(value, (int, float)) or value < 0:
                raise ValueError(f"device.{field} is invalid")
        positions = sorted(device.get("positions", []), key=lambda item: item["id"])
        _unique_ids(positions, f"positions for {device['device_key']}")
        if not positions:
            raise ValueError("every device must have at least one position")
        if any(item.get("rack_id") not in rack_ids for item in positions):
            raise ValueError("position references an unknown rack")
        current_count = sum(1 for item in positions if item.get("is_current") is True)
        if device["kind"] == "existing" and current_count != 1:
            raise ValueError("existing device must have exactly one current position")
        if device["kind"] == "new" and current_count != 0:
            raise ValueError("new device cannot have a current position")
        device["positions"] = positions
    for resource in power_outlets:
        if resource.get("rack_id") not in rack_ids:
            raise ValueError("power resource references an unknown rack")
    for resource in network_ports:
        connected = resource.get("rack_ids")
        if not isinstance(connected, list) or not connected or any(item not in rack_ids for item in connected):
            raise ValueError("network resource references an unknown rack")
    fixed_occupancy = payload.get("fixed_occupancy", [])
    if not isinstance(fixed_occupancy, list) or any(item.get("rack_id") not in rack_ids for item in fixed_occupancy):
        raise ValueError("fixed occupancy references an unknown rack")
    phase = payload.get("phase")
    if phase not in {"normal", "expanded"}:
        raise ValueError("phase is invalid")
    min_moves = _positive_int(payload.get("min_moves", 0), "min_moves", allow_zero=True)
    max_moves = _positive_int(payload.get("max_moves", 0), "max_moves", allow_zero=True)
    return {
        **payload,
        "phase": phase,
        "min_moves": min_moves,
        "max_moves": max_moves,
        "max_candidates": min(MAX_CANDIDATES, max(1, int(payload.get("max_candidates", MAX_CANDIDATES)))),
        "time_limit_ms": min(MAX_TIME_MS, max(50, int(payload.get("time_limit_ms", MAX_TIME_MS)))),
        "racks": racks,
        "devices": devices,
        "fixed_occupancy": fixed_occupancy,
        "power_outlets": power_outlets,
        "network_ports": network_ports,
    }


def _status_name(status):
    if status == cp_model.OPTIMAL:
        return "optimal"
    if status == cp_model.FEASIBLE:
        return "feasible"
    if status == cp_model.INFEASIBLE:
        return "infeasible"
    return "unknown"


def _covers(position, rack_id, unit):
    return (
        position["rack_id"] == rack_id
        and int(position["start_u"]) <= unit <= int(position["end_u"])
    )


def _build_model(payload):
    model = cp_model.CpModel()
    devices = payload["devices"]
    racks = payload["racks"]
    position_vars = {}
    selected_positions = {}
    moved = {}

    for device_index, device in enumerate(devices):
        variables = []
        for position_index, _position in enumerate(device["positions"]):
            variable = model.new_bool_var(f"x_{device_index}_{position_index}")
            position_vars[device_index, position_index] = variable
            variables.append(variable)
        model.add_exactly_one(variables)
        selected = model.new_int_var(0, len(device["positions"]) - 1, f"position_{device_index}")
        model.add(selected == sum(
            position_index * position_vars[device_index, position_index]
            for position_index in range(len(device["positions"]))
        ))
        selected_positions[device_index] = selected
        if device["kind"] == "existing":
            moved_var = model.new_bool_var(f"moved_{device_index}")
            model.add(moved_var == sum(
                position_vars[device_index, position_index]
                for position_index, position in enumerate(device["positions"])
                if not position.get("is_current")
            ))
            moved[device_index] = moved_var

    model.add(sum(moved.values()) >= payload["min_moves"])
    model.add(sum(moved.values()) <= payload["max_moves"])

    coordinates = set()
    fixed_counts = {}
    for item in payload["fixed_occupancy"]:
        for unit in range(int(item["start_u"]), int(item["end_u"]) + 1):
            coordinate = (item["rack_id"], item["layer_id"], unit)
            coordinates.add(coordinate)
            fixed_counts[coordinate] = fixed_counts.get(coordinate, 0) + 1
    for device in devices:
        for position in device["positions"]:
            for unit in range(int(position["start_u"]), int(position["end_u"]) + 1):
                coordinates.add((position["rack_id"], position["layer_id"], unit))
    for rack_id, layer_id, unit in sorted(coordinates):
        variables = [
            position_vars[device_index, position_index]
            for device_index, device in enumerate(devices)
            for position_index, position in enumerate(device["positions"])
            if position["layer_id"] == layer_id and _covers(position, rack_id, unit)
        ]
        model.add(sum(variables) <= 1 - fixed_counts.get((rack_id, layer_id, unit), 0))

    dimensions = (
        ("rated_power_w", "current_power_w", "design_power_w"),
        ("weight_kg", "current_weight_kg", "max_weight_kg"),
        ("network_ports", "current_ports", "port_limit"),
        ("u_size", "current_u", "usable_u"),
    )
    for rack in racks:
        rack_id = rack["id"]
        for device_field, current_field, capacity_field in dimensions:
            assigned = sum(
                int(device[device_field]) * position_vars[device_index, position_index]
                for device_index, device in enumerate(devices)
                for position_index, position in enumerate(device["positions"])
                if position["rack_id"] == rack_id
            )
            current = int(rack[current_field])
            capacity = int(rack[capacity_field])
            model.add(assigned + current <= capacity)
            if payload["strategy_id"] == "consolidated":
                model.add((assigned + current) * 5 <= capacity * 4 - 1)

    replica_groups = sorted({device.get("replica_group") for device in devices if device.get("replica_group")})
    for group in replica_groups:
        group_indexes = [index for index, device in enumerate(devices) if device.get("replica_group") == group]
        for field in ("source_id", "network_switch_id"):
            domains = sorted({
                position[field]
                for index in group_indexes
                for position in devices[index]["positions"]
            })
            for domain in domains:
                model.add(sum(
                    position_vars[index, position_index]
                    for index in group_indexes
                    for position_index, position in enumerate(devices[index]["positions"])
                    if position[field] == domain
                ) <= 1)

    for rack in racks:
        available_power = sum(1 for item in payload["power_outlets"] if item["rack_id"] == rack["id"])
        active_devices = sum(
            position_vars[device_index, position_index]
            for device_index, device in enumerate(devices)
            for position_index, position in enumerate(device["positions"])
            if position["rack_id"] == rack["id"]
            and (device["kind"] == "new" or not position.get("is_current"))
        )
        model.add(active_devices <= available_power)

    switch_ids = sorted({item["switch_id"] for item in payload["network_ports"]})
    for switch_id in switch_ids:
        available_ports = sum(1 for item in payload["network_ports"] if item["switch_id"] == switch_id)
        required_ports = sum(
            int(device["network_ports"]) * position_vars[device_index, position_index]
            for device_index, device in enumerate(devices)
            for position_index, position in enumerate(device["positions"])
            if position["network_switch_id"] == switch_id
            and (device["kind"] == "new" or not position.get("is_current"))
        )
        model.add(required_ports <= available_ports)

    for left_index in range(len(devices) - 1):
        left = devices[left_index]
        right = devices[left_index + 1]
        left_coordinates = [(item["rack_id"], item["layer_id"], item["start_u"]) for item in left["positions"]]
        right_coordinates = [(item["rack_id"], item["layer_id"], item["start_u"]) for item in right["positions"]]
        if (
            left["kind"] == right["kind"] == "new"
            and left_coordinates == right_coordinates
            and all(left[field] == right[field] for field in ("u_size", "rated_power_w", "weight_kg", "network_ports", "replica_group"))
        ):
            model.add(selected_positions[left_index] < selected_positions[left_index + 1])

    soft_cost = sum(
        int(position["soft_cost"]) * position_vars[device_index, position_index]
        for device_index, device in enumerate(devices)
        for position_index, position in enumerate(device["positions"])
    )
    secondary_cost = soft_cost
    secondary_span = max(1,
        sum(max(int(position["soft_cost"]) for position in device["positions"]) for device in devices)
    )
    if payload["phase"] == "expanded":
        model.minimize(sum(moved.values()) * (secondary_span + 1) + secondary_cost)
    else:
        model.minimize(secondary_cost)

    return {
        "model": model,
        "position_vars": position_vars,
        "selected_positions": selected_positions,
        "moved": moved,
    }


def solve_problem(raw_payload):
    started = time.monotonic()
    payload = _validated(raw_payload)
    built = _build_model(payload)
    model = built["model"]
    devices = payload["devices"]
    deadline = time.monotonic() + payload["time_limit_ms"] / 1000
    candidates = []
    last_status = cp_model.UNKNOWN

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

        selected = []
        chosen_positions = []
        migration_count = 0
        for device_index, device in enumerate(devices):
            position_index = solver.value(built["selected_positions"][device_index])
            position = device["positions"][position_index]
            chosen_positions.append(built["position_vars"][device_index, position_index])
            is_moved = device["kind"] == "existing" and not position.get("is_current")
            if is_moved:
                migration_count += 1
            selected.append((device, position, is_moved))

        assignments = []
        used_power = set()
        used_network = set()
        for device, position, is_moved in sorted(selected, key=lambda item: item[0]["device_key"]):
            active_links = device["kind"] == "new" or is_moved
            compatible_power = next((
                item for item in payload["power_outlets"]
                if item["rack_id"] == position["rack_id"] and item["id"] not in used_power
            ), None) if active_links else None
            compatible_network = [
                item for item in payload["network_ports"]
                if position["rack_id"] in item["rack_ids"] and item["id"] not in used_network
            ][:int(device["network_ports"])] if active_links else []
            if active_links and (compatible_power is None or len(compatible_network) != int(device["network_ports"])):
                raise RuntimeError("LINK_RESOURCE_EXHAUSTED after CP-SAT resource-capacity validation")
            if compatible_power:
                used_power.add(compatible_power["id"])
            used_network.update(item["id"] for item in compatible_network)
            assignments.append({
                "device_key": device["device_key"],
                "position_id": position["id"],
                "rack_id": position["rack_id"],
                "layer_id": position["layer_id"],
                "start_u": int(position["start_u"]),
                "moved": is_moved,
                "power_outlet_id": compatible_power["id"] if compatible_power else None,
                "network_port_ids": [item["id"] for item in compatible_network],
            })
        assignments.sort(key=lambda item: item["device_key"])
        candidates.append({
            "objective_value": int(round(solver.objective_value)),
            "migration_count": migration_count,
            "assignments": assignments,
        })
        model.add(sum(chosen_positions) <= len(chosen_positions) - 1)

    result_status = (
        "optimal" if candidates and last_status == cp_model.OPTIMAL
        else "feasible" if candidates
        else _status_name(last_status)
    )
    return {
        "schema_version": 2,
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

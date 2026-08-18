import unittest
from copy import deepcopy

from solver.cp_sat_solver import _validated, solve_problem


def _position(device_key, rack_id, start_u, current=False, soft_cost=0):
    return {
        "id": f"{device_key}:{rack_id}:L01:{start_u}",
        "rack_id": rack_id,
        "layer_id": "L01",
        "start_u": start_u,
        "end_u": start_u + 1,
        "usable_end_u": 40,
        "source_id": "SRC-A" if rack_id == "CAB-01" else "SRC-B",
        "network_switch_id": "SW-A" if rack_id == "CAB-01" else "SW-B",
        "is_current": current,
        "soft_cost": soft_cost,
    }


def _device(device_key, kind, positions, replica_group=None):
    device_id = device_key.replace(":", "-").upper()
    current = next(({
        "rack_id": item["rack_id"],
        "layer_id": item["layer_id"],
        "start_u": item["start_u"],
    } for item in positions if item["is_current"]), None)
    return {
        "device_key": device_key,
        "kind": kind,
        "id": device_id,
        "u_size": 2,
        "rated_power_w": 100,
        "weight_kg": 10,
        "network_ports": 1,
        "business_id": None,
        "replica_group": replica_group,
        "device": {"id": device_id},
        "current": current,
        "positions": positions,
    }


def problem(phase="normal", min_moves=0, max_moves=2, new_count=1, existing_count=5):
    racks = [
        {
            "id": "CAB-01",
            "source_id": "SRC-A",
            "network_switch_id": "SW-A",
            "design_power_w": 10_000,
            "current_power_w": 0,
            "max_weight_kg": 1_000,
            "current_weight_kg": 0,
            "port_limit": 100,
            "current_ports": 0,
            "usable_u": 100,
            "current_u": 0,
            "activated": True,
        },
        {
            "id": "CAB-02",
            "source_id": "SRC-B",
            "network_switch_id": "SW-B",
            "design_power_w": 10_000,
            "current_power_w": 0,
            "max_weight_kg": 1_000,
            "current_weight_kg": 0,
            "port_limit": 100,
            "current_ports": 0,
            "usable_u": 100,
            "current_u": 0,
            "activated": True,
        },
    ]
    devices = []
    for index in range(new_count):
        key = f"new:{index}"
        devices.append(_device(key, "new", [
            _position(key, "CAB-01", 30 + index * 2, soft_cost=index),
            _position(key, "CAB-02", 30 + index * 2, soft_cost=100 + index),
        ]))
    for index in range(existing_count):
        key = f"existing:MOVE-{index + 1:02d}"
        current_rack = "CAB-01" if index % 2 == 0 else "CAB-02"
        target_rack = "CAB-02" if current_rack == "CAB-01" else "CAB-01"
        devices.append(_device(key, "existing", [
            _position(key, current_rack, 1 + index * 2, current=True),
            _position(key, target_rack, 60 + index * 2, soft_cost=10 + index),
        ]))
    power_outlets = []
    network_ports = []
    for rack_id, pdu_id, switch_id in (
        ("CAB-01", "PDU-A", "SW-A"),
        ("CAB-02", "PDU-B", "SW-B"),
    ):
        for index in range(1, 21):
            power_outlets.append({
                "id": f"{pdu_id}:P{index:02d}",
                "pdu_id": pdu_id,
                "outlet": f"P{index:02d}",
                "rack_id": rack_id,
                "source_id": "SRC-A" if rack_id == "CAB-01" else "SRC-B",
                "occupied": False,
            })
            network_ports.append({
                "id": f"{switch_id}:GE0/0/{index:02d}",
                "switch_id": switch_id,
                "switch_port": f"GE0/0/{index:02d}",
                "rack_ids": [rack_id],
                "occupied": False,
            })
    assignment_count = sum(len(item["positions"]) + 1 + item["network_ports"]
                           + (1 if item["kind"] == "existing" else 0)
                           for item in devices)
    return {
        "schema_version": 2,
        "strategy_id": "balanced_optimal",
        "phase": phase,
        "request_count": new_count,
        "min_moves": min_moves,
        "max_moves": max_moves,
        "max_candidates": 4,
        "time_limit_ms": 2_000,
        "assignment_variable_count": assignment_count,
        "devices": devices,
        "fixed_occupancy": [],
        "racks": racks,
        "power_outlets": power_outlets,
        "network_ports": network_ports,
    }


class CpSatSolverTests(unittest.TestCase):
    def test_normal_model_can_choose_zero_one_or_two_moves(self):
        result = solve_problem(problem(phase="normal", min_moves=0, max_moves=2))
        self.assertIn(result["status"], {"optimal", "feasible"})
        self.assertLessEqual(result["candidates"][0]["migration_count"], 2)

    def test_expanded_model_minimizes_move_count_from_three(self):
        result = solve_problem(problem(phase="expanded", min_moves=3, max_moves=5))
        self.assertIn(result["status"], {"optimal", "feasible"})
        self.assertEqual(result["candidates"][0]["migration_count"], 3)

    def test_assignments_own_unique_power_and_network_resources(self):
        candidate = solve_problem(problem(new_count=2))["candidates"][0]
        power = [item["power_outlet_id"] for item in candidate["assignments"] if item["power_outlet_id"]]
        network = [port for item in candidate["assignments"] for port in item["network_port_ids"]]
        self.assertEqual(len(power), len(set(power)))
        self.assertEqual(len(network), len(set(network)))

    def test_fixed_u_conflicts_are_infeasible(self):
        payload = problem(new_count=1, existing_count=0)
        payload["fixed_occupancy"] = [
            {"device_id": "FIX-A", "rack_id": item["rack_id"], "layer_id": item["layer_id"],
             "start_u": item["start_u"], "end_u": item["end_u"]}
            for item in payload["devices"][0]["positions"]
        ]
        result = solve_problem(payload)
        self.assertEqual(result["status"], "infeasible")

    def test_rack_capacity_can_make_the_problem_infeasible(self):
        payload = problem(new_count=1, existing_count=0)
        for rack in payload["racks"]:
            rack["design_power_w"] = 50
        self.assertEqual(solve_problem(payload)["status"], "infeasible")

    def test_replica_group_uses_distinct_power_and_switch_domains(self):
        payload = problem(new_count=2, existing_count=0)
        for device in payload["devices"]:
            device["replica_group"] = "RG-01"
        candidate = solve_problem(payload)["candidates"][0]
        self.assertEqual({item["rack_id"] for item in candidate["assignments"]}, {"CAB-01", "CAB-02"})

    def test_exact_budget_is_accepted_and_twenty_thousand_one_is_rejected(self):
        payload = problem()
        payload["assignment_variable_count"] = 20_000
        self.assertEqual(_validated(payload)["assignment_variable_count"], 20_000)
        payload["assignment_variable_count"] = 20_001
        with self.assertRaisesRegex(ValueError, "MODEL_BUDGET_EXCEEDED"):
            _validated(payload)

    def test_same_input_is_stable_and_candidate_count_is_bounded(self):
        payload = problem(new_count=1, existing_count=0)
        first = solve_problem(payload)
        second = solve_problem(deepcopy(payload))
        self.assertLessEqual(len(first["candidates"]), 4)
        self.assertEqual(first["candidates"], second["candidates"])

    def test_invalid_schema_and_duplicate_resources_are_rejected(self):
        payload = problem()
        payload["schema_version"] = 1
        with self.assertRaisesRegex(ValueError, "schema_version"):
            _validated(payload)
        payload = problem()
        payload["power_outlets"].append(deepcopy(payload["power_outlets"][0]))
        with self.assertRaisesRegex(ValueError, "unique"):
            _validated(payload)


if __name__ == "__main__":
    unittest.main()

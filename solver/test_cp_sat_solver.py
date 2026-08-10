import unittest
from types import SimpleNamespace
from unittest.mock import patch

from solver.cp_sat_solver import _consolidated_rack_limit, _validated, solve_problem


def problem(**request_overrides):
    request = {
        "id": "PY-SOLVER",
        "count": 1,
        "u_size": 2,
        "rated_power_w": 100,
        "weight_kg": 10,
        "network_ports": 1,
        "replica_group": None,
    }
    request.update(request_overrides)
    racks = [
        {
            "id": "CAB-01",
            "source_id": "SRC-A",
            "network_switch_id": "SW-A",
            "design_power_w": 1000,
            "current_power_w": 0,
            "remaining_power_w": 1000,
            "remaining_weight_kg": 100,
            "remaining_ports": 10,
            "current_weight_kg": 0,
            "max_weight_kg": 100,
            "current_ports": 0,
            "port_limit": 10,
            "current_u": 0,
            "usable_u": 100,
            "activated": True,
        },
        {
            "id": "CAB-02",
            "source_id": "SRC-B",
            "network_switch_id": "SW-B",
            "design_power_w": 1000,
            "current_power_w": 0,
            "remaining_power_w": 1000,
            "remaining_weight_kg": 100,
            "remaining_ports": 10,
            "current_weight_kg": 0,
            "max_weight_kg": 100,
            "current_ports": 0,
            "port_limit": 10,
            "current_u": 0,
            "usable_u": 100,
            "activated": False,
        },
    ]
    slots = [
        {
            "id": f"CAB-01:L01:{start}",
            "rack_id": "CAB-01",
            "layer_id": "L01",
            "start_u": start,
            "end_u": start + request["u_size"] - 1,
            "source_id": "SRC-A",
            "network_switch_id": "SW-A",
            "soft_cost": start,
        }
        for start in (1, 3, 5)
    ] + [
        {
            "id": f"CAB-02:L01:{start}",
            "rack_id": "CAB-02",
            "layer_id": "L01",
            "start_u": start,
            "end_u": start + request["u_size"] - 1,
            "source_id": "SRC-B",
            "network_switch_id": "SW-B",
            "soft_cost": 100 + start,
        }
        for start in (1, 3, 5)
    ]
    return {
        "schema_version": 1,
        "strategy_id": "balanced_optimal",
        "max_candidates": 4,
        "time_limit_ms": 2000,
        "request": request,
        "racks": racks,
        "slots": slots,
    }


class CpSatSolverTests(unittest.TestCase):
    def test_returns_no_more_than_four_distinct_candidates(self):
        result = solve_problem(problem())
        self.assertIn(result["status"], {"optimal", "feasible"})
        self.assertEqual(len(result["candidates"]), 4)
        signatures = {
            tuple((item["device_index"], item["rack_id"], item["layer_id"], item["start_u"])
                  for item in candidate["placements"])
            for candidate in result["candidates"]
        }
        self.assertEqual(len(signatures), 4)

    def test_batch_devices_do_not_overlap_and_replica_domains_are_distinct(self):
        result = solve_problem(problem(count=2, replica_group="RG-01"))
        self.assertIn(result["status"], {"optimal", "feasible"})
        placements = result["candidates"][0]["placements"]
        self.assertEqual(len(placements), 2)
        self.assertNotEqual(placements[0]["rack_id"], placements[1]["rack_id"])

    def test_capacity_constraints_can_make_the_problem_infeasible(self):
        payload = problem(rated_power_w=2000)
        result = solve_problem(payload)
        self.assertEqual(result["status"], "infeasible")
        self.assertEqual(result["candidates"], [])

    def test_same_input_has_stable_candidate_order(self):
        first = solve_problem(problem())
        second = solve_problem(problem())
        self.assertEqual(first["candidates"], second["candidates"])

    def test_duplicate_slot_coordinates_do_not_create_duplicate_candidates(self):
        payload = problem()
        payload["slots"].append({
            **payload["slots"][0],
            "id": "CAB-01:L01:1:DUPLICATE",
        })

        result = solve_problem(payload)

        signatures = {
            tuple((item["device_index"], item["rack_id"], item["layer_id"], item["start_u"])
                  for item in candidate["placements"])
            for candidate in result["candidates"]
        }
        self.assertEqual(len(result["candidates"]), len(signatures))

    @patch("solver.cp_sat_solver.cp_model.CpSolver")
    @patch("solver.cp_sat_solver.time.monotonic", side_effect=[100.0, 100.045, 100.05])
    def test_passes_remaining_sub_ten_ms_budget_to_solver(self, monotonic, solver_class):
        solver = solver_class.return_value
        solver.parameters = SimpleNamespace()
        solver.solve.return_value = 0
        payload = problem()
        payload["time_limit_ms"] = 50

        result = solve_problem(payload)

        solver_class.assert_called_once()
        self.assertAlmostEqual(solver.parameters.max_time_in_seconds, 0.005)
        self.assertEqual(result["status"], "unknown")

    def test_rejects_invalid_counts_before_model_construction(self):
        for count in (0, 1.5, 101):
            with self.subTest(count=count):
                payload = problem(count=count)
                with self.assertRaisesRegex(ValueError, "request.count"):
                    _validated(payload)

    def test_rejects_more_than_twenty_thousand_assignment_variables(self):
        payload = problem(count=100)
        payload["slots"] = [{
            **payload["slots"][0],
            "id": f"CAB-01:L01:{start}",
            "start_u": start,
            "end_u": start,
        } for start in range(1, 202)]

        with self.assertRaisesRegex(ValueError, "CP_SAT_MODEL_TOO_LARGE"):
            _validated(payload)
        result = solve_problem(payload)
        self.assertEqual(result["status"], "unknown")
        self.assertEqual(result["error_code"], "CP_SAT_MODEL_TOO_LARGE")
        self.assertEqual(result["candidates"], [])

    def test_consolidated_batch_stays_strictly_below_the_eighty_percent_line(self):
        payload = problem(count=2)
        payload["strategy_id"] = "consolidated"
        payload["max_candidates"] = 1
        for rack in payload["racks"]:
            rack["current_power_w"] = 600
            rack["remaining_power_w"] = 400

        result = solve_problem(payload)

        self.assertIn(result["status"], {"optimal", "feasible"})
        placements = result["candidates"][0]["placements"]
        self.assertEqual({item["rack_id"] for item in placements}, {"CAB-01", "CAB-02"})

    def test_consolidated_limit_covers_power_weight_ports_and_u(self):
        request = problem(count=2)["request"]
        rack = problem()["racks"][0]
        dimensions = (
            ("current_power_w", "rated_power_w", "design_power_w"),
            ("current_weight_kg", "weight_kg", "max_weight_kg"),
            ("current_ports", "network_ports", "port_limit"),
            ("current_u", "u_size", "usable_u"),
        )

        for current, increment, capacity in dimensions:
            with self.subTest(dimension=current):
                candidate_rack = {**rack}
                candidate_request = {**request}
                for other_current, other_increment, other_capacity in dimensions:
                    candidate_rack[other_current] = 0
                    candidate_rack[other_capacity] = 1_000
                    candidate_request[other_increment] = 1
                candidate_rack[current] = 60
                candidate_rack[capacity] = 100
                candidate_request[increment] = 10

                self.assertEqual(
                    _consolidated_rack_limit(candidate_rack, candidate_request, 2),
                    1,
                )

    def test_consolidated_objective_keeps_rack_count_ahead_of_large_batch_soft_cost(self):
        count = 11
        payload = problem(count=count)
        payload["strategy_id"] = "consolidated"
        payload["max_candidates"] = 1
        payload["racks"] = []
        payload["slots"] = []
        for rack_id, slot_count, soft_cost in (
            ("CAB-A", 11, 10_000),
            ("CAB-B", 6, 0),
            ("CAB-C", 5, 0),
        ):
            payload["racks"].append({
                "id": rack_id,
                "source_id": f"SRC-{rack_id}",
                "network_switch_id": f"SW-{rack_id}",
                "design_power_w": 100_000,
                "current_power_w": 0,
                "remaining_power_w": 100_000,
                "current_weight_kg": 0,
                "max_weight_kg": 10_000,
                "remaining_weight_kg": 10_000,
                "current_ports": 0,
                "port_limit": 10_000,
                "remaining_ports": 10_000,
                "current_u": 0,
                "usable_u": 1_000,
                "activated": True,
            })
            payload["slots"].extend({
                "id": f"{rack_id}:L01:{start}",
                "rack_id": rack_id,
                "layer_id": "L01",
                "start_u": start,
                "end_u": start,
                "source_id": f"SRC-{rack_id}",
                "network_switch_id": f"SW-{rack_id}",
                "soft_cost": soft_cost,
            } for start in range(1, slot_count + 1))

        result = solve_problem(payload)

        self.assertIn(result["status"], {"optimal", "feasible"})
        self.assertEqual(
            {item["rack_id"] for item in result["candidates"][0]["placements"]},
            {"CAB-A"},
        )


if __name__ == "__main__":
    unittest.main()

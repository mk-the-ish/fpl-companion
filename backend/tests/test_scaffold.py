import asyncio
import json
import tempfile
import unittest
from pathlib import Path

import httpx
import numpy as np

from backend.data_pipeline import FPLApiClient, FPLUpstreamError
from backend.evaluate import evaluate_walk_forward, run_walk_forward_evaluation
from backend.main import app, get_fpl_api
from backend.features import FEATURE_NAMES, build_training_rows
from backend.monte_carlo import estimate_haul_probability
from backend.ml_model import begin_training, finish_training
from backend.optimizer import solve_binary_selection


class FakeFPLApiClient:
    def __init__(self) -> None:
        position_by_player = {
            **{player_id: 1 for player_id in (1, 2)},
            **{player_id: 2 for player_id in range(3, 8)},
            **{player_id: 3 for player_id in range(8, 13)},
            **{player_id: 4 for player_id in range(13, 16)},
        }
        self.bootstrap = {
            "events": [
                {"id": gameweek, "finished": gameweek <= 12}
                for gameweek in range(1, 39)
            ],
            "teams": [
                {"id": team_id, "short_name": f"T{team_id}"}
                for team_id in range(1, 16)
            ]
            + [
                {"id": 100 + team_id, "short_name": f"O{team_id}"}
                for team_id in range(1, 16)
            ],
            "elements": [
                {
                    "id": player_id,
                    "web_name": f"Player {player_id}",
                    "team": player_id,
                    "element_type": position_by_player[player_id],
                    "status": "a",
                    "now_cost": 50,
                    "minutes": 900,
                    "total_points": 100,
                    "expected_goals": "5.0",
                    "expected_assists": "3.0",
                    "expected_goals_conceded": "10.0",
                    "clean_sheets": 5,
                    "form": "5.0",
                }
                for player_id in range(1, 16)
            ],
        }
        self.fixtures = [
            {
                "event": gameweek,
                "team_h": team_id,
                "team_a": 100 + team_id,
                "team_h_difficulty": 2,
                "team_a_difficulty": 4,
            }
            for gameweek in range(12, 16)
            for team_id in range(1, 15)
        ]
        self.fixtures.append(
            {
                "event": 12,
                "team_h": 3,
                "team_a": 103,
                "team_h_difficulty": 3,
                "team_a_difficulty": 3,
            }
        )
        self.picks_response = {
            "entry_history": {"bank": 0},
            "picks": [{"element": player_id} for player_id in range(1, 16)],
        }
        self.bootstrap_calls = 0
        self.fixtures_calls = 0
        self.picks_calls: list[tuple[int, int]] = []
        self.fail_bootstrap = False
        self.training_rows = [
            {
                **{
                    name: (
                        float(position)
                        if name == "element_type"
                        else float(gameweek * (index + 1) % 17)
                        if name != "fatigue_decay"
                        else 1.0
                    )
                    for index, name in enumerate(FEATURE_NAMES)
                },
                "target": float((gameweek + player["id"]) % 12),
                "gameweek": gameweek,
                "player_id": player["id"],
                "fixture_count": 2 if player["id"] == 3 and gameweek == 12 else 1,
            }
            for player in self.bootstrap["elements"]
            for position in [player["element_type"]]
            for gameweek in range(1, 13)
        ]
        self.training_gameweek: int | None = None

    async def get_bootstrap(self) -> dict[str, object]:
        self.bootstrap_calls += 1
        if self.fail_bootstrap:
            raise FPLUpstreamError("simulated upstream outage")
        return self.bootstrap

    async def get_fixtures(self) -> list[dict[str, object]]:
        self.fixtures_calls += 1
        return self.fixtures

    async def get_entry_picks(
        self,
        team_id: int,
        gameweek: int,
    ) -> dict[str, object]:
        self.picks_calls.append((team_id, gameweek))
        return self.picks_response

    async def get_training_rows(
        self,
        bootstrap: dict[str, object],
        fixtures: list[dict[str, object]],
        through_gameweek: int | None = None,
    ) -> tuple[list[dict[str, object]], dict[str, dict[str, float]]]:
        self.training_gameweek = through_gameweek
        rows = [
            row
            for row in self.training_rows
            if through_gameweek is None or row["gameweek"] <= through_gameweek
        ]
        player_features = {
            str(player["id"]): {
                "minutes_prior_roll4": 90.0,
                "xg_per90_prior_roll4": 0.1,
                "xa_per90_prior_roll4": 0.05,
                "xgc_per90_prior_roll4": 0.2,
                "points_per90_prior_roll4": 5.0,
            }
            for player in self.bootstrap["elements"]
        }
        return rows, player_features


class BackendScaffoldTests(unittest.TestCase):
    def setUp(self) -> None:
        self.fpl_api = FakeFPLApiClient()
        self.model_directory = tempfile.TemporaryDirectory()
        app.state.model_path = Path(self.model_directory.name) / "model_v1.joblib"
        app.state.report_directory = Path(self.model_directory.name) / "reports"
        app.dependency_overrides[get_fpl_api] = lambda: self.fpl_api

    def tearDown(self) -> None:
        app.dependency_overrides.pop(get_fpl_api, None)
        self.model_directory.cleanup()

    async def get_api_response(
        self,
        path: str,
        method: str = "GET",
        json: dict[str, object] | None = None,
    ) -> httpx.Response:
        async with httpx.AsyncClient(
            base_url="http://testserver",
            transport=httpx.ASGITransport(app=app),
        ) as client:
            return await client.request(method, path, json=json)

    def test_health_endpoint(self) -> None:
        response = asyncio.run(self.get_api_response("/api/v1/health"))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["api_version"], "v1")
        self.assertTrue(response.headers.get("X-Request-ID"))

    def test_root_endpoint_describes_service_and_health_url(self) -> None:
        response = asyncio.run(self.get_api_response("/"))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json(),
            {
                "service": "fpl-companion-ml",
                "api_version": "v1",
                "health": "/api/v1/health",
                "docs": "/docs",
            },
        )

    def test_local_network_origin_is_allowed_for_expo_web(self) -> None:
        async def fetch() -> httpx.Response:
            async with httpx.AsyncClient(
                base_url="http://testserver",
                transport=httpx.ASGITransport(app=app),
            ) as client:
                return await client.get(
                    "/api/v1/health",
                    headers={"Origin": "http://192.168.1.25:8081"},
                )

        response = asyncio.run(fetch())

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.headers["access-control-allow-origin"],
            "http://192.168.1.25:8081",
        )

    def test_model_endpoint_reports_model_state(self) -> None:
        response = asyncio.run(self.get_api_response("/api/v1/model"))

        self.assertEqual(response.status_code, 200)
        self.assertIn(response.json()["status"], {"ready", "untrained"})
        if response.json()["status"] == "untrained":
            self.assertIsNone(response.json()["model_version"])

    def test_model_endpoint_reports_loading_during_first_training(self) -> None:
        begin_training()
        try:
            response = asyncio.run(self.get_api_response("/api/v1/model"))
        finally:
            finish_training()

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"status": "loading", "model_version": None})

    def test_recommendations_endpoint_matches_contract(self) -> None:
        response = asyncio.run(
            self.get_api_response("/api/v1/recommendations?start_gw=12&position=3")
        )

        self.assertEqual(response.status_code, 200)
        recommendations = response.json()
        self.assertEqual(len(recommendations), 5)
        self.assertEqual(
            set(recommendations[0]),
            {
                "player",
                "projectedScore",
                "avgFDR",
                "upcomingMatches",
                "per90Metric",
                "fixtureCount",
                "projectedXP",
            },
        )
        self.assertIsNone(recommendations[0]["projectedXP"])
        self.assertEqual(len(recommendations[0]["upcomingMatches"]), 4)
        self.assertEqual(self.fpl_api.bootstrap_calls, 1)
        self.assertEqual(self.fpl_api.fixtures_calls, 1)

    def test_double_gameweek_recommendation_lists_both_fixtures(self) -> None:
        response = asyncio.run(
            self.get_api_response("/api/v1/recommendations?start_gw=12&position=2")
        )

        self.assertEqual(response.status_code, 200)
        top_recommendation = response.json()[0]
        self.assertEqual(top_recommendation["player"]["id"], 3)
        self.assertEqual(top_recommendation["fixtureCount"], 5)
        self.assertTrue(top_recommendation["upcomingMatches"][0]["isDouble"])
        self.assertTrue(top_recommendation["upcomingMatches"][1]["isDouble"])

    def test_recommendations_reject_invalid_query_with_contract_error(self) -> None:
        response = asyncio.run(
            self.get_api_response("/api/v1/recommendations?start_gw=39&position=3")
        )

        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json()["error"]["code"], "validation_error")
        self.assertTrue(response.json()["error"]["request_id"])
        self.assertTrue(response.headers.get("X-Request-ID"))

    def test_optimize_squad_returns_valid_xi_and_bench_order(self) -> None:
        response = asyncio.run(
            self.get_api_response(
                "/api/v1/optimize-squad",
                method="POST",
                json={"team_id": 1234, "gameweek": 12, "free_transfers": 1},
            )
        )

        self.assertEqual(response.status_code, 200, response.text)
        result = response.json()
        self.assertEqual(len(result["starters"]), 11)
        self.assertEqual(len(result["bench"]), 4)
        starter_positions = [
            player["player"]["element_type"] for player in result["starters"]
        ]
        self.assertEqual(starter_positions.count(1), 1)
        self.assertGreaterEqual(starter_positions.count(2), 3)
        self.assertGreaterEqual(starter_positions.count(3), 2)
        self.assertGreaterEqual(starter_positions.count(4), 1)
        self.assertEqual(result["bench"][-1]["player"]["element_type"], 1)
        self.assertIn(result["captain"], result["starters"])
        self.assertIn(result["viceCaptain"], result["starters"])
        self.assertTrue(all(player["matchXP"] for player in result["starters"]))
        double_gameweek_defender = next(
            player for player in result["starters"] if player["player"]["id"] == 3
        )
        self.assertEqual(double_gameweek_defender["fixtureCount"], 2)
        self.assertNotIn(
            15,
            [player["player"]["id"] for player in result["starters"]],
            "The blank-gameweek forward should be benched when alternatives are available.",
        )
        self.assertEqual(self.fpl_api.picks_calls, [(1234, 12)])

    def test_optimize_squad_rejects_invalid_request_body(self) -> None:
        response = asyncio.run(
            self.get_api_response(
                "/api/v1/optimize-squad",
                method="POST",
                json={"team_id": 0, "gameweek": 39, "free_transfers": -1},
            )
        )

        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json()["error"]["code"], "validation_error")

    def test_upstream_errors_use_contract_error_envelope(self) -> None:
        self.fpl_api.fail_bootstrap = True
        response = asyncio.run(
            self.get_api_response("/api/v1/recommendations?start_gw=12&position=3")
        )

        self.assertEqual(response.status_code, 502)
        self.assertEqual(response.json()["error"]["code"], "upstream_error")
        self.assertTrue(response.json()["error"]["request_id"])

    def test_retrain_persists_position_models_and_serves_xp(self) -> None:
        retrain_response = asyncio.run(
            self.get_api_response(
                "/api/v1/retrain",
                method="POST",
                json={"completed_gameweek": 10},
            )
        )

        self.assertEqual(retrain_response.status_code, 200, retrain_response.text)
        retrained = retrain_response.json()
        self.assertTrue(Path(app.state.model_path).is_file())
        self.assertEqual(retrained["status"], "ready")
        self.assertEqual(self.fpl_api.training_gameweek, 10)
        self.assertEqual(set(retrained["metrics"]), {"1", "2", "3", "4"})

        model_status = asyncio.run(self.get_api_response("/api/v1/model"))
        self.assertEqual(model_status.json()["status"], "ready")
        self.assertEqual(model_status.json()["model_version"], retrained["model_version"])

        optimize_response = asyncio.run(
            self.get_api_response(
                "/api/v1/optimize-squad",
                method="POST",
                json={"team_id": 1234, "gameweek": 12, "free_transfers": 1},
            )
        )
        self.assertEqual(optimize_response.status_code, 200, optimize_response.text)
        match_projection = optimize_response.json()["starters"][0]
        self.assertEqual(len(match_projection["matchXP"]), 1)
        self.assertAlmostEqual(match_projection["xP"], sum(match_projection["matchXP"]))

        recommendation_response = asyncio.run(
            self.get_api_response("/api/v1/recommendations?start_gw=12&position=3")
        )
        self.assertIsNotNone(recommendation_response.json()[0]["projectedXP"])

    def test_failed_retrain_preserves_existing_model_artifact(self) -> None:
        initial_retrain = asyncio.run(
            self.get_api_response(
                "/api/v1/retrain",
                method="POST",
                json={"completed_gameweek": 10},
            )
        )
        self.assertEqual(initial_retrain.status_code, 200, initial_retrain.text)
        original_model_version = initial_retrain.json()["model_version"]

        self.fpl_api.training_rows = []
        response = asyncio.run(
            self.get_api_response("/api/v1/retrain", method="POST")
        )

        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()["error"]["code"], "model_unavailable")
        self.assertTrue(Path(app.state.model_path).is_file())
        current_model = asyncio.run(self.get_api_response("/api/v1/model")).json()
        self.assertEqual(current_model["status"], "ready")
        self.assertEqual(
            current_model["model_version"],
            original_model_version,
        )

    def test_retrain_rejects_a_gameweek_that_is_not_finished(self) -> None:
        response = asyncio.run(
            self.get_api_response(
                "/api/v1/retrain",
                method="POST",
                json={"completed_gameweek": 13},
            )
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["error"]["code"], "validation_error")
        self.assertFalse(Path(app.state.model_path).exists())

    def test_walk_forward_evaluation_uses_only_prior_gameweeks_and_reports_baselines(self) -> None:
        rows = [
            {
                **{
                    name: (
                        float(position)
                        if name == "element_type"
                        else 90.0
                        if name == "minutes_prior_roll4"
                        else 4.0
                        if name == "points_per90_prior_roll4"
                        else float(gameweek % 3)
                        if name == "opponent_difficulty"
                        else 1.0
                        if name == "fatigue_decay"
                        else 0.0
                    )
                    for name in FEATURE_NAMES
                },
                "target": float(gameweek + player_id % 3),
                "gameweek": gameweek,
                "player_id": player_id,
                "fixture_count": 2 if gameweek == 5 and player_id == 30 else 1,
            }
            for position in range(1, 5)
            for player_id in range(position * 10, position * 10 + 3)
            for gameweek in range(1, 7)
        ]

        report = evaluate_walk_forward(rows, latest_gameweek=6, min_train_gameweeks=3)

        self.assertEqual(report["evaluation_gameweeks"], [4, 5, 6])
        self.assertEqual(set(report["positions"]), {"1", "2", "3", "4"})
        midfielder = report["positions"]["3"]
        self.assertEqual(midfielder["sample_count"], 9)
        self.assertIn("beat_both_baselines", midfielder)
        self.assertEqual(
            midfielder["by_fixture_cardinality"]["double_gameweek"]["ridge"]["sample_count"],
            1,
        )
        self.assertEqual(set(midfielder["by_gameweek"]), {"4", "5", "6"})
        self.assertEqual(
            midfielder["by_gameweek"]["4"]["ridge"]["sample_count"],
            3,
        )

    def test_walk_forward_report_contains_metrics_only_and_does_not_mutate_model(self) -> None:
        rows = [
            {
                **{name: float(position if name == "element_type" else 1) for name in FEATURE_NAMES},
                "target": float(gameweek + player_id),
                "gameweek": gameweek,
                "player_id": player_id,
                "fixture_count": 1,
            }
            for position in range(1, 5)
            for player_id in range(position * 10, position * 10 + 3)
            for gameweek in range(1, 6)
        ]
        report_directory = Path(self.model_directory.name) / "reports"

        report, report_path = run_walk_forward_evaluation(
            rows,
            latest_gameweek=5,
            min_train_gameweeks=3,
            report_directory=report_directory,
        )

        self.assertFalse(Path(app.state.model_path).exists())
        self.assertTrue(report_path.is_file())
        self.assertEqual(json.loads(report_path.read_text(encoding="utf-8")), report)
        self.assertNotIn("player_id", report_path.read_text(encoding="utf-8"))
        self.assertTrue(report_path.name.startswith("eval_report_"))

    def test_evaluate_endpoint_does_not_mutate_existing_model_artifact(self) -> None:
        original_artifact = b"leave existing production model artifact untouched"
        Path(app.state.model_path).write_bytes(original_artifact)

        response = asyncio.run(
            self.get_api_response("/api/v1/evaluate", method="POST")
        )

        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertTrue(Path(body["report_path"]).is_file())
        self.assertEqual(Path(app.state.model_path).read_bytes(), original_artifact)
        self.assertEqual(body["report"]["evaluation_gameweeks"][0], 4)
        self.assertEqual(self.fpl_api.training_gameweek, 12)

    def test_training_rows_use_only_prior_match_features(self) -> None:
        history = [
            {
                "round": gameweek,
                "minutes": 90,
                "expected_goals": "1.0",
                "expected_assists": "0.5",
                "expected_goals_conceded": "1.0",
                "total_points": 2,
                "was_home": gameweek % 2 == 0,
                "opponent_team": 2,
            }
            for gameweek in range(1, 6)
        ]
        rows = build_training_rows(
            player_id=7,
            team_id=1,
            element_type=3,
            history=history,
            fixtures=[
                {
                    "event": 5,
                    "team_h": 2,
                    "team_a": 1,
                    "team_h_difficulty": 3,
                    "team_a_difficulty": 3,
                },
                {
                    "event": 5,
                    "team_h": 3,
                    "team_a": 1,
                    "team_h_difficulty": 3,
                    "team_a_difficulty": 3,
                },
            ],
        )

        self.assertEqual(len(rows), 5)
        self.assertEqual(rows[0]["minutes_prior_roll4"], 0)
        self.assertEqual(rows[0]["xg_per90_prior_roll4"], 0)
        self.assertEqual(rows[4]["minutes_prior_roll4"], 90)
        self.assertEqual(rows[4]["xg_per90_prior_roll4"], 1)
        self.assertEqual(rows[4]["fixture_count"], 2)

    def test_double_gameweek_features_do_not_leak_same_gameweek_results(self) -> None:
        history = [
            {
                "round": 1,
                "minutes": 90,
                "total_points": 2,
                "was_home": True,
                "opponent_team": 2,
                "kickoff_time": "2026-08-01T12:00:00Z",
            },
            {
                "round": 2,
                "minutes": 90,
                "total_points": 20,
                "was_home": True,
                "opponent_team": 3,
                "kickoff_time": "2026-08-08T12:00:00Z",
            },
            {
                "round": 2,
                "minutes": 90,
                "total_points": 1,
                "was_home": False,
                "opponent_team": 4,
                "kickoff_time": "2026-08-12T12:00:00Z",
            },
        ]

        rows = build_training_rows(
            player_id=7,
            team_id=1,
            element_type=3,
            history=history,
            fixtures=[],
        )

        double_gameweek_rows = [row for row in rows if row["gameweek"] == 2]
        self.assertEqual(len(double_gameweek_rows), 2)
        self.assertEqual(
            [row["points_per90_prior_roll4"] for row in double_gameweek_rows],
            [2.0, 2.0],
        )

    def test_binary_milp_respects_constraint(self) -> None:
        result = solve_binary_selection(
            objective_coefficients=[5, 4, 3],
            constraint_matrix=[[1, 1, 1]],
            lower_bounds=[0],
            upper_bounds=[2],
        )

        self.assertEqual(sum(result.selected), 2)
        self.assertEqual(result.objective_value, 9.0)

    def test_blank_and_double_gameweek_haul_probability(self) -> None:
        self.assertEqual(estimate_haul_probability([]), 0.0)
        probability = estimate_haul_probability(
            [
                np.array([4.0, 5.0, 1.0]),
                np.array([6.0, 5.0, 2.0]),
            ]
        )

        self.assertAlmostEqual(probability, 200.0 / 3.0)

    def test_milp_rejects_mismatched_constraint_dimensions(self) -> None:
        with self.assertRaises(ValueError):
            solve_binary_selection(
                objective_coefficients=[1.0, 2.0],
                constraint_matrix=[[1.0]],
                lower_bounds=[0.0],
                upper_bounds=[1.0],
            )

    def test_milp_allows_unconstrained_binary_selection(self) -> None:
        result = solve_binary_selection([1.0, 3.0], [], [], [])

        self.assertEqual(result.selected, (True, True))
        self.assertEqual(result.objective_value, 4.0)

    def test_fpl_client_keeps_api_path_prefix(self) -> None:
        requested_paths: list[str] = []

        def respond(request: httpx.Request) -> httpx.Response:
            requested_paths.append(request.url.path)
            return httpx.Response(200, json={"events": []})

        async def fetch_bootstrap() -> dict[str, object]:
            async with httpx.AsyncClient(
                base_url="https://fpl.test/api/",
                transport=httpx.MockTransport(respond),
            ) as http_client:
                async with FPLApiClient(client=http_client) as fpl_client:
                    return await fpl_client.get_bootstrap()

        payload = asyncio.run(fetch_bootstrap())

        self.assertEqual(payload, {"events": []})
        self.assertEqual(requested_paths, ["/api/bootstrap-static/"])


if __name__ == "__main__":
    unittest.main()

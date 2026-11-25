"""Walk-forward model evaluation that never writes to the production artifact."""

import argparse
import asyncio
import json
import logging
import math
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
from sklearn.linear_model import Ridge
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

from .config import RUNTIME_DATA_DIR
from .data_pipeline import FPLApiClient
from .features import FEATURE_NAMES, number
from .ml_model import RIDGE_ALPHA

logger = logging.getLogger(__name__)
BACKEND_DIR = Path(__file__).resolve().parent
DEFAULT_REPORT_DIRECTORY = RUNTIME_DATA_DIR / "reports"


def _score(actual: np.ndarray, predicted: np.ndarray) -> dict[str, float | int]:
    if actual.size == 0:
        return {"sample_count": 0, "mae": None, "bias": None}
    errors = predicted - actual
    return {
        "sample_count": int(actual.size),
        "mae": round(float(np.mean(np.abs(errors))), 4),
        "bias": round(float(np.mean(errors)), 4),
    }


def _valid_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    result = []
    for row in rows:
        if not isinstance(row.get("gameweek"), int):
            continue
        position = number(row.get("element_type"), default=float("nan"))
        if not math.isfinite(position) or int(position) not in range(1, 5):
            continue
        target = number(row.get("target"), default=float("nan"))
        features = [number(row.get(name), default=float("nan")) for name in FEATURE_NAMES]
        if math.isfinite(target) and all(math.isfinite(value) for value in features):
            result.append(row)
    return result


def _metric_breakdown(
    actual: np.ndarray,
    predictions: dict[str, np.ndarray],
    cardinalities: np.ndarray,
) -> dict[str, Any]:
    result: dict[str, Any] = {
        name: _score(actual, predicted)
        for name, predicted in predictions.items()
    }
    cardinality_metrics: dict[str, dict[str, dict[str, float | int | None]]] = {}
    for label, fixture_count in (("single_gameweek", 1), ("double_gameweek", 2)):
        mask = cardinalities == fixture_count
        cardinality_metrics[label] = {
            name: _score(actual[mask], predicted[mask])
            for name, predicted in predictions.items()
        }
    result["by_fixture_cardinality"] = cardinality_metrics
    return result


def evaluate_walk_forward(
    training_rows: list[dict[str, Any]],
    latest_gameweek: int | None = None,
    min_train_gameweeks: int = 3,
) -> dict[str, Any]:
    """Train only on earlier gameweeks and score each later gameweek."""
    if min_train_gameweeks < 1:
        raise ValueError("min_train_gameweeks must be at least one.")

    rows = _valid_rows(training_rows)
    gameweeks = sorted(
        {
            int(row["gameweek"])
            for row in rows
            if isinstance(row.get("gameweek"), int)
        }
    )
    if not gameweeks:
        raise ValueError("No valid training rows with gameweek values were provided.")

    through_gameweek = latest_gameweek if latest_gameweek is not None else max(gameweeks)
    evaluation_gameweeks = [
        gameweek
        for gameweek in range(min_train_gameweeks + 1, through_gameweek + 1)
        if gameweek in gameweeks
        and sum(prior_week < gameweek for prior_week in gameweeks)
        >= min_train_gameweeks
    ]
    if not evaluation_gameweeks:
        raise ValueError(
            "Not enough distinct completed gameweeks for walk-forward evaluation."
        )

    position_reports: dict[str, dict[str, Any]] = {}
    positions = sorted(
        {
            int(row["element_type"])
            for row in rows
            if isinstance(row.get("element_type"), (int, float))
            and 1 <= int(row["element_type"]) <= 4
        }
    )

    for position in positions:
        position_rows = [
            row for row in rows if int(number(row.get("element_type"))) == position
        ]
        observations: dict[str, list[float | int]] = {
            "actual": [],
            "ridge": [],
            "positional_mean": [],
            "player_rolling4": [],
            "fixture_count": [],
            "gameweek": [],
        }

        for target_gameweek in evaluation_gameweeks:
            train_rows = [
                row for row in position_rows if int(row["gameweek"]) < target_gameweek
            ]
            test_rows = [
                row for row in position_rows if int(row["gameweek"]) == target_gameweek
            ]
            if not train_rows or not test_rows:
                continue

            x_train = np.asarray(
                [[number(row[name]) for name in FEATURE_NAMES] for row in train_rows],
                dtype=float,
            )
            y_train = np.asarray(
                [number(row["target"]) for row in train_rows],
                dtype=float,
            )
            x_test = np.asarray(
                [[number(row[name]) for name in FEATURE_NAMES] for row in test_rows],
                dtype=float,
            )
            actual = np.asarray(
                [number(row["target"]) for row in test_rows],
                dtype=float,
            )
            if not (
                np.isfinite(x_train).all()
                and np.isfinite(y_train).all()
                and np.isfinite(x_test).all()
                and np.isfinite(actual).all()
            ):
                continue

            model = make_pipeline(StandardScaler(), Ridge(alpha=RIDGE_ALPHA))
            model.fit(x_train, y_train)
            ridge_prediction = model.predict(x_test)
            positional_prediction = np.full(
                len(test_rows),
                float(np.mean(y_train)),
                dtype=float,
            )
            rolling_prediction = np.asarray(
                [
                    number(row.get("points_per90_prior_roll4"))
                    * number(row.get("minutes_prior_roll4"))
                    / 90
                    for row in test_rows
                ],
                dtype=float,
            )

            for index, row in enumerate(test_rows):
                observations["actual"].append(float(actual[index]))
                observations["ridge"].append(float(ridge_prediction[index]))
                observations["positional_mean"].append(float(positional_prediction[index]))
                observations["player_rolling4"].append(float(rolling_prediction[index]))
                observations["fixture_count"].append(
                    int(number(row.get("fixture_count")))
                )
                observations["gameweek"].append(target_gameweek)

        actual_array = np.asarray(observations["actual"], dtype=float)
        prediction_arrays = {
            name: np.asarray(observations[name], dtype=float)
            for name in ("ridge", "positional_mean", "player_rolling4")
        }
        cardinalities = np.asarray(observations["fixture_count"], dtype=int)
        all_metrics = _metric_breakdown(
            actual_array,
            prediction_arrays,
            cardinalities,
        )

        by_gameweek: dict[str, Any] = {}
        gameweek_values = np.asarray(observations["gameweek"], dtype=int)
        for gameweek in sorted(set(gameweek_values.tolist())):
            mask = gameweek_values == gameweek
            by_gameweek[str(gameweek)] = _metric_breakdown(
                actual_array[mask],
                {name: predicted[mask] for name, predicted in prediction_arrays.items()},
                cardinalities[mask],
            )

        mae = {name: all_metrics[name]["mae"] for name in prediction_arrays}
        ridge_mae = mae["ridge"]
        position_report = {
            "sample_count": int(actual_array.size),
            **all_metrics,
            "beat_both_baselines": (
                ridge_mae is not None
                and mae["positional_mean"] is not None
                and mae["player_rolling4"] is not None
                and ridge_mae < mae["positional_mean"]
                and ridge_mae < mae["player_rolling4"]
            ),
            "by_gameweek": by_gameweek,
        }
        position_reports[str(position)] = position_report

    return {
        "evaluation": "walk_forward_expanding_window",
        "training_policy": "For each target gameweek t, fit only rows with gameweek < t.",
        "min_train_gameweeks": min_train_gameweeks,
        "evaluation_gameweeks": evaluation_gameweeks,
        "positions": position_reports,
    }


def write_report(
    report: dict[str, Any],
    report_directory: Path = DEFAULT_REPORT_DIRECTORY,
) -> Path:
    report_directory.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    report_path = report_directory / f"eval_report_{timestamp}.json"
    temporary_path = report_path.with_suffix(".json.tmp")
    try:
        with temporary_path.open("w", encoding="utf-8") as file:
            json.dump(report, file, indent=2, allow_nan=False)
            file.write("\n")
        temporary_path.replace(report_path)
    except OSError:
        temporary_path.unlink(missing_ok=True)
        raise
    return report_path


def run_walk_forward_evaluation(
    training_rows: list[dict[str, Any]],
    latest_gameweek: int | None = None,
    min_train_gameweeks: int = 3,
    report_directory: Path = DEFAULT_REPORT_DIRECTORY,
) -> tuple[dict[str, Any], Path]:
    report = evaluate_walk_forward(
        training_rows=training_rows,
        latest_gameweek=latest_gameweek,
        min_train_gameweeks=min_train_gameweeks,
    )
    report["generated_at"] = datetime.now(timezone.utc).isoformat()
    report_path = write_report(report, report_directory)
    return report, report_path


async def _run_live_evaluation(
    min_train_gameweeks: int,
) -> tuple[dict[str, Any], Path]:
    async with FPLApiClient() as fpl_api:
        bootstrap, fixtures = await asyncio.gather(
            fpl_api.get_bootstrap(),
            fpl_api.get_fixtures(),
        )
        completed_gameweeks = [
            event["id"]
            for event in bootstrap.get("events", [])
            if isinstance(event, dict)
            and event.get("finished") is True
            and isinstance(event.get("id"), int)
        ]
        latest_gameweek = max(completed_gameweeks, default=None)
        if latest_gameweek is None:
            raise RuntimeError("The FPL API has no completed gameweeks to evaluate.")
        training_rows, _ = await fpl_api.get_training_rows(
            bootstrap=bootstrap,
            fixtures=fixtures,
            through_gameweek=latest_gameweek,
        )
    return run_walk_forward_evaluation(
        training_rows=training_rows,
        latest_gameweek=latest_gameweek,
        min_train_gameweeks=min_train_gameweeks,
    )


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Evaluate the xP model with an expanding-window gameweek backtest."
    )
    parser.add_argument(
        "--min-train-gameweeks",
        type=int,
        default=3,
        help="Minimum number of prior gameweeks required before each evaluation week.",
    )
    arguments = parser.parse_args()

    report, report_path = asyncio.run(
        _run_live_evaluation(arguments.min_train_gameweeks)
    )
    print(json.dumps({"report_path": str(report_path), "report": report}, indent=2))


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    main()

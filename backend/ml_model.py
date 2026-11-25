import logging
import math
import os
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import joblib
import numpy as np
from sklearn.linear_model import Ridge
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

from .config import settings
from .features import (
    FEATURE_NAMES,
    hours_between,
    live_player_features,
    number,
    parse_datetime,
)

logger = logging.getLogger(__name__)
ARTIFACT_FORMAT_VERSION = 2
MIN_POSITION_TRAINING_SAMPLES = 8
RIDGE_ALPHA = 5.0
SECOND_MATCH_FATIGUE = 0.82

_training_state_lock = threading.Lock()
_is_training = False


class ModelUnavailableError(RuntimeError):
    """Raised when an operation requires a trained model that is not available."""


class ModelArtifactError(RuntimeError):
    """Raised when a persisted model artifact is unreadable or incompatible."""


class ModelTrainingInProgressError(RuntimeError):
    """Raised when another training run is already in progress."""


class ModelTrainingError(RuntimeError):
    """Raised when the supplied dataset cannot produce a complete model."""


def begin_training() -> None:
    global _is_training
    with _training_state_lock:
        if _is_training:
            raise ModelTrainingInProgressError("A model retraining job is already running.")
        _is_training = True


def finish_training() -> None:
    global _is_training
    with _training_state_lock:
        _is_training = False


def model_status(model_path: Path = settings.model_path) -> dict[str, str | None]:
    with _training_state_lock:
        training = _is_training
    if training:
        return {
            "status": "loading",
            "model_version": (
                _read_artifact_version(model_path) if model_path.is_file() else None
            ),
        }
    if not model_path.is_file():
        return {"status": "untrained", "model_version": None}
    return {"status": "ready", "model_version": _read_artifact_version(model_path)}


def _read_artifact_version(model_path: Path) -> str | None:
    return load_model(model_path)["model_version"]


def load_model(model_path: Path = settings.model_path) -> dict[str, Any]:
    if not model_path.is_file():
        raise ModelUnavailableError(
            f"No trained model artifact exists at {model_path}."
        )
    try:
        artifact = joblib.load(model_path)
    except Exception as exc:
        raise ModelArtifactError(
            f"Unable to read model artifact at {model_path}."
        ) from exc
    if (
        not isinstance(artifact, dict)
        or artifact.get("artifact_format_version") != ARTIFACT_FORMAT_VERSION
        or artifact.get("feature_names") != list(FEATURE_NAMES)
        or not isinstance(artifact.get("models"), dict)
        or not isinstance(artifact.get("player_features"), dict)
        or not all(
            position in artifact["models"]
            and callable(getattr(artifact["models"][position], "predict", None))
            for position in range(1, 5)
        )
        or not isinstance(artifact.get("model_version"), str)
    ):
        raise ModelArtifactError(f"Model artifact at {model_path} is incompatible.")
    return artifact


def _mean_absolute_error(actual: np.ndarray, predicted: np.ndarray) -> float:
    return float(np.mean(np.abs(actual - predicted)))


def _train_position_model(rows: list[dict[str, Any]]) -> tuple[Any, dict[str, Any]]:
    ordered_rows = sorted(rows, key=lambda row: (row.get("gameweek", 0), row.get("player_id", 0)))
    if len(ordered_rows) < MIN_POSITION_TRAINING_SAMPLES:
        raise ValueError(
            f"Position has {len(ordered_rows)} records; "
            f"at least {MIN_POSITION_TRAINING_SAMPLES} are required."
        )

    features = np.asarray(
        [[number(row.get(name)) for name in FEATURE_NAMES] for row in ordered_rows],
        dtype=float,
    )
    targets = np.asarray([number(row.get("target"), float("nan")) for row in ordered_rows])
    valid_rows = np.isfinite(features).all(axis=1) & np.isfinite(targets)
    features = features[valid_rows]
    targets = targets[valid_rows]
    if targets.size < MIN_POSITION_TRAINING_SAMPLES:
        raise ValueError("Position has too few finite training records.")

    gameweeks = np.asarray(
        [int(ordered_rows[index].get("gameweek", 0)) for index in np.flatnonzero(valid_rows)],
        dtype=int,
    )
    unique_gameweeks = np.unique(gameweeks)
    if unique_gameweeks.size >= 3:
        split_week_index = max(int(unique_gameweeks.size * 0.8), 1)
        split_week = unique_gameweeks[min(split_week_index, unique_gameweeks.size - 1)]
        training_mask = gameweeks < split_week
        validation_mask = ~training_mask
    else:
        split_index = max(int(targets.size * 0.8), 1)
        if targets.size - split_index < 2:
            split_index = targets.size - 2
        training_mask = np.arange(targets.size) < split_index
        validation_mask = ~training_mask
    if training_mask.sum() < 2 or validation_mask.sum() < 2:
        raise ValueError("Position has too few matches for a chronological validation split.")

    holdout = make_pipeline(StandardScaler(), Ridge(alpha=RIDGE_ALPHA))
    holdout.fit(features[training_mask], targets[training_mask])
    validation_mae = _mean_absolute_error(
        targets[validation_mask],
        holdout.predict(features[validation_mask]),
    )

    model = make_pipeline(StandardScaler(), Ridge(alpha=RIDGE_ALPHA))
    model.fit(features, targets)
    return model, {
        "sample_count": int(targets.size),
        "validation_mae": round(validation_mae, 4),
    }


def train_and_persist_model(
    training_rows: list[dict[str, Any]],
    model_path: Path = settings.model_path,
    player_features: dict[str, dict[str, float]] | None = None,
) -> dict[str, Any]:
    if not training_rows:
        raise ModelTrainingError("Training dataset is empty.")

    rows_by_position: dict[int, list[dict[str, Any]]] = {1: [], 2: [], 3: [], 4: []}
    for row in training_rows:
        position = int(number(row.get("element_type")))
        if position in rows_by_position:
            rows_by_position[position].append(row)

    models: dict[int, Any] = {}
    metrics: dict[int, dict[str, Any]] = {}
    for position in range(1, 5):
        try:
            model, position_metrics = _train_position_model(rows_by_position[position])
        except ValueError as exc:
            raise ModelTrainingError(
                f"Unable to train position {position}: {exc}"
            ) from exc
        models[position] = model
        metrics[position] = position_metrics

    trained_at = datetime.now(timezone.utc)
    model_version = f"model_v1-{trained_at.strftime('%Y%m%dT%H%M%S%fZ')}"
    artifact = {
        "artifact_format_version": ARTIFACT_FORMAT_VERSION,
        "model_version": model_version,
        "trained_at": trained_at.isoformat(),
        "feature_names": list(FEATURE_NAMES),
        "models": models,
        "player_features": player_features or {},
        "metrics": metrics,
        "training_sample_count": sum(item["sample_count"] for item in metrics.values()),
    }
    model_path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = model_path.with_name(f"{model_path.name}.tmp")
    try:
        joblib.dump(artifact, temporary_path, compress=3)
        os.replace(temporary_path, model_path)
    finally:
        if temporary_path.exists():
            temporary_path.unlink()
    logger.info(
        "Persisted model %s with %s training records.",
        model_version,
        artifact["training_sample_count"],
    )
    return {
        "model_version": model_version,
        "trained_at": artifact["trained_at"],
        "training_sample_count": artifact["training_sample_count"],
        "metrics": metrics,
    }


def predict_match_xp(
    player: dict[str, Any],
    fixture: dict[str, Any],
    fixtures: list[dict[str, Any]],
    artifact: dict[str, Any],
    apply_availability: bool = True,
) -> float:
    position = int(number(player.get("element_type")))
    model = artifact["models"].get(position)
    if model is None:
        raise ModelArtifactError(f"Model artifact has no regressor for position {position}.")

    team_id = int(player["team"])
    is_home = fixture.get("team_h") == team_id
    difficulty_key = "team_h_difficulty" if is_home else "team_a_difficulty"
    opponent_difficulty = int(fixture.get(difficulty_key) or 3)
    current_kickoff = fixture.get("kickoff_time")
    current_kickoff_datetime = parse_datetime(current_kickoff)
    previous_fixtures = [
        candidate
        for candidate in fixtures
        if candidate is not fixture
        and (candidate.get("team_h") == team_id or candidate.get("team_a") == team_id)
        and parse_datetime(candidate.get("kickoff_time")) is not None
        and current_kickoff_datetime is not None
        and parse_datetime(candidate.get("kickoff_time")) < current_kickoff_datetime
    ]
    previous_fixture = max(
        previous_fixtures,
        key=lambda candidate: parse_datetime(candidate.get("kickoff_time")),
        default=None,
    )
    rest_hours = (
        hours_between(previous_fixture.get("kickoff_time"), current_kickoff)
        if previous_fixture is not None
        else 168.0
    )
    feature_values = live_player_features(
        player,
        opponent_difficulty=opponent_difficulty,
        is_home=is_home,
        rest_hours=rest_hours,
        prior_features=artifact.get("player_features", {}).get(str(player["id"])),
    )
    vector = np.asarray([[feature_values[name] for name in FEATURE_NAMES]], dtype=float)
    prediction = float(model.predict(vector)[0])
    if not math.isfinite(prediction):
        raise ModelArtifactError("Model produced a non-finite expected-points prediction.")
    prediction = max(prediction, 0.0)

    if apply_availability:
        status = player.get("status")
        status_multiplier = 1.0 if status == "a" else 0.6 if status == "d" else 0.0
        chance_of_playing = player.get("chance_of_playing_next_round")
        if chance_of_playing is not None:
            status_multiplier *= min(max(number(chance_of_playing) / 100, 0), 1)
    else:
        status_multiplier = 1.0
    return round(prediction * status_multiplier, 2)


def predict_gameweek_xp(
    player: dict[str, Any],
    player_fixtures: list[dict[str, Any]],
    all_fixtures: list[dict[str, Any]],
    artifact: dict[str, Any],
    apply_availability: bool = True,
) -> tuple[float, list[float]]:
    sorted_fixtures = sorted(
        player_fixtures,
        key=lambda fixture: parse_datetime(fixture.get("kickoff_time"))
        or datetime.max.replace(tzinfo=timezone.utc),
    )
    match_xp = [
        predict_match_xp(
            player,
            fixture,
            all_fixtures,
            artifact,
            apply_availability=apply_availability,
        )
        for fixture in sorted_fixtures
    ]
    discounted_match_xp = [
        prediction * (1.0 if index == 0 else SECOND_MATCH_FATIGUE)
        for index, prediction in enumerate(match_xp)
    ]
    rounded_match_xp = [
        round(prediction, 2) for prediction in discounted_match_xp
    ]
    return round(sum(rounded_match_xp), 2), rounded_match_xp

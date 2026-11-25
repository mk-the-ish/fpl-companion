import math
from datetime import datetime, timezone
from typing import Any


FEATURE_NAMES = (
    "element_type",
    "minutes_prior_roll4",
    "xg_per90_prior_roll4",
    "xa_per90_prior_roll4",
    "xgc_per90_prior_roll4",
    "points_per90_prior_roll4",
    "opponent_difficulty",
    "is_home",
    "rest_hours",
    "fatigue_decay",
)


def number(value: Any, default: float = 0.0) -> float:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return default
    return parsed if math.isfinite(parsed) else default


def parse_datetime(value: Any) -> datetime | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def fatigue_decay(rest_hours: float) -> float:
    if rest_hours > 72:
        return 1.0
    return max(0.7, 1 - 0.18 * math.exp(-max(rest_hours, 0) / 24))


def _per90(records: list[dict[str, Any]], field: str) -> float:
    total_minutes = sum(max(number(record.get("minutes")), 0.0) for record in records)
    if total_minutes <= 0:
        return 0.0
    total = sum(number(record.get(field)) for record in records)
    return total / total_minutes * 90


def _rest_hours(previous: dict[str, Any] | None, current: dict[str, Any]) -> float:
    if previous is None:
        return 168.0
    previous_kickoff = parse_datetime(previous.get("kickoff_time"))
    current_kickoff = parse_datetime(current.get("kickoff_time"))
    if previous_kickoff is None or current_kickoff is None:
        return 168.0
    return max((current_kickoff - previous_kickoff).total_seconds() / 3600, 0.0)


def prior_player_features(
    element_type: int,
    previous_records: list[dict[str, Any]],
) -> dict[str, float]:
    recent_records = previous_records[-4:]
    minutes = [max(number(item.get("minutes")), 0.0) for item in recent_records]
    return {
        "element_type": float(element_type),
        "minutes_prior_roll4": sum(minutes) / len(minutes) if minutes else 0.0,
        "xg_per90_prior_roll4": _per90(recent_records, "expected_goals"),
        "xa_per90_prior_roll4": _per90(recent_records, "expected_assists"),
        "xgc_per90_prior_roll4": _per90(recent_records, "expected_goals_conceded"),
        "points_per90_prior_roll4": _per90(recent_records, "total_points"),
    }


def _difficulty_lookup(
    fixtures: list[dict[str, Any]],
    team_id: int,
) -> dict[tuple[int, int, bool], int]:
    result: dict[tuple[int, int, bool], int] = {}
    for fixture in fixtures:
        event = fixture.get("event")
        if not isinstance(event, int):
            continue
        if fixture.get("team_h") == team_id:
            opponent_id = fixture.get("team_a")
            if not isinstance(opponent_id, int):
                continue
            result[(event, opponent_id, True)] = int(
                fixture.get("team_h_difficulty") or 3
            )
        if fixture.get("team_a") == team_id:
            opponent_id = fixture.get("team_h")
            if not isinstance(opponent_id, int):
                continue
            result[(event, opponent_id, False)] = int(
                fixture.get("team_a_difficulty") or 3
            )
    return result


def _fixture_count_for_history_record(
    record: dict[str, Any],
    fixtures: list[dict[str, Any]],
    fallback_team_id: int,
) -> int:
    event = record.get("round")
    opponent_id = int(number(record.get("opponent_team"), default=-1))
    was_home = bool(record.get("was_home"))
    matching_fixture = next(
        (
            fixture
            for fixture in fixtures
            if fixture.get("event") == event
            and (
                fixture.get("team_h") == opponent_id
                if was_home
                else fixture.get("team_a") == opponent_id
            )
        ),
        None,
    )
    team_id = fallback_team_id
    if matching_fixture is not None:
        candidate_team_id = (
            matching_fixture.get("team_h")
            if was_home
            else matching_fixture.get("team_a")
        )
        if isinstance(candidate_team_id, int):
            team_id = candidate_team_id

    fixture_count = sum(
        1
        for fixture in fixtures
        if fixture.get("event") == event
        and team_id in (fixture.get("team_h"), fixture.get("team_a"))
    )
    return fixture_count or 1


def build_training_rows(
    player_id: int,
    team_id: int,
    element_type: int,
    history: list[dict[str, Any]],
    fixtures: list[dict[str, Any]],
    through_gameweek: int | None = None,
) -> list[dict[str, Any]]:
    ordered_history = sorted(
        (
            record
            for record in history
            if isinstance(record.get("round"), int)
            and (through_gameweek is None or record["round"] <= through_gameweek)
        ),
        key=lambda record: (
            record["round"],
            parse_datetime(record.get("kickoff_time")) or datetime.min.replace(tzinfo=timezone.utc),
        ),
    )
    difficulty_by_fixture = _difficulty_lookup(fixtures, team_id)
    rows = []

    for index, record in enumerate(ordered_history):
        previous_records = [
            previous
            for previous in ordered_history[:index]
            if previous["round"] < record["round"]
        ]
        rest_hours = _rest_hours(
            ordered_history[index - 1] if index > 0 else None,
            record,
        )
        try:
            is_home = int(bool(record.get("was_home")))
        except (TypeError, ValueError):
            is_home = 0
        difficulty = difficulty_by_fixture.get(
            (
                record["round"],
                int(number(record.get("opponent_team"))),
                bool(is_home),
            ),
            3,
        )
        feature_values = {
            **prior_player_features(element_type, previous_records),
            "opponent_difficulty": float(difficulty),
            "is_home": float(is_home),
            "rest_hours": rest_hours,
            "fatigue_decay": fatigue_decay(rest_hours),
        }
        target = number(record.get("total_points"), default=float("nan"))
        if not math.isfinite(target):
            continue
        rows.append(
            {
                **feature_values,
                "target": target,
                "gameweek": record["round"],
                "player_id": player_id,
                "fixture_count": _fixture_count_for_history_record(
                    record,
                    fixtures,
                    team_id,
                ),
            }
        )
    return rows


def latest_player_history_features(
    element_type: int,
    history: list[dict[str, Any]],
    through_gameweek: int | None = None,
) -> dict[str, float]:
    ordered_history = sorted(
        (
            record
            for record in history
            if isinstance(record.get("round"), int)
            and (through_gameweek is None or record["round"] <= through_gameweek)
        ),
        key=lambda record: (
            record["round"],
            parse_datetime(record.get("kickoff_time"))
            or datetime.min.replace(tzinfo=timezone.utc),
        ),
    )
    return prior_player_features(element_type, ordered_history)


def live_player_features(
    player: dict[str, Any],
    opponent_difficulty: int,
    is_home: bool,
    rest_hours: float,
    prior_features: dict[str, float] | None = None,
) -> dict[str, float]:
    minutes = max(number(player.get("minutes")), 0.0)
    inferred_appearances = max(math.ceil(minutes / 90), 1)
    season_minutes_per_appearance = min(minutes / inferred_appearances, 90.0)
    features = {
        "element_type": float(player.get("element_type", 0)),
        "minutes_prior_roll4": season_minutes_per_appearance,
        "xg_per90_prior_roll4": number(player.get("expected_goals")) / max(minutes, 90.0) * 90,
        "xa_per90_prior_roll4": number(player.get("expected_assists")) / max(minutes, 90.0) * 90,
        "xgc_per90_prior_roll4": number(player.get("expected_goals_conceded")) / max(minutes, 90.0) * 90,
        "points_per90_prior_roll4": number(player.get("total_points")) / max(minutes, 90.0) * 90,
        "opponent_difficulty": float(opponent_difficulty),
        "is_home": float(is_home),
        "rest_hours": rest_hours,
        "fatigue_decay": fatigue_decay(rest_hours),
    }
    if prior_features is not None:
        features.update(
            {
                name: float(prior_features[name])
                for name in (
                    "minutes_prior_roll4",
                    "xg_per90_prior_roll4",
                    "xa_per90_prior_roll4",
                    "xgc_per90_prior_roll4",
                    "points_per90_prior_roll4",
                )
                if name in prior_features
            }
        )
    return features


def hours_between(kickoff_a: Any, kickoff_b: Any, default: float = 168.0) -> float:
    first = parse_datetime(kickoff_a)
    second = parse_datetime(kickoff_b)
    if first is None or second is None:
        return default
    return max((second - first).total_seconds() / 3600, 0.0)

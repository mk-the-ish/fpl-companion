import math
from collections import Counter
from typing import Any

import numpy as np

from .api_models import (
    OptimizedSquadResponse,
    PlayerProjectionResponse,
    PositionRecommendationResponse,
    TransferSuggestionResponse,
    UpcomingMatchResponse,
)
from .monte_carlo import estimate_haul_probability
from .ml_model import predict_gameweek_xp
from .optimizer import OptimizationError, solve_binary_selection

MONTE_CARLO_TRIALS = 25_000
HAUL_THRESHOLD = 10.0
SECOND_MATCH_FATIGUE = 0.82


class InvalidFPLDataError(ValueError):
    """Raised when an upstream response cannot represent a valid FPL team."""


def _number(value: Any, default: float = 0.0) -> float:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return default
    return parsed if math.isfinite(parsed) else default


def _team_names(bootstrap: dict[str, Any]) -> dict[int, str]:
    return {
        int(team["id"]): str(team["short_name"])
        for team in bootstrap.get("teams", [])
        if "id" in team and "short_name" in team
    }


def _team_matches(
    fixtures: list[dict[str, Any]],
    team_id: int,
    gameweek: int,
) -> list[dict[str, Any]]:
    return [
        fixture
        for fixture in fixtures
        if fixture.get("event") == gameweek
        and (fixture.get("team_h") == team_id or fixture.get("team_a") == team_id)
    ]


def _player_matchups(
    player: dict[str, Any],
    matches: list[dict[str, Any]],
    teams: dict[int, str],
) -> list[dict[str, Any]]:
    matchups = []
    for fixture in matches:
        is_home = fixture.get("team_h") == player["team"]
        opponent_id = fixture.get("team_a") if is_home else fixture.get("team_h")
        difficulty_key = "team_h_difficulty" if is_home else "team_a_difficulty"
        matchups.append(
            {
                "opponentShort": teams.get(opponent_id, "TBD"),
                "isHome": is_home,
                "fdr": int(fixture.get(difficulty_key) or 3),
            }
        )
    return matchups


def _project_points(
    player: dict[str, Any],
    matches: list[dict[str, Any]],
    teams: dict[int, str],
) -> tuple[float, list[dict[str, Any]], list[float]]:
    matchups = _player_matchups(player, matches, teams)
    if not matches:
        return 0.0, [{"opponentShort": "BLANK", "isHome": False, "fdr": 5}], []

    status = player.get("status")
    status_multiplier = 1.0 if status == "a" else 0.6 if status == "d" else 0.0
    expected_goals = _number(player.get("expected_goals"))
    expected_assists = _number(player.get("expected_assists"))
    form = _number(player.get("form"))
    match_xp = []

    for index, (fixture, matchup) in enumerate(zip(matches, matchups, strict=True)):
        fdr_multiplier = 1 + (3 - matchup["fdr"]) * 0.12
        if player.get("element_type") in (1, 2):
            base_match_points = (
                2.0
                + (_number(player.get("clean_sheets")) / max(_number(player.get("total_points")), 1))
                * 3.5
                + form * 0.4
            ) * fdr_multiplier
        else:
            base_match_points = (
                2.0 + (expected_goals * 0.75 + expected_assists * 0.5) * 1.8 + form * 0.5
            ) * fdr_multiplier

        venue_multiplier = 1.08 if fixture.get("team_h") == player["team"] else 0.95
        fatigue_multiplier = 1.0 if index == 0 else SECOND_MATCH_FATIGUE
        predicted_match_xp = (
            base_match_points
            * fatigue_multiplier
            * venue_multiplier
            * status_multiplier
        )
        match_xp.append(round(predicted_match_xp, 2))

    return round(sum(match_xp) + 1e-10, 2), matchups, match_xp


def _haul_probability(player_id: int, gameweek: int, xpoints: float, fixture_count: int) -> int:
    if xpoints <= 0 or fixture_count == 0:
        return 0

    random = np.random.default_rng(seed=player_id * 100 + gameweek)
    match_lambda = xpoints / fixture_count
    match_samples = [
        random.poisson(match_lambda, size=MONTE_CARLO_TRIALS).astype(float) * 2.2
        for _ in range(fixture_count)
    ]
    percent = estimate_haul_probability(match_samples, threshold=HAUL_THRESHOLD)
    return int(math.floor(percent + 0.5))


def recommend_players(
    players: list[dict[str, Any]],
    fixtures: list[dict[str, Any]],
    teams: dict[int, str],
    start_gameweek: int,
    position: int,
    model_artifact: dict[str, Any] | None = None,
) -> list[PositionRecommendationResponse]:
    recommendations: list[PositionRecommendationResponse] = []
    target_gameweeks = range(start_gameweek, start_gameweek + 4)

    for player in players:
        if player.get("element_type") != position or player.get("status") not in ("a", "d"):
            continue

        upcoming_matches: list[UpcomingMatchResponse] = []
        total_fdr = 0
        fixture_count = 0
        weighted_run_score = 0.0
        model_projected_xp = 0.0

        for index, gameweek in enumerate(target_gameweeks):
            matches = _team_matches(fixtures, int(player["team"]), gameweek)
            gameweek_weight = 1 / math.sqrt(index + 1)

            if not matches:
                upcoming_matches.append(
                    UpcomingMatchResponse(
                        gameweek=gameweek,
                        opponentShort="BLANK",
                        isHome=False,
                        fdr=5,
                        isBlank=True,
                    )
                )
                weighted_run_score -= 1.5 * gameweek_weight
                continue

            if model_artifact is not None:
                gameweek_xp, _ = predict_gameweek_xp(
                    player=player,
                    player_fixtures=matches,
                    all_fixtures=fixtures,
                    artifact=model_artifact,
                    apply_availability=index == 0,
                )
                model_projected_xp += gameweek_xp

            for match_index, fixture in enumerate(matches):
                is_home = fixture.get("team_h") == player["team"]
                opponent_id = fixture.get("team_a") if is_home else fixture.get("team_h")
                difficulty_key = "team_h_difficulty" if is_home else "team_a_difficulty"
                fdr = int(fixture.get(difficulty_key) or 3)
                upcoming_matches.append(
                    UpcomingMatchResponse(
                        gameweek=gameweek,
                        opponentShort=teams.get(opponent_id, "TBD"),
                        isHome=is_home,
                        fdr=fdr,
                        isDouble=len(matches) > 1,
                    )
                )
                fixture_count += 1
                total_fdr += fdr
                fatigue = 1.0 if match_index == 0 else SECOND_MATCH_FATIGUE
                ease = 5 - fdr + (0.75 if is_home else 0.0)
                weighted_run_score += ease * fatigue * gameweek_weight

        minutes = max(_number(player.get("minutes")), 1.0)
        nineties = minutes / 90
        expected_goals = _number(player.get("expected_goals"))
        expected_assists = _number(player.get("expected_assists"))
        expected_goals_conceded = _number(player.get("expected_goals_conceded"))
        form = _number(player.get("form"))

        if position in (1, 2):
            xgc_per_90 = expected_goals_conceded / nineties
            clean_sheets_per_90 = _number(player.get("clean_sheets")) / nineties
            per90_metric = max(0.0, 2.5 - xgc_per_90) + clean_sheets_per_90 * 2
            fixture_factor = max(0.0, weighted_run_score * 5.2)
            form_factor = min(form * 3.5, 25)
            underlying_factor = min(per90_metric * 10, 25)
        else:
            per90_metric = (expected_goals + expected_assists) / nineties
            fixture_factor = max(0.0, weighted_run_score * 4.5)
            form_factor = min(form * 3.5, 25)
            underlying_factor = min(per90_metric * 35, 35)

        projected_score = min(
            math.floor(fixture_factor + form_factor + underlying_factor + 0.5),
            100,
        )
        avg_fdr = total_fdr / fixture_count if fixture_count else 5.0
        recommendations.append(
            PositionRecommendationResponse(
                player=player,
                projectedScore=projected_score,
                avgFDR=round(avg_fdr + 1e-10, 1),
                upcomingMatches=upcoming_matches,
                per90Metric=round(per90_metric + 1e-10, 2),
                fixtureCount=fixture_count,
                projectedXP=(
                    round(model_projected_xp + 1e-10, 2)
                    if model_artifact is not None
                    else None
                ),
            )
        )

    return sorted(
        recommendations,
        key=lambda recommendation: recommendation.projectedScore,
        reverse=True,
    )


def _validate_squad_picks(
    picks_response: dict[str, Any],
    players_by_id: dict[int, dict[str, Any]],
) -> list[dict[str, Any]]:
    picks = picks_response.get("picks")
    if not isinstance(picks, list) or len(picks) != 15:
        raise InvalidFPLDataError("FPL picks response must contain exactly 15 players.")

    squad = []
    seen_ids = set()
    for pick in picks:
        player_id = pick.get("element")
        if not isinstance(player_id, int) or player_id in seen_ids:
            raise InvalidFPLDataError("FPL picks contain an invalid or duplicate player.")
        player = players_by_id.get(player_id)
        if player is None:
            raise InvalidFPLDataError(f"FPL player {player_id} is missing from bootstrap data.")
        seen_ids.add(player_id)
        squad.append(player)

    positions = Counter(player.get("element_type") for player in squad)
    if positions != Counter({1: 2, 2: 5, 3: 5, 4: 3}):
        raise InvalidFPLDataError("FPL picks do not match the required 2/5/5/3 squad positions.")
    if max(Counter(player.get("team") for player in squad).values(), default=0) > 3:
        raise InvalidFPLDataError("FPL picks exceed the three-player club limit.")
    return squad


def _solve_starting_xi(
    squad: list[dict[str, Any]],
    projections: list[PlayerProjectionResponse],
) -> tuple[list[int], list[int]]:
    count = len(squad)
    rows: list[list[float]] = []
    lower: list[float] = []
    upper: list[float] = []

    rows.append([1.0] * count)
    lower.append(11.0)
    upper.append(11.0)

    positions = [player.get("element_type") for player in squad]
    position_bounds = ((1, 1, 1), (2, 3, count), (3, 2, count), (4, 1, count))
    for position, minimum, maximum in position_bounds:
        rows.append(
            [
                1.0 if player_position == position else 0.0
                for player_position in positions
            ]
        )
        lower.append(float(minimum))
        upper.append(float(maximum))

    clubs = sorted({player.get("team") for player in squad})
    for club in clubs:
        rows.append([1.0 if player.get("team") == club else 0.0 for player in squad])
        lower.append(0.0)
        upper.append(3.0)

    result = solve_binary_selection(
        objective_coefficients=[projection.xP for projection in projections],
        constraint_matrix=rows,
        lower_bounds=lower,
        upper_bounds=upper,
    )
    starters = [index for index, selected in enumerate(result.selected) if selected]
    bench = [index for index, selected in enumerate(result.selected) if not selected]
    return starters, bench


def optimize_squad(
    picks_response: dict[str, Any],
    bootstrap: dict[str, Any],
    fixtures: list[dict[str, Any]],
    gameweek: int,
    free_transfers: int,
    model_artifact: dict[str, Any] | None = None,
    all_fixtures: list[dict[str, Any]] | None = None,
) -> OptimizedSquadResponse:
    players_by_id = {
        int(player["id"]): player
        for player in bootstrap.get("elements", [])
        if "id" in player
    }
    squad = _validate_squad_picks(picks_response, players_by_id)
    teams = _team_names(bootstrap)

    projections: list[PlayerProjectionResponse] = []
    for player in squad:
        matches = _team_matches(fixtures, int(player["team"]), gameweek)
        if model_artifact is not None:
            xpoints, match_xp = predict_gameweek_xp(
                player=player,
                player_fixtures=matches,
                all_fixtures=all_fixtures or fixtures,
                artifact=model_artifact,
            )
            matchups = _player_matchups(player, matches, teams)
            if not matches:
                matchups = [{"opponentShort": "BLANK", "isHome": False, "fdr": 5}]
        else:
            xpoints, matchups, match_xp = _project_points(player, matches, teams)
        fixture_count = len(matches)
        minutes_expected = (
            0
            if fixture_count == 0
            else round(
                (80 if _number(player.get("minutes")) > 0 else 45)
                * (1.7 if fixture_count == 2 else 1.0)
            )
        )
        projections.append(
            PlayerProjectionResponse(
                player=player,
                xP=xpoints,
                matchXP=match_xp,
                haulProbability=_haul_probability(
                    int(player["id"]),
                    gameweek,
                    xpoints,
                    fixture_count,
                ),
                fixtureCount=fixture_count,
                matchups=matchups,
                minutesExpected=minutes_expected,
            )
        )

    try:
        starter_indices, bench_indices = _solve_starting_xi(squad, projections)
    except (OptimizationError, ValueError) as exc:
        raise OptimizationError(f"Could not select a valid FPL starting XI: {exc}") from exc

    starters = [projections[index] for index in starter_indices]
    bench = [projections[index] for index in bench_indices]
    bench_goalkeepers = [player for player in bench if player.player.get("element_type") == 1]
    bench_outfield = [player for player in bench if player.player.get("element_type") != 1]
    bench_outfield.sort(key=lambda projection: projection.xP, reverse=True)
    bench = bench_outfield + bench_goalkeepers

    if len(starters) != 11 or len(bench) != 4 or len(starters) < 2:
        raise OptimizationError("Optimizer did not produce a complete 15-player squad.")

    captaincy_order = sorted(
        starters,
        key=lambda projection: projection.xP * 1.5 + projection.haulProbability * 0.1,
        reverse=True,
    )
    transfer_suggestions = _suggest_transfer(
        squad=squad,
        projections=projections,
        all_players=list(players_by_id.values()),
        fixtures=fixtures,
        teams=teams,
        gameweek=gameweek,
        bank=_number(picks_response.get("entry_history", {}).get("bank")),
        free_transfers=free_transfers,
        model_artifact=model_artifact,
        all_fixtures=all_fixtures or fixtures,
    )

    return OptimizedSquadResponse(
        starters=starters,
        bench=bench,
        captain=captaincy_order[0],
        viceCaptain=captaincy_order[1],
        transferSuggestions=transfer_suggestions,
    )


def _suggest_transfer(
    squad: list[dict[str, Any]],
    projections: list[PlayerProjectionResponse],
    all_players: list[dict[str, Any]],
    fixtures: list[dict[str, Any]],
    teams: dict[int, str],
    gameweek: int,
    bank: float,
    free_transfers: int,
    model_artifact: dict[str, Any] | None = None,
    all_fixtures: list[dict[str, Any]] | None = None,
) -> list[TransferSuggestionResponse]:
    if not projections:
        return []

    current_squad_ids = {int(player["id"]) for player in squad}
    club_counts = Counter(player.get("team") for player in squad)
    sell_candidate = min(projections, key=lambda projection: projection.xP)
    sell_price_limit = _number(sell_candidate.player.get("now_cost")) + bank
    available_replacements: list[tuple[float, dict[str, Any]]] = []

    for player in all_players:
        if int(player["id"]) in current_squad_ids:
            continue
        if player.get("element_type") != sell_candidate.player.get("element_type"):
            continue
        if player.get("status") not in ("a", "d"):
            continue
        if _number(player.get("now_cost")) > sell_price_limit:
            continue
        remaining_club_count = club_counts[player.get("team")] - (
            1 if player.get("team") == sell_candidate.player.get("team") else 0
        )
        if remaining_club_count >= 3:
            continue

        matches = _team_matches(fixtures, int(player["team"]), gameweek)
        if model_artifact is not None:
            xpoints, _ = predict_gameweek_xp(
                player=player,
                player_fixtures=matches,
                all_fixtures=all_fixtures or fixtures,
                artifact=model_artifact,
            )
        else:
            xpoints, _, _ = _project_points(player, matches, teams)
        available_replacements.append((xpoints, player))

    if not available_replacements:
        return []

    replacement_xp, replacement = max(available_replacements, key=lambda candidate: candidate[0])
    hit = 0.0 if free_transfers > 0 else 4.0
    net_gain = replacement_xp - sell_candidate.xP - hit
    if net_gain <= 0:
        return []

    return [
        TransferSuggestionResponse(
            sellCandidate=sell_candidate,
            buyCandidate=replacement,
            deltaXP=round(net_gain + 1e-10, 2),
        )
    ]

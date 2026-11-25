import asyncio
import logging
from typing import Any

import httpx

from .config import settings
from .features import (
    build_training_rows,
    latest_player_history_features,
    number,
)

logger = logging.getLogger(__name__)
HISTORY_FETCH_CONCURRENCY = 8


class FPLUpstreamError(RuntimeError):
    def __init__(self, message: str, status_code: int | None = None) -> None:
        super().__init__(message)
        self.status_code = status_code


class FPLApiClient:
    """Async client for the official FPL endpoints used by the service."""

    def __init__(
        self,
        client: httpx.AsyncClient | None = None,
        base_url: str = settings.fpl_api_base_url,
        timeout_seconds: float = settings.fpl_api_timeout_seconds,
    ) -> None:
        self._client = client or httpx.AsyncClient(
            base_url=base_url,
            timeout=timeout_seconds,
            headers={
                "Accept": "application/json",
                "User-Agent": "FPLCompanionML/1.0",
            },
        )
        self._owns_client = client is None

    async def __aenter__(self) -> "FPLApiClient":
        return self

    async def __aexit__(self, *_: object) -> None:
        if self._owns_client:
            await self._client.aclose()

    async def close(self) -> None:
        if self._owns_client:
            await self._client.aclose()

    async def _get_json(self, path: str) -> Any:
        try:
            response = await self._client.get(path)
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            raise FPLUpstreamError(
                f"FPL returned HTTP {exc.response.status_code} for {path}.",
                status_code=exc.response.status_code,
            ) from exc
        except httpx.RequestError as exc:
            raise FPLUpstreamError(
                f"FPL request failed for {path}: {exc}."
            ) from exc

        try:
            return response.json()
        except ValueError as exc:
            raise FPLUpstreamError(
                f"FPL returned invalid JSON for {path}.",
                status_code=response.status_code,
            ) from exc

    async def get_bootstrap(self) -> dict[str, Any]:
        return await self._get_json("bootstrap-static/")

    async def get_fixtures(self) -> list[dict[str, Any]]:
        return await self._get_json("fixtures/")

    async def get_entry_picks(
        self,
        team_id: int,
        gameweek: int,
    ) -> dict[str, Any]:
        return await self._get_json(
            f"entry/{team_id}/event/{gameweek}/picks/"
        )

    async def get_player_summary(self, player_id: int) -> dict[str, Any]:
        return await self._get_json(f"element-summary/{player_id}/")

    async def get_training_rows(
        self,
        bootstrap: dict[str, Any],
        fixtures: list[dict[str, Any]],
        through_gameweek: int | None = None,
    ) -> tuple[list[dict[str, Any]], dict[str, dict[str, float]]]:
        players = [
            player
            for player in bootstrap.get("elements", [])
            if isinstance(player, dict)
            and isinstance(player.get("id"), int)
            and number(player.get("minutes")) > 0
        ]
        if not players:
            raise FPLUpstreamError("No players with recorded minutes are available for training.")

        semaphore = asyncio.Semaphore(HISTORY_FETCH_CONCURRENCY)

        async def fetch_history(player: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
            async with semaphore:
                summary = await self.get_player_summary(int(player["id"]))
            if not isinstance(summary, dict) or not isinstance(summary.get("history"), list):
                raise FPLUpstreamError(
                    f"FPL returned an invalid history response for player {player['id']}."
                )
            return player, summary

        player_histories = await asyncio.gather(
            *(fetch_history(player) for player in players)
        )
        rows: list[dict[str, Any]] = []
        latest_features: dict[str, dict[str, float]] = {}
        for player, summary in player_histories:
            player_id = int(player["id"])
            rows.extend(
                build_training_rows(
                    player_id=player_id,
                    team_id=int(player["team"]),
                    element_type=int(player["element_type"]),
                    history=summary["history"],
                    fixtures=fixtures,
                    through_gameweek=through_gameweek,
                )
            )
            latest_features[str(player_id)] = latest_player_history_features(
                element_type=int(player["element_type"]),
                history=summary["history"],
                through_gameweek=through_gameweek,
            )

        if not rows:
            raise FPLUpstreamError("FPL player histories contained no trainable match records.")
        return rows, latest_features

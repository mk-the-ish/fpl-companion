import asyncio
import logging
from collections.abc import AsyncIterator
from typing import Annotated, Any
from uuid import uuid4

from fastapi import Body, Depends, FastAPI, HTTPException, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool

from . import __version__
from .analysis import (
    InvalidFPLDataError,
    optimize_squad,
    recommend_players,
)
from .api_models import (
    ErrorResponse,
    OptimizeSquadRequest,
    OptimizedSquadResponse,
    PositionRecommendationResponse,
    RetrainRequest,
    RetrainResponse,
)
from .config import settings
from .data_pipeline import FPLApiClient, FPLUpstreamError
from .ml_model import (
    ModelArtifactError,
    ModelTrainingError,
    ModelTrainingInProgressError,
    ModelUnavailableError,
    begin_training,
    finish_training,
    load_model,
    model_status,
    train_and_persist_model,
)
from .optimizer import OptimizationError

logger = logging.getLogger(__name__)

app = FastAPI(
    title="FPL Companion ML API",
    version=__version__,
    description="Machine-learning and optimization service for FPL Companion.",
)
app.state.model_path = settings.model_path

app.add_middleware(
    CORSMiddleware,
    allow_origins=list(settings.cors_origins),
    allow_origin_regex=settings.cors_origin_regex,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization", "X-Request-ID"],
)


async def get_fpl_api() -> AsyncIterator[FPLApiClient]:
    async with FPLApiClient() as client:
        yield client


@app.middleware("http")
async def add_request_id(request: Request, call_next):
    request_id = str(uuid4())
    request.state.request_id = request_id
    response = await call_next(request)
    response.headers["X-Request-ID"] = request_id
    return response


def _error_response(
    request: Request,
    status_code: int,
    code: str,
    message: str,
    details: list[dict[str, str]] | None = None,
) -> JSONResponse:
    error: dict[str, object] = {
        "code": code,
        "message": message,
        "request_id": request.state.request_id,
    }
    if details:
        error["details"] = details
    return JSONResponse(
        status_code=status_code,
        content={"error": error},
        headers={"X-Request-ID": request.state.request_id},
    )


@app.exception_handler(RequestValidationError)
async def handle_validation_error(
    request: Request,
    exc: RequestValidationError,
) -> JSONResponse:
    details = [
        {
            "field": ".".join(str(part) for part in error["loc"]),
            "message": error["msg"],
        }
        for error in exc.errors()
    ]
    return _error_response(
        request,
        status_code=422,
        code="validation_error",
        message="Request validation failed.",
        details=details,
    )


@app.exception_handler(HTTPException)
async def handle_http_error(
    request: Request,
    exc: HTTPException,
) -> JSONResponse:
    if exc.status_code == 400:
        code = "validation_error"
    elif exc.status_code == 404:
        code = "not_found"
    elif exc.status_code == 502:
        code = "upstream_error"
    elif exc.status_code == 503:
        code = "model_unavailable"
    else:
        code = "internal_error"

    return _error_response(
        request,
        status_code=exc.status_code,
        code=code,
        message=str(exc.detail),
    )


@app.exception_handler(FPLUpstreamError)
async def handle_fpl_upstream_error(
    request: Request,
    exc: FPLUpstreamError,
) -> JSONResponse:
    if exc.status_code == 404:
        status_code = 404
        code = "not_found"
        message = "The requested FPL manager or resource was not found."
    else:
        status_code = 502
        code = "upstream_error"
        message = "The official FPL API request failed."
    logger.warning("FPL upstream failure request_id=%s: %s", request.state.request_id, exc)
    return _error_response(request, status_code, code, message)


@app.exception_handler(InvalidFPLDataError)
async def handle_invalid_fpl_data(
    request: Request,
    exc: InvalidFPLDataError,
) -> JSONResponse:
    logger.warning("Invalid FPL response request_id=%s: %s", request.state.request_id, exc)
    return _error_response(
        request,
        status_code=502,
        code="upstream_error",
        message="The official FPL API returned data that could not be processed.",
    )


@app.exception_handler(OptimizationError)
async def handle_optimization_error(
    request: Request,
    exc: OptimizationError,
) -> JSONResponse:
    logger.warning("Optimization failed request_id=%s: %s", request.state.request_id, exc)
    return _error_response(
        request,
        status_code=503,
        code="optimization_failed",
        message="A valid squad optimization could not be produced.",
    )


@app.exception_handler(ModelArtifactError)
async def handle_model_artifact_error(
    request: Request,
    exc: ModelArtifactError,
) -> JSONResponse:
    logger.exception(
        "Model artifact error request_id=%s",
        request.state.request_id,
        exc_info=exc,
    )
    return _error_response(
        request,
        status_code=503,
        code="model_unavailable",
        message="The saved prediction model could not be loaded.",
    )


@app.exception_handler(ModelTrainingInProgressError)
async def handle_training_in_progress(
    request: Request,
    exc: ModelTrainingInProgressError,
) -> JSONResponse:
    return _error_response(
        request,
        status_code=503,
        code="model_unavailable",
        message=str(exc),
    )


@app.exception_handler(ModelTrainingError)
async def handle_model_training_error(
    request: Request,
    exc: ModelTrainingError,
) -> JSONResponse:
    logger.warning("Model training failed request_id=%s: %s", request.state.request_id, exc)
    return _error_response(
        request,
        status_code=503,
        code="model_unavailable",
        message=str(exc),
    )


@app.exception_handler(Exception)
async def handle_unexpected_error(
    request: Request,
    exc: Exception,
) -> JSONResponse:
    logger.exception(
        "Unhandled API error request_id=%s",
        request.state.request_id,
        exc_info=exc,
    )
    return _error_response(
        request,
        status_code=500,
        code="internal_error",
        message="An unexpected internal error occurred.",
    )


@app.get("/api/v1/health")
async def health() -> dict[str, str]:
    return {
        "status": "ok",
        "service": "fpl-companion-ml",
        "api_version": "v1",
    }


@app.get("/api/v1/model")
async def get_model_status(request: Request) -> dict[str, str | None]:
    return model_status(request.app.state.model_path)


@app.post(
    "/api/v1/retrain",
    response_model=RetrainResponse,
    responses={
        400: {"model": ErrorResponse},
        422: {"model": ErrorResponse},
        502: {"model": ErrorResponse},
        503: {"model": ErrorResponse},
    },
)
async def retrain_model_endpoint(
    request: Request,
    fpl_api: FPLApiClient = Depends(get_fpl_api),
    payload: RetrainRequest | None = Body(default=None),
) -> RetrainResponse:
    begin_training()
    try:
        bootstrap, fixtures = await asyncio.gather(
            fpl_api.get_bootstrap(),
            fpl_api.get_fixtures(),
        )
        if not isinstance(bootstrap, dict) or not isinstance(bootstrap.get("elements"), list):
            raise InvalidFPLDataError("FPL bootstrap response is missing player data.")
        if not isinstance(fixtures, list):
            raise InvalidFPLDataError("FPL fixtures response is not a list.")

        through_gameweek = payload.completed_gameweek if payload else None
        completed_events = {
            event.get("id")
            for event in bootstrap.get("events", [])
            if isinstance(event, dict)
            and event.get("finished") is True
            and isinstance(event.get("id"), int)
        }
        if through_gameweek is not None and through_gameweek not in completed_events:
            raise HTTPException(
                status_code=400,
                detail="completed_gameweek must refer to a finished FPL gameweek.",
            )
        if through_gameweek is None:
            through_gameweek = max(completed_events, default=None)

        training_rows, player_features = await fpl_api.get_training_rows(
            bootstrap=bootstrap,
            fixtures=fixtures,
            through_gameweek=through_gameweek,
        )
        training_result = await run_in_threadpool(
            train_and_persist_model,
            training_rows,
            request.app.state.model_path,
            player_features,
        )
        return RetrainResponse(status="ready", **training_result)
    finally:
        finish_training()


@app.post(
    "/api/v1/optimize-squad",
    response_model=OptimizedSquadResponse,
    responses={
        404: {"model": ErrorResponse},
        422: {"model": ErrorResponse},
        502: {"model": ErrorResponse},
        503: {"model": ErrorResponse},
    },
)
async def optimize_squad_endpoint(
    payload: OptimizeSquadRequest,
    request: Request,
    fpl_api: Annotated[FPLApiClient, Depends(get_fpl_api)],
) -> OptimizedSquadResponse:
    bootstrap, fixtures, picks = await _fetch_optimization_inputs(
        fpl_api,
        team_id=payload.team_id,
        gameweek=payload.gameweek,
    )
    try:
        return optimize_squad(
            picks_response=picks,
            bootstrap=bootstrap,
            fixtures=fixtures,
            gameweek=payload.gameweek,
            free_transfers=payload.free_transfers,
            model_artifact=_load_available_model(request.app.state.model_path),
            all_fixtures=fixtures,
        )
    except InvalidFPLDataError:
        raise
    except ValueError as exc:
        raise OptimizationError("Invalid optimizer input.") from exc


async def _fetch_optimization_inputs(
    fpl_api: FPLApiClient,
    team_id: int,
    gameweek: int,
) -> tuple[dict[str, Any], list[dict[str, Any]], dict[str, Any]]:
    bootstrap, fixtures, picks = await asyncio.gather(
        fpl_api.get_bootstrap(),
        fpl_api.get_fixtures(),
        fpl_api.get_entry_picks(team_id, gameweek),
    )
    if not isinstance(bootstrap, dict) or not isinstance(bootstrap.get("elements"), list):
        raise InvalidFPLDataError("FPL bootstrap response is missing player data.")
    if not isinstance(fixtures, list):
        raise InvalidFPLDataError("FPL fixtures response is not a list.")
    if not isinstance(picks, dict):
        raise InvalidFPLDataError("FPL picks response is not an object.")
    return bootstrap, fixtures, picks


@app.get(
    "/api/v1/recommendations",
    response_model=list[PositionRecommendationResponse],
    responses={
        422: {"model": ErrorResponse},
        502: {"model": ErrorResponse},
    },
)
async def recommendations_endpoint(
    start_gw: Annotated[int, Query(ge=1, le=38)],
    position: Annotated[int, Query(ge=1, le=4)],
    fpl_api: Annotated[FPLApiClient, Depends(get_fpl_api)],
    request: Request,
) -> list[PositionRecommendationResponse]:
    bootstrap, fixtures = await asyncio.gather(
        fpl_api.get_bootstrap(),
        fpl_api.get_fixtures(),
    )
    if not isinstance(bootstrap, dict) or not isinstance(bootstrap.get("elements"), list):
        raise InvalidFPLDataError("FPL bootstrap response is missing player data.")
    if not isinstance(fixtures, list):
        raise InvalidFPLDataError("FPL fixtures response is not a list.")

    return recommend_players(
        players=bootstrap["elements"],
        fixtures=fixtures,
        teams={
            int(team["id"]): str(team["short_name"])
            for team in bootstrap.get("teams", [])
            if isinstance(team, dict) and "id" in team and "short_name" in team
        },
        start_gameweek=start_gw,
        position=position,
        model_artifact=_load_available_model(request.app.state.model_path),
    )


def _load_available_model(model_path):
    try:
        return load_model(model_path)
    except ModelUnavailableError:
        logger.info("No trained model available; using heuristic projections.")
        return None

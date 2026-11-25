from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, StrictInt


class OptimizeSquadRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    team_id: StrictInt = Field(gt=0)
    gameweek: StrictInt = Field(ge=1, le=38)
    free_transfers: StrictInt = Field(ge=0)


class ProjectionMatch(BaseModel):
    opponentShort: str
    isHome: bool
    fdr: int


class PlayerProjectionResponse(BaseModel):
    player: dict[str, Any]
    xP: float
    matchXP: list[float] = Field(default_factory=list)
    haulProbability: int = Field(ge=0, le=100)
    fixtureCount: int = Field(ge=0)
    matchups: list[ProjectionMatch]
    minutesExpected: int = Field(ge=0)


class TransferSuggestionResponse(BaseModel):
    sellCandidate: PlayerProjectionResponse
    buyCandidate: dict[str, Any]
    deltaXP: float


class OptimizedSquadResponse(BaseModel):
    starters: list[PlayerProjectionResponse] = Field(min_length=11, max_length=11)
    bench: list[PlayerProjectionResponse] = Field(min_length=4, max_length=4)
    captain: PlayerProjectionResponse
    viceCaptain: PlayerProjectionResponse
    transferSuggestions: list[TransferSuggestionResponse]


class UpcomingMatchResponse(BaseModel):
    gameweek: int
    opponentShort: str
    isHome: bool
    fdr: int
    isDouble: bool | None = None
    isBlank: bool | None = None


class PositionRecommendationResponse(BaseModel):
    player: dict[str, Any]
    projectedScore: int
    avgFDR: float
    upcomingMatches: list[UpcomingMatchResponse]
    per90Metric: float
    fixtureCount: int
    projectedXP: float | None = None


class RetrainRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    completed_gameweek: StrictInt | None = Field(default=None, ge=1, le=38)


class RetrainResponse(BaseModel):
    status: Literal["ready"]
    model_version: str
    trained_at: str
    training_sample_count: int
    metrics: dict[int, dict[str, float | int]]


class ErrorDetail(BaseModel):
    field: str
    message: str


class ErrorBody(BaseModel):
    code: Literal[
        "validation_error",
        "not_found",
        "upstream_error",
        "model_unavailable",
        "optimization_failed",
        "internal_error",
    ]
    message: str
    details: list[ErrorDetail] | None = None
    request_id: str


class ErrorResponse(BaseModel):
    error: ErrorBody

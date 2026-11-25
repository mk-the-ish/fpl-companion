# ML API Contract

This contract describes the version 1 JSON API consumed by the mobile app. The
backend fetches official FPL data itself; clients send manager/gameweek
identifiers rather than player or fixture snapshots.

Until a trained prediction model is available, optimization and recommendation
routes use the deterministic local-equivalent heuristic scoring. The `model`
status endpoint reports model availability separately; these routes do not
pretend heuristic scores were produced by a trained model.

All endpoints are rooted at `/api/v1` and use JSON. The `v1` path prefix is the
compatibility boundary. Field names and casing below are the wire format and
must remain stable within this API version.

## Endpoints

### `POST /api/v1/optimize-squad`

Request:

```json
{
  "team_id": 123456,
  "gameweek": 12,
  "free_transfers": 1
}
```

Validation:

- `team_id`: required positive integer.
- `gameweek`: required integer from 1 through 38.
- `free_transfers`: required non-negative integer.

The backend fetches that entry's picks and the FPL bootstrap/fixture data, then
returns an `OptimizedSquadOutput`:

```json
{
  "starters": [],
  "bench": [],
  "captain": {},
  "viceCaptain": {},
  "transferSuggestions": []
}
```

Each non-empty projection in those fields has:

```json
{
  "player": {},
  "xP": 0,
  "matchXP": [],
  "haulProbability": 0,
  "fixtureCount": 0,
  "matchups": [
    {
      "opponentShort": "BLANK",
      "isHome": false,
      "fdr": 5
    }
  ],
  "minutesExpected": 0
}
```

`player` uses the `FPLPlayer` shape in `types/fpl.ts`. A transfer suggestion has
`sellCandidate` (a projection), `buyCandidate` (an `FPLPlayer`), and `deltaXP`
(a number). A valid squad response has 11 starters and 4 bench players,
including the reserve goalkeeper in the final bench position. `captain` and
`viceCaptain` are projections from the starters.

The recommendation's `deltaXP` is the net one-gameweek xP gain after a 4-point
hit when `free_transfers` is zero. No suggestion is returned when that net gain
is not positive. Player sale value is approximated using the player's current
`now_cost` plus the manager's bank because the public picks response does not
include each player's purchase/selling price.

### `GET /api/v1/recommendations?start_gw={gw}&position={1|2|3|4}`

Query validation:

- `start_gw`: required integer from 1 through 38.
- `position`: required integer; `1` goalkeeper, `2` defender, `3` midfielder,
  or `4` forward.

Returns an array of `PositionRecommendation`, matching the current local
recommender contract:

```json
[
  {
    "player": {},
    "projectedScore": 0,
    "avgFDR": 0,
    "upcomingMatches": [],
    "per90Metric": 0,
    "fixtureCount": 0,
    "projectedXP": null
  }
]
```

Each `upcomingMatches` item has `gameweek`, `opponentShort`, `isHome`, and
`fdr`, with optional `isDouble` and `isBlank`. `player` uses the `FPLPlayer`
shape. `projectedXP` is the model's total xP across the four-week horizon, or
`null` while serving the local-equivalent heuristic fallback.

### `GET /api/v1/health`

Returns HTTP 200 when the API process is responsive:

```json
{
  "status": "ok",
  "service": "fpl-companion-ml",
  "api_version": "v1"
}
```

### `GET /api/v1/model`

Returns model availability independently of process health:

```json
{
  "status": "ready",
  "model_version": "model_v1"
}
```

`status` is `ready`, `untrained`, or `loading`. `model_version` is `null` when
no trained model is available.

### `POST /api/v1/retrain`

Retrains four position-specific Ridge regression models and atomically saves a
versioned artifact at the configured model path. The endpoint fetches bootstrap,
fixtures, and each player history with minutes recorded. The request body is
optional:

```json
{
  "completed_gameweek": 12
}
```

When omitted, the most recently completed FPL gameweek is used. Historical
features for every training match are built only from earlier matches for that
player, with opponent difficulty and home/away information from fixtures. The
new artifact is only installed if all four position models train successfully,
so a failed retrain leaves the previous artifact untouched.
The artifact also stores each fetched player's latest four-match feature
snapshot so serving uses the same rolling feature definitions as training
without making one history request per recommendation.

Success response:

```json
{
  "status": "ready",
  "model_version": "model_v1-20261124T110000123456Z",
  "trained_at": "2026-11-24T11:00:00+00:00",
  "training_sample_count": 1000,
  "metrics": {
    "1": {
      "sample_count": 100,
      "validation_mae": 2.1
    }
  }
}
```

Each position has a chronological holdout MAE. At least eight finite historical
matches per position are required.

## Prediction behavior

The trained regressors predict match-level points for each scheduled fixture.
The API sums match predictions into gameweek xP and discounts a second fixture
by `0.82`. The squad endpoint exposes the individual predictions as `matchXP`
and their sum as `xP`. Recommendations expose the four-gameweek sum as
`projectedXP`, while retaining the existing heuristic `projectedScore` for UI
compatibility.

Before any trained artifact exists, `xP` and recommendation fields continue to
use deterministic heuristics; recommendation `projectedXP` is `null`. Model
availability is visible through `GET /api/v1/model`. A corrupt or incompatible
artifact is reported explicitly rather than silently treated as a missing
model.

## Error response

All non-2xx responses use this envelope:

```json
{
  "error": {
    "code": "validation_error",
    "message": "Request validation failed.",
    "details": [
      {
        "field": "position",
        "message": "Must be one of 1, 2, 3, or 4."
      }
    ],
    "request_id": "request-id"
  }
}
```

`details` may be omitted when there are no field-specific errors. `request_id`
must be included for tracing. Error codes are `validation_error`, `not_found`,
`upstream_error`, `model_unavailable`, `optimization_failed`, and
`internal_error`.

Expected status mapping:

| HTTP status | Meaning |
| --- | --- |
| 400 | Invalid domain request |
| 404 | FPL manager or requested resource not found |
| 422 | Missing, malformed, or out-of-range request fields |
| 502 | FPL upstream request failed |
| 503 | Model unavailable or optimization could not run |
| 500 | Unexpected internal failure |

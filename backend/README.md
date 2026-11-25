# FPL Companion ML backend

The Python service is isolated in this directory; Python dependencies are
declared in `requirements.txt` and are not part of the Expo package manifests.

## Setup and run

From the repository root, create a virtual environment and install backend
dependencies:

```powershell
py -3.13 -m venv backend\.venv
backend\.venv\Scripts\python -m pip install -r backend\requirements.txt
backend\.venv\Scripts\python -m uvicorn backend.main:app --host 0.0.0.0 --port 8000
```

The API documentation is available at `http://127.0.0.1:8000/docs`. The
endpoints include `GET /api/v1/health`, `GET /api/v1/model`,
`POST /api/v1/optimize-squad`, `GET /api/v1/recommendations`, and
`POST /api/v1/retrain`. Optimization and recommendation results use model
predictions after successful training, and deterministic heuristics before
then.

To connect the mobile app, run the backend on the host machine with
`--host 0.0.0.0`, then enter its reachable HTTP or HTTPS base URL in Settings
under **ML API Base URL** (for example, `http://192.168.1.10:8000`). The app
uses the local TypeScript projections if the URL is blank or the server cannot
be reached.

Train the position-specific Ridge regressors from completed FPL player-match
history with:

```powershell
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8000/api/v1/retrain `
  -ContentType 'application/json' `
  -Body '{"completed_gameweek":12}'
```

The body can be omitted to use the latest completed gameweek. Training artifacts
are written atomically to the configured model path; failed runs do not replace
the current model. Once an artifact is available, optimization and
recommendation routes use model predictions. Without one, they keep using the
deterministic heuristic fallback.

## Configuration

| Environment variable | Default | Purpose |
| --- | --- | --- |
| `FPL_API_BASE_URL` | Official FPL API URL | Override upstream API base |
| `FPL_API_TIMEOUT_SECONDS` | `15` | Timeout for official FPL requests |
| `FPL_MODEL_PATH` | `backend/models/model_v1.joblib` | Trained model artifact |
| `FPL_ML_CORS_ORIGINS` | Local Expo web origins | Comma-separated allowed browser origins |
| `FPL_ML_CORS_ORIGIN_REGEX` | Loopback and private IPv4 origins | Override the allowed local-network browser origin pattern |

`data_pipeline.py` provides an async official-API client. `ml_model.py` owns
artifact status/loading, `optimizer.py` provides a validated SciPy binary MILP
primitive, and `monte_carlo.py` aggregates independently sampled match points
for single and double gameweeks.

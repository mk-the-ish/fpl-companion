# FPL Companion ML backend

The Python service is isolated in this directory; Python dependencies are
declared in `requirements.txt` and are not part of the Expo package manifests.

## Vercel deployment

For Vercel, set the project's framework preset to FastAPI/Python and
**Root Directory** to the repository root (`.`), not `backend/`. The root
`pyproject.toml` points Vercel to
`backend.main:app`; the root `requirements.txt` includes the backend runtime
dependencies. The `.vercelignore` file excludes the mobile app, local
development environment, and test files from the Python deployment bundle.
After these files are committed, redeploy the project. Verify `/`,
`/api/v1/health`, and `/docs`.

Vercel Functions have an ephemeral writable `/tmp` directory. The backend
uses the platform temporary directory under `fpl-companion` for reports and newly trained model files when
`VERCEL=1`; those files are not durable across cold starts, instances, or
deployments. The Vercel-hosted retrain endpoint therefore does not provide
persistent model storage. Use a durable external artifact store before relying
on retraining in production, or train locally and package a versioned artifact
with a deployment. `FPL_RUNTIME_DATA_DIR` and `FPL_MODEL_PATH` can override the
runtime paths, but pointing them at the read-only deployment filesystem will
not work.

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
`POST /api/v1/retrain`, and `POST /api/v1/evaluate`. Optimization and
recommendation results use model predictions after successful training, and
deterministic heuristics before then.

To connect the mobile app, run the backend on the host machine with
`--host 0.0.0.0`, then enter its reachable HTTP or HTTPS base URL in Settings
under **ML API Base URL** (for example, `http://192.168.1.10:8000`). The app
uses the local TypeScript projections if the URL is blank or the server cannot
be reached.

For local development, train the position-specific Ridge regressors from completed FPL player-match
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

## Evaluate model quality

Run an expanding-window walk-forward evaluation from the repository root:

```powershell
backend\.venv\Scripts\python.exe -m backend.evaluate
```

For each completed gameweek from GW4 onward, the evaluator trains a fresh
position-specific Ridge pipeline using only rows from earlier gameweeks, then
compares it with a positional-mean baseline and the player's prior rolling-four
points baseline. It reports MAE, prediction bias, sample counts, per-gameweek
metrics, and separate single/double-gameweek metrics by position. The
evaluation-only path never loads or mutates `model_v1.joblib`; aggregate JSON
reports are written to `backend/reports/`.

The same evaluation can be started from Swagger UI or a script with
`POST /api/v1/evaluate`. It fetches completed FPL history and returns both the
report and its path. Reports contain aggregate metrics only, not player
histories or IDs.

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

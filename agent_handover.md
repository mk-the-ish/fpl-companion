# 🤖 Engineering Handover: FPL Companion — Machine Learning & Optimization Engine

## 1. Objective & Scope
This document serves as the technical specification and handover brief to transition the **FPL Companion** mobile app from deterministic TypeScript heuristics (`services/squadOptimizer.ts`, `services/recommenderV2.ts`) to a dedicated **Machine Learning & Operations Research Microservice** (Python / FastAPI / LightGBM / SciPy).

Your goal as the local coding agent is to:
1. Inspect the existing React Native (Expo Router) codebase and TypeScript interfaces (`types/fpl.ts`).
2. Scaffold a decoupled Python ML backend (`backend/` directory) that ingests official FPL API data, trains/serves an expected points ($\text{xP}$) gradient-boosted regression model, and solves multi-period Integer Linear Programs (ILP).
3. Wire the React Native client to consume predictions from this new ML endpoint with graceful fallback to the local TypeScript engine when offline.

---

## 2. Current Repository Architecture

```text
fpl-companion/
├── app/
│   ├── (tabs)/
│   │   ├── _layout.tsx        # Bottom tab navigation (Live Hub, My Squad, Planner, Leagues, Settings)
│   │   ├── index.tsx          # Live Gameweek Hub & BPS tracking
│   │   ├── squad.tsx          # User 15-man roster, Pitch View, and "AI Tactician" dashboard
│   │   ├── planner.tsx        # 4-Gameweek multi-position transfer target engine
│   │   ├── leagues.tsx        # Classic mini-league standings
│   │   └── settings.tsx       # FPL Entry ID management & React Query cache invalidation
│   └── setup.tsx              # Onboarding FPL Team ID linker
├── services/
│   ├── fplApi.ts              # Official FPL REST client (/bootstrap-static/, /event/{gw}/live/, etc.)
│   ├── recommenderV2.ts       # [HEURISTIC V2] 4-GW positional projection & fixture run scorer
│   └── squadOptimizer.ts      # [HEURISTIC V2] 0-1 Knapsack Starting XI solver & Monte Carlo captaincy sim
├── stores/
│   └── useUserStore.ts        # Zustand persisted state (teamId)
├── types/
│   └── fpl.ts                 # Strict TypeScript interfaces for FPL API payloads
└── FPL_MATHEMATICAL_MODEL.md  # Formal LaTeX specification of the mathematical formulation
```

### Key Existing Interfaces (`types/fpl.ts`)
Before modifying client services, inspect `types/fpl.ts` to ensure strict contract alignment:
* `FPLPlayer`: Contains `id`, `web_name`, `team`, `element_type` (`1=GKP, 2=DEF, 3=MID, 4=FWD`), `now_cost`, `form`, `minutes`, `expected_goals`, `expected_assists`, `expected_goals_conceded`, `clean_sheets`, `status` (`'a' | 'd' | 'i' | 's' | 'u'`).
* `FPLFixture`: Contains `event` (GW ID), `team_h`, `team_a`, `team_h_difficulty`, `team_a_difficulty`.
* `FPLPick`: Contains `element` (Player ID), `position` (`1..15`), `multiplier`, `is_captain`, `is_vice_captain`.

---

## 3. Target Architecture: Python ML & Optimization Microservice

Create a new `backend/` directory at the project root. Do **not** pollute the React Native `package.json` with Python dependencies.

```text
fpl-companion/
└── backend/
    ├── requirements.txt       # fastapi, uvicorn, pandas, numpy, scikit-learn, lightgbm, scipy, httpx
    ├── main.py                # FastAPI entrypoint, CORS middleware, API routes
    ├── data_pipeline.py       # Async FPL API fetcher + feature engineering (rolling xGI, opponent xGC)
    ├── ml_model.py            # LightGBM / Ridge regression model for match-level xP prediction
    ├── optimizer.py           # SciPy MILP solver (multi-GW transfer & formation optimization)
    └── monte_carlo.py         # Vectorized NumPy Poisson-Gamma captaincy haul simulator
```

---

## 4. Phase-by-Phase Execution Plan for Agent

### Phase 1: Data Ingestion & Feature Engineering (`backend/data_pipeline.py`)
1. Pull live data asynchronously via `httpx` from `https://fantasy.premierleague.com/api/bootstrap-static/` and `/fixtures/`.
2. Also fetch historical player-gameweek logs (`/element-summary/{player_id}/`) for active players ($\text{minutes} > 0$) to build a tabular training dataset.
3. **Required Engineered Features:**
   * `npxg_per_90_roll4` & `xa_per_90_roll4`: 4-match rolling underlying attacking rates.
   * `bayesian_xgi`: Empirical shrinkage blending rolling 4-match rate with full-season prior using logistic minutes saturation $\alpha(M) = (1 + e^{-\kappa(M - 450)})^{-1}$.
   * `opp_xgc_per_90`: Opponent's defensive vulnerability (expected goals conceded per 90).
   * `opp_xg_per_90`: Opponent's attacking threat (used for GKP/DEF clean sheet probability $P(\text{CS}) = e^{-\beta \cdot \text{opp\_xg}}$).
   * `is_home`: Binary home advantage indicator.
   * `rest_hours` & `fatigue_decay`: Hours since previous match; apply non-linear decay scalar $\Phi_{\text{fatigue}}$ if $\Delta \tau \le 72\text{h}$ (crucial for Double Gameweeks).
   * `fixture_count`: Cardinality of matches in target GW ($0 = \text{BGW}$, $1 = \text{SGW}$, $2 = \text{DGW}$).

### Phase 2: Supervised xP Model (`backend/ml_model.py`)
1. Train position-specific regressors (or a unified LightGBM Regressor with `element_type` as a categorical feature) predicting `total_points` on a per-fixture basis.
2. **Double & Blank Gameweek Aggregation:**
   * If `fixture_count == 0` (BGW): Force $\widehat{\text{xP}}_{i, t} = 0.0$.
   * If `fixture_count == 2` (DGW): Predict match 1 and match 2 independently, applying the congestion rotation/fatigue discount to match 2 ($\approx 0.82\times$) and summing expectations.
3. Persist trained artifacts (`model_v1.joblib`) with an endpoint (`POST /api/v1/retrain`) to refresh weights after each completed Gameweek.

### Phase 3: Vectorized Monte Carlo & MILP Solver (`backend/monte_carlo.py` & `backend/optimizer.py`)
1. **Vectorized Captaincy Simulation (`monte_carlo.py`):**
   * Replace the TypeScript Knuth loop in `services/squadOptimizer.ts` with vectorized NumPy sampling (`np.random.poisson` / `np.random.gamma`, $N = 25,000$ trials).
   * For DGW players, simulate two independent match distributions and sum trials to compute exact $P(\text{Score} \ge 10)$ (`haul_probability`).
2. **Exact MILP Roster & Transfer Solver (`optimizer.py`):**
   * Use `scipy.optimize.milp` to solve the 0-1 Integer Linear Program over a 4-Gameweek horizon:
     * Maximize total expected points minus transfer hit penalties ($-4$ pts per transfer exceeding free transfers).
     * Enforce strict FPL constraints: $11$ starters ($1\text{ GKP}, \ge 3\text{ DEF}, \ge 2\text{ MID}, \ge 1\text{ FWD}$), total squad budget $\le \text{TeamValue} + \text{Bank}$, and max $3$ players per Premier League club.

### Phase 4: FastAPI Endpoints (`backend/main.py`)
Expose the following JSON endpoints (ensure CORS allows requests from Expo / local network IPs):

1. `POST /api/v1/optimize-squad`
   * **Request Payload:** `{ "team_id": number, "gameweek": number, "free_transfers": number }`
   * **Response Payload:** Must match the `OptimizedSquadOutput` interface in `services/squadOptimizer.ts` (`starters`, `bench`, `captain`, `viceCaptain`, `transferSuggestions`) so the UI in `app/(tabs)/squad.tsx` requires zero structural rewrites.
2. `GET /api/v1/recommendations?start_gw={gw}&position={1|2|3|4}`
   * **Response Payload:** Must match `PositionRecommendation[]` in `services/recommenderV2.ts` for seamless rendering in `app/(tabs)/planner.tsx`.

### Phase 5: React Native Client Integration
1. Add a configurable `ML_API_BASE_URL` in `stores/useUserStore.ts` (and expose an input field in `app/(tabs)/settings.tsx` so the user can point the mobile APK to their local PC IP or hosted FastAPI server).
2. Update `app/(tabs)/squad.tsx` and `app/(tabs)/planner.tsx` to query the FastAPI backend first via `@tanstack/react-query`, automatically falling back to the local TypeScript functions (`evaluateUserSquad` / `generateMultiGameweekPicks`) if the ML server is unreachable.

---

## 5. Verification Checklist for Agent
Before concluding the task, verify:
- [ ] `uvicorn main:app --host 0.0.0.0 --port 8000` starts cleanly without dependency conflicts.
- [ ] `POST /api/v1/optimize-squad` correctly benches Blank Gameweek ($\text{xP} = 0$) players and prioritizes Double Gameweek captains.
- [ ] `scipy.optimize.milp` never violates the 3-players-per-club limit or valid FPL formation rules.
- [ ] TypeScript compilation (`npx tsc --noEmit`) passes with zero errors in the root Expo app.
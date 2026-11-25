# Project Limitations

This is a running list of known gaps and validation work to revisit after the
current implementation plan is complete. It records confirmed limitations, not
an exhaustive audit. Add new items here as they are discovered, and remove or
mark an item resolved only after the change has been implemented and verified.

Last updated: 2026-11-24

## Known limitations

| Priority | Area | Limitation | Follow-up |
| --- | --- | --- | --- |
| High | Training and model quality | A real expanding-window backtest was run for GW4-GW11 (3,684 match rows total), but Ridge did not beat both baselines in any position. Player rolling-four form had lower MAE than Ridge in all positions: GKP 2.0557 vs 2.1886 (n=208), DEF 1.8930 vs 2.2129 (n=1,288), MID 1.6492 vs 1.6608 (n=1,764), FWD 1.7773 vs 1.9293 (n=424). Ridge bias was -0.0876, +0.4960, +0.0959, and +0.0315 respectively. No double-gameweek rows were present, so DGW performance is unverified. | Do not treat the Ridge model as a validated production improvement. Investigate features/regularization and validate over a longer period; include a season archive containing players no longer active, and evaluate DGWs when representative samples are available. Compare against rolling-four baseline before enabling model-backed predictions by position. Report: [eval_report_20261125T081428912987Z.json](./backend/reports/eval_report_20261125T081428912987Z.json). |
| Medium | Historical data coverage | The training pipeline fetches histories only for players currently listed in bootstrap with recorded minutes. The resulting historical dataset can omit players who are no longer active or no longer have minutes in the current bootstrap, creating survivor/availability bias in model training and backtesting. | Build or obtain season-wide historical player snapshots and construct training data from the historical player population for each gameweek. |
| High | Squad recommendations | The mobile squad request currently sends `free_transfers: 1` rather than the manager's actual available free transfers. Transfer suggestions can therefore misstate the value of a move when the manager has a different number. | Retrieve the manager's free-transfer count for the selected gameweek and pass it through the API request; add tests for zero, one, and multiple free transfers. |
| Medium | Multi-gameweek optimization | The backend selects a starting XI for one gameweek and suggests at most a single replacement. It does not yet solve the handover's planned four-gameweek transfer/formation MILP, budget evolution, and transfer-hit optimization. | Implement the full-horizon transfer optimizer after the current client-integration plan. |
| Medium | Recommendation score semantics | `projectedScore` remains the heuristic ranking score. The model's `projectedXP` is separately returned when a trained artifact is available and is `null` otherwise; the recommendation order is still based on `projectedScore`. | Decide and document whether recommendations should rank by model xP, heuristic score, or a calibrated combination; validate that decision against historical outcomes. |
| Medium | Live integration | The mobile client has not been validated end-to-end against a live backend and real FPL responses. Current verification covers backend tests, app type-checking, and linting, but not a real-device/network integration run. | Test on a device with the backend reachable over the local network and test the offline fallback, timeout, and malformed-response cases. |
| Medium | Native SDK upgrade | The ignored, generated `android/` project was not regenerated as part of the SDK 58 package upgrade, so a native Android build/runtime has not been verified against SDK 58. | Regenerate the Android CNG project for SDK 58 before the next native build, preserving any local signing or build artifacts that must be retained. |
| High | Vercel model persistence | Vercel function storage is ephemeral. Retraining and evaluation write beneath the platform temporary directory; those files can disappear on cold starts or new instances, and the locally ignored model artifact is not automatically included in deployment. | Add durable external model artifact storage or explicitly package a versioned artifact with deployments; keep evaluation reports in durable storage if they need to persist. |
| Low | Operational deployment | The app accepts either HTTP or HTTPS for the configured backend URL. Local development may use HTTP, but a hosted deployment should use HTTPS and a reachable, maintained backend service. | Document and verify the intended production hosting, TLS, availability, and deployment process before distribution. |

## Tracking guidance

- Keep entries specific and actionable; include evidence or affected routes
  when it helps locate the limitation.
- Treat validation gaps separately from known implementation gaps. A feature
  that has only been tested with mocks should not be described as production
  validated.
- Reassess priorities when the current plan is complete. This file is a
  backlog, not a commitment to change scope during the active plan.

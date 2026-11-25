# Project Limitations

This is a running list of known gaps and validation work to revisit after the
current implementation plan is complete. It records confirmed limitations, not
an exhaustive audit. Add new items here as they are discovered, and remove or
mark an item resolved only after the change has been implemented and verified.

Last updated: 2026-11-24

## Known limitations

| Priority | Area | Limitation | Follow-up |
| --- | --- | --- | --- |
| High | Training and model quality | No real-data retraining or evaluation against a held-out live-season dataset has been run. Existing model tests use synthetic/mock data, so real FPL history availability, per-position sample sizes, and validation performance are not yet established. | Run a controlled retraining against completed FPL data; record sample counts and validation MAE by position, and compare with a simple baseline before relying on model predictions. |
| High | Squad recommendations | The mobile squad request currently sends `free_transfers: 1` rather than the manager's actual available free transfers. Transfer suggestions can therefore misstate the value of a move when the manager has a different number. | Retrieve the manager's free-transfer count for the selected gameweek and pass it through the API request; add tests for zero, one, and multiple free transfers. |
| Medium | Multi-gameweek optimization | The backend selects a starting XI for one gameweek and suggests at most a single replacement. It does not yet solve the handover's planned four-gameweek transfer/formation MILP, budget evolution, and transfer-hit optimization. | Implement the full-horizon transfer optimizer after the current client-integration plan. |
| Medium | Recommendation score semantics | `projectedScore` remains the heuristic ranking score. The model's `projectedXP` is separately returned when a trained artifact is available and is `null` otherwise; the recommendation order is still based on `projectedScore`. | Decide and document whether recommendations should rank by model xP, heuristic score, or a calibrated combination; validate that decision against historical outcomes. |
| Medium | Live integration | The mobile client has not been validated end-to-end against a live backend and real FPL responses. Current verification covers backend tests, app type-checking, and linting, but not a real-device/network integration run. | Test on a device with the backend reachable over the local network and test the offline fallback, timeout, and malformed-response cases. |
| Medium | Native SDK upgrade | The ignored, generated `android/` project was not regenerated as part of the SDK 58 package upgrade, so a native Android build/runtime has not been verified against SDK 58. | Regenerate the Android CNG project for SDK 58 before the next native build, preserving any local signing or build artifacts that must be retained. |
| Low | Operational deployment | The app accepts either HTTP or HTTPS for the configured backend URL. Local development may use HTTP, but a hosted deployment should use HTTPS and a reachable, maintained backend service. | Document and verify the intended production hosting, TLS, availability, and deployment process before distribution. |

## Tracking guidance

- Keep entries specific and actionable; include evidence or affected routes
  when it helps locate the limitation.
- Treat validation gaps separately from known implementation gaps. A feature
  that has only been tested with mocks should not be described as production
  validated.
- Reassess priorities when the current plan is complete. This file is a
  backlog, not a commitment to change scope during the active plan.

from collections.abc import Sequence

import numpy as np


def estimate_haul_probability(
    match_point_samples: Sequence[Sequence[float] | np.ndarray],
    threshold: float = 10.0,
) -> float:
    """Estimate percent of sampled single/DGW totals meeting the haul threshold.

    Each match must contain the same number of independently generated trial
    samples. An empty match list represents a blank gameweek and returns 0.
    """
    if not np.isfinite(threshold):
        raise ValueError("threshold must be finite.")
    if len(match_point_samples) == 0:
        return 0.0

    samples = [np.asarray(match, dtype=float) for match in match_point_samples]
    trial_count = samples[0].size
    if trial_count == 0:
        raise ValueError("Match samples must contain at least one trial.")

    for match in samples:
        if match.ndim != 1:
            raise ValueError("Each match sample collection must be one-dimensional.")
        if match.size != trial_count:
            raise ValueError("All matches must have the same number of trials.")
        if not np.isfinite(match).all():
            raise ValueError("Match samples must contain only finite values.")

    combined_points = np.sum(np.stack(samples, axis=0), axis=0)
    return float(np.mean(combined_points >= threshold) * 100.0)

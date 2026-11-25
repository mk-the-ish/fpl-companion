from dataclasses import dataclass
from typing import Sequence

import numpy as np
from scipy.optimize import Bounds, LinearConstraint, milp


class OptimizationError(RuntimeError):
    """Raised when the binary optimization problem cannot be solved."""


@dataclass(frozen=True)
class BinaryMilpResult:
    selected: tuple[bool, ...]
    objective_value: float


def solve_binary_selection(
    objective_coefficients: Sequence[float],
    constraint_matrix: Sequence[Sequence[float]],
    lower_bounds: Sequence[float],
    upper_bounds: Sequence[float],
) -> BinaryMilpResult:
    """Maximize a linear objective over binary choices and linear constraints."""
    objective = np.asarray(objective_coefficients, dtype=float)
    if len(constraint_matrix) == 0:
        matrix = np.empty((0, objective.size), dtype=float)
    else:
        matrix = np.asarray(constraint_matrix, dtype=float)
    lower = np.asarray(lower_bounds, dtype=float)
    upper = np.asarray(upper_bounds, dtype=float)

    if objective.ndim != 1 or objective.size == 0:
        raise ValueError("objective_coefficients must be a non-empty 1D sequence.")
    if not np.isfinite(objective).all():
        raise ValueError("objective_coefficients must contain only finite values.")
    if matrix.ndim != 2 or matrix.shape[1] != objective.size:
        raise ValueError(
            "constraint_matrix must be 2D with one column per decision variable."
        )
    if lower.ndim != 1 or upper.ndim != 1:
        raise ValueError("Constraint bounds must be 1D sequences.")
    if lower.size != matrix.shape[0] or upper.size != matrix.shape[0]:
        raise ValueError("Constraint bounds must match the constraint row count.")
    if not np.isfinite(matrix).all():
        raise ValueError("constraint_matrix must contain only finite values.")
    if np.isnan(lower).any() or np.isnan(upper).any():
        raise ValueError("Constraint bounds cannot contain NaN.")
    if np.any(lower > upper):
        raise ValueError("Each lower constraint bound must be <= its upper bound.")

    constraints = (
        LinearConstraint(matrix, lower, upper) if matrix.shape[0] else None
    )
    result = milp(
        c=-objective,
        integrality=np.ones(objective.size, dtype=np.int32),
        bounds=Bounds(
            np.zeros(objective.size, dtype=float),
            np.ones(objective.size, dtype=float),
        ),
        constraints=constraints,
    )

    if not result.success or result.x is None:
        raise OptimizationError(
            f"Binary optimization failed: {result.message or 'no solution found'}."
        )

    selected_values = np.rint(result.x).astype(bool)
    return BinaryMilpResult(
        selected=tuple(bool(value) for value in selected_values),
        objective_value=float(np.dot(objective, selected_values)),
    )

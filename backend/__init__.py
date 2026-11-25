"""FPL Companion ML backend package."""

import os

if os.getenv("VERCEL") == "1":
    for variable in (
        "OPENBLAS_NUM_THREADS",
        "OMP_NUM_THREADS",
        "MKL_NUM_THREADS",
        "NUMEXPR_NUM_THREADS",
    ):
        os.environ[variable] = "1"

__version__ = "0.1.0"

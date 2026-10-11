"""VayuRahshak: likely smoke path from a burning field.

A simple wind-following model, not a smoke dispersion model.
"""

import logging
from datetime import timedelta, timezone

# Library logging: callers (Lambda runtime, scripts) decide where logs go.
logging.getLogger(__name__).addHandler(logging.NullHandler())

# Fixed India Standard Time offset. We do not depend on zoneinfo or tzdata.
IST = timezone(timedelta(hours=5, minutes=30))

LABEL = "Likely smoke direction"
DISCLAIMER = (
    "Simple wind model: it follows the forecast wind from your field. "
    "It is not a smoke dispersion model."
)

USER_AGENT = (
    "ParaliMitra-SmokePath/1.0 "
    "(hackathon demo; +https://github.com/devansh2506/Parali_Mitra)"
)

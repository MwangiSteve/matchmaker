"""Candidate filtering and feature building for (request, pro) pairs.

This is the part that carries over to production unchanged: swap the
simulated pro table for your real database and these functions still apply.
"""
import numpy as np
import pandas as pd

from .world import CATEGORIES, CATEGORY_NAMES, is_peak, travel_minutes

RATING_PRIOR = 4.0     # what we assume about a pro with no reviews
RATING_PRIOR_WEIGHT = 5  # ...worth this many reviews
COMPLETION_PRIOR = 0.85

FEATURES = [
    "travel_min", "same_area", "rating_smoothed", "n_reviews_log", "completion_rate",
    "has_history", "jobs_done_log", "is_new", "reply_min_log", "acceptance_rate",
    "price_ratio", "verified", "last_active_days", "urgency", "hour", "is_peak",
    "has_photos", "customer_past_hires", "category",
]


def candidate_mask(req, pros, km, available):
    """Hard rules: right category, available, within the pro's travel limit, recently active."""
    travel = travel_minutes(km[req["area"], pros["area"]], req["hour"])
    return (
        pros[f"cat_{CATEGORY_NAMES[req['category']]}"]
        & available
        & (travel <= pros["max_travel_min"])
        & (pros["last_active_days"] < 30)
    )


def build_features(req, pros, idx, km):
    """Feature table for one request against the pros at positions `idx`."""
    g = lambda col: pros[col][idx]
    n_rev = g("n_reviews")
    rating = np.nan_to_num(g("rating"), nan=RATING_PRIOR)
    # Bayesian smoothing: a 5.0 from 2 reviews should not beat a 4.8 from 200.
    rating_s = (rating * n_rev + RATING_PRIOR * RATING_PRIOR_WEIGHT) / (n_rev + RATING_PRIOR_WEIGHT)
    base_price = list(CATEGORIES.values())[req["category"]][0]
    jobs = g("jobs_done")
    n = len(idx)
    return pd.DataFrame({
        "travel_min": travel_minutes(km[req["area"], g("area")], req["hour"]),
        "same_area": (g("area") == req["area"]).astype(int),
        "rating_smoothed": rating_s,
        "n_reviews_log": np.log1p(n_rev),
        "completion_rate": np.nan_to_num(g("completion_rate"), nan=COMPLETION_PRIOR),
        "has_history": (jobs > 0).astype(int),
        "jobs_done_log": np.log1p(jobs),
        "is_new": (jobs < 3).astype(int),
        "reply_min_log": np.log(g("reply_min")),
        "acceptance_rate": g("acceptance_rate"),
        "price_ratio": base_price * g("price_level") / req["budget"],  # >1: pro costs more than budget
        "verified": g("verified").astype(int),
        "last_active_days": g("last_active_days"),
        "urgency": np.full(n, req["urgency"]),
        "hour": np.full(n, req["hour"]),
        "is_peak": np.full(n, int(is_peak(req["hour"]))),
        "has_photos": np.full(n, int(req["has_photos"])),
        "customer_past_hires": np.full(n, req["customer_past_hires"]),
        "category": np.full(n, req["category"]),
    })[FEATURES]

"""Synthetic Nairobi world: areas, service categories, pros and customer requests.

Columns starting with "_true_" are hidden ground truth used only by the
simulator. A real system never sees them; the ranker must learn from the
observable columns (ratings, reply times, etc.).
"""
import numpy as np
import pandas as pd

# (lat, lon, share of pros living there, share of customer requests from there)
AREAS = {
    "CBD":        (-1.2864, 36.8172, 0.03, 0.04),
    "Westlands":  (-1.2676, 36.8108, 0.03, 0.10),
    "Parklands":  (-1.2630, 36.8180, 0.03, 0.06),
    "Kilimani":   (-1.2906, 36.7840, 0.03, 0.10),
    "Kileleshwa": (-1.2810, 36.7830, 0.02, 0.07),
    "Lavington":  (-1.2780, 36.7690, 0.02, 0.07),
    "Karen":      (-1.3190, 36.7076, 0.02, 0.06),
    "Lang'ata":   (-1.3627, 36.7502, 0.04, 0.05),
    "South B":    (-1.3090, 36.8350, 0.06, 0.05),
    "South C":    (-1.3180, 36.8270, 0.05, 0.05),
    "Embakasi":   (-1.3200, 36.9000, 0.10, 0.05),
    "Eastleigh":  (-1.2740, 36.8510, 0.08, 0.03),
    "Kasarani":   (-1.2210, 36.8970, 0.09, 0.04),
    "Roysambu":   (-1.2180, 36.8840, 0.08, 0.04),
    "Ruaka":      (-1.2050, 36.7790, 0.05, 0.05),
    "Rongai":     (-1.3960, 36.7550, 0.07, 0.04),
    "Kitengela":  (-1.4740, 36.9600, 0.06, 0.03),
    "Syokimau":   (-1.3610, 36.9300, 0.06, 0.04),
    "Ruiru":      (-1.1460, 36.9600, 0.08, 0.03),
}
AREA_NAMES = list(AREAS)

# Typical job price in KES and share of requests
CATEGORIES = {
    "plumbing":         (2500, 0.20),
    "electrical":       (3000, 0.15),
    "cleaning":         (1500, 0.25),
    "painting":         (8000, 0.10),
    "carpentry":        (5000, 0.10),
    "appliance_repair": (3500, 0.12),
    "moving":           (10000, 0.08),
}
CATEGORY_NAMES = list(CATEGORIES)
URGENCY = ["now", "this_week", "flexible"]


def _norm(w):
    w = np.asarray(w, dtype=float)
    return w / w.sum()


def km_matrix():
    """Straight-line km between every pair of areas (2 km within the same area)."""
    lat = np.radians([a[0] for a in AREAS.values()])
    lon = np.radians([a[1] for a in AREAS.values()])
    dlat = lat[:, None] - lat[None, :]
    dlon = lon[:, None] - lon[None, :]
    h = np.sin(dlat / 2) ** 2 + np.cos(lat[:, None]) * np.cos(lat[None, :]) * np.sin(dlon / 2) ** 2
    km = 2 * 6371 * np.arcsin(np.sqrt(h))
    np.fill_diagonal(km, 2.0)
    return km


def is_peak(hour):
    hour = np.asarray(hour)
    return ((hour >= 6) & (hour < 9)) | ((hour >= 16) & (hour < 20))


def travel_minutes(km, hour):
    """Rough Nairobi road time: winding roads, plus much slower at rush hour."""
    road_km = 1.4 * np.asarray(km) + 1.5
    speed_kmh = np.where(is_peak(hour), 14.0, 28.0)
    return road_km / speed_kmh * 60 + 10


def _sigmoid(x):
    return 1 / (1 + np.exp(-x))


def make_pros(n, rng):
    area = rng.choice(len(AREAS), n, p=_norm([a[2] for a in AREAS.values()]))
    cats = np.zeros((n, len(CATEGORIES)), dtype=bool)
    cat_p = _norm([c[1] for c in CATEGORIES.values()])
    for i, k in enumerate(rng.choice([1, 2, 3], n, p=[0.5, 0.35, 0.15])):
        cats[i, rng.choice(len(CATEGORIES), k, replace=False, p=cat_p)] = True

    quality = rng.normal(0, 1, n)        # hidden: how good their work really is
    responsive = rng.normal(0, 1, n)     # hidden: how reliably they pick up leads
    price_level = rng.lognormal(0, 0.25, n)

    jobs_done = np.where(rng.random(n) < 0.25, 0, rng.poisson(rng.gamma(2, 15, n)))
    n_reviews = rng.binomial(jobs_done, 0.6)
    with np.errstate(divide="ignore", invalid="ignore"):
        rating = np.clip(4.1 + 0.45 * quality + rng.normal(0, 0.8, n) / np.sqrt(n_reviews), 1, 5)
    rating = np.where(n_reviews > 0, rating, np.nan)
    completion = np.where(
        jobs_done > 0, np.clip(_sigmoid(2.2 + 0.9 * quality) + rng.normal(0, 0.05, n), 0, 1), np.nan
    )

    df = pd.DataFrame({
        "pro_id": np.arange(n),
        "area": area,
        "jobs_done": jobs_done,
        "n_reviews": n_reviews,
        "rating": rating,
        "completion_rate": completion,
        "reply_min": np.exp(3.4 - 0.7 * responsive + rng.normal(0, 0.3, n)),
        "acceptance_rate": _sigmoid(0.4 + 0.9 * responsive + rng.normal(0, 0.3, n)),
        "price_level": price_level,
        "verified": rng.random(n) < 0.55,
        "last_active_days": rng.exponential(3, n),
        "max_travel_min": rng.choice([45, 60, 90], n, p=[0.3, 0.45, 0.25]),
        "_true_quality": quality,
        "_true_responsive": responsive,
    })
    for j, c in enumerate(CATEGORY_NAMES):
        df[f"cat_{c}"] = cats[:, j]
    return df


def make_requests(n, rng, start_id=0):
    cat = rng.choice(len(CATEGORIES), n, p=_norm([c[1] for c in CATEGORIES.values()]))
    base_price = np.array([c[0] for c in CATEGORIES.values()])[cat]
    hour_p = _norm([1, 3, 5, 6, 6, 5, 5, 5, 5, 5, 4, 3, 2, 1, 1, 1])  # 06:00-21:00
    return pd.DataFrame({
        "request_id": np.arange(start_id, start_id + n),
        "area": rng.choice(len(AREAS), n, p=_norm([a[3] for a in AREAS.values()])),
        "category": cat,
        "hour": rng.choice(np.arange(6, 22), n, p=hour_p),
        "urgency": rng.choice(len(URGENCY), n, p=[0.3, 0.45, 0.25]),
        "budget": np.round(base_price * rng.lognormal(0, 0.3, n), -2),
        "has_photos": rng.random(n) < 0.4,
        "customer_past_hires": rng.poisson(0.8, n),
    })

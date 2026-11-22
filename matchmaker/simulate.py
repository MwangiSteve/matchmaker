"""Marketplace simulator. Plays the role of real customers and pros.

It uses the hidden "_true_" columns to decide who responds, who gets hired
and whether the job goes well. It also updates pro stats (jobs, ratings)
as jobs happen, so a policy that always picks the same pros shows up as
poor pro coverage.

Replace this with your real logs once you have them; the policies and
features don't change.
"""
import numpy as np
import pandas as pd

from .features import FEATURES, build_features, candidate_mask
from .policies import rank
from .world import km_matrix

NIGHT_HOURS = {20, 21}


def _sigmoid(x):
    return 1 / (1 + np.exp(-x))


class Marketplace:
    def __init__(self, pros_df, seed=0, availability=0.75):
        self.P = {c: pros_df[c].to_numpy().copy() for c in pros_df.columns}
        self.n = len(pros_df)
        self.km = km_matrix()
        self.seed = seed
        self.availability = availability
        self.hires = np.zeros(self.n, dtype=int)

    def step(self, req, policy, k=5):
        # Per-request randomness, so every policy sees the same availability.
        rng = np.random.default_rng([self.seed, int(req["request_id"])])
        available = rng.random(self.n) < self.availability
        idx = np.flatnonzero(candidate_mask(req, self.P, self.km, available))
        if len(idx) == 0:
            return None
        X = build_features(req, self.P, idx, self.km)
        order = rank(policy, X, rng, k)[:k]
        X = X.iloc[order].reset_index(drop=True)
        shown = idx[order]

        q = self.P["_true_quality"][shown]
        resp = self.P["_true_responsive"][shown]
        travel = X["travel_min"].to_numpy()
        price_ratio = X["price_ratio"].to_numpy()
        urgent = req["urgency"] == 0

        # 1. Does each shown pro respond to the lead?
        logit_r = (0.2 + 1.0 * resp - 0.025 * (travel - 30)
                   - 1.0 * (req["hour"] in NIGHT_HOURS)
                   - 1.2 * np.maximum(0, price_ratio - 1.15)
                   - 0.15 * np.minimum(X["last_active_days"].to_numpy(), 10))
        responded = rng.random(len(shown)) < _sigmoid(logit_r)
        reply_min = np.exp(X["reply_min_log"].to_numpy()) * rng.lognormal(0, 0.4, len(shown))

        # 2. Customer picks one responder, or nobody.
        position = np.arange(len(shown))
        util = (1.3 * (X["rating_smoothed"].to_numpy() - 4.2)
                + 0.4 * X["verified"].to_numpy()
                - 0.5 * (price_ratio - 1) - 1.8 * np.maximum(0, price_ratio - 1)
                - 0.015 * travel * (2 if urgent else 1)
                - 0.2 * np.log(reply_min / 30) * (2 if urgent else 1)
                + 0.15 * X["n_reviews_log"].to_numpy()
                - 0.25 * position
                + rng.gumbel(size=len(shown)))
        util[~responded] = -np.inf
        hired = np.zeros(len(shown), dtype=int)
        outside_option = 0.3 + rng.gumbel()
        if responded.any() and util.max() > outside_option:
            hired[np.argmax(util)] = 1

        # 3. Does the job go well?
        logit_g = 1.4 + 1.3 * q - 0.012 * (travel - 30) + 0.3 * req["has_photos"]
        good = ((rng.random(len(shown)) < _sigmoid(logit_g)) & (hired == 1)).astype(int)
        stars = np.where(good == 1,
                         np.clip(np.round(4.3 + 0.5 * q + rng.normal(0, 0.5, len(shown))), 3, 5),
                         np.clip(np.round(2.0 + 0.5 * q + rng.normal(0, 0.8, len(shown))), 1, 3))

        self._update(shown, responded, hired, good, stars, rng)

        out = X.copy()
        out["request_id"] = req["request_id"]
        out["pro_id"] = shown
        out["position"] = position
        out["responded"] = responded.astype(int)
        out["reply_min"] = np.where(responded, reply_min, np.nan)
        out["hired"] = hired
        out["good"] = good
        out["stars"] = np.where(hired == 1, stars, np.nan)
        return out

    def _update(self, shown, responded, hired, good, stars, rng):
        P = self.P
        P["last_active_days"][shown[responded]] = 0.0
        for j in np.flatnonzero(hired):
            p = shown[j]
            self.hires[p] += 1
            P["jobs_done"][p] += 1
            jobs = P["jobs_done"][p]
            prev = P["completion_rate"][p]
            P["completion_rate"][p] = good[j] if np.isnan(prev) else (prev * (jobs - 1) + good[j]) / jobs
            if rng.random() < 0.7:  # not every customer leaves a review
                n = P["n_reviews"][p]
                prev = 0.0 if np.isnan(P["rating"][p]) else P["rating"][p]
                P["rating"][p] = (prev * n + stars[j]) / (n + 1)
                P["n_reviews"][p] = n + 1

    def run(self, requests, policy, k=5):
        rows = [self.step(r, policy, k) for r in requests.to_dict("records")]
        logs = pd.concat([r for r in rows if r is not None], ignore_index=True)
        return logs, self.summary(requests, logs)

    def summary(self, requests, logs):
        per_req = logs.groupby("request_id").agg(
            hired=("hired", "max"), good=("good", "max"), first_reply=("reply_min", "min"))
        n = len(requests)
        hires_sorted = np.sort(self.hires)[::-1]
        top10 = hires_sorted[: max(1, self.n // 10)].sum() / max(1, hires_sorted.sum())
        return {
            "hire_rate": per_req["hired"].sum() / n,
            "good_job_rate": per_req["good"].sum() / n,
            "no_candidates": 1 - len(per_req) / n,
            "median_first_reply_min": per_req["first_reply"].median(),
            "pros_with_a_job": (self.hires > 0).mean(),
            "top10pct_pros_share": top10,
        }

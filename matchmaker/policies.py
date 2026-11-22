"""Ranking policies: how to order the candidate pros for a request.

- HeuristicPolicy: hand-weighted score, use this at launch before you have data.
- ModelRanker: three ML models, P(respond) x P(hired | respond) x P(good job | hired).
- Exploration: reserve a slot for new pros so they can build a track record.
"""
import pickle

import numpy as np
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.metrics import roc_auc_score

from .features import FEATURES


class RandomPolicy:
    name = "random"

    def scores(self, X, rng):
        return rng.random(len(X))


class HeuristicPolicy:
    """Phase 1: no data needed. Tune the weights by hand as you learn."""
    name = "heuristic"

    def __init__(self, w_proximity=0.35, w_rating=0.25, w_response=0.20, w_price=0.20):
        self.w = (w_proximity, w_rating, w_response, w_price)

    def scores(self, X, rng=None):
        proximity = 1 - np.clip(X["travel_min"] / 90, 0, 1)
        rating = np.clip((X["rating_smoothed"] - 3) / 2, 0, 1)
        response = 1 - np.clip(X["reply_min_log"] / np.log(240), 0, 1)  # 4h reply = 0
        price_fit = 1 - np.clip(np.abs(X["price_ratio"] - 1), 0, 1)
        a, b, c, d = self.w
        return (a * proximity + b * rating + c * response + d * price_fit).to_numpy()


class EpsilonPolicy:
    """Wraps a policy and shows a random order for a share of requests.
    Use this while collecting training data so the model sees varied rankings."""

    def __init__(self, base, epsilon=0.3):
        self.base, self.epsilon = base, epsilon
        self.name = f"{base.name}+eps{epsilon}"

    def scores(self, X, rng):
        if rng.random() < self.epsilon:
            return rng.random(len(X))
        return self.base.scores(X, rng)


def _gbm():
    return HistGradientBoostingClassifier(
        max_iter=300, learning_rate=0.05, max_leaf_nodes=31,
        l2_regularization=1.0, early_stopping=True, random_state=0,
        categorical_features=[FEATURES.index("category"), FEATURES.index("urgency")],
    )


class ModelRanker:
    """Phase 2: learn from logged impressions.

    The hired model also gets the position a pro was shown in, because
    customers tend to pick whoever is listed first. At ranking time every
    pro is scored as if shown in position 0, which removes that bias.
    """

    def __init__(self, new_pro_slot=None):
        self.new_pro_slot = new_pro_slot  # e.g. 2 = put the best new pro 3rd
        self.name = "model" + (f"+newpro@{new_pro_slot + 1}" if new_pro_slot is not None else "")
        self.m_respond = self.m_hire = self.m_good = None

    def fit(self, logs):
        X = logs[FEATURES]
        self.m_respond = _gbm().fit(X, logs["responded"])
        r = logs[logs["responded"] == 1]
        self.m_hire = _gbm().fit(r[FEATURES].assign(position=r["position"]), r["hired"])
        h = logs[logs["hired"] == 1]
        self.m_good = _gbm().fit(h[FEATURES], h["good"])
        return self

    def predict_parts(self, X):
        p_r = self.m_respond.predict_proba(X)[:, 1]
        p_h = self.m_hire.predict_proba(X.assign(position=0))[:, 1]
        p_g = self.m_good.predict_proba(X)[:, 1]
        return p_r, p_h, p_g

    def scores(self, X, rng=None):
        p_r, p_h, p_g = self.predict_parts(X)
        return p_r * p_h * p_g

    def order(self, X, rng, k):
        """Ranked positions, optionally reserving a slot for a promising new pro."""
        s = self.scores(X, rng)
        order = list(np.argsort(-s))
        if self.new_pro_slot is None or len(order) <= self.new_pro_slot:
            return order
        top = order[:k]
        if not any(X["is_new"].iloc[i] for i in top):
            new = [i for i in order[k:] if X["is_new"].iloc[i]]
            if new:
                order.remove(new[0])
                order.insert(self.new_pro_slot, new[0])
        return order

    def report(self, logs):
        """AUC of each sub-model on a held-out log (0.5 = guessing, 1.0 = perfect)."""
        out = {"respond": roc_auc_score(logs["responded"], self.m_respond.predict_proba(logs[FEATURES])[:, 1])}
        r = logs[logs["responded"] == 1]
        out["hired|respond"] = roc_auc_score(
            r["hired"], self.m_hire.predict_proba(r[FEATURES].assign(position=r["position"]))[:, 1])
        h = logs[logs["hired"] == 1]
        out["good|hired"] = roc_auc_score(h["good"], self.m_good.predict_proba(h[FEATURES])[:, 1])
        return out

    def save(self, path):
        with open(path, "wb") as f:
            pickle.dump(self, f)

    @staticmethod
    def load(path):
        with open(path, "rb") as f:
            return pickle.load(f)


def rank(policy, X, rng, k):
    if hasattr(policy, "order"):
        return policy.order(X, rng, k)
    return list(np.argsort(-policy.scores(X, rng)))

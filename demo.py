"""End-to-end demo.

1. Build a synthetic Nairobi marketplace (400 pros).
2. Collect training logs with the heuristic + 30% random exploration.
3. Train the three-part ML ranker and check accuracy on held-out logs.
4. Run a simulated A/B test of every policy on the same fresh requests.
5. Save the model and show an example ranking.

Run:  python demo.py
"""
import numpy as np
import pandas as pd

from matchmaker.features import build_features, candidate_mask
from matchmaker.policies import EpsilonPolicy, HeuristicPolicy, ModelRanker, RandomPolicy
from matchmaker.simulate import Marketplace
from matchmaker.world import AREA_NAMES, CATEGORY_NAMES, URGENCY, km_matrix, make_pros, make_requests

rng = np.random.default_rng(42)
pros = make_pros(400, rng)
train_reqs = make_requests(8000, rng)
test_reqs = make_requests(3000, rng, start_id=100_000)

print("Collecting training logs (heuristic + 30% exploration)...")
logs, _ = Marketplace(pros, seed=1).run(train_reqs, EpsilonPolicy(HeuristicPolicy(), 0.3))
print(f"  {len(logs):,} impressions, {logs['responded'].sum():,} responses, {logs['hired'].sum():,} hires")

cut = logs["request_id"].quantile(0.8)  # train on older requests, check on newer
model = ModelRanker().fit(logs[logs["request_id"] <= cut])
print("\nHeld-out AUC (0.5 = guessing, 1.0 = perfect):")
for part, auc in model.report(logs[logs["request_id"] > cut]).items():
    print(f"  {part:<15} {auc:.3f}")

model = ModelRanker().fit(logs)  # final model on all logs
explore = ModelRanker(new_pro_slot=2)
explore.m_respond, explore.m_hire, explore.m_good = model.m_respond, model.m_hire, model.m_good

print("\nSimulated A/B test on 3,000 new requests (same customers, same availability):")
rows = {}
for policy in [RandomPolicy(), HeuristicPolicy(), model, explore]:
    _, summary = Marketplace(pros, seed=2).run(test_reqs, policy)
    rows[policy.name] = summary
table = pd.DataFrame(rows).T
pct = ["hire_rate", "good_job_rate", "no_candidates", "pros_with_a_job", "top10pct_pros_share"]
fmt = table.copy()
for c in pct:
    fmt[c] = (table[c] * 100).map("{:.1f}%".format)
fmt["median_first_reply_min"] = table["median_first_reply_min"].map("{:.0f}".format)
print(fmt.to_string())

model.save("model.pkl")
print("\nSaved model.pkl")

# Example: rank pros for one request, with the model's reasoning.
km = km_matrix()
P = {c: pros[c].to_numpy() for c in pros.columns}
req = test_reqs.iloc[7].to_dict()
idx = np.flatnonzero(candidate_mask(req, P, km, np.ones(len(pros), bool)))
X = build_features(req, P, idx, km)
p_r, p_h, p_g = model.predict_parts(X)
ex = pd.DataFrame({
    "pro_id": idx, "area": [AREA_NAMES[a] for a in P["area"][idx]],
    "travel_min": X["travel_min"].round(), "rating": X["rating_smoothed"].round(2),
    "reply_min": np.exp(X["reply_min_log"]).round(), "price_ratio": X["price_ratio"].round(2),
    "P(respond)": p_r.round(2), "P(hired)": p_h.round(2), "P(good)": p_g.round(2),
    "score": (p_r * p_h * p_g).round(3),
}).sort_values("score", ascending=False).head(5)
print(f"\nExample: {CATEGORY_NAMES[req['category']]} in {AREA_NAMES[req['area']]}, "
      f"{req['hour']}:00, urgency={URGENCY[req['urgency']]}, budget KES {req['budget']:,.0f}")
print(f"{len(idx)} candidates passed the filter. Top 5:")
print(ex.to_string(index=False))

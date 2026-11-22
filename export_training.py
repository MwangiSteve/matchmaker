"""Train the ranker on real logs from the database (instead of the simulator).

    DATABASE_URL=postgresql://... python export_training.py [--min-age-days 3] [--out model.pkl] [--csv logs.csv]

Labels, per impression (one pro shown for one request):
  responded  the pro replied (lead_responses)
  hired      the customer hired this pro (jobs)
  good       job completed and rated 4+ stars (or completed with no review)

Requests younger than --min-age-days are skipped: their outcomes aren't in yet.
"""
import argparse
import os
import sys

import pandas as pd
import psycopg

from matchmaker.features import FEATURES
from matchmaker.policies import ModelRanker

QUERY = """
select mi.request_id, mi.pro_id, mi.position, mi.features, r.created_at,
       (lr.pro_id is not null)::int as responded,
       (j.pro_id is not null)::int  as hired,
       (j.status = 'completed' and coalesce(rv.stars, 5) >= 4)::int as good
  from match_impressions mi
  join requests r on r.id = mi.request_id
  left join lead_responses lr on lr.request_id = mi.request_id and lr.pro_id = mi.pro_id
  left join jobs j on j.request_id = mi.request_id and j.pro_id = mi.pro_id
  left join reviews rv on rv.job_id = j.id
 where r.created_at < now() - make_interval(days => %s)
   and (j.id is null or j.status <> 'hired')   -- skip jobs still in progress
 order by r.created_at
"""

MIN_ROWS = {"impressions": 2000, "responses": 500, "hires": 200}


def load(url, min_age_days):
    with psycopg.connect(url) as conn:
        rows = conn.execute(QUERY, (min_age_days,)).fetchall()
    df = pd.DataFrame(rows, columns=["request_id", "pro_id", "position", "features", "created_at",
                                     "responded", "hired", "good"])
    if df.empty:
        return df
    feats = pd.DataFrame(df.pop("features").tolist())
    missing = [f for f in FEATURES if f not in feats]
    if missing:
        raise SystemExit(f"impressions are missing features {missing}; were they logged by an older version?")
    df = pd.concat([df, feats[FEATURES].astype(float)], axis=1)
    df["good"] = df["good"].fillna(0).astype(int)
    return df


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--min-age-days", type=int, default=3)
    ap.add_argument("--out", default="model.pkl")
    ap.add_argument("--csv", help="also save the training table as CSV")
    args = ap.parse_args()
    url = os.environ.get("DATABASE_URL") or sys.exit("Set DATABASE_URL")

    df = load(url, args.min_age_days)
    counts = {"impressions": len(df), "responses": int(df["responded"].sum()) if len(df) else 0,
              "hires": int(df["hired"].sum()) if len(df) else 0}
    print("Training data: " + ", ".join(f"{v:,} {k}" for k, v in counts.items()))
    if args.csv and len(df):
        df.to_csv(args.csv, index=False)
    short = [k for k, need in MIN_ROWS.items() if counts[k] < need]
    if short:
        print("Not enough data to train yet (need " +
              ", ".join(f"{MIN_ROWS[k]:,} {k}" for k in short) + "). Keep using the heuristic.")
        return

    # Time-based check: train on the older 80%, measure on the newest 20%.
    cut = df["created_at"].quantile(0.8)
    report = ModelRanker().fit(df[df["created_at"] <= cut]).report(df[df["created_at"] > cut])
    print("Held-out AUC (0.5 = guessing): " + ", ".join(f"{k} {v:.3f}" for k, v in report.items()))

    ModelRanker().fit(df).save(args.out)
    print(f"Saved {args.out}. Restart serve.py to use it.")


if __name__ == "__main__":
    main()

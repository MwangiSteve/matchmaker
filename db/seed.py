"""Fill a database with simulated Nairobi pros and ~2 months of simulated activity.

For testing only, so you can try the whole flow before real pros sign up.
All names and phone numbers are fake (+254 700 0xx xxx range).

    DATABASE_URL=postgresql://... python db/seed.py [--pros 400] [--requests 3000] [--reset]

--reset deletes ALL rows from the matchmaker tables first. Never run it on production.
"""
import argparse
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import psycopg
from psycopg.types.json import Jsonb

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from matchmaker.features import FEATURES  # noqa: E402
from matchmaker.policies import EpsilonPolicy, HeuristicPolicy  # noqa: E402
from matchmaker.simulate import Marketplace  # noqa: E402
from matchmaker.world import AREAS, AREA_NAMES, CATEGORIES, CATEGORY_NAMES, URGENCY, make_pros, make_requests  # noqa: E402

FIRST = ["Wanjiru", "Otieno", "Kamau", "Achieng", "Mwangi", "Njeri", "Kiprono", "Akinyi", "Mutua",
         "Wambui", "Ochieng", "Chebet", "Kariuki", "Nyambura", "Omondi", "Muthoni", "Kibet", "Atieno"]
LAST = ["Kimani", "Odhiambo", "Njoroge", "Wekesa", "Mutiso", "Koech", "Owino", "Ndungu", "Barasa",
        "Gitau", "Onyango", "Rotich", "Maina", "Juma", "Wafula", "Cheruiyot", "Macharia", "Nduta"]
TABLES = ["reviews", "jobs", "lead_responses", "match_impressions", "requests", "customers", "pro_services", "pros"]


def jitter(rng, area_idx, n=None):
    lat, lon = AREAS[AREA_NAMES[area_idx]][:2]
    return lat + rng.normal(0, 0.006, n), lon + rng.normal(0, 0.006, n)  # ~0.7 km


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pros", type=int, default=400)
    ap.add_argument("--requests", type=int, default=3000)
    ap.add_argument("--customers", type=int, default=1500)
    ap.add_argument("--reset", action="store_true")
    args = ap.parse_args()
    url = os.environ.get("DATABASE_URL")
    if not url:
        sys.exit("Set DATABASE_URL")

    if not args.reset:
        with psycopg.connect(url) as conn:
            if conn.execute("select count(*) from pros").fetchone()[0]:
                sys.exit("pros table is not empty; use --reset on a test database to replace it")

    rng = np.random.default_rng(7)
    pros = make_pros(args.pros, rng)
    reqs = make_requests(args.requests, rng)
    print(f"Simulating {args.requests} requests across {args.pros} pros...")
    logs, _ = Marketplace(pros, seed=11).run(reqs, EpsilonPolicy(HeuristicPolicy(), 0.3))

    now = datetime.now(timezone.utc)
    start = now - timedelta(days=60)
    # Spread requests over 60 days, at the simulated Nairobi hour (UTC+3).
    day = np.sort(rng.integers(0, 58, len(reqs)))
    created = [start + timedelta(days=int(d), hours=int(h) - 3, minutes=int(m))
               for d, h, m in zip(day, reqs["hour"], rng.integers(0, 60, len(reqs)))]
    req_time = dict(zip(reqs["request_id"], created))

    with psycopg.connect(url) as conn, conn.cursor() as cur:
        if args.reset:
            cur.execute("truncate " + ", ".join(TABLES) + " cascade")

        # Pros and their services
        pro_uuid = {}
        lat, lon = zip(*(jitter(rng, a) for a in pros["area"]))
        for i, p in enumerate(pros.itertuples()):
            cur.execute(
                """insert into pros (full_name, phone, area, lat, lon, max_travel_min, verified, last_active_at, created_at)
                   values (%s, %s, %s, %s, %s, %s, %s, %s, %s) returning id""",
                (f"{rng.choice(FIRST)} {rng.choice(LAST)}", f"+254700{i:06d}", AREA_NAMES[p.area],
                 float(lat[i]), float(lon[i]), int(p.max_travel_min), bool(p.verified),
                 now - timedelta(days=float(p.last_active_days)), start - timedelta(days=int(rng.integers(0, 300)))))
            pro_uuid[p.pro_id] = cur.fetchone()[0]
            for c in CATEGORY_NAMES:
                if getattr(p, f"cat_{c}"):
                    cur.execute("insert into pro_services (pro_id, category, typical_price_kes) values (%s, %s, %s)",
                                (pro_uuid[p.pro_id], c, int(round(CATEGORIES[c][0] * p.price_level, -1))))

        # Customers
        cust_ids = []
        for i in range(args.customers):
            cur.execute("insert into customers (full_name, phone, created_at) values (%s, %s, %s) returning id",
                        (f"{rng.choice(FIRST)} {rng.choice(LAST)}", f"+254701{i:06d}", start))
            cust_ids.append(cur.fetchone()[0])

        # Requests
        req_uuid = {}
        for r in reqs.itertuples():
            la, lo = jitter(rng, r.area)
            cur.execute(
                """insert into requests (customer_id, category, area, lat, lon, urgency, budget_kes, has_photos, created_at)
                   values (%s, %s, %s, %s, %s, %s, %s, %s, %s) returning id""",
                (cust_ids[rng.integers(len(cust_ids))], CATEGORY_NAMES[r.category], AREA_NAMES[r.area],
                 float(la), float(lo), URGENCY[r.urgency], int(r.budget), bool(r.has_photos), req_time[r.request_id]))
            req_uuid[r.request_id] = cur.fetchone()[0]

        # Impressions, responses, jobs, reviews
        n_jobs = 0
        for row in logs.itertuples(index=False):
            rid, pid = req_uuid[row.request_id], pro_uuid[row.pro_id]
            shown = req_time[row.request_id] + timedelta(minutes=1)
            feats = {f: float(getattr(row, f)) for f in FEATURES}
            cur.execute(
                """insert into match_impressions (request_id, pro_id, position, score, source, features, shown_at)
                   values (%s, %s, %s, 0, 'heuristic', %s, %s)""",
                (rid, pid, int(row.position), Jsonb(feats), shown))
            if row.responded:
                cur.execute("insert into lead_responses (request_id, pro_id, responded_at) values (%s, %s, %s)",
                            (rid, pid, shown + timedelta(minutes=float(row.reply_min))))
            if row.hired:
                status = "completed" if row.good or rng.random() < 0.6 else rng.choice(["cancelled", "disputed"])
                cur.execute(
                    """insert into jobs (request_id, pro_id, customer_id, status, hired_at, completed_at)
                       select id, %s, customer_id, %s, %s, %s from requests where id = %s returning id""",
                    (pid, status, shown + timedelta(hours=2),
                     shown + timedelta(days=1) if status == "completed" else None, rid))
                job_id = cur.fetchone()[0]
                n_jobs += 1
                if status == "completed" and not np.isnan(row.stars) and rng.random() < 0.7:
                    cur.execute("insert into reviews (job_id, stars, created_at) values (%s, %s, %s)",
                                (job_id, int(row.stars), shown + timedelta(days=2)))
        conn.commit()
    print(f"Seeded {len(pro_uuid)} pros, {len(cust_ids)} customers, {len(req_uuid)} requests, "
          f"{len(logs)} impressions, {n_jobs} jobs")


if __name__ == "__main__":
    main()

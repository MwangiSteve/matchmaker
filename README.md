# matchmaker

**Ceras Technologies**: the matching engine behind Ceras.


Predictive matching for a home-services marketplace in Nairobi: given a customer request, rank the pros most likely to **respond**, **get hired** and **do the job well**.

```
score = P(respond) × P(hired | responded) × P(good job | hired)
```

## Layout

| Path | What it is |
|---|---|
| `matchmaker/features.py` | Candidate filter + feature building (used in production) |
| `matchmaker/policies.py` | Heuristic scorer (launch) and the 3-model ML ranker |
| `matchmaker/world.py` | Synthetic Nairobi areas, categories, pros and requests |
| `matchmaker/simulate.py` | Marketplace simulator that stands in for real users until you have logs |
| `demo.py` | Collect logs → train → simulated A/B test → save `model.pkl` |
| `serve.py` | HTTP scoring service so Node can use the model |
| `node/` | Node module: filter, features, heuristic, model client with fallback |
| `node/src/store.js` | Postgres: find candidate pros, save requests, log matches, record responses/hires/reviews |
| `db/schema.sql` | Database tables (Postgres / Supabase / Neon) |
| `db/seed.py` | Fills a **test** database with simulated pros and 2 months of activity |
| `export_training.py` | Trains the model from the database logs |

## Quick start

```bash
pip install -r requirements.txt
python demo.py          # ~3 min; writes model.pkl
python serve.py         # scoring service on :8765
cd node && npm test && node example.js
```

## Database setup

1. Create a free Postgres database, e.g. on [Supabase](https://supabase.com) or [Neon](https://neon.tech), and copy its connection string.
2. Create the tables:
   ```bash
   psql "$DATABASE_URL" -f db/schema.sql
   ```
3. Optional, test databases only: load simulated pros so you can try matching:
   ```bash
   python db/seed.py
   ```
4. Match from Node:
   ```bash
   cd node && npm install && DATABASE_URL=... node example-db.js
   ```

In your API:

```js
import pg from 'pg';
import { matchRequest, recordResponse, hirePro, finishJob, addReview } from './src/store.js';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

// customer posts a request
const { requestId, results } = await matchRequest(pool, {
  customerId, category: 'plumbing', area: 'Kilimani', lat, lon,
  urgency: 'now', budgetKes: 3000, hasPhotos: true,
}, { modelUrl: process.env.MODEL_URL });   // omit modelUrl to use the heuristic only

await recordResponse(pool, { requestId, proId, quoteKes: 2800 });   // pro replies
const jobId = await hirePro(pool, { requestId, proId });              // customer hires
await finishJob(pool, jobId, 'completed');                            // or 'cancelled' / 'disputed'
await addReview(pool, { jobId, stars: 5 });
```

**Call all five.** They're what the model learns from. `matchRequest` logs the pros shown and the exact features used, and the rest record what happened next.

## Post a job screen (React + Express)

`web/` has two pages: the **homepage** at `/` (search box, popular services, how it works, areas served, a section for pros) and the customer's **"Post a job"** page at `/post`. Searching on the homepage, e.g. "leaking tap" or "maji" with an estate, opens `/post` with the service and estate already filled in. Both pages talk to the API in `node/server.js`. The Post a job flow: pick a service, describe the job, choose an estate (or share your location), choose when, set a budget, enter a phone number, then see the top 5 pros and hire one. The pro's phone number is shown only after hiring.

```bash
python serve.py                                            # optional: ML model on :8765
cd node && DATABASE_URL=... MODEL_URL=http://127.0.0.1:8765 node server.js   # API on :3000
cd web && npm install && npm run dev                       # page on :5173, /api proxied to :3000
```

For production, run `npm run build` in `web/`. `node server.js` then serves the page and the API together on one port.

API: `GET /api/options`, `POST /api/requests`, `POST /api/requests/:id/hire`. See `node/src/api.js`.

**Before launch:** add phone verification (SMS one-time code). Right now anyone who types a phone number can post or hire as that customer.

## Retraining on real data

```bash
DATABASE_URL=... python export_training.py      # writes model.pkl, then restart serve.py
```

It refuses to train until there are at least 2,000 impressions, 500 responses and 200 hires. Until then, keep using the heuristic. Retraining weekly is plenty at first.

## How it fits your backend

```
Node API ── filterCandidates() ── buildFeatures() ──► POST /score (Python) ──► ranked pros
                                        │                     │ down / slow (>300 ms)
                                        └── heuristicScore() ◄┘  automatic fallback
```

At launch, run Node only. The heuristic needs no data. **Log every impression** (who was shown, at what position, whether they responded, got hired, and the job rating). Once you have a few thousand requests, train on those logs instead of the simulator and switch on the model.

## Simulated results (3,000 requests, 400 pros)

| Policy | Hire rate | Good-job rate | Pros with ≥1 job |
|---|---|---|---|
| random | 30.8% | 22.8% | 66.2% |
| heuristic | 57.6% | 49.9% | 60.0% |
| model | 62.6% | 54.8% | 40.5% |
| model + new-pro slot | 61.1% | 54.2% | 45.8% |

The model gets more hires but sends work to fewer pros. Use the new-pro slot, and watch pro coverage alongside hire rate, or pros who never get jobs will leave.

## Keep Python and Node in sync

`node/src/matcher.js` must build exactly the same features as `matchmaker/features.py`, with the category and urgency lists in the same order. If you change one, change the other.

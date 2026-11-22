# matchmaker

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

## Quick start

```bash
pip install -r requirements.txt
python demo.py          # ~3 min; writes model.pkl
python serve.py         # scoring service on :8765
cd node && npm test && node example.js
```

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

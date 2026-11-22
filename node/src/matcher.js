// Match engine for the Node backend.
//
// - filterCandidates / buildFeatures mirror matchmaker/features.py exactly,
//   so the Python-trained model gets the same inputs it was trained on.
// - rankPros asks the Python scoring service (serve.py) for ML scores and
//   falls back to the heuristic if the service is down or slow, so matching
//   never stops working.

// Must stay in the same order as CATEGORIES / URGENCY in matchmaker/world.py.
export const CATEGORIES = {
  plumbing: 2500,
  electrical: 3000,
  cleaning: 1500,
  painting: 8000,
  carpentry: 5000,
  appliance_repair: 3500,
  moving: 10000,
};
export const CATEGORY_NAMES = Object.keys(CATEGORIES);
export const URGENCY = ['now', 'this_week', 'flexible'];

const RATING_PRIOR = 4.0;
const RATING_PRIOR_WEIGHT = 5;
const COMPLETION_PRIOR = 0.85;

export function haversineKm(a, b) {
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

export const isPeak = (hour) => (hour >= 6 && hour < 9) || (hour >= 16 && hour < 20);

export function travelMinutes(km, hour) {
  const roadKm = 1.4 * km + 1.5;
  const speed = isPeak(hour) ? 14 : 28;
  return (roadKm / speed) * 60 + 10;
}

function distanceKm(req, pro) {
  // Same estate counts as 2 km, as in training.
  if (req.area && req.area === pro.area) return 2;
  return Math.max(2, haversineKm(req, pro));
}

/** Hard rules: right category, available, within travel limit, active in the last 30 days. */
export function filterCandidates(req, pros) {
  return pros.filter((p) =>
    p.categories.includes(req.category) &&
    p.available !== false &&
    (p.lastActiveDays ?? 0) < 30 &&
    travelMinutes(distanceKm(req, p), req.hour) <= (p.maxTravelMin ?? 60));
}

/** One feature object per pro. Keys match FEATURES in features.py. */
export function buildFeatures(req, pro) {
  const nRev = pro.nReviews ?? 0;
  const rating = pro.rating ?? RATING_PRIOR;
  const jobs = pro.jobsDone ?? 0;
  const quote = pro.typicalPrice?.[req.category] ?? CATEGORIES[req.category];
  const catIdx = CATEGORY_NAMES.indexOf(req.category);
  const urgIdx = URGENCY.indexOf(req.urgency);
  if (catIdx < 0) throw new Error(`unknown category: ${req.category}`);
  if (urgIdx < 0) throw new Error(`unknown urgency: ${req.urgency}`);
  return {
    travel_min: travelMinutes(distanceKm(req, pro), req.hour),
    same_area: req.area && req.area === pro.area ? 1 : 0,
    rating_smoothed: (rating * nRev + RATING_PRIOR * RATING_PRIOR_WEIGHT) / (nRev + RATING_PRIOR_WEIGHT),
    n_reviews_log: Math.log1p(nRev),
    completion_rate: pro.completionRate ?? COMPLETION_PRIOR,
    has_history: jobs > 0 ? 1 : 0,
    jobs_done_log: Math.log1p(jobs),
    is_new: jobs < 3 ? 1 : 0,
    reply_min_log: Math.log(pro.replyMin ?? 60),
    acceptance_rate: pro.acceptanceRate ?? 0.5,
    price_ratio: quote / req.budget,
    verified: pro.verified ? 1 : 0,
    last_active_days: pro.lastActiveDays ?? 0,
    urgency: urgIdx,
    hour: req.hour,
    is_peak: isPeak(req.hour) ? 1 : 0,
    has_photos: req.hasPhotos ? 1 : 0,
    customer_past_hires: req.customerPastHires ?? 0,
    category: catIdx,
  };
}

/** Phase 1 score: no data needed. Same weights as HeuristicPolicy in policies.py. */
export function heuristicScore(f, w = { proximity: 0.35, rating: 0.25, response: 0.2, price: 0.2 }) {
  const clip = (x) => Math.min(1, Math.max(0, x));
  return (
    w.proximity * (1 - clip(f.travel_min / 90)) +
    w.rating * clip((f.rating_smoothed - 3) / 2) +
    w.response * (1 - clip(f.reply_min_log / Math.log(240))) +
    w.price * (1 - clip(Math.abs(f.price_ratio - 1)))
  );
}

async function modelScores(features, url, timeoutMs) {
  const res = await fetch(`${url}/score`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ features }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`scoring service returned ${res.status}`);
  return res.json();
}

/**
 * Rank pros for a request.
 * @returns {{ source: 'model'|'heuristic', results: Array<{pro, score, features, parts?}> }}
 */
export async function rankPros(req, pros, { k = 5, modelUrl = null, timeoutMs = 300, newProSlot = 2 } = {}) {
  const candidates = filterCandidates(req, pros);
  if (candidates.length === 0) return { source: 'none', results: [] };
  const features = candidates.map((p) => buildFeatures(req, p));

  let source = 'heuristic';
  let scores = features.map((f) => heuristicScore(f));
  let parts = null;
  if (modelUrl) {
    try {
      const out = await modelScores(features, modelUrl, timeoutMs);
      scores = out.scores;
      parts = out;
      source = 'model';
    } catch {
      // Keep heuristic scores; log this in production.
    }
  }

  const ranked = candidates
    .map((pro, i) => ({
      pro,
      score: scores[i],
      features: features[i],
      ...(parts && { parts: { pRespond: parts.p_respond[i], pHired: parts.p_hired[i], pGood: parts.p_good[i] } }),
    }))
    .sort((a, b) => b.score - a.score);

  // Exploration: give a promising new pro a slot in the top k so they can build a track record.
  if (newProSlot != null && ranked.length > newProSlot && !ranked.slice(0, k).some((r) => r.features.is_new)) {
    const j = ranked.findIndex((r, i) => i >= k && r.features.is_new);
    if (j >= 0) ranked.splice(newProSlot, 0, ...ranked.splice(j, 1));
  }
  return { source, results: ranked.slice(0, k) };
}

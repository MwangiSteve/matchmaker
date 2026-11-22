// Run:  node example.js
// With the ML model:  start `python serve.py` in the repo root first.
import { rankPros } from './src/matcher.js';

const pros = [
  { id: 'p1', area: 'Westlands', lat: -1.2676, lon: 36.8108, categories: ['plumbing'], jobsDone: 40, nReviews: 25, rating: 4.7, completionRate: 0.95, replyMin: 12, acceptanceRate: 0.8, typicalPrice: { plumbing: 2800 }, verified: true, lastActiveDays: 1, maxTravelMin: 60 },
  { id: 'p2', area: 'Kilimani', lat: -1.2906, lon: 36.784, categories: ['plumbing', 'electrical'], jobsDone: 120, nReviews: 80, rating: 4.5, completionRate: 0.9, replyMin: 45, acceptanceRate: 0.6, typicalPrice: { plumbing: 2200 }, verified: true, lastActiveDays: 0, maxTravelMin: 90 },
  { id: 'p3', area: 'Embakasi', lat: -1.32, lon: 36.9, categories: ['plumbing'], jobsDone: 2, nReviews: 1, rating: 5.0, replyMin: 8, acceptanceRate: 0.9, typicalPrice: { plumbing: 1800 }, verified: false, lastActiveDays: 0, maxTravelMin: 90 },
  { id: 'p4', area: 'Ruaka', lat: -1.205, lon: 36.779, categories: ['plumbing'], jobsDone: 15, nReviews: 10, rating: 3.9, completionRate: 0.8, replyMin: 90, acceptanceRate: 0.4, typicalPrice: { plumbing: 3500 }, verified: true, lastActiveDays: 5, maxTravelMin: 60 },
  { id: 'p5', area: 'Parklands', lat: -1.263, lon: 36.818, categories: ['cleaning'], jobsDone: 60, nReviews: 40, rating: 4.9, replyMin: 10, verified: true, lastActiveDays: 0, maxTravelMin: 60 },
];

const request = {
  area: 'Westlands', lat: -1.268, lon: 36.812,
  category: 'plumbing', hour: 10, urgency: 'now',
  budget: 2500, hasPhotos: true, customerPastHires: 1,
};

const { source, results } = await rankPros(request, pros, { modelUrl: process.env.MODEL_URL ?? 'http://127.0.0.1:8765' });
console.log(`Ranked by: ${source}`);
for (const r of results) {
  const extra = r.parts ? ` (respond ${r.parts.pRespond.toFixed(2)}, hired ${r.parts.pHired.toFixed(2)}, good ${r.parts.pGood.toFixed(2)})` : '';
  console.log(`${r.pro.id}  ${r.pro.area.padEnd(10)} score ${r.score.toFixed(3)}  travel ${Math.round(r.features.travel_min)} min${extra}`);
}

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildFeatures, filterCandidates, rankPros, travelMinutes } from '../src/matcher.js';

const req = { area: 'Westlands', lat: -1.268, lon: 36.812, category: 'plumbing', hour: 10, urgency: 'now', budget: 2500 };
const pro = (id, over = {}) => ({ id, area: 'Westlands', lat: -1.2676, lon: 36.8108, categories: ['plumbing'], jobsDone: 10, nReviews: 5, rating: 4.5, replyMin: 20, ...over });

test('travel is slower at rush hour', () => {
  assert.ok(travelMinutes(5, 8) > travelMinutes(5, 11));
});

test('filter drops wrong category, unavailable, far and inactive pros', () => {
  const pros = [
    pro('ok'),
    pro('cat', { categories: ['cleaning'] }),
    pro('busy', { available: false }),
    pro('far', { area: 'Kitengela', lat: -1.474, lon: 36.96, maxTravelMin: 45 }),
    pro('idle', { lastActiveDays: 45 }),
  ];
  assert.deepEqual(filterCandidates(req, pros).map((p) => p.id), ['ok']);
});

test('ratings with few reviews are pulled toward the prior', () => {
  const few = buildFeatures(req, pro('a', { rating: 5, nReviews: 1 }));
  const many = buildFeatures(req, pro('b', { rating: 4.8, nReviews: 200 }));
  assert.ok(many.rating_smoothed > few.rating_smoothed);
});

test('falls back to heuristic when the model service is unreachable', async () => {
  const out = await rankPros(req, [pro('a'), pro('b', { replyMin: 200 })], { modelUrl: 'http://127.0.0.1:1', timeoutMs: 200 });
  assert.equal(out.source, 'heuristic');
  assert.equal(out.results[0].pro.id, 'a');
});

test('reserves a slot for a new pro', async () => {
  const pros = [...Array(6)].map((_, i) => pro(`v${i}`, { jobsDone: 50, nReviews: 30, rating: 4.8 }));
  pros.push(pro('newbie', { jobsDone: 0, nReviews: 0, rating: undefined, replyMin: 200 }));
  const { results } = await rankPros(req, pros, { k: 5, newProSlot: 2 });
  assert.equal(results[2].pro.id, 'newbie');
});

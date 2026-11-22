// Integration test: needs a seeded test database.
//   DATABASE_URL=postgresql://... npm test
// Skipped when DATABASE_URL is not set. Adds rows, so never point it at production.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { addReview, finishJob, hirePro, matchRequest, recordResponse } from '../src/store.js';

const url = process.env.DATABASE_URL;
const pool = url ? new pg.Pool({ connectionString: url }) : null;
after(() => pool?.end());

const westlandsPlumbing = {
  category: 'plumbing', area: 'Westlands', lat: -1.268, lon: 36.812,
  urgency: 'now', budgetKes: 2500, hasPhotos: true,
};

test('full flow: match, respond, hire, complete, review', { skip: !url && 'DATABASE_URL not set' }, async () => {
  const { rows: [cust] } = await pool.query(`select id from customers limit 1`);
  const match = await matchRequest(pool, { ...westlandsPlumbing, customerId: cust.id }, { modelUrl: null });

  assert.ok(match.candidates > 0, 'expected seeded plumbers near Westlands');
  assert.ok(match.results.length > 0 && match.results.length <= 5);
  assert.equal(match.source, 'heuristic');

  const { rows: logged } = await pool.query(
    `select pro_id, position, features from match_impressions where request_id = $1 order by position`,
    [match.requestId]);
  assert.deepEqual(logged.map((r) => r.pro_id), match.results.map((r) => r.pro.id));
  assert.equal(logged[0].features.category, 0); // plumbing
  assert.equal(typeof logged[0].features.travel_min, 'number');

  const top = match.results[0].pro.id;
  const before = (await pool.query(`select jobs_done from pro_stats where pro_id = $1`, [top])).rows[0].jobs_done;
  await recordResponse(pool, { requestId: match.requestId, proId: top, quoteKes: 2400 });
  const jobId = await hirePro(pool, { requestId: match.requestId, proId: top, agreedPriceKes: 2400 });
  await finishJob(pool, jobId, 'completed');
  await addReview(pool, { jobId, stars: 5, comment: 'Fixed the leak fast' });

  const { rows: [s] } = await pool.query(`select jobs_done, n_reviews from pro_stats where pro_id = $1`, [top]);
  assert.equal(s.jobs_done, before + 1);
  assert.ok(s.n_reviews >= 1);
});

test('only pros who offer the service and are available are returned', { skip: !url && 'DATABASE_URL not set' }, async () => {
  const match = await matchRequest(pool, { ...westlandsPlumbing, category: 'moving' }, { modelUrl: null, k: 50 });
  const ids = match.results.map((r) => r.pro.id);
  if (!ids.length) return;
  const { rows } = await pool.query(
    `select count(*)::int as n from pro_services where category = 'moving' and pro_id = any($1)`, [ids]);
  assert.equal(rows[0].n, ids.length);

  // Mark the top pro as away; they must drop out of the next match.
  await pool.query(`update pros set away_until = now() + interval '1 day' where id = $1`, [ids[0]]);
  try {
    const again = await matchRequest(pool, { ...westlandsPlumbing, category: 'moving' }, { modelUrl: null, k: 50 });
    assert.ok(!again.results.some((r) => r.pro.id === ids[0]));
  } finally {
    await pool.query(`update pros set away_until = null where id = $1`, [ids[0]]);
  }
});

test('rejects unknown category', { skip: !url && 'DATABASE_URL not set' }, async () => {
  await assert.rejects(matchRequest(pool, { ...westlandsPlumbing, category: 'gardening' }), /unknown category/);
});

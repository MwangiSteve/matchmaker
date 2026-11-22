// Match a request against pros in your database.
//   DATABASE_URL=postgresql://... node example-db.js
// Start `python serve.py` first to rank with the ML model; otherwise the heuristic is used.
import pg from 'pg';
import { matchRequest } from './src/store.js';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
try {
  const { requestId, source, candidates, results } = await matchRequest(pool, {
    category: 'plumbing', area: 'Kilimani', lat: -1.2906, lon: 36.784,
    urgency: 'now', budgetKes: 3000, hasPhotos: true,
    description: 'Kitchen sink leaking',
  }, { modelUrl: process.env.MODEL_URL ?? 'http://127.0.0.1:8765' });

  console.log(`Request ${requestId}: ${candidates} candidates, ranked by ${source}`);
  const ids = results.map((r) => r.pro.id);
  const { rows } = await pool.query(`select id, full_name from pros where id = any($1)`, [ids]);
  const name = Object.fromEntries(rows.map((r) => [r.id, r.full_name]));
  for (const r of results) {
    const f = r.features;
    console.log(
      `${name[r.pro.id].padEnd(20)} ${String(r.pro.area).padEnd(11)} score ${r.score.toFixed(3)}  ` +
      `${Math.round(f.travel_min)} min away  rating ${f.rating_smoothed.toFixed(2)}  ` +
      `${r.pro.jobsDone} jobs${f.is_new ? '  (new pro)' : ''}`);
  }
} finally {
  await pool.end();
}

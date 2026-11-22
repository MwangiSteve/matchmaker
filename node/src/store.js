// Postgres layer for the matcher. Uses the tables in db/schema.sql.
//
//   import pg from 'pg';
//   const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
//   const { requestId, results } = await matchRequest(pool, { ...request });
//
// Every match shown is logged to match_impressions with the exact features
// the ranker used. Together with lead_responses, jobs and reviews, that log
// is the model's training data (see export_training.py).
import { rankPros, CATEGORY_NAMES, URGENCY } from './matcher.js';

// Widest search radius: a pro with a 90-minute limit off-peak covers ~25 km
// straight-line (see travelMinutes). The exact travel check happens in JS.
const MAX_SEARCH_KM = 26;
const NAIROBI_UTC_OFFSET = 3; // Kenya has no daylight saving

export const nairobiHour = (date = new Date()) => (date.getUTCHours() + NAIROBI_UTC_OFFSET) % 24;

/** Active, available pros offering `category` within the search box, with their stats. */
export async function findCandidatePros(db, { category, lat, lon }) {
  const dLat = MAX_SEARCH_KM / 111;
  const dLon = MAX_SEARCH_KM / (111 * Math.cos((lat * Math.PI) / 180));
  const { rows } = await db.query(
    `select p.id, p.area, p.lat, p.lon, p.max_travel_min, p.verified,
            ps.typical_price_kes,
            s.jobs_done, s.n_reviews, s.rating, s.completion_rate,
            s.reply_min, s.acceptance_rate, s.last_active_days
       from pros p
       join pro_services ps on ps.pro_id = p.id and ps.category = $1
       join pro_stats s on s.pro_id = p.id
      where p.is_active
        and (p.away_until is null or p.away_until < now())
        and p.last_active_at > now() - interval '30 days'
        and p.lat between $2 and $3
        and p.lon between $4 and $5`,
    [category, lat - dLat, lat + dLat, lon - dLon, lon + dLon],
  );
  return rows.map((r) => ({
    id: r.id,
    area: r.area,
    lat: r.lat,
    lon: r.lon,
    categories: [category],
    maxTravelMin: r.max_travel_min,
    verified: r.verified,
    typicalPrice: r.typical_price_kes ? { [category]: r.typical_price_kes } : {},
    jobsDone: r.jobs_done,
    nReviews: r.n_reviews,
    rating: r.rating ?? undefined,
    completionRate: r.completion_rate ?? undefined,
    replyMin: r.reply_min ?? undefined,
    acceptanceRate: r.acceptance_rate ?? undefined,
    lastActiveDays: r.last_active_days,
  }));
}

async function customerPastHires(db, customerId) {
  if (!customerId) return 0;
  const { rows } = await db.query(
    `select count(*)::int as n from jobs where customer_id = $1 and status = 'completed'`, [customerId]);
  return rows[0].n;
}

/**
 * Save a customer request, rank pros for it, and log what was shown.
 * @param input {customerId?, category, area?, lat, lon, urgency, budgetKes, hasPhotos?, description?}
 * @param opts  passed to rankPros (k, modelUrl, timeoutMs, newProSlot)
 */
export async function matchRequest(pool, input, opts = {}) {
  if (!CATEGORY_NAMES.includes(input.category)) throw new Error(`unknown category: ${input.category}`);
  if (!URGENCY.includes(input.urgency)) throw new Error(`unknown urgency: ${input.urgency}`);

  const { rows: [saved] } = await pool.query(
    `insert into requests (customer_id, category, area, lat, lon, urgency, budget_kes, has_photos, description)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id, created_at`,
    [input.customerId ?? null, input.category, input.area ?? null, input.lat, input.lon,
      input.urgency, input.budgetKes, input.hasPhotos ?? false, input.description ?? null],
  );

  const req = {
    area: input.area, lat: input.lat, lon: input.lon,
    category: input.category, urgency: input.urgency,
    budget: input.budgetKes, hasPhotos: input.hasPhotos ?? false,
    hour: nairobiHour(saved.created_at),
    customerPastHires: await customerPastHires(pool, input.customerId),
  };
  const pros = await findCandidatePros(pool, req);
  const { source, results } = await rankPros(req, pros, opts);

  if (results.length) {
    const client = await pool.connect();
    try {
      await client.query('begin');
      for (const [position, r] of results.entries()) {
        await client.query(
          `insert into match_impressions (request_id, pro_id, position, score, source, features)
           values ($1, $2, $3, $4, $5, $6)`,
          [saved.id, r.pro.id, position, r.score, source, r.features],
        );
      }
      await client.query('commit');
    } catch (e) {
      await client.query('rollback');
      throw e;
    } finally {
      client.release();
    }
  }
  return { requestId: saved.id, source, candidates: pros.length, results };
}

/** A shown pro replied to the lead. Also marks the pro as active. */
export async function recordResponse(db, { requestId, proId, quoteKes = null, message = null }) {
  await db.query(
    `insert into lead_responses (request_id, pro_id, quote_kes, message) values ($1, $2, $3, $4)
     on conflict (request_id, pro_id) do nothing`,
    [requestId, proId, quoteKes, message]);
  await db.query(`update pros set last_active_at = now() where id = $1`, [proId]);
}

/** Customer hired a pro for a request. Returns the job id. */
export async function hirePro(db, { requestId, proId, agreedPriceKes = null }) {
  const { rows } = await db.query(
    `insert into jobs (request_id, pro_id, customer_id, agreed_price_kes)
     select r.id, $2, r.customer_id, $3 from requests r where r.id = $1
     returning id`,
    [requestId, proId, agreedPriceKes]);
  if (!rows.length) throw new Error(`request not found: ${requestId}`);
  return rows[0].id;
}

/** status: 'completed' | 'cancelled' | 'disputed' */
export async function finishJob(db, jobId, status = 'completed') {
  await db.query(
    `update jobs set status = $2, completed_at = case when $2 = 'completed' then now() end where id = $1`,
    [jobId, status]);
}

export async function addReview(db, { jobId, stars, comment = null }) {
  await db.query(
    `insert into reviews (job_id, stars, comment) values ($1, $2, $3)
     on conflict (job_id) do update set stars = excluded.stars, comment = excluded.comment`,
    [jobId, stars, comment]);
}

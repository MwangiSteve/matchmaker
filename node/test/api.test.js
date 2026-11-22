// API tests. The phone-number tests always run; the rest need a seeded test database.
//   DATABASE_URL=postgresql://... npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { createApp, normalizeKenyanPhone } from '../src/api.js';

test('normalizes Kenyan phone numbers', () => {
  assert.equal(normalizeKenyanPhone('0712 345 678'), '+254712345678');
  assert.equal(normalizeKenyanPhone('+254712345678'), '+254712345678');
  assert.equal(normalizeKenyanPhone('254112345678'), '+254112345678');
  assert.throws(() => normalizeKenyanPhone('12345'));
  assert.throws(() => normalizeKenyanPhone('0812345678'));
});

const url = process.env.DATABASE_URL;
const skip = !url && 'DATABASE_URL not set';
let pool; let server; let base;

before(async () => {
  if (!url) return;
  pool = new pg.Pool({ connectionString: url });
  server = createApp(pool).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  server?.close();
  await pool?.end();
});

const post = (path, body) => fetch(base + path, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
}).then(async (r) => ({ status: r.status, body: await r.json() }));

const job = {
  category: 'plumbing', description: 'Kitchen sink leaking badly', area: 'Kilimani',
  urgency: 'now', budgetKes: 3000, name: 'Test Customer', phone: '0799 000 111',
};

test('options lists services, estates and urgency', { skip }, async () => {
  const o = await fetch(`${base}/api/options`).then((r) => r.json());
  assert.ok(o.categories.some((c) => c.slug === 'plumbing'));
  assert.ok(o.areas.includes('Kilimani'));
  assert.equal(o.urgency.length, 3);
});

test('post a job, get pros, hire one', { skip }, async () => {
  const res = await post('/api/requests', job);
  assert.equal(res.status, 201);
  assert.ok(res.body.pros.length > 0);
  const pro = res.body.pros[0];
  assert.ok(pro.name && pro.area && typeof pro.travelMin === 'number');
  assert.equal(pro.phone, undefined, 'pro phone must not be shown before hiring');

  const wrongPhone = await post(`/api/requests/${res.body.requestId}/hire`, { proId: pro.id, phone: '0799 999 999' });
  assert.equal(wrongPhone.status, 404);

  const hire = await post(`/api/requests/${res.body.requestId}/hire`, { proId: pro.id, phone: job.phone });
  assert.equal(hire.status, 201);
  assert.match(hire.body.pro.phone, /^\+254/);

  const again = await post(`/api/requests/${res.body.requestId}/hire`, { proId: res.body.pros[1]?.id ?? pro.id, phone: job.phone });
  assert.equal(again.status, 409);
});

test('cannot hire a pro who was not shown for the job', { skip }, async () => {
  const res = await post('/api/requests', job);
  const { rows } = await pool.query(
    `select id from pros where id <> all($1) limit 1`, [res.body.pros.map((p) => p.id)]);
  const hire = await post(`/api/requests/${res.body.requestId}/hire`, { proId: rows[0].id, phone: job.phone });
  assert.equal(hire.status, 404);
});

test('rejects bad input with a readable message', { skip }, async () => {
  for (const [patch, msg] of [
    [{ category: 'gardening' }, /service/],
    [{ urgency: 'yesterday' }, /when/],
    [{ area: 'Mombasa' }, /estate/],
    [{ budgetKes: 50 }, /budget/],
    [{ description: 'leak' }, /Describe/],
    [{ phone: '123' }, /phone/],
    [{ area: undefined, lat: 51.5, lon: -0.12 }, /outside Kenya/],
  ]) {
    const res = await post('/api/requests', { ...job, ...patch });
    assert.equal(res.status, 400, JSON.stringify(patch));
    assert.match(res.body.error, msg);
  }
});

const newPro = (phone) => ({
  fullName: 'Test Fundi', phone, area: 'Kilimani', maxTravelMin: 60, agree: true,
  services: [{ category: 'plumbing', typicalPriceKes: 2200 }, { category: 'electrical' }],
});

test('a pro signs up and becomes matchable', { skip }, async () => {
  const phone = `07${String(Date.now()).slice(-8)}`;
  const res = await post('/api/pros', newPro(phone));
  assert.equal(res.status, 201);
  assert.deepEqual(res.body.services, ['plumbing', 'electrical']);

  const { rows } = await pool.query(
    `select p.verified, ps.category, ps.typical_price_kes from pros p join pro_services ps on ps.pro_id = p.id
      where p.id = $1 order by ps.category`, [res.body.id]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].verified, false, 'new pros start unverified');
  assert.equal(rows.find((r) => r.category === 'plumbing').typical_price_kes, 2200);

  const { findCandidatePros } = await import('../src/store.js');
  const cands = await findCandidatePros(pool, { category: 'electrical', lat: -1.2906, lon: 36.784 });
  assert.ok(cands.some((c) => c.id === res.body.id), 'new pro should be a candidate for nearby jobs');

  const dup = await post('/api/pros', newPro(phone));
  assert.equal(dup.status, 409);
});

test('pro sign-up rejects bad input', { skip }, async () => {
  for (const [patch, msg] of [
    [{ fullName: 'Juma' }, /first and last/],
    [{ services: [] }, /at least one service/],
    [{ services: [{ category: 'gardening' }] }, /Invalid service/],
    [{ services: [{ category: 'plumbing' }, { category: 'plumbing' }] }, /Invalid service/],
    [{ services: [{ category: 'plumbing', typicalPriceKes: 5 }] }, /Prices/],
    [{ maxTravelMin: 500 }, /travel/],
    [{ agree: false }, /terms/],
    [{ phone: '555' }, /phone/],
  ]) {
    const res = await post('/api/pros', { ...newPro('0722000111'), ...patch });
    assert.equal(res.status, 400, JSON.stringify(patch));
    assert.match(res.body.error, msg);
  }
});

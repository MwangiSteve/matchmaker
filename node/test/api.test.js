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

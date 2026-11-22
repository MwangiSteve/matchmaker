// HTTP API for the "Post a job" screen.
//
//   GET  /api/options                 services, estates and urgency choices for the form
//   POST /api/requests                post a job -> saved request + top matched pros
//   POST /api/requests/:id/hire       customer hires one of the pros they were shown
//   POST /api/pros                    a fundi signs up as a pro
//
// No login yet: customers are identified by phone number. Add real auth
// (e.g. SMS one-time codes) before launch, otherwise anyone can post as anyone.
import express from 'express';
import { AREAS } from './areas.js';
import { CATEGORIES, CATEGORY_NAMES, URGENCY } from './matcher.js';
import { createPro, getProCards, hirePro, matchRequest, upsertCustomer } from './store.js';

const LABELS = {
  plumbing: 'Plumbing', electrical: 'Electrical', cleaning: 'Cleaning', painting: 'Painting',
  carpentry: 'Carpentry', appliance_repair: 'Appliance repair', moving: 'Moving',
};
const URGENCY_LABELS = { now: 'Today', this_week: 'This week', flexible: "I'm flexible" };
const TRAVEL_CHOICES = [45, 60, 90];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class BadRequest extends Error {}

/** Accepts 07XXXXXXXX, 01XXXXXXXX, 2547..., +2547... ; returns +2547XXXXXXXX. */
export function normalizeKenyanPhone(raw) {
  const digits = String(raw ?? '').replace(/[\s()-]/g, '');
  const m = digits.match(/^(?:\+?254|0)([17]\d{8})$/);
  if (!m) throw new BadRequest('Enter a Kenyan phone number, e.g. 0712 345 678');
  return `+254${m[1]}`;
}

function parseLocation(b) {
  if (typeof b.lat === 'number' && typeof b.lon === 'number') {
    if (!(b.lat > -4.8 && b.lat < 5.1 && b.lon > 33.9 && b.lon < 42)) throw new BadRequest('That location is outside Kenya');
    return { lat: b.lat, lon: b.lon, area: typeof b.area === 'string' && AREAS[b.area] ? b.area : null };
  }
  if (AREAS[b.area]) return { lat: AREAS[b.area][0], lon: AREAS[b.area][1], area: b.area };
  throw new BadRequest('Choose your estate or share your location');
}

function parsePro(body) {
  const b = body ?? {};
  const fullName = typeof b.fullName === 'string' ? b.fullName.trim().replace(/\s+/g, ' ') : '';
  if (fullName.length < 3 || fullName.length > 80 || !fullName.includes(' ')) {
    throw new BadRequest('Enter your first and last name');
  }
  if (!Array.isArray(b.services) || b.services.length === 0) throw new BadRequest('Choose at least one service you offer');
  const seen = new Set();
  const services = b.services.map((s) => {
    if (!CATEGORY_NAMES.includes(s?.category) || seen.has(s.category)) throw new BadRequest('Invalid service');
    seen.add(s.category);
    const raw = s.typicalPriceKes;
    if (raw === undefined || raw === null || raw === '') return { category: s.category, typicalPriceKes: null };
    const price = Number(raw);
    if (!Number.isInteger(price) || price < 100 || price > 1_000_000) {
      throw new BadRequest('Prices must be between KES 100 and KES 1,000,000');
    }
    return { category: s.category, typicalPriceKes: price };
  });
  const maxTravelMin = Number(b.maxTravelMin);
  if (!TRAVEL_CHOICES.includes(maxTravelMin)) throw new BadRequest('Choose how far you can travel');
  if (b.agree !== true) throw new BadRequest('Please accept the terms to join');
  return { fullName, phone: normalizeKenyanPhone(b.phone), maxTravelMin, services, ...parseLocation(b) };
}

function parseJob(body) {
  const b = body ?? {};
  if (!CATEGORY_NAMES.includes(b.category)) throw new BadRequest('Choose a service');
  if (!URGENCY.includes(b.urgency)) throw new BadRequest('Choose when you need it');

  const { lat, lon, area } = parseLocation(b);

  const budget = Number(b.budgetKes);
  if (!Number.isInteger(budget) || budget < 200 || budget > 1_000_000) {
    throw new BadRequest('Enter a budget between KES 200 and KES 1,000,000');
  }
  const description = typeof b.description === 'string' ? b.description.trim().slice(0, 1000) : '';
  if (description.length < 10) throw new BadRequest('Describe the job in a few words (at least 10 characters)');
  const name = typeof b.name === 'string' ? b.name.trim().slice(0, 80) || null : null;

  return {
    phone: normalizeKenyanPhone(b.phone), name,
    job: { category: b.category, urgency: b.urgency, area, lat, lon, budgetKes: budget, description, hasPhotos: false },
  };
}

export function createApp(pool, { modelUrl = null } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '10kb' }));
  const wrap = (fn) => (req, res, next) => fn(req, res).catch(next);

  app.get('/api/options', (req, res) => {
    res.json({
      categories: CATEGORY_NAMES.map((slug) => ({ slug, label: LABELS[slug] ?? slug, basePriceKes: CATEGORIES[slug] })),
      travel: TRAVEL_CHOICES,
      areas: Object.keys(AREAS),
      urgency: URGENCY.map((value) => ({ value, label: URGENCY_LABELS[value] })),
    });
  });

  app.post('/api/requests', wrap(async (req, res) => {
    const { phone, name, job } = parseJob(req.body);
    const customerId = await upsertCustomer(pool, { phone, name });
    const match = await matchRequest(pool, { ...job, customerId }, { modelUrl });
    const cards = await getProCards(pool, match.results.map((r) => r.pro.id), job.category);
    res.status(201).json({
      requestId: match.requestId,
      pros: match.results.map((r) => ({
        ...cards.get(r.pro.id),
        travelMin: Math.round(r.features.travel_min / 5) * 5,
        isNew: Boolean(r.features.is_new),
      })),
    });
  }));

  app.post('/api/requests/:id/hire', wrap(async (req, res) => {
    const requestId = req.params.id;
    const proId = req.body?.proId;
    if (!UUID.test(requestId) || !UUID.test(String(proId))) throw new BadRequest('Invalid request or pro');
    const phone = normalizeKenyanPhone(req.body?.phone);

    // Only the customer who posted the job can hire, and only a pro they were shown.
    const { rows } = await pool.query(
      `select p.full_name, p.phone
         from requests r
         join customers c on c.id = r.customer_id
         join match_impressions mi on mi.request_id = r.id and mi.pro_id = $2
         join pros p on p.id = mi.pro_id
        where r.id = $1 and c.phone = $3`,
      [requestId, proId, phone]);
    if (!rows.length) return res.status(404).json({ error: 'Job or pro not found' });

    try {
      const jobId = await hirePro(pool, { requestId, proId });
      res.status(201).json({ jobId, pro: { name: rows[0].full_name, phone: rows[0].phone } });
    } catch (e) {
      if (e.code === '23505') return res.status(409).json({ error: 'You already hired someone for this job' });
      throw e;
    }
  }));

  app.post('/api/pros', wrap(async (req, res) => {
    const pro = parsePro(req.body);
    try {
      const id = await createPro(pool, pro);
      res.status(201).json({ id, name: pro.fullName, area: pro.area, services: pro.services.map((s) => s.category) });
    } catch (e) {
      if (e.code === '23505') return res.status(409).json({ error: 'This phone number is already registered as a pro' });
      throw e;
    }
  }));

  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof BadRequest) return res.status(400).json({ error: err.message });
    if (err.type === 'entity.parse.failed' || err.type === 'entity.too.large') {
      return res.status(400).json({ error: 'Invalid request body' });
    }
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  });
  return app;
}

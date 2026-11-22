import { useEffect, useMemo, useState } from 'react';
import { BRAND, COMPANY, ICONS, SiteHeader, getOptions, link } from './brand.jsx';

const BLURBS = {
  plumbing: 'Leaks, blocked drains, taps, water tanks',
  electrical: 'Wiring, sockets, lighting, tokens & meters',
  cleaning: 'Homes, offices, move-in and move-out cleans',
  painting: 'Interior, exterior, gates and grills',
  carpentry: 'Doors, cabinets, furniture repair, fittings',
  appliance_repair: 'Fridges, cookers, washing machines, TVs',
  moving: 'Pick-ups, house moves, office moves',
};
// Extra search words, including common Swahili terms.
const KEYWORDS = {
  plumbing: 'plumber pipe toilet sink tap shower water tank borehole maji bomba',
  electrical: 'electrician power light bulb socket wiring token meter stima umeme',
  cleaning: 'cleaner house office carpet sofa laundry fumigation usafi mama fua',
  painting: 'painter paint wall gate rangi',
  carpentry: 'carpenter wood door cabinet wardrobe bed table furniture mbao seremala',
  appliance_repair: 'fridge cooker oven microwave washing machine tv repair fundi',
  moving: 'movers move relocation lorry pickup transport kuhama',
};
const TINTS = ['t1', 't2', 't3', 't4'];

/** Best service for free text, e.g. "leaking tap" -> plumbing. */
function findService(query, categories) {
  const words = query.toLowerCase().match(/[a-z]+/g)?.filter((w) => w.length >= 3) ?? [];
  if (!words.length) return null;
  let best = null; let bestScore = 0;
  for (const c of categories) {
    const hay = `${c.label} ${BLURBS[c.slug] ?? ''} ${KEYWORDS[c.slug] ?? ''}`.toLowerCase();
    const score = words.filter((w) => hay.includes(w.slice(0, Math.max(3, Math.min(w.length, 4))))).length;
    if (score > bestScore) { best = c; bestScore = score; }
  }
  return best;
}

const STEPS = [
  ['Tell us what you need', 'Pick a service, describe the job, and set your budget. It takes about a minute.'],
  ['See your best matches', 'We rank nearby pros by who is most likely to reply fast and do great work, not just who is closest.'],
  ['Hire and get it done', 'Call or WhatsApp the pro you pick to agree on time and price. Rate them when the job is done.'],
];

const REASONS = [
  ['✓', 'Verified pros are marked', 'Pros who have shown us their ID carry a Verified badge, so you know who you are letting in.'],
  ['★', 'Ratings from real jobs', 'Reviews come only from customers who hired the pro through Ceras.'],
  ['⏱', 'Matched for reliability', 'Our matching learns who actually turns up, so dependable fundis rise to the top.'],
  ['📍', 'Real travel times', 'We account for Nairobi traffic, so “nearby” means a pro who can actually reach you.'],
];

function postUrl(service, area) {
  const q = new URLSearchParams();
  if (service) q.set('service', service);
  if (area) q.set('area', area);
  const s = q.toString();
  return link(`/post${s ? `?${s}` : ''}`);
}

export default function Home() {
  const [options, setOptions] = useState(null);
  const [query, setQuery] = useState('');
  const [area, setArea] = useState('');

  useEffect(() => {
    getOptions().then(setOptions);
  }, []);

  const categories = options?.categories ?? [];
  const match = useMemo(() => findService(query, categories), [query, categories]);

  function search(e) {
    e.preventDefault();
    window.location.href = postUrl(match?.slug, area);
  }

  return (
    <div className="site">
      <SiteHeader cta />

      <section className="hero">
        <div className="wrap">
          <h1>Trusted fundis near you, <span className="hl">in minutes.</span></h1>
          <p className="lead">Plumbers, electricians, cleaners and more across Nairobi, matched to your job, your estate and your budget.</p>
          <form className="search" onSubmit={search} role="search">
            <label className="field grow">
              <span className="sr">What do you need?</span>
              <span aria-hidden className="field-icon">🔎</span>
              <input list="services" value={query} onChange={(e) => setQuery(e.target.value)}
                placeholder="What do you need? e.g. leaking tap" />
              <datalist id="services">
                {categories.map((c) => <option key={c.slug} value={c.label} />)}
              </datalist>
            </label>
            <label className="field">
              <span className="sr">Estate</span>
              <span aria-hidden className="field-icon">📍</span>
              <select value={area} onChange={(e) => setArea(e.target.value)}>
                <option value="">Your estate</option>
                {options?.areas.map((a) => <option key={a}>{a}</option>)}
              </select>
            </label>
            <button className="primary">{match ? `Find ${match.label.toLowerCase()} pros` : 'Find pros'}</button>
          </form>
          <div className="quick">
            <span className="muted">Popular:</span>
            {['plumbing', 'cleaning', 'electrical', 'moving'].map((s) => {
              const c = categories.find((x) => x.slug === s);
              return c && <a key={s} className="chip" href={postUrl(s, area)}>{ICONS[s]} {c.label}</a>;
            })}
          </div>
        </div>
      </section>

      <section className="wrap block">
        <h2>Popular services</h2>
        <div className="tiles">
          {categories.map((c, i) => (
            <a key={c.slug} className="tile" href={postUrl(c.slug, area)}>
              <span className={`tile-art ${TINTS[i % TINTS.length]}`} aria-hidden>{ICONS[c.slug] ?? '🛠️'}</span>
              <span className="tile-body">
                <strong>{c.label}</strong>
                <span className="muted">{BLURBS[c.slug]}</span>
              </span>
            </a>
          ))}
        </div>
      </section>

      <section className="band">
        <div className="wrap block">
          <h2>How {BRAND} works</h2>
          <ol className="steps">
            {STEPS.map(([title, text], i) => (
              <li key={title}>
                <span className="step-num">{i + 1}</span>
                <h3>{title}</h3>
                <p className="muted">{text}</p>
              </li>
            ))}
          </ol>
          <a className="primary" href={link('/post')}>Post a job, it's free</a>
        </div>
      </section>

      <section className="wrap block">
        <h2>Why Nairobi chooses {BRAND}</h2>
        <div className="reasons">
          {REASONS.map(([icon, title, text]) => (
            <div key={title} className="reason">
              <span className="reason-icon" aria-hidden>{icon}</span>
              <div>
                <h3>{title}</h3>
                <p className="muted">{text}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="wrap block">
        <h2>Areas we serve</h2>
        <div className="areas">
          {options?.areas.map((a) => <a key={a} className="chip" href={postUrl('', a)}>{a}</a>)}
        </div>
      </section>

      <section className="wrap block" id="pros">
        <div className="pro-cta">
          <div>
            <h2>Are you a fundi?</h2>
            <p>Get jobs from customers near you. No more waiting for word of mouth. New pros get a fair chance to be seen while they build their reviews.</p>
          </div>
          <a className="soon" href={link('/join')}>Join as a pro →</a>
        </div>
      </section>

      <footer className="foot">
        <div className="wrap foot-inner">
          <span className="logo">{BRAND}<span> Technologies</span></span>
          <span className="muted">© {new Date().getFullYear()} {COMPANY} · Nairobi, Kenya</span>
        </div>
      </footer>
    </div>
  );
}

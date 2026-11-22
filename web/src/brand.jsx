// Shared brand pieces and helpers for every page.
export const BRAND = 'Ceras';
export const COMPANY = 'Ceras Technologies';

export const ICONS = {
  plumbing: '🚰', electrical: '💡', cleaning: '🧽', painting: '🎨',
  carpentry: '🪚', appliance_repair: '🔧', moving: '🚚',
};

// Preview build (`npm run build:preview`): runs with no server, using plain
// hash names (#post-s0-a3) and sample data, so it can be shown as a static page.
export const PREVIEW = import.meta.env.VITE_PREVIEW === '1';

const FALLBACK_OPTIONS = {
  categories: [
    ['plumbing', 'Plumbing', 2500], ['electrical', 'Electrical', 3000], ['cleaning', 'Cleaning', 1500],
    ['painting', 'Painting', 8000], ['carpentry', 'Carpentry', 5000],
    ['appliance_repair', 'Appliance repair', 3500], ['moving', 'Moving', 10000],
  ].map(([slug, label, basePriceKes]) => ({ slug, label, basePriceKes })),
  areas: ['CBD', 'Westlands', 'Parklands', 'Kilimani', 'Kileleshwa', 'Lavington', 'Karen', "Lang'ata",
    'South B', 'South C', 'Embakasi', 'Eastleigh', 'Kasarani', 'Roysambu', 'Ruaka', 'Rongai',
    'Kitengela', 'Syokimau', 'Ruiru'],
  urgency: [
    { value: 'now', label: 'Today' }, { value: 'this_week', label: 'This week' },
    { value: 'flexible', label: "I'm flexible" },
  ],
  travel: [45, 60, 90],
};

/** Link to a page: "/post?service=x&area=y" normally, "#post-s0-a3" in preview. */
export function link(path) {
  if (!PREVIEW) return path;
  const [p, query = ''] = path.split('?');
  const q = new URLSearchParams(query);
  const s = FALLBACK_OPTIONS.categories.findIndex((c) => c.slug === q.get('service'));
  const a = FALLBACK_OPTIONS.areas.indexOf(q.get('area'));
  return `#${p.replace(/^\//, '') || 'home'}${s >= 0 ? `-s${s}` : ''}${a >= 0 ? `-a${a}` : ''}`;
}

/** Current page path and query, for either kind of link. */
export function currentLocation() {
  if (PREVIEW) {
    const m = window.location.hash.match(/^#([a-z]+)(?:-s(\d+))?(?:-a(\d+))?$/);
    const params = new URLSearchParams();
    if (m?.[2]) params.set('service', FALLBACK_OPTIONS.categories[Number(m[2])]?.slug ?? '');
    if (m?.[3]) params.set('area', FALLBACK_OPTIONS.areas[Number(m[3])] ?? '');
    return { path: `/${m && m[1] !== 'home' ? m[1] : ''}`, params };
  }
  return { path: window.location.pathname, params: new URLSearchParams(window.location.search) };
}

export async function getOptions() {
  if (PREVIEW) return FALLBACK_OPTIONS;
  try {
    const res = await fetch('/api/options');
    if (res.ok) return await res.json();
  } catch { /* fall through */ }
  return FALLBACK_OPTIONS;
}

export async function postJson(path, body) {
  if (PREVIEW) return sampleResponse(path, body);
  const res = await fetch(path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? 'Something went wrong. Please try again.');
  return data;
}

// ---- Preview-only sample data. Nothing is saved. ----
const SAMPLE_PROS = [
  ['Otieno Onyango', 'Parklands', true, 4.9, 183, 268, 30, false],
  ['Atieno Barasa', 'Westlands', false, 4.7, 63, 99, 25, false],
  ['Chebet Nduta', 'Kileleshwa', true, null, 0, 2, 20, true],
  ['Nyambura Onyango', 'Kileleshwa', true, 5.0, 9, 14, 20, false],
  ['Wanjiru Rotich', 'South B', true, 4.8, 20, 33, 30, false],
];

function sampleResponse(path, body) {
  const wait = (v) => new Promise((r) => setTimeout(() => r(v), 500));
  if (path === '/api/requests') {
    const base = FALLBACK_OPTIONS.categories.find((c) => c.slug === body.category)?.basePriceKes ?? 2500;
    return wait({
      requestId: 'preview',
      pros: SAMPLE_PROS.map(([name, area, verified, rating, reviews, jobsDone, travelMin, isNew], i) => ({
        id: `sample-${i}`, name, area, verified, rating, reviews, jobsDone, travelMin, isNew,
        typicalPriceKes: Math.round((base * (0.85 + i * 0.07)) / 10) * 10,
      })),
    });
  }
  if (path.endsWith('/hire')) {
    const i = Number(String(body.proId).split('-')[1]) || 0;
    return wait({ jobId: 'preview', pro: { name: SAMPLE_PROS[i][0], phone: '+254700000000' } });
  }
  if (path === '/api/pros') {
    if (!body.fullName?.trim().includes(' ')) return Promise.reject(new Error('Enter your first and last name'));
    if (!/^(?:\+?254|0)[17]\d{8}$/.test(String(body.phone).replace(/[\s()-]/g, ''))) {
      return Promise.reject(new Error('Enter a Kenyan phone number, e.g. 0712 345 678'));
    }
    if (!body.area && body.lat == null) return Promise.reject(new Error('Choose your estate or share your location'));
    if (!body.agree) return Promise.reject(new Error('Please accept the terms to join'));
    return wait({ id: 'preview', name: body.fullName.trim(), area: body.area ?? null, services: body.services.map((s) => s.category) });
  }
  return Promise.reject(new Error('Not available in preview'));
}

export function PreviewBanner() {
  if (!PREVIEW) return null;
  return <div className="preview-banner">Preview with sample data. Nothing you enter is saved.</div>;
}

export function SiteHeader({ cta = false }) {
  return (
    <>
      <PreviewBanner />
      <header className="site-head">
        <div className="wrap head-inner">
          <a className="logo" href={link('/')} aria-label={`${COMPANY} home`}>{BRAND}<span> Technologies</span></a>
          {cta && (
            <nav className="head-nav">
              <a className="head-link" href={link('/join')}>For pros</a>
              <a className="primary small" href={link('/post')}>Post a job</a>
            </nav>
          )}
        </div>
      </header>
    </>
  );
}

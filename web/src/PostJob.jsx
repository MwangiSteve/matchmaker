import { useEffect, useState } from 'react';

const ICONS = {
  plumbing: '🚰', electrical: '💡', cleaning: '🧽', painting: '🎨',
  carpentry: '🪚', appliance_repair: '🔧', moving: '🚚',
};
// Placeholder brand name: change it here.
const BRAND = { first: 'fundi', second: 'match' };
const kes = (n) => `KES ${Number(n).toLocaleString('en-KE')}`;

function load(key, fallback = '') {
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}
function save(key, value) {
  try { localStorage.setItem(key, value); } catch { /* private mode */ }
}

async function api(path, body) {
  const res = await fetch(path, body ? {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  } : undefined);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? 'Something went wrong. Please try again.');
  return data;
}

export default function PostJob() {
  const [options, setOptions] = useState(null);
  const [form, setForm] = useState({
    category: '', description: '', area: load('mm.area'), urgency: 'this_week',
    budgetKes: '', name: load('mm.name'), phone: load('mm.phone'),
  });
  const [coords, setCoords] = useState(null);
  const [locating, setLocating] = useState(false);
  const [step, setStep] = useState('form'); // form | results | hired
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [hired, setHired] = useState(null);

  useEffect(() => {
    api('/api/options').then(setOptions).catch((e) => setError(e.message));
  }, []);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target?.value ?? e }));

  function useMyLocation() {
    if (!navigator.geolocation) return setError('Your browser cannot share location. Pick your estate instead.');
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => { setCoords({ lat: pos.coords.latitude, lon: pos.coords.longitude }); setLocating(false); },
      () => { setError('Could not get your location. Pick your estate instead.'); setLocating(false); },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  async function submit(e) {
    e.preventDefault();
    setError('');
    if (!form.category) return setError('Choose a service');
    setBusy(true);
    try {
      const data = await api('/api/requests', {
        ...form, budgetKes: Number(form.budgetKes), area: form.area || undefined, ...(coords ?? {}),
      });
      save('mm.name', form.name); save('mm.phone', form.phone); save('mm.area', form.area);
      setResult(data);
      setStep('results');
      window.scrollTo(0, 0);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function hire(pro) {
    setError('');
    setBusy(true);
    try {
      const data = await api(`/api/requests/${result.requestId}/hire`, { proId: pro.id, phone: form.phone });
      setHired(data.pro);
      setStep('hired');
      window.scrollTo(0, 0);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function startOver() {
    setForm((f) => ({ ...f, category: '', description: '', budgetKes: '' }));
    setResult(null); setHired(null); setError(''); setStep('form');
  }

  const service = options?.categories.find((c) => c.slug === form.category);

  return (
    <div className="page">
      <header className="top">
        <span className="logo">{BRAND.first}<span>{BRAND.second}</span></span>
      </header>

      {error && <div className="alert" role="alert">{error}</div>}

      {step === 'form' && (
        <form className="card" onSubmit={submit} noValidate>
          <h1>Post a job</h1>
          <p className="muted">Tell us what you need. We'll show you the best pros near you.</p>

          <fieldset>
            <legend>What do you need?</legend>
            <div className="services">
              {options?.categories.map((c) => (
                <button type="button" key={c.slug}
                  className={`service ${form.category === c.slug ? 'on' : ''}`}
                  aria-pressed={form.category === c.slug}
                  onClick={() => set('category')(c.slug)}>
                  <span className="icon" aria-hidden>{ICONS[c.slug] ?? '🛠️'}</span>
                  {c.label}
                </button>
              )) ?? <p className="muted">Loading…</p>}
            </div>
          </fieldset>

          <label>
            Describe the job
            <textarea rows={3} maxLength={1000} value={form.description} onChange={set('description')}
              placeholder="e.g. Kitchen sink is leaking under the cabinet" required />
          </label>

          <fieldset>
            <legend>Where?</legend>
            <div className="row">
              <select value={form.area} onChange={set('area')} aria-label="Estate">
                <option value="">Choose your estate</option>
                {options?.areas.map((a) => <option key={a}>{a}</option>)}
              </select>
              <button type="button" className="ghost" onClick={useMyLocation} disabled={locating}>
                {locating ? 'Locating…' : coords ? '📍 Location set' : '📍 Use my location'}
              </button>
            </div>
          </fieldset>

          <fieldset>
            <legend>When?</legend>
            <div className="segmented">
              {options?.urgency.map((u) => (
                <button type="button" key={u.value} className={form.urgency === u.value ? 'on' : ''}
                  aria-pressed={form.urgency === u.value} onClick={() => set('urgency')(u.value)}>
                  {u.label}
                </button>
              ))}
            </div>
          </fieldset>

          <label>
            Your budget (KES)
            <input inputMode="numeric" pattern="[0-9]*" value={form.budgetKes} placeholder="e.g. 3000"
              onChange={(e) => set('budgetKes')(e.target.value.replace(/\D/g, ''))} required />
          </label>

          <div className="row two">
            <label>
              Your name
              <input value={form.name} onChange={set('name')} autoComplete="name" placeholder="Optional" />
            </label>
            <label>
              Phone number
              <input type="tel" value={form.phone} onChange={set('phone')} autoComplete="tel"
                placeholder="0712 345 678" required />
            </label>
          </div>

          <button className="primary" disabled={busy}>{busy ? 'Finding pros…' : 'Find pros'}</button>
        </form>
      )}

      {step === 'results' && result && (
        <section>
          <div className="summary">
            <button className="link" onClick={() => setStep('form')}>← Edit job</button>
            <h1>{result.pros.length ? `Top ${service?.label.toLowerCase() ?? ''} pros for you` : 'No pros available yet'}</h1>
            <p className="muted">
              {result.pros.length
                ? 'Ranked by who is most likely to reply quickly and do a great job.'
                : "Nobody nearby offers this right now. We've saved your job and will let you know."}
            </p>
          </div>
          <ul className="pros">
            {result.pros.map((p, i) => (
              <li key={p.id} className="card pro">
                <div className="avatar" aria-hidden>{p.name.split(' ').map((w) => w[0]).join('').slice(0, 2)}</div>
                <div className="info">
                  <div className="name">
                    {p.name}
                    {p.verified && <span className="badge ok" title="ID verified">✓ Verified</span>}
                    {i === 0 && <span className="badge top">Best match</span>}
                  </div>
                  <div className="meta">
                    {p.isNew || p.rating == null
                      ? <span className="badge new">New on {BRAND.first}{BRAND.second}</span>
                      : <span>★ {p.rating.toFixed(1)} <span className="muted">({p.reviews})</span></span>}
                    <span>{p.jobsDone} jobs</span>
                    <span>{p.area}</span>
                  </div>
                  <div className="meta muted">
                    <span className="nowrap">~{p.travelMin} min away</span> · <span className="nowrap">usually {kes(p.typicalPriceKes)}</span>
                  </div>
                </div>
                <button className="primary small" onClick={() => hire(p)} disabled={busy}>Hire</button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {step === 'hired' && hired && (
        <section className="card done">
          <div className="big" aria-hidden>🎉</div>
          <h1>You hired {hired.name}</h1>
          <p>Call or WhatsApp them to agree on the time and price.</p>
          <a className="primary" href={`tel:${hired.phone}`}>Call {hired.phone}</a>
          <a className="ghost" href={`https://wa.me/${hired.phone.replace('+', '')}`} target="_blank" rel="noreferrer">WhatsApp</a>
          <button className="link" onClick={startOver}>Post another job</button>
        </section>
      )}
    </div>
  );
}

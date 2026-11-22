import { useEffect, useState } from 'react';
import { BRAND, ICONS, SiteHeader, getOptions, link, postJson } from './brand.jsx';

const kes = (n) => Number(n).toLocaleString('en-KE');
const TRAVEL_LABELS = { 45: 'Up to 45 min', 60: 'Up to 1 hour', 90: 'Up to 1½ hours' };

export default function Join() {
  const [options, setOptions] = useState(null);
  const [form, setForm] = useState({ fullName: '', phone: '', area: '', maxTravelMin: 60, agree: false });
  const [prices, setPrices] = useState({}); // slug -> price string; key present = service selected
  const [coords, setCoords] = useState(null);
  const [locating, setLocating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(null);

  useEffect(() => { getOptions().then(setOptions); }, []);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e?.target ? (e.target.type === 'checkbox' ? e.target.checked : e.target.value) : e }));

  function toggle(slug) {
    setPrices((p) => {
      const next = { ...p };
      if (slug in next) delete next[slug]; else next[slug] = '';
      return next;
    });
  }

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
    const services = Object.entries(prices).map(([category, price]) => ({
      category, typicalPriceKes: price === '' ? null : Number(price),
    }));
    if (!services.length) return setError('Choose at least one service you offer');
    setBusy(true);
    try {
      const data = await postJson('/api/pros', {
        ...form, area: form.area || undefined, maxTravelMin: Number(form.maxTravelMin), services, ...(coords ?? {}),
      });
      setDone(data);
      window.scrollTo(0, 0);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const labelOf = (slug) => options?.categories.find((c) => c.slug === slug)?.label ?? slug;

  return (
    <div className="site">
      <SiteHeader />
      <div className="page">
        {error && <div className="alert" role="alert">{error}</div>}

        {!done && (
          <form className="card" onSubmit={submit} noValidate>
            <h1>Join {BRAND} as a pro</h1>
            <p className="muted">Get jobs from customers near you. It's free to join and takes two minutes.</p>

            <div className="row two">
              <label>
                Full name
                <input value={form.fullName} onChange={set('fullName')} autoComplete="name" placeholder="e.g. Wanjiru Kamau" required />
              </label>
              <label>
                Phone number
                <input type="tel" value={form.phone} onChange={set('phone')} autoComplete="tel" placeholder="0712 345 678" required />
              </label>
            </div>

            <fieldset>
              <legend>Which services do you offer?</legend>
              <div className="services">
                {options?.categories.map((c) => (
                  <button type="button" key={c.slug} className={`service ${c.slug in prices ? 'on' : ''}`}
                    aria-pressed={c.slug in prices} onClick={() => toggle(c.slug)}>
                    <span className="icon" aria-hidden>{ICONS[c.slug] ?? '🛠️'}</span>
                    {c.label}
                  </button>
                )) ?? <p className="muted">Loading…</p>}
              </div>
            </fieldset>

            {Object.keys(prices).length > 0 && (
              <fieldset>
                <legend>Your usual price for a typical job</legend>
                <p className="muted small-note">Optional. Customers see this so they can compare. Leave blank if it varies a lot.</p>
                <div className="price-list">
                  {Object.keys(prices).map((slug) => {
                    const base = options?.categories.find((c) => c.slug === slug)?.basePriceKes;
                    return (
                      <label key={slug} className="price-row">
                        <span>{ICONS[slug]} {labelOf(slug)}</span>
                        <span className="kes-input">
                          <span aria-hidden>KES</span>
                          <input inputMode="numeric" pattern="[0-9]*" value={prices[slug]}
                            aria-label={`${labelOf(slug)} price in KES`}
                            placeholder={base ? kes(base) : ''}
                            onChange={(e) => setPrices((p) => ({ ...p, [slug]: e.target.value.replace(/\D/g, '') }))} />
                        </span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            )}

            <fieldset>
              <legend>Where are you based?</legend>
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
              <legend>How far can you travel to a job?</legend>
              <div className="segmented">
                {(options?.travel ?? [45, 60, 90]).map((m) => (
                  <button type="button" key={m} className={Number(form.maxTravelMin) === m ? 'on' : ''}
                    aria-pressed={Number(form.maxTravelMin) === m} onClick={() => set('maxTravelMin')(m)}>
                    {TRAVEL_LABELS[m] ?? `${m} min`}
                  </button>
                ))}
              </div>
            </fieldset>

            <label className="check">
              <input type="checkbox" checked={form.agree} onChange={set('agree')} />
              <span>I agree that {BRAND} can share my name, services, area and prices with customers, and give my phone number to customers who hire me.</span>
            </label>

            <button className="primary" disabled={busy}>{busy ? 'Signing you up…' : 'Join as a pro'}</button>
          </form>
        )}

        {done && (
          <section className="card done">
            <div className="big" aria-hidden>🧰</div>
            <h1>Karibu, {done.name.split(' ')[0]}!</h1>
            <p>
              You're now on {BRAND}. Customers{done.area ? ` in and around ${done.area}` : ' near you'} looking for{' '}
              {new Intl.ListFormat('en', { type: 'disjunction' }).format(done.services.map((x) => labelOf(x).toLowerCase()))} can find you, and you'll show as <strong>New on {BRAND}</strong>.
            </p>
            <p className="muted">Next: we'll contact you to check your ID. Verified pros get a ✓ badge and more jobs.</p>
            <a className="primary" href={link('/')}>Back to {BRAND}</a>
          </section>
        )}
      </div>
    </div>
  );
}

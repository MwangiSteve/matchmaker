// Shared brand pieces for every page.
export const BRAND = 'Ceras';
export const COMPANY = 'Ceras Technologies';

export const ICONS = {
  plumbing: '🚰', electrical: '💡', cleaning: '🧽', painting: '🎨',
  carpentry: '🪚', appliance_repair: '🔧', moving: '🚚',
};

export function SiteHeader({ cta = false }) {
  return (
    <header className="site-head">
      <div className="wrap head-inner">
        <a className="logo" href="/" aria-label={`${COMPANY} home`}>{BRAND}<span> Technologies</span></a>
        {cta && (
          <nav className="head-nav">
            <a className="head-link" href="#pros">For pros</a>
            <a className="primary small" href="/post">Post a job</a>
          </nav>
        )}
      </div>
    </header>
  );
}

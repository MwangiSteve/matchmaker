import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import Home from './Home.jsx';
import Join from './Join.jsx';
import PostJob from './PostJob.jsx';
import { currentLocation } from './brand.jsx';
import './styles.css';

// No router library needed: "/" homepage, "/post" Post a job, "/join" pro sign-up.
const PAGES = { '/post': PostJob, '/join': Join };

function App() {
  const [path, setPath] = useState(currentLocation().path);
  useEffect(() => {
    const update = () => { setPath(currentLocation().path); window.scrollTo(0, 0); };
    window.addEventListener('hashchange', update); // preview build uses #/ links
    return () => window.removeEventListener('hashchange', update);
  }, []);
  const Page = PAGES[path.replace(/\/$/, '')] ?? Home;
  return <Page key={path} />;
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

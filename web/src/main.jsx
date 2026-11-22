import React from 'react';
import { createRoot } from 'react-dom/client';
import Home from './Home.jsx';
import PostJob from './PostJob.jsx';
import './styles.css';

// Two pages, no router library needed: "/" is the homepage, "/post" is Post a job.
const Page = window.location.pathname.startsWith('/post') ? PostJob : Home;

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Page />
  </React.StrictMode>,
);

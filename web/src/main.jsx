import React from 'react';
import { createRoot } from 'react-dom/client';
import PostJob from './PostJob.jsx';
import './styles.css';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <PostJob />
  </React.StrictMode>,
);

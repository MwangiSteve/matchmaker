// Start the API (and the built web app, if present).
//   DATABASE_URL=postgresql://... [MODEL_URL=http://127.0.0.1:8765] [PORT=3000] node server.js
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import express from 'express';
import pg from 'pg';
import { createApp } from './src/api.js';

if (!process.env.DATABASE_URL) {
  console.error('Set DATABASE_URL');
  process.exit(1);
}
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const app = createApp(pool, { modelUrl: process.env.MODEL_URL ?? null });

// Serve the React build from ../web/dist in production.
const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'web', 'dist');
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^\/(?!api\/).*/, (req, res) => res.sendFile(path.join(dist, 'index.html')));
}

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => console.log(`API on http://localhost:${port}${existsSync(dist) ? ' (serving web/dist)' : ''}`));

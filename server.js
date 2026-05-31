const express = require('express');
const path = require('path');
const fetch = require('node-fetch');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
});

const DEFAULT_CHANNELS = [
  { handle: '@imjust5taku' },
  { handle: '@Mohana-TV' },
  { handle: '@3UP-MOON' },
];

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS storage (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);
}

async function getData(key, fallback) {
  const result = await pool.query('SELECT value FROM storage WHERE key = $1', [key]);
  if (!result.rows.length) return fallback;
  return JSON.parse(result.rows[0].value);
}

async function setData(key, value) {
  await pool.query(
    'INSERT INTO storage (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2',
    [key, JSON.stringify(value)]
  );
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/tools', async (req, res) => {
  try { res.json(await getData('tools', [])); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/tools', async (req, res) => {
  if (!Array.isArray(req.body)) return res.status(400).json({ error: 'array expected' });
  try { await setData('tools', req.body); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/channels', async (req, res) => {
  try { res.json(await getData('channels', DEFAULT_CHANNELS)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/channels', async (req, res) => {
  if (!Array.isArray(req.body)) return res.status(400).json({ error: 'array expected' });
  try { await setData('channels', req.body); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/meta', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'url required' });
  try {
    const target = url.startsWith('http') ? url : 'https://' + url;
    const response = await fetch(target, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; tools-qpola-bot/1.0)' },
      timeout: 8000,
    });
    const html = await response.text();
    const get = (pattern) => {
      const m = html.match(pattern);
      return m ? m[1].replace(/&amp;/g, '&').replace(/&quot;/g, '"').trim() : '';
    };
    const title =
      get(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) ||
      get(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i) ||
      get(/<title[^>]*>([^<]+)<\/title>/i) || '';
    const description =
      get(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i) ||
      get(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:description["']/i) ||
      get(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i) ||
      get(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i) || '';
    const { hostname } = new URL(target);
    const favicon = `https://www.google.com/s2/favicons?sz=64&domain_url=${hostname}`;
    res.json({ title, description, favicon, url: target });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

initDb().then(() => {
  app.listen(PORT, () => {
    console.log(`tools.qpola.net running at http://localhost:${PORT}`);
  });
}).catch(err => {
  console.error('DB init failed:', err.message);
  process.exit(1);
});

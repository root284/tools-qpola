const express = require('express');
const path = require('path');
const fs = require('fs');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3000;

// Storage: Postgres if DATABASE_URL is set, otherwise file-based
let usePostgres = false;
let pool = null;

if (process.env.DATABASE_URL) {
  try {
    const { Pool } = require('pg');
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
    });
    usePostgres = true;
    console.log('Using Postgres storage');
  } catch (e) {
    console.log('pg init failed, falling back to file storage:', e.message);
  }
} else {
  console.log('No DATABASE_URL, using file storage');
}

// File storage paths (volume mount or local)
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const TOOLS_FILE = path.join(DATA_DIR, 'tools.json');
const CHANNELS_FILE = path.join(DATA_DIR, 'channels.json');
const CLICKS_FILE = path.join(DATA_DIR, 'clicks.json');

const DEFAULT_CHANNELS = [
  { handle: '@imjust5taku' },
  { handle: '@Mohana-TV' },
  { handle: '@3UP-MOON' },
];

// --- File storage helpers ---
function fileRead(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch { return fallback; }
}

function fileWrite(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

// --- Postgres helpers ---
async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS storage (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);
}

async function dbGet(key, fallback) {
  const r = await pool.query('SELECT value FROM storage WHERE key=$1', [key]);
  return r.rows.length ? JSON.parse(r.rows[0].value) : fallback;
}

async function dbSet(key, value) {
  await pool.query(
    'INSERT INTO storage(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=$2',
    [key, JSON.stringify(value)]
  );
}

// --- Unified get/set ---
const FILE_BY_KEY = { channels: CHANNELS_FILE, clicks: CLICKS_FILE, tools: TOOLS_FILE };

async function getData(key, fallback) {
  if (usePostgres) return dbGet(key, fallback);
  return fileRead(FILE_BY_KEY[key] || TOOLS_FILE, fallback);
}

async function setData(key, value) {
  if (usePostgres) return dbSet(key, value);
  fileWrite(FILE_BY_KEY[key] || TOOLS_FILE, value);
}

// --- Express ---
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

app.get('/api/clicks', async (req, res) => {
  try { res.json(await getData('clicks', {})); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/clicks', async (req, res) => {
  const { url } = req.body || {};
  if (!url) return res.status(400).json({ error: 'url required' });
  try {
    const clicks = await getData('clicks', {});
    clicks[url] = (clicks[url] || 0) + 1;
    await setData('clicks', clicks);
    res.json({ ok: true, count: clicks[url] });
  } catch (e) { res.status(500).json({ error: e.message }); }
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

async function start() {
  if (usePostgres) {
    try {
      await initDb();
      console.log('Postgres ready');
    } catch (e) {
      console.log('Postgres connection failed, falling back to file storage:', e.message);
      usePostgres = false;
    }
  }
  app.listen(PORT, () => {
    console.log(`tools.qpola.net running at http://localhost:${PORT} (storage: ${usePostgres ? 'postgres' : 'file'})`);
  });
}

start();

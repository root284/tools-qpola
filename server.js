const express = require('express');
const path = require('path');
const fs = require('fs');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3000;
const CHANNELS_FILE = path.join(__dirname, 'data', 'channels.json');

const DEFAULT_CHANNELS = [
  { handle: '@imjust5taku' },
  { handle: '@Mohana-TV' },
  { handle: '@3UP-MOON' },
];

function readChannels() {
  try {
    if (!fs.existsSync(CHANNELS_FILE)) return DEFAULT_CHANNELS;
    const raw = fs.readFileSync(CHANNELS_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed.length ? parsed : DEFAULT_CHANNELS;
  } catch {
    return DEFAULT_CHANNELS;
  }
}

function writeChannels(channels) {
  fs.mkdirSync(path.dirname(CHANNELS_FILE), { recursive: true });
  fs.writeFileSync(CHANNELS_FILE, JSON.stringify(channels, null, 2));
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/channels', (req, res) => {
  res.json(readChannels());
});

app.post('/api/channels', (req, res) => {
  const channels = req.body;
  if (!Array.isArray(channels)) return res.status(400).json({ error: 'array expected' });
  writeChannels(channels);
  res.json({ ok: true });
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
      get(/<title[^>]*>([^<]+)<\/title>/i) ||
      '';

    const description =
      get(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i) ||
      get(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:description["']/i) ||
      get(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i) ||
      get(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i) ||
      '';

    const { hostname } = new URL(target);
    const favicon = `https://www.google.com/s2/favicons?sz=64&domain_url=${hostname}`;

    res.json({ title, description, favicon, url: target });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => {
  console.log(`tools.qpola.net running at http://localhost:${PORT}`);
});

const express = require('express');
const initSqlJs = require('sql.js');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3002;
const DB_PATH = __dirname + '/privalytics-api.db';

let db;

async function initDB() {
  const SQL = await initSqlJs();
  try {
    if (fs.existsSync(DB_PATH)) {
      const buffer = fs.readFileSync(DB_PATH);
      db = new SQL.Database(buffer);
    } else {
      db = new SQL.Database();
    }
  } catch (e) {
    db = new SQL.Database();
  }

  db.run(`CREATE TABLE IF NOT EXISTS sites (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, domain TEXT NOT NULL,
    api_key TEXT UNIQUE, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT, site_id TEXT NOT NULL,
    session_hash TEXT NOT NULL, event_type TEXT NOT NULL, path TEXT NOT NULL,
    referrer_domain TEXT, country TEXT, browser TEXT, device_type TEXT,
    screen_bucket TEXT, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  saveDB();
}

function saveDB() {
  fs.writeFileSync(DB_PATH, Buffer.from(db.export()));
}

function generateSessionHash(ip, date) {
  return crypto.createHash('sha256').update(ip + ':' + date).digest('hex').substring(0, 16);
}

function getDateString() {
  return new Date().toISOString().split('T')[0];
}

function parseUserAgent(ua) {
  let browser = 'Unknown', deviceType = 'desktop';
  if (ua?.includes('Mobile') || ua?.includes('Android')) deviceType = 'mobile';
  else if (ua?.includes('Tablet') || ua?.includes('iPad')) deviceType = 'tablet';
  if (ua?.includes('Firefox')) browser = 'Firefox';
  else if (ua?.includes('Chrome')) browser = 'Chrome';
  else if (ua?.includes('Safari')) browser = 'Safari';
  else if (ua?.includes('Edge')) browser = 'Edge';
  return { browser, deviceType };
}

function extractDomain(url) {
  try {
    if (!url) return null;
    return new URL(url).hostname.replace('www.', '');
  } catch { return null; }
}

app.use(express.json());

// API Key authentication middleware
function auth(req, res, next) {
  const key = req.headers['x-api-key'];
  if (!key) return res.status(401).json({ error: 'API key required' });
  
  const result = db.exec(`SELECT id FROM sites WHERE api_key = ?`, [key]);
  if (result.length === 0 || result[0].values.length === 0) {
    return res.status(401).json({ error: 'Invalid API key' });
  }
  req.siteId = result[0].values[0][0];
  next();
}

// Create site with API key
app.post('/api/sites', (req, res) => {
  const { name, domain } = req.body;
  if (!name || !domain) return res.status(400).json({ error: 'Name and domain required' });
  
  const id = uuidv4();
  const apiKey = uuidv4().replace(/-/g, '');
  db.run('INSERT INTO sites (id, name, domain, api_key) VALUES (?, ?, ?, ?)', [id, name, domain, apiKey]);
  saveDB();
  
  res.status(201).json({ id, name, domain, api_key: apiKey });
});

// Track event
app.post('/api/track', (req, res) => {
  const { siteId, type = 'pageview', path = '/' } = req.body;
  if (!siteId) return res.status(400).json({ error: 'Site ID required' });

  const ip = req.ip || 'unknown';
  const ua = req.headers['user-agent'];
  const { browser, deviceType } = parseUserAgent(ua);
  const sessionHash = generateSessionHash(ip, getDateString());
  const referrerDomain = extractDomain(req.body.referrer);

  db.run(`INSERT INTO events (site_id, session_hash, event_type, path, referrer_domain, browser, device_type)
    VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [siteId, sessionHash, type, path, referrerDomain, browser, deviceType]);
  saveDB();
  res.status(204).end();
});

// Get stats (requires auth)
app.get('/api/stats', auth, (req, res) => {
  const siteId = req.siteId;

  const visitors = db.exec(`SELECT COUNT(DISTINCT session_hash) FROM events WHERE site_id = ?`, [siteId]);
  const views = db.exec(`SELECT COUNT(*) FROM events WHERE site_id = ? AND event_type = 'pageview'`, [siteId]);
  
  res.json({
    visitors: visitors[0]?.values[0]?.[0] || 0,
    views: views[0]?.values[0]?.[0] || 0
  });
});

// Get timeseries
app.get('/api/timeseries', auth, (req, res) => {
  const { start, end, metric = 'visitors' } = req.query;
  const siteId = req.siteId;
  
  let query;
  if (metric === 'views') {
    query = `SELECT DATE(timestamp) as date, COUNT(*) as count FROM events 
      WHERE site_id = ? AND event_type = 'pageview' GROUP BY DATE(timestamp) ORDER BY date`;
  } else {
    query = `SELECT DATE(timestamp) as date, COUNT(DISTINCT session_hash) as count 
      FROM events WHERE site_id = ? GROUP BY DATE(timestamp) ORDER BY date`;
  }
  
  const result = db.exec(query, [siteId]);
  const data = result[0]?.values.map(r => ({ date: r[0], count: r[1] })) || [];
  res.json(data);
});

// Get pages
app.get('/api/pages', auth, (req, res) => {
  const result = db.exec(`
    SELECT path, COUNT(*) as views, COUNT(DISTINCT session_hash) as visitors
    FROM events WHERE site_id = ? AND event_type = 'pageview'
    GROUP BY path ORDER BY views DESC LIMIT 20
  `, [req.siteId]);
  
  res.json(result[0]?.values.map(r => ({ path: r[0], views: r[1], visitors: r[2] })) || []);
});

// Get referrers
app.get('/api/referrers', auth, (req, res) => {
  const result = db.exec(`
    SELECT referrer_domain, COUNT(*) as views
    FROM events WHERE site_id = ? AND referrer_domain IS NOT NULL
    GROUP BY referrer_domain ORDER BY views DESC LIMIT 20
  `, [req.siteId]);
  
  res.json(result[0]?.values.map(r => ({ domain: r[0], views: r[1] })) || []);
});

// Get devices
app.get('/api/devices', auth, (req, res) => {
  const result = db.exec(`
    SELECT device_type, browser, COUNT(*) as views, COUNT(DISTINCT session_hash) as visitors
    FROM events WHERE site_id = ? GROUP BY device_type, browser ORDER BY visitors DESC
  `, [req.siteId]);
  
  res.json(result[0]?.values.map(r => ({ device: r[0], browser: r[1], views: r[2], visitors: r[3] })) || []);
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

initDB().then(() => {
  app.listen(PORT, () => {
    console.log(`Privalytics API running on http://localhost:${PORT}`);
  });
}).catch(console.error);

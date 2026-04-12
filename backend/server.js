require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const cron = require('node-cron');
const greenPlains = require('./scrapers/green-plains');
const nfp = require('./scrapers/nfp');

const app = express();
const PORT = process.env.PORT || 3000;
const CACHE_PATH = path.join(__dirname, 'cache', 'grain-cache.json');
const CACHE_INTERVAL = parseInt(process.env.CACHE_INTERVAL_MINUTES) || 20;

// ── Serve static frontend ──
app.use(express.static(path.join(__dirname, '..')));

// ── Read cache ──
function readCache() {
  try {
    return JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
  } catch {
    return {
      greenPlains: { success: false, data: [], error: 'Cache not initialized', timestamp: null },
      nfp: { success: false, data: [], error: 'Cache not initialized', timestamp: null }
    };
  }
}

// ── Write cache ──
function writeCache(data) {
  fs.writeFileSync(CACHE_PATH, JSON.stringify(data, null, 2));
}

// ── API: Grain bids ──
app.get('/api/grain', (req, res) => {
  const cache = readCache();
  res.json(cache);
});

// ── API: Health check ──
app.get('/api/health', (req, res) => {
  const cache = readCache();
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    cacheAge: {
      greenPlains: cache.greenPlains.timestamp,
      nfp: cache.nfp.timestamp
    }
  });
});

// ── Scrape all sources and update cache ──
async function runScrapeJob() {
  console.log(`[${new Date().toISOString()}] Starting grain scrape job...`);
  const cache = readCache();

  const [gpResult, nfpResult] = await Promise.allSettled([
    greenPlains.scrape(),
    nfp.scrape()
  ]);

  // Update Green Plains
  if (gpResult.status === 'fulfilled') {
    cache.greenPlains = gpResult.value;
    if (gpResult.value.success) {
      console.log(`  Green Plains: ${gpResult.value.data.length} bids scraped`);
    } else {
      console.warn(`  Green Plains: scrape failed — ${gpResult.value.error}`);
    }
  } else {
    console.error(`  Green Plains: exception — ${gpResult.reason}`);
    cache.greenPlains = {
      success: false,
      data: cache.greenPlains.data, // retain last good data
      error: gpResult.reason?.message || 'Unknown error',
      timestamp: new Date().toISOString(),
      stale: true
    };
  }

  // Update NFP
  if (nfpResult.status === 'fulfilled') {
    cache.nfp = nfpResult.value;
    if (nfpResult.value.success) {
      console.log(`  NFP: ${nfpResult.value.data.length} bids scraped`);
    } else {
      console.warn(`  NFP: scrape failed — ${nfpResult.value.error}`);
    }
  } else {
    console.error(`  NFP: exception — ${nfpResult.reason}`);
    cache.nfp = {
      success: false,
      data: cache.nfp.data,
      error: nfpResult.reason?.message || 'Unknown error',
      timestamp: new Date().toISOString(),
      stale: true
    };
  }

  writeCache(cache);
  console.log(`[${new Date().toISOString()}] Scrape job complete.`);
}

// ── API: Force refresh ──
app.post('/api/grain/refresh', async (req, res) => {
  try {
    await runScrapeJob();
    res.json(readCache());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Schedule scraping via cron ──
// Run every CACHE_INTERVAL minutes during market hours (Mon-Fri, 7am-5pm CT)
const cronExpr = `*/${CACHE_INTERVAL} 7-17 * * 1-5`;
cron.schedule(cronExpr, runScrapeJob, { timezone: 'America/Chicago' });
console.log(`Grain scrape scheduled: every ${CACHE_INTERVAL} min, Mon-Fri 7am-5pm CT`);

// Also run a daily morning scrape at 6:55 AM CT to have data ready for market open
cron.schedule('55 6 * * 1-5', runScrapeJob, { timezone: 'America/Chicago' });

// ── Start server ──
app.listen(PORT, async () => {
  console.log(`FarmOS Dashboard running on http://localhost:${PORT}`);
  console.log(`Serving static files from ${path.join(__dirname, '..')}`);

  // Initial scrape on startup
  console.log('Running initial scrape...');
  await runScrapeJob();
});

/**
 * Crystal Valley Cooperative — Corn Bid Scraper
 * Source: https://crystalvalley.coop/grain/#bids
 * Location: Trimont, MN
 *
 * Crystal Valley typically embeds a Barchart cashbid widget.
 * We use Playwright to render the page fully, select the
 * Trimont location if needed, and extract bid data.
 */

const { chromium } = require('playwright');

const TARGET_URL = 'https://crystalvalley.coop/grain/#bids';
const LOCATION_KEYWORD = /trimont/i;
const TIMEOUT = 30000;

async function scrape() {
  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });

    const page = await context.newPage();
    page.setDefaultTimeout(TIMEOUT);

    await page.goto(TARGET_URL, { waitUntil: 'networkidle', timeout: TIMEOUT });
    await page.waitForTimeout(3000); // let widget load

    // Try to select Trimont location
    await selectLocation(page);
    await page.waitForTimeout(2500);

    // Check for embedded iframes (Barchart widgets are often in iframes)
    const bids = await extractBids(page);

    if (bids.length === 0) {
      // Try iframes
      const iframeBids = await extractFromIframes(page);
      if (iframeBids.length > 0) {
        return {
          success: true,
          data: iframeBids,
          source: 'Crystal Valley Cooperative',
          location: 'Trimont, MN',
          timestamp: new Date().toISOString()
        };
      }

      return {
        success: false,
        data: [],
        error: 'No bid data found in page HTML. Widget may have changed.',
        timestamp: new Date().toISOString()
      };
    }

    return {
      success: true,
      data: bids,
      source: 'Crystal Valley Cooperative',
      location: 'Trimont, MN',
      timestamp: new Date().toISOString()
    };
  } catch (err) {
    return {
      success: false,
      data: [],
      error: err.message,
      timestamp: new Date().toISOString()
    };
  } finally {
    if (browser) await browser.close();
  }
}

async function selectLocation(page) {
  // Standard <select>
  const selects = await page.$$('select');
  for (const sel of selects) {
    const options = await sel.evaluate(el =>
      Array.from(el.options).map(o => ({ value: o.value, text: o.textContent.trim() }))
    );
    const match = options.find(o => LOCATION_KEYWORD.test(o.text));
    if (match) {
      await sel.selectOption(match.value);
      return true;
    }
  }

  // Button/link with "Trimont" text
  const clickables = await page.$$('a, button, [role="tab"], [class*="location"]');
  for (const el of clickables) {
    const text = await el.textContent();
    if (LOCATION_KEYWORD.test(text)) {
      try { await el.click(); return true; } catch {}
    }
  }
  return false;
}

async function extractBids(page) {
  return await page.evaluate(() => {
    const bids = [];
    const monthPattern = /\b(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\s*'?\d{0,2}\b/i;

    const tables = document.querySelectorAll('table');
    for (const table of tables) {
      const rows = table.querySelectorAll('tr');
      let headerMap = {};
      const headerRow = table.querySelector('thead tr, tr:first-child');
      if (headerRow) {
        const ths = headerRow.querySelectorAll('th, td');
        ths.forEach((th, i) => {
          const t = th.textContent.trim().toLowerCase();
          if (/deliv|month|contract/i.test(t)) headerMap.delivery = i;
          if (/cash|bid|price/i.test(t)) headerMap.cashBid = i;
          if (/basis/i.test(t)) headerMap.basis = i;
          if (/change|chg/i.test(t)) headerMap.change = i;
        });
      }

      for (const row of rows) {
        const cells = row.querySelectorAll('td');
        if (cells.length < 3) continue;
        const texts = Array.from(cells).map(c => c.textContent.trim());
        const deliveryIdx = headerMap.delivery ?? 0;
        if (!monthPattern.test(texts[deliveryIdx])) continue;

        const bid = {
          delivery: texts[deliveryIdx].toUpperCase().replace(/'/g, ''),
          cashBid: null,
          basis: '--',
          change: '0.00'
        };

        if (headerMap.cashBid !== undefined) {
          const m = texts[headerMap.cashBid].replace(/[$,]/g, '').match(/(\d+\.\d{2,4})/);
          if (m) bid.cashBid = parseFloat(m[1]).toFixed(2);
        } else {
          for (let i = 1; i < texts.length; i++) {
            const m = texts[i].replace(/[$,]/g, '').match(/^(\d+\.\d{2,4})$/);
            if (m && parseFloat(m[1]) > 2 && parseFloat(m[1]) < 20) {
              bid.cashBid = parseFloat(m[1]).toFixed(2);
              break;
            }
          }
        }

        if (headerMap.basis !== undefined) {
          const m = texts[headerMap.basis].match(/([+-]?\d+\.\d{2})/);
          if (m) bid.basis = m[1];
        }

        if (headerMap.change !== undefined) {
          const m = texts[headerMap.change].match(/([+-]?\d+\.\d{2,4})/);
          if (m) bid.change = parseFloat(m[1]).toFixed(2);
        }

        if (bid.cashBid) bids.push(bid);
      }
    }

    return bids;
  });
}

async function extractFromIframes(page) {
  const iframes = await page.$$('iframe');
  for (const iframe of iframes) {
    try {
      const frame = await iframe.contentFrame();
      if (!frame) continue;
      await frame.waitForTimeout(1500);
      const bids = await frame.evaluate(() => {
        const bids = [];
        const monthPattern = /\b(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\s*'?\d{0,2}\b/i;
        const tables = document.querySelectorAll('table');
        for (const table of tables) {
          const rows = table.querySelectorAll('tr');
          for (const row of rows) {
            const cells = row.querySelectorAll('td');
            if (cells.length < 3) continue;
            const texts = Array.from(cells).map(c => c.textContent.trim());
            if (!monthPattern.test(texts[0])) continue;
            let cashBid = null;
            for (let i = 1; i < texts.length; i++) {
              const m = texts[i].replace(/[$,]/g, '').match(/^(\d+\.\d{2,4})$/);
              if (m && parseFloat(m[1]) > 2 && parseFloat(m[1]) < 20) {
                cashBid = parseFloat(m[1]).toFixed(2);
                break;
              }
            }
            if (cashBid) {
              const basisMatch = texts.join(' ').match(/([+-]\d+\.\d{2})/);
              bids.push({
                delivery: texts[0].toUpperCase().replace(/'/g, ''),
                cashBid,
                basis: basisMatch ? basisMatch[1] : '--',
                change: '0.00'
              });
            }
          }
        }
        return bids;
      });
      if (bids.length > 0) return bids;
    } catch {}
  }
  return [];
}

module.exports = { scrape };

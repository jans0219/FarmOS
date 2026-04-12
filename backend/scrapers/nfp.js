/**
 * New Fashion Pork — Corn Bid Scraper
 * Source: https://www.nfpinc.com/corn-bids
 * Location: Estherville, IA
 *
 * README indicates this can be a "direct scrape" but the site
 * blocks non-browser user agents (403). Playwright ensures
 * we present a real browser fingerprint.
 */

const { chromium } = require('playwright');

const TARGET_URL = 'https://www.nfpinc.com/corn-bids';
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

    // Wait for any dynamic content to settle
    await page.waitForTimeout(2000);

    // Extract bid data
    const bids = await extractBids(page);

    if (bids.length === 0) {
      // Try waiting longer in case JS is still loading content
      await page.waitForTimeout(5000);
      const retryBids = await extractBids(page);

      if (retryBids.length === 0) {
        return {
          success: false,
          data: [],
          error: 'No bid data found in page HTML. Site structure may have changed.',
          timestamp: new Date().toISOString()
        };
      }

      return {
        success: true,
        data: retryBids,
        source: 'New Fashion Pork',
        location: 'Estherville, IA',
        timestamp: new Date().toISOString()
      };
    }

    return {
      success: true,
      data: bids,
      source: 'New Fashion Pork',
      location: 'Estherville, IA',
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

async function extractBids(page) {
  return await page.evaluate(() => {
    const bids = [];
    const monthPattern = /\b(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\s*'?\d{0,2}\b/i;

    // Find all tables
    const tables = document.querySelectorAll('table');
    for (const table of tables) {
      const rows = table.querySelectorAll('tr');

      // Identify column mapping from headers
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
          if (/futures/i.test(t)) headerMap.futures = i;
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

        // Cash bid
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

        // Basis
        if (headerMap.basis !== undefined) {
          const m = texts[headerMap.basis].match(/([+-]?\d+\.\d{2})/);
          if (m) bid.basis = m[1];
        } else {
          for (const t of texts) {
            const m = t.match(/([+-]\d+\.\d{2})/);
            if (m && Math.abs(parseFloat(m[1])) < 2) {
              bid.basis = m[1];
              break;
            }
          }
        }

        // Change
        if (headerMap.change !== undefined) {
          const m = texts[headerMap.change].match(/([+-]?\d+\.\d{2,4})/);
          if (m) bid.change = parseFloat(m[1]).toFixed(2);
        }

        if (bid.cashBid) bids.push(bid);
      }
    }

    // Fallback: scan for common embedded bid widget patterns
    if (bids.length === 0) {
      // Try Bushel-style widget
      const bidCards = document.querySelectorAll('[class*="commodity"], [class*="bid-row"], [class*="cashbid"]');
      for (const card of bidCards) {
        const text = card.textContent;
        const monthMatch = text.match(/\b(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\s*'?\d{0,2}\b/i);
        const priceMatch = text.match(/\$?(\d+\.\d{2,4})/);
        if (monthMatch && priceMatch) {
          const basisMatch = text.match(/([+-]\d+\.\d{2})/);
          bids.push({
            delivery: monthMatch[0].toUpperCase(),
            cashBid: parseFloat(priceMatch[1]).toFixed(2),
            basis: basisMatch ? basisMatch[1] : '--',
            change: '0.00'
          });
        }
      }
    }

    // Fallback: text scan
    if (bids.length === 0) {
      const allText = document.body.innerText;
      const lines = allText.split('\n');
      for (const line of lines) {
        const monthMatch = line.match(/\b(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\s*'?\d{0,2}\b/i);
        const priceMatch = line.match(/\$?(\d+\.\d{2,4})/);
        if (monthMatch && priceMatch) {
          const basisMatch = line.match(/([+-]\d+\.\d{2})/);
          bids.push({
            delivery: monthMatch[0].toUpperCase(),
            cashBid: parseFloat(priceMatch[1]).toFixed(2),
            basis: basisMatch ? basisMatch[1] : '--',
            change: '0.00'
          });
        }
      }
    }

    return bids;
  });
}

module.exports = { scrape };

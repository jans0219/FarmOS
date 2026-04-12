/**
 * Green Plains Renewable Energy — Corn Bid Scraper
 * Source: https://gpreinc.com/corn-bids/
 * Location: Superior, IA
 *
 * This site uses a dropdown to select the elevator location.
 * Playwright is required because the bid data loads dynamically
 * after the location is selected via JavaScript.
 */

const { chromium } = require('playwright');

const TARGET_URL = 'https://gpreinc.com/corn-bids/';
const LOCATION_KEYWORD = /superior/i;
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

    // Try to find and select "Superior" from a dropdown
    const selected = await selectLocation(page);
    if (selected) {
      // Wait for table to refresh after location change
      await page.waitForTimeout(3000);
    }

    // Extract bid data
    const bids = await extractBids(page);

    if (bids.length === 0) {
      return {
        success: false,
        data: [],
        error: 'No bid data found in page HTML. Site structure may have changed.',
        timestamp: new Date().toISOString()
      };
    }

    return {
      success: true,
      data: bids,
      source: 'Green Plains Renewable Energy',
      location: 'Superior, IA',
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
  // Strategy 1: Standard <select> dropdown
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

  // Strategy 2: Custom dropdown (button + list)
  const dropdownTriggers = await page.$$('[class*="dropdown"], [class*="select"], [role="listbox"], [class*="location"]');
  for (const trigger of dropdownTriggers) {
    await trigger.click();
    await page.waitForTimeout(500);
    const items = await page.$$('[class*="dropdown-item"], [class*="option"], [role="option"], li');
    for (const item of items) {
      const text = await item.textContent();
      if (LOCATION_KEYWORD.test(text)) {
        await item.click();
        return true;
      }
    }
  }

  // Strategy 3: Look for links/tabs with location names
  const links = await page.$$('a, button, [class*="tab"]');
  for (const link of links) {
    const text = await link.textContent();
    if (LOCATION_KEYWORD.test(text)) {
      await link.click();
      return true;
    }
  }

  return false;
}

async function extractBids(page) {
  return await page.evaluate(() => {
    const bids = [];
    const monthPattern = /\b(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\s*'?\d{0,2}\b/i;
    const pricePattern = /^\$?\d+\.\d{2,4}$/;

    // Find all tables on the page
    const tables = document.querySelectorAll('table');
    for (const table of tables) {
      const rows = table.querySelectorAll('tr');

      // Try to identify column headers
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

        // Check if this row contains a delivery month
        const deliveryIdx = headerMap.delivery ?? 0;
        if (!monthPattern.test(texts[deliveryIdx])) continue;

        const bid = {
          delivery: texts[deliveryIdx].toUpperCase().replace(/'/g, ''),
          cashBid: null,
          basis: '--',
          change: '0.00'
        };

        // Extract cash bid
        if (headerMap.cashBid !== undefined) {
          const priceText = texts[headerMap.cashBid].replace(/[$,]/g, '');
          const m = priceText.match(/(\d+\.\d{2,4})/);
          if (m) bid.cashBid = parseFloat(m[1]).toFixed(2);
        } else {
          // Scan cells for a price-like value
          for (let i = 1; i < texts.length; i++) {
            const cleaned = texts[i].replace(/[$,]/g, '');
            const m = cleaned.match(/^(\d+\.\d{2,4})$/);
            if (m && parseFloat(m[1]) > 2 && parseFloat(m[1]) < 20) {
              bid.cashBid = parseFloat(m[1]).toFixed(2);
              break;
            }
          }
        }

        // Extract basis
        if (headerMap.basis !== undefined) {
          const basisText = texts[headerMap.basis];
          const m = basisText.match(/([+-]?\d+\.\d{2})/);
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

        // Extract change
        if (headerMap.change !== undefined) {
          const changeText = texts[headerMap.change];
          const m = changeText.match(/([+-]?\d+\.\d{2,4})/);
          if (m) bid.change = parseFloat(m[1]).toFixed(2);
        }

        if (bid.cashBid) bids.push(bid);
      }
    }

    // Fallback: look for non-table bid structures (divs, lists)
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

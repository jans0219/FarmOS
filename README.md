# FarmOS — Janssen & Hoffman Farm Dashboard

A web-based farm operating system dashboard that integrates grain markets, live cameras, and weather data into a single interface. Built for remote access from any device.

---

## Project Status

| Phase | Scope | Status |
|-------|-------|--------|
| Phase 1 | Static mockup — layout, structure, visual design | ✅ Complete |
| Phase 2 | Live backend — grain scraping, weather API, deployment | 🔧 In Progress |
| Phase 3 | Camera streaming — RTSP relay via Raspberry Pi + Cloudflare Tunnel | 📋 Planned |

---

## Repository Structure

```
farm-os/
├── README.md
├── frontend/
│   └── index.html          # Main dashboard (single-file for now)
├── backend/
│   ├── server.js           # Node.js/Express backend (Phase 2)
│   ├── scrapers/
│   │   ├── green-plains.js # Green Plains corn bid scraper
│   │   └── nfp.js          # New Fashion Pork corn bid scraper
│   ├── weather/
│   │   └── open-meteo.js   # Weather API integration (Open-Meteo, free)
│   └── cache/
│       └── grain-cache.json # Local cache for grain prices
├── config/
│   └── cameras.json        # Camera configuration store
├── .env.example            # Environment variable template
└── package.json
```

---

## Features

### Home Page
- **Grain Markets** — Corn and soybean cash bids, basis, and change from open. Corn sources: Green Plains Renewable Energy (Superior, IA) and New Fashion Pork (Estherville, IA). Soybean source: CHS (Fairmont, MN). Prices refresh every 15–20 minutes via scraper.
- **Live Cameras** — 4-up view on home page, selectable from up to 16 configured cameras across multiple NVR locations. *(Phase 3)*
- **Weather** — Dunnell, MN (ZIP 56127). Today panel always visible; 3-day and 10-day forecast toggle. Growing Degree Units (base 50°F) since a user-selected start date (default April 10).

### Cameras Tab
- Configure up to 16 cameras with name, WAN IP:Port, NVR location, and channel
- Select which 4 cameras display on the home page and in which position
- Built to support Amcrest NV4108E-A2 NVRs (RTSP) and future Ubiquiti cameras

### Field Ops Tab
- Placeholder — planned for planting records, field maps, equipment logs

### Grain Ops Tab
- Placeholder — planned for bin inventory, load tracking, contracts, settlements

---

## Tech Stack

### Frontend
- Vanilla HTML, CSS, JavaScript (no framework required for Phase 1)
- Fonts: Barlow Condensed + Barlow + JetBrains Mono (Google Fonts)
- Color theme: white background, gray/black accents, orange (#e86c1a)

### Backend (Phase 2)
- **Runtime:** Node.js
- **Framework:** Express.js
- **Scraping:** Playwright (headless browser — handles dropdown-based sites like Green Plains)
- **Weather:** [Open-Meteo API](https://open-meteo.com/) — free, no API key required
- **Caching:** Local JSON file cache (updates every 20 minutes via cron)
- **Hosting:** Render.com free tier or Railway.app free tier

### Camera Infrastructure (Phase 3)
- **On-site (each NVR location):** Raspberry Pi running FFmpeg + Cloudflare Tunnel
- **Stream format:** RTSP → HLS transcoding via FFmpeg
- **Tunnel:** Cloudflare Tunnel (free tier) — no open ports, no static IP required
- **NVR RTSP URL format:** `rtsp://[user]:[pass]@[IP]:[port]/cam/realmonitor?channel=1&subtype=0`

---

## Grain Data Sources

| Elevator | Commodity | URL | Method |
|----------|-----------|-----|--------|
| Green Plains Renewable Energy | Corn | https://gpreinc.com/corn-bids/ | Playwright scrape (location dropdown) |
| New Fashion Pork | Corn | https://www.nfpinc.com/corn-bids | Direct scrape |
| Valero Ethanol (Welcome, MN) | Corn | https://portal.bushelpowered.com/valero/welcome | Phase 2 — Bushel 2FA session |
| CHS Inc. (Fairmont, MN) | Soybeans | CHS portal | Phase 2 — login-based scrape |

> **Note:** Scraping may break if source websites update their HTML structure. The backend should log scrape failures and display a "Data unavailable — last updated [timestamp]" message rather than showing stale data silently.

---

## Weather Data

- **Provider:** [Open-Meteo](https://open-meteo.com/) — free, no account required
- **Location:** Dunnell, MN — Latitude 43.5344, Longitude -94.7613
- **Fields fetched:** temperature (hi/lo/current), wind speed, wind direction, precipitation probability, precipitation amount, weather condition code, sunrise/sunset times
- **GDU formula:** `max(0, ((Tmax + Tmin) / 2) - 50)` accumulated daily since selected start date

---

## Environment Variables

Create a `.env` file based on `.env.example`:

```
PORT=3000
CACHE_INTERVAL_MINUTES=20
WEATHER_LAT=43.5344
WEATHER_LON=-94.7613
GDU_BASE_TEMP=50
```

---

## Deployment (Phase 2 Target)

### Option A — Render.com (Recommended, Free)
1. Push repo to GitHub
2. Connect repo to [render.com](https://render.com)
3. Set build command: `npm install`
4. Set start command: `node backend/server.js`
5. Add environment variables in Render dashboard
6. Auto-deploys on every push to `main`

### Option B — Railway.app (Free tier)
1. Push repo to GitHub
2. Connect at [railway.app](https://railway.app)
3. Railway auto-detects Node.js
4. Add environment variables
5. Deploy

---

## Camera Setup Guide (Phase 3)

Each NVR location requires:

1. **Raspberry Pi** (Pi 4 or Pi 5 recommended) connected to same network as NVR
2. Install FFmpeg: `sudo apt install ffmpeg`
3. Install Cloudflare Tunnel: `curl -L https://pkg.cloudflare.com/cloudflare-main.gpg | sudo tee /usr/share/keyrings/cloudflare-main.gpg`
4. Authenticate tunnel: `cloudflared tunnel login`
5. Create tunnel: `cloudflared tunnel create farm-location-1`
6. Configure FFmpeg to pull RTSP and serve HLS on local port
7. Tunnel exposes HLS endpoint to your dashboard via `https://[tunnel-name].cfargotunnel.com`

Supported camera systems:
- ✅ Amcrest NV4108E-A2 (RTSP confirmed)
- 📋 Ubiquiti (planned — different RTSP URL format, same relay architecture)

---

## Development Notes

- All placeholder/static data in `index.html` will be replaced by backend API calls in Phase 2
- The camera configuration tab saves to `config/cameras.json` via a POST endpoint
- The dashboard polls `/api/grain` and `/api/weather` endpoints on page load and every 20 minutes
- No user authentication is implemented yet — consider adding basic auth before exposing to the public internet

---

## Contributors

Janssen & Hoffman Farms  
Built with assistance from Claude (Anthropic)

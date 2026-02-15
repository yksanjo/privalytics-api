# Privalytics API

Headless analytics API with API key authentication.

## Features

- API key authentication
- Full analytics data endpoints
- Referrer tracking
- Device/browser breakdown
- Headless (no UI - API only)

## Installation

```bash
npm install
npm start
```

Server runs on http://localhost:3002

## Usage

1. Create a site:
   ```bash
   curl -X POST http://localhost:3002/api/sites \
     -H "Content-Type: application/json" \
     -d '{"name": "My Site", "domain": "example.com"}'
   ```

2. Use the returned API key for authenticated requests

3. Track pageviews:
   ```bash
   curl -X POST http://localhost:3002/api/track \
     -H "Content-Type: application/json" \
     -d '{"siteId": "SITE_ID", "path": "/"}'
   ```

## API Endpoints

- `POST /api/sites` - Create site (returns API key)
- `POST /api/track` - Track event
- `GET /api/stats` - Get stats (requires X-API-Key header)
- `GET /api/timeseries` - Time series data
- `GET /api/pages` - Top pages
- `GET /api/referrers` - Referrer data
- `GET /api/devices` - Device breakdown
- `GET /health` - Health check

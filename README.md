# VayuRahshak (वायुरक्षक)

**One platform for the crop-residue problem in India: the farmer who can stop burning, the authority who has to act, and the citizen who breathes the smoke.**

Every October farmers burn straw because the alternatives are unclear, officials cannot see which fires matter, and people downwind find out when the air turns bad. VayuRahshak puts all three on the same data. It was built for the WeMakeDevs x AWS hackathon (8 to 11 October 2026) and runs on AWS.

**Live project: [VayuRahshak](https://d1qht8bqoe1eyl.cloudfront.net)**

## The three sides

| Login | What it is for |
|---|---|
| **Farmer** (Kissan Sarthi) | The farmer's toolkit: farm, crops, crop doctor, stubble options, no-burn pledge, warnings from authorities |
| **Authority** | A control room: every fire, a smoke map, warn the person behind a fire, alert people downwind, track each case |
| **Citizen** | The air near home now and for 48 hours, whether smoke is coming, health advice, alerts |

They are connected: an authority warns a farmer, the warning appears on the farmer's Warnings page, the farmer taps "I have read this", and the fire's case turns *acknowledged* for the authority. Everything is in English and Hindi (authority screens in English). Logins are demo logins; Amazon Cognito sign-in is prepared but off.

## Kissan Sarthi (किसान सारथी): the farmer's side

| Tool | What the farmer gets |
|---|---|
| **My farm** | Registers the farm (place, land size, soil, irrigation). Sees fires and smoke within 25 km, and warnings from authorities with an "I have read this" button |
| **Crops** | 20 common Indian crops with sowing date, expected harvest and a care guide for the stage the crop is in, plus **Gemini** advice for that crop at its stage (tasks for the next two weeks, pests to watch, weather) |
| **Crop doctor** | Takes a photo and/or ticks what they see (yellow stripes, white powder, stem holes, spots, insects, wilting, pale leaves). **Google Gemini** looks at the photo and says what is likely wrong, with organic steps, standard label doses and the Kisan Call Centre number (1800-180-1551). Without the AI, a symptom guide gives the same kind of answer |
| **Stubble** | What burning their straw would release (PM2.5, CO, NO2, SO2, soot, CO2) and how toxic, plus five better options with cost, gain and support: Pusa bio-decomposer, Happy Seeder, bio-pellets, mushrooms, enriched fodder |
| **No-burn pledge** | Picks an option, takes the pledge and prints a certificate |

Kissan Sarthi:
* **Inside the platform:** the Farmer login of the main app, with the Gemini calls running in the same Lambda (`POST /farmer/diagnose` and `/farmer/crop-advice`, key kept as a hidden AWS parameter, rate-limited). It uses the platform's own pollution numbers, so the farmer's calculator and the authority's fire view agree. A farmer's farm, crops and pledges stay in their browser. Photos are shrunk on the phone, sent to Gemini only when the farmer presses "Ask the AI", and not kept.

## The fire and air engine (short version)

* **Fires:** NASA satellites (FIRMS, VIIRS) give every hot spot in India for the last 24 hours, about 3 hours behind the satellite.
* **What burned:** a predict from land cover (ESA WorldCover) and, around Delhi, Punjab and Haryana, mapped industry. Each label has a reason.
* **How toxic:** using machine learning: heat strength gives the amount burned, published emission factors (GFED4.1) give what is released, and we compare that with India's safe limits.
* **Smoke path:** Open-Meteo wind on a grid over India moves a point hour by hour, backwards and forwards. It gives direction and timing.
* **Air quality:** the Indian AQI is computed in code. Forecast: the CAMS model, 48 hours. Measured: OpenAQ stations, often 2 to 4 days old and marked as such.

## How it is built

```
Browser ──> CloudFront ──┬──> S3 (the web app)
                         └──> API Gateway ──> Lambda (Python 3.12) ──┬──> DynamoDB (alerts, cases)
EventBridge (every 30 min) ──> Lambda "warm" ──────────────────────┴──> S3 (shared cache)
```

AWS services: S3, CloudFront, API Gateway, Lambda, DynamoDB, EventBridge (Cognito and SNS optional, off). The scheduled refresh keeps fires, the wind grid and the air forecast in S3, so visitors get an answer in about 2 seconds instead of waiting about 25. The frontend is plain JavaScript with Leaflet and no build step; the backend uses only the Python standard library.

```
smoke-path/      the platform: src/ (backend), frontend/ (all three roles), scripts/, tests/, template.yaml
kissan-sarthi/   the standalone farmer app (Next.js, FastAPI, Gemini)
```

## Run it

You need Python 3.12 and free keys in `smoke-path/.env` (gitignored): `FIRMS_MAP_KEY` (firms.modaps.eosdis.nasa.gov/api/map_key), `OPENAQ_API_KEY` (explore.openaq.org/register) and `GEMINI_API_KEY` (aistudio.google.com, for the farmer's AI advice; optional).

```
cd smoke-path
python3.12 scripts/local_server.py --port 8765      # open http://127.0.0.1:8765/
python3.12 -m unittest discover -s tests            # tests, no network needed
```

Without `?api=` the page runs on saved samples (works offline). See `smoke-path/DEMO_SCRIPT.md` for a 3-minute walk-through.

## API

`GET /fires`, `/stations`, `/forecast`, `/air?lat&lon`, `/smoke`; `POST /alerts`, `GET /alerts?lat&lon` (add `&kind=farmer_warnings` for farmers), `POST /alerts/{id}/ack`, `GET /activity`, `GET /cases`, `PATCH /cases/{id}`. With sign-in off, the authority routes are open to anyone with the address: fine for a private demo, enable Cognito (`EnableAuth=true`) before public use.

## Data sources

NASA FIRMS (fires), Google Gemini (farmer's AI advice), Open-Meteo and the CAMS forecast by ECMWF (wind, air forecast; free tier, non-commercial), OpenAQ (stations), ESA WorldCover and OpenStreetMap (land cover, industry, places, shipped with the app), Esri (map tiles), GFED4.1 (emission factors), CPCB National Air Quality Index (method and colours). NASA FIRMS, OpenAQ and Gemini need free keys.

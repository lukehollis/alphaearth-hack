# AlphaEarth Embedding Viewer (Next.js + Leaflet + Google Earth Engine)

Interactive visualization of Google Earth Engine's AlphaEarth embeddings. This app:
- Renders RGB embedding layers for 2023 and 2024 near (-121.8036, 39.0372)
- Computes a dot-product similarity layer between years
- Uses Leaflet for map rendering, Earth Engine JS API for tiles

The visualization replicates this Earth Engine code:

```javascript
// Load collection.
var dataset = ee.ImageCollection('GOOGLE/SATELLITE_EMBEDDING/V1/ANNUAL');

// Point of interest.
var point = ee.Geometry.Point(-121.8036, 39.0372);

// Get embedding images for two years.
var image1 = dataset
      .filterDate('2023-01-01', '2024-01-01')
      .filterBounds(point)
      .first();

var image2 = dataset
      .filterDate('2024-01-01', '2025-01-01')
      .filterBounds(point)
      .first();

// Visualize three axes of the embedding space as an RGB.
var visParams = {min: -0.3, max: 0.3, bands: ['A01', 'A16', 'A09']};

Map.addLayer(image1, visParams, '2023 embeddings');
Map.addLayer(image2, visParams, '2024 embeddings');

// Calculate dot product as a measure of similarity between embedding vectors.
var dotProd = image1
    .multiply(image2)
    .reduce(ee.Reducer.sum());

Map.addLayer(
  dotProd,
  {min: 0, max: 1, palette: ['white', 'black']},
  'Similarity between years (brighter = less similar)'
);

Map.centerObject(point, 12);
Map.setOptions('SATELLITE');
```

## Prerequisites

You need:
- A Google Cloud project with the Earth Engine API enabled
- An Earth Engine account (access must be approved for your Google user)
- A Web OAuth 2.0 Client ID (Google Cloud Console) with authorized origins for local dev

## Setup

1) Create a Web OAuth 2.0 Client ID
- In Google Cloud Console, enable the "Earth Engine API"
- Create OAuth 2.0 credentials: Client type = "Web application"
- Authorized JavaScript origins (for local dev):
  - http://localhost:3000
  - http://127.0.0.1:3000
- Copy the Client ID

2) Configure environment variable
- Copy the example file and paste your Client ID:
  ```bash
  cp .env.local.example .env.local
  # edit .env.local
  # NEXT_PUBLIC_EE_CLIENT_ID=YOUR_GOOGLE_OAUTH_WEB_CLIENT_ID
  ```

3) Install dependencies
- This was done automatically by create-next-app, but if needed:
  ```bash
  npm install
  ```

4) Run the development server
```bash
npm run dev
```
Open http://localhost:3000 in your browser.

On first load, a Google OAuth popup will ask you to sign in and authorize. Make sure popups are allowed for localhost.

## What this app does

- Loads Leaflet and adds an Esri World Imagery basemap
- Loads the Earth Engine JS API in the browser and authenticates via OAuth
- Builds three EE tile layers:
  - 2023 embeddings RGB (bands A01, A16, A09; range -0.3..0.3)
  - 2024 embeddings RGB (same vis)
  - Similarity layer via dot product (0..1; white..black)
- Adds a layer control to toggle visibility

## Code structure

- `components/EEMap.js` (client component)
  - Dynamically imports Leaflet (client-only)
  - Loads `https://apis.google.com/js/api.js` and `https://www.gstatic.com/earthengine/ee_api_js.js`
  - Performs `ee.data.authenticateViaOauth` with `NEXT_PUBLIC_EE_CLIENT_ID`
  - Queries `GOOGLE/SATELLITE_EMBEDDING/V1/ANNUAL`
  - Creates map tiles via `image.getMap(visParams)` and overlays them in Leaflet
- `app/layout.js`
  - Injects Leaflet CSS into the document head
- `app/page.js`
  - Dynamically imports the map component with `ssr: false` to ensure it runs only in the browser

## Troubleshooting

- Popup blocked: Allow popups for localhost:3000
- 401 / auth errors: Ensure your Earth Engine account is approved and the Earth Engine API is enabled. Confirm `NEXT_PUBLIC_EE_CLIENT_ID` matches a Web OAuth Client with `http://localhost:3000` as an authorized origin
- Stuck in auth: Clear site data for localhost, then reload
- Nothing renders / blank tiles: Open the browser console to inspect any EE errors. Verify your network can reach `earthengine.googleapis.com`
- Corporate networks may block some Google endpoints or popups; try a different network if needed

## Deployment

- Add your production origin to the OAuth client's Authorized JavaScript origins (e.g., your Vercel domain)
- Set `NEXT_PUBLIC_EE_CLIENT_ID` in your hosting env
- This app is client-only for mapping logic (no SSR required)

## License

MIT

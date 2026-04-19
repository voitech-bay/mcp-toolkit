# World map GeoJSON

The "Geo insights" analytics tab (`ConversationsGeoInsights.vue`) renders a
choropleth world map using ECharts. ECharts v6 no longer ships built-in map
data, so you must drop a compatible GeoJSON file here:

- Path (relative to frontend public): `public/maps/world.json`
- Expected properties: every feature must have `properties.name` matching the
  canonical English country name used by the backend aggregator in
  `src/services/project-conversation-geo.ts` (e.g. `"United States"`,
  `"United Kingdom"`, `"Russia"`, `"Czech Rep."`, `"Bosnia and Herz."`).

## Where to get a compatible file

1. **Natural Earth 1:110m admin 0 countries** (recommended, ~200 KB):
   https://github.com/nvkelso/natural-earth-vector/blob/master/geojson/ne_110m_admin_0_countries.geojson

   Rename to `world.json`. It already uses `NAME` / `ADMIN` properties, so
   either (a) run a quick transform so `properties.name = properties.NAME`
   before dropping it here, or (b) adjust the component to read `feature.properties.NAME`.

2. **ECharts example world.json** (used in the official ECharts gallery):
   Fetch from a local ECharts docs clone or the
   `world.json` mirrored in various community repos.

When the file is missing, the component gracefully falls back to the horizontal
bar chart and the country table, and shows an info alert explaining how to
enable the map.

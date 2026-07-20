# Maps: trip routes, route planner, group rides (Apple MapKit JS)

Three map features share the MapKit JS foundation (key setup below):

- **Trip routes** — recorded drives drawn on the map (this doc's main body).
- **Route planner** (`/map` → Rota) — destination search + route line +
  distance/ETA, fully client-side via `mapkit.Search`/`mapkit.Directions`
  (no backend, covered by the same token).
- **Group rides** (`/map` → Birlikte sür) — create a ride, share the 6-char
  code, members see each other live. REST: `/api/ride-groups` (create /
  join / leave / active); live positions go over a WebSocket
  (`/api/ride-ws`, one-time ticket auth from `GET /api/ride-groups/ws-ticket`).
  Positions are **relayed in-memory only, never persisted** — the only
  stored data is group membership (migration 019). Owner leaving ends the
  ride for everyone; groups expire after 24 h.


Trips recorded with tracking on now keep their **route**: the client thins the
GPS trace as it drives (≥30 m between kept points), Douglas-Peucker-simplifies
at trip end (20 m tolerance, ≤1000 points), and stores it as an encoded
polyline (`trip.route`, migration 018). Older trips have no route and simply
don't get a map. Routes are user data: deleted with the trip and with the
account.

- List responses only carry `hasRoute`; `GET /api/trips/:id` returns the
  polyline. Tapping a trip row expands an inline Apple map.
- Codec + simplifier: `apps/web/src/lib/polyline.ts` (Google polyline
  algorithm — treat the encoding as frozen).
- Map auth: the web never sees the key. `GET /api/mapkit-token` (signed-in
  users only) mints a 30-minute ES256 JWT; MapKit JS calls it via the loader in
  `apps/web/src/lib/mapkit.ts`. `/api/public-config` reports `mapkit: true`
  once configured, which is what makes the UI show maps at all.

## Setup (one-time, developer portal)

1. [Keys](https://developer.apple.com/account/resources/authkeys/list) → ⊕ →
   name it, tick **MapKit JS** → Register → download the `.p8`, note the Key ID.
2. `.env`:

```
MAPKIT_KEY=<.p8 contents — PEM or base64>
MAPKIT_KEY_ID=<key id>
# MAPKIT_TEAM_ID defaults to APNS_TEAM_ID — set only if different.
```

3. Redeploy the api. No app rebuild needed — the wrapper loads the live web.

Free tier: 250,000 map loads/day with the developer account — far beyond this
app's needs.

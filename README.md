# Trip Plan Worker

A Cloudflare Worker that exposes selected Google Maps Platform capabilities as authenticated application-owned tools for a travel-planning agent.

## Included

- One Cloudflare Worker; no Durable Objects or database required.
- Seven tools: `search_places`, `search_nearby_places`, `search_restaurants`, `get_place_details`, `get_route`, `get_route_matrix`, and `geocode_location`.
- Responses-style OpenAI function schemas at `GET /openai/tools`.
- Managed OpenAI Agents API session gateway with streamed first turns, follow-up messages, and automatic Google function dispatch.
- Authenticated execution endpoint at `POST /tools/execute`.
- Google Places API (New), Routes API and Geocoding API adapters.
- Field masks, basic input validation, consistent JSON errors and secret-based credentials.

## Requirements

- Node.js 20+
- A Cloudflare account and Wrangler
- A Google Cloud project with billing enabled and the Places API (New), Routes API and Geocoding API enabled
- A Google Maps Platform API key restricted to the APIs this Worker needs

## Setup

```bash
npm install
npx wrangler login
npx wrangler secret put GOOGLE_MAPS_API_KEY
npx wrangler secret put APP_API_TOKEN
npx wrangler secret put OPENAI_API_KEY
npm run dev
```

Use a long, random `APP_API_TOKEN`. Keep both secrets server-side; never embed them in the iOS app or expose them to the model.

Deploy:

```bash
npm run typecheck
npm run deploy
```

Set `ALLOWED_ORIGIN` in `wrangler.toml` to your application backend origin if browser-based calls are needed. Prefer calling this Worker from your authenticated application backend rather than directly from a mobile client.

## HTTP API

All endpoints except `GET /health` require:

```http
Authorization: Bearer <APP_API_TOKEN>
```

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Health check |
| GET | `/openai/tools` | OpenAI function tool definitions |
| GET | `/tools` | Available tool names |
| POST | `/tools/execute` | Execute one tool |
| POST | `/agent/sessions` | Create managed Agent session and stream first turn |
| POST | `/agent/sessions/{session_id}/messages` | Continue a managed session |
| GET | `/agent/sessions/{session_id}` | Retrieve managed session state |
| GET | `/agent/sessions/{session_id}/events` | Reconnect to session events |
| GET | `/agent/sessions/{session_id}` | Retrieve session state |

Example:

```bash
curl -X POST "$WORKER_URL/tools/execute" \
  -H "Authorization: Bearer $APP_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "search_places",
    "arguments": {
      "query": "museums in Kyoto",
      "location": null,
      "radius_meters": null,
      "limit": 10,
      "language_code": "en",
      "region_code": "JP",
      "included_type": "museum",
      "open_now": null
    }
  }'
```

See [OpenAI Agents API integration](docs/agents-api-integration.md) for managed sessions and automatic function-call execution, and [legacy tool integration](docs/openai-integration.md) for direct dispatcher use, and [Apple MapKit boundary](docs/apple-mapkit-boundary.md) for provider display restrictions.

## Important Google Maps Platform terms

Google Maps Content is subject to Google's current service-specific terms, attribution, caching and display restrictions. In particular, do not render Google Places/Geocoding content or Google Routes geometry on Apple MapKit. Use Apple MapKit/Apple Maps data for the native itinerary map, or use Google Maps for Google Maps Content. Review the applicable terms for your account and region before production launch.

This project intentionally does not persist Google Maps Content. Place IDs and user-authored itinerary data should be handled separately and only in ways permitted by the applicable terms.

## Current scope / limitations

- `search_restaurants` applies rating, review-count and price filtering after the Places text search response. These are application-side filters, not all native Google search filters.
- Restaurant quality scoring is not implemented; Google ratings are signals, not a guarantee of quality.
- `get_route` and `get_route_matrix` return Google Routes data. Do not use their geometry or route content as Apple MapKit overlays.
- The Worker can create and continue managed OpenAI Agent sessions, stream events, and dispatch pending Google function calls. Store session IDs in your application data store and scope them to the authenticated user.
- No Durable Objects are included. Add them only if you later need per-trip coordination, WebSockets, or shared concurrent state.

# Google Maps MCP Server

This Worker exposes the Google Maps tools as a stateless Streamable HTTP MCP server at:

\`https://<your-worker>.workers.dev/mcp\`

Implementation uses Cloudflare's \`createMcpHandler\` and the MCP SDK v2 server package. It is stateless and does not require a Durable Object or MCP session storage.

## Authentication

The endpoint currently requires:

\`\`\`http
Authorization: Bearer <APP_API_TOKEN>
\`\`\`

Configure \`APP_API_TOKEN\` as a Cloudflare Worker Secret. When connecting from OpenAI Agents API, provide the authorization value as an MCP transport credential (prefer a Vault credential for reusable credentials; alternatively supply it per session). Never put this token in the iOS app or agent instructions.

This is currently a single shared service credential. Before exposing MCP access to end users directly, add OAuth or a trusted authenticated gateway that validates the user's Supabase JWT and applies per-user authorization and quotas.

## Tools

| Tool | Purpose |
|---|---|
| \`search_places\` | Text search for attractions, landmarks, shopping and POIs |
| \`search_nearby_places\` | Nearby search by coordinates and place types |
| \`search_restaurants\` | Restaurant discovery with optional rating, review-count and price filters |
| \`get_place_details\` | Place details by Google Place ID |
| \`get_route\` | Google Routes route calculation |
| \`get_route_matrix\` | Multi-origin/destination route matrix |
| \`geocode_location\` | Forward and reverse geocoding |

## OpenAI Agents API connection

Add an MCP server to the saved Agent's tools:

\`\`\`json
{
  "type": "mcp",
  "server_label": "google_maps",
  "transport": {
    "type": "http",
    "server_url": "https://<your-worker>.workers.dev/mcp"
  },
  "connection_origin": "service",
  "required": true,
  "allowed_tools": [
    "search_places",
    "search_nearby_places",
    "search_restaurants",
    "get_place_details",
    "get_route",
    "get_route_matrix",
    "geocode_location"
  ]
}
\`\`\`

Supply \`Authorization: Bearer <APP_API_TOKEN>\` via the MCP transport's \`authorization\` property or a matching OpenAI Vault credential. Avoid hardcoding secrets in reusable Agent instructions or source control.

Example with per-session transport authorization:

\`\`\`json
{
  "type": "mcp",
  "server_label": "google_maps",
  "transport": {
    "type": "http",
    "server_url": "https://<your-worker>.workers.dev/mcp",
    "authorization": "Bearer <APP_API_TOKEN>"
  },
  "connection_origin": "service",
  "required": true
}
\`\`\`

## Test

Use MCP Inspector:

\`\`\`bash
npx @modelcontextprotocol/inspector@latest
\`\`\`

Connect to the Worker URL and set the Authorization header to the bearer token. Run List Tools and verify the seven tools appear. Then call \`search_places\` with a small limit.

The MCP endpoint is JSON-RPC, not a browser page; opening the URL directly in a browser is not a valid test.

## Important Google Maps terms

Google Places, Geocoding and Routes content is subject to Google's service-specific terms. Do not render Google Maps Content as annotations or route overlays on Apple MapKit. Use Apple Maps/MapKit data or another provider whose licence explicitly allows the intended display.

## Ticket API

The ticket API has not yet been added because its endpoint definitions, authentication scheme, request/response examples and booking/availability semantics have not been supplied. Once these are available, add ticket-specific tools to this MCP server (or a separate MCP endpoint if you need independent auth, scaling or release cycles).

# Trip Plan MCP Server

This Worker exposes two provider groups through one stateless Streamable HTTP MCP endpoint:

\`https://<your-worker>.workers.dev/mcp\`

- Google Maps Platform: Places, Routes and Geocoding.
- DidaTicket distribution sandbox: destinations, ticket catalogue, product details, SKU calendars, package requirements and live availability checks.

The implementation uses Cloudflare's \`createMcpHandler\` and MCP SDK v2. It is stateless and does not require a Durable Object or MCP session storage.

## Runtime configuration

Worker variables:

- \`DIDA_API_BASE_URL\`: defaults to the rollinggo test sandbox base URL in \`wrangler.toml\`.
- \`DIDA_ACCEPT_LANGUAGE\`: defaults to \`en\`.

Worker secrets:

\`\`\`bash
npx wrangler secret put APP_API_TOKEN
npx wrangler secret put GOOGLE_MAPS_API_KEY
npx wrangler secret put DIDA_API_TOKEN
\`\`\`

The DidaTicket credential is a sandbox credential. Keep it in Cloudflare Secrets; never commit it to GitHub, include it in Agent instructions, or ship it in the iOS app. The sandbox endpoint and credential are not production credentials. Replace the base URL and credential when production access is issued.

DidaTicket uses \`Authorization: Bearer <DIDA_API_TOKEN>\` and recommends \`Accept-Language: en\` or \`zh-CN\`.

## Authentication to this MCP server

The MCP endpoint currently requires:

\`\`\`http
Authorization: Bearer <APP_API_TOKEN>
\`\`\`

When connecting from OpenAI Agents API, supply this value as the MCP transport authorization or a matching OpenAI Vault credential. Prefer Vault for reusable credentials.

This is a shared service credential for server-to-server access. It is not per-user authentication. Before exposing the MCP endpoint directly to end users, add OAuth or an authenticated gateway that validates Supabase JWTs and applies per-user authorization and quotas.

## Tools

### Google Maps (7 tools)

| Tool | Purpose |
|---|---|
| \`search_places\` | Text search for attractions, landmarks, shopping and POIs |
| \`search_nearby_places\` | Nearby search by coordinates and place types |
| \`search_restaurants\` | Restaurant discovery with optional rating, review-count and price filters |
| \`get_place_details\` | Place details by Google Place ID |
| \`get_route\` | Google Routes route calculation |
| \`get_route_matrix\` | Multi-origin/destination route matrix |
| \`geocode_location\` | Forward and reverse geocoding |

### DidaTicket (10 tools)

| Tool | Purpose |
|---|---|
| \`ticket_list_countries\` | List countries supported by the ticket channel |
| \`ticket_list_cities\` | List destinations, optionally filtered by country |
| \`ticket_list_categories\` | List product categories and subcategories |
| \`ticket_search_products\` | Search the ticket catalogue by keyword, destination, country or category |
| \`ticket_get_product_details\` | Get product, package, SKU, age, contact and cancellation details |
| \`ticket_get_sku_calendar\` | Get date-specific selling prices, inventory and cutoff times |
| \`ticket_get_package_extra_info\` | Get package booking requirements |
| \`ticket_check_availability\` | Live availability and quote check before order creation |

## Recommended ticket discovery flow

1. Use \`ticket_list_countries\`, \`ticket_list_cities\` and \`ticket_list_categories\` when the user has not provided catalogue codes.
2. Use \`ticket_search_products\` to discover candidate attractions and tickets.
3. Use \`ticket_get_product_details\` to inspect packages, SKUs, age/party limits, cancellation rules and required contact fields.
4. Use \`ticket_get_sku_calendar\` for date-specific selling price, inventory and cutoff time. Product-list \`price\` is only a starting/indicative price, not a confirmed date-specific offer.
5. Use \`ticket_get_package_extra_info\` for package-specific requirements.
6. Use \`ticket_check_availability\` immediately before order validation or booking to obtain a live availability and price result.

Important API rules:

- Ticket API dates use destination-local \`yyyy-MM-dd HH:mm:ss\`, not date-only values.
- SKU calendar accepts 1–20 unique Dida SKU codes and a range no longer than 90 days.
- Package extra-info accepts 1–50 unique package codes.
- Availability-check expects a JSON array of package lines directly, not an object wrapping that array.
- Ticket API price and inventory are time-sensitive. Recheck availability before any future order action.

## Deliberately not exposed yet

This first MCP release does **not** expose order creation, payment/fulfilment, cancellation, order listing, or account balance tools. Those actions can create financial or booking side effects. Add them in a separate booking phase with explicit user confirmation, idempotency keys, order ownership checks and clear payment/credit safeguards.

## OpenAI Agents API connection

Add an MCP server to the saved Agent:

\`\`\`json
{
  "type": "mcp",
  "server_label": "trip_plan_supply",
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
    "geocode_location",
    "ticket_list_countries",
    "ticket_list_cities",
    "ticket_list_categories",
    "ticket_search_products",
    "ticket_get_product_details",
    "ticket_get_sku_calendar",
    "ticket_get_package_extra_info",
    "ticket_check_availability"
  ]
}
\`\`\`

Supply \`Authorization: Bearer <APP_API_TOKEN>\` through the MCP transport's \`authorization\` property or a matching OpenAI Vault credential. Do not put the token in Agent instructions.

## Test

Use MCP Inspector:

\`\`\`bash
npx @modelcontextprotocol/inspector@latest
\`\`\`

Connect to the Worker URL and set the Authorization header. Run List Tools and verify all 17 tools appear. Test `ticket_health_check` and `ticket_search_products` with a small page size. Test a read-only tool first, such as \`ticket_search_products\` with a small page size.

The \`/mcp\` endpoint speaks MCP JSON-RPC; opening it directly in a browser is not a valid test.

## Google Maps display boundary

Google Places, Geocoding and Routes content is subject to Google's service-specific terms. Do not render Google Maps Content as annotations or route overlays on Apple MapKit. Use Apple Maps/MapKit data or another provider whose licence explicitly allows the intended display.

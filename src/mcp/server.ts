import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { Env } from "../types";
import { executeTool } from "../tools/dispatcher";

const coordinate = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});

const nullableCoordinate = coordinate.nullable().optional();

function asMcpError(error: unknown) {
  const message = error instanceof Error ? error.message : "Tool execution failed";
  return {
    content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }],
    isError: true,
  };
}

function registerTool(
  server: McpServer,
  env: Env,
  name: string,
  description: string,
  inputSchema: any,
) {
  server.registerTool(
    name,
    { description, inputSchema },
    async (args: any) => {
      try {
        const result = await executeTool(name, args, env);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result) }],
        };
      } catch (error) {
        return asMcpError(error);
      }
    },
  );
}

export function createTripPlanMcpServer(env: Env) {
  const server = new McpServer({
    name: "trip-plan-supply",
    version: "1.0.0",
  });

  registerTool(
    server,
    env,
    "search_places",
    "Search Google Places for attractions, landmarks, shopping areas and other points of interest. Google Maps Content must not be rendered as markers or overlays on Apple MapKit.",
    {
      query: z.string().min(1).max(300).describe("Natural-language place search query, including city or area."),
      location: nullableCoordinate.describe("Optional location bias. Do not use Google-returned coordinates as Apple MapKit annotations."),
      radius_meters: z.number().int().min(100).max(50000).nullable().optional(),
      limit: z.number().int().min(1).max(20).default(10),
      language_code: z.string().optional(),
      region_code: z.string().optional(),
      included_type: z.string().optional(),
      open_now: z.boolean().optional(),
    },
  );

  registerTool(
    server,
    env,
    "search_nearby_places",
    "Search nearby Google Places by one or more place types and a radius. Google Maps Content must not be overlaid on Apple MapKit.",
    {
      location: coordinate.describe("Search centre latitude and longitude."),
      included_types: z.array(z.string().min(1)).min(1).max(10).describe("Google Places types, such as tourist_attraction, museum, restaurant, cafe or park."),
      radius_meters: z.number().min(100).max(50000).default(3000),
      limit: z.number().int().min(1).max(20).default(20),
      language_code: z.string().optional(),
    },
  );

  registerTool(
    server,
    env,
    "search_restaurants",
    "Search restaurants by area and cuisine, with optional application-side rating, review-count and price-level filters. Google rating is a signal, not a guarantee of quality.",
    {
      area: z.string().min(1).max(200).describe("City, neighbourhood or area, e.g. Shinjuku, Tokyo."),
      cuisine: z.string().nullable().optional().describe("Cuisine, e.g. sushi, ramen, Japanese, Italian."),
      location: nullableCoordinate,
      radius_meters: z.number().int().min(100).max(50000).nullable().optional(),
      min_rating: z.number().min(0).max(5).nullable().optional(),
      min_rating_count: z.number().int().min(0).nullable().optional(),
      price_levels: z.array(z.enum([
        "PRICE_LEVEL_FREE",
        "PRICE_LEVEL_INEXPENSIVE",
        "PRICE_LEVEL_MODERATE",
        "PRICE_LEVEL_EXPENSIVE",
        "PRICE_LEVEL_VERY_EXPENSIVE",
      ])).nullable().optional(),
      open_now: z.boolean().nullable().optional(),
      limit: z.number().int().min(1).max(20).default(10),
      language_code: z.string().optional(),
    },
  );

  registerTool(
    server,
    env,
    "get_place_details",
    "Retrieve selected Google Place details using a Google Place ID. Do not use returned Google Maps Content as Apple MapKit annotations.",
    {
      place_id: z.string().min(1).max(200),
      language_code: z.string().optional(),
    },
  );

  registerTool(
    server,
    env,
    "get_route",
    "Calculate a route using Google Routes API. Google route geometry must not be drawn over Apple MapKit.",
    {
      origin: z.string().min(1),
      destination: z.string().min(1),
      travel_mode: z.enum(["DRIVE", "BICYCLE", "WALK", "TWO_WHEELER", "TRANSIT"]),
      departure_time: z.string().nullable().optional(),
      routing_preference: z.enum(["TRAFFIC_UNAWARE", "TRAFFIC_AWARE", "TRAFFIC_AWARE_OPTIMAL"]).nullable().optional(),
      alternatives: z.boolean().default(false),
      language_code: z.string().default("en"),
    },
  );

  registerTool(
    server,
    env,
    "get_route_matrix",
    "Calculate a Google Routes distance/time matrix for comparing itinerary stop order. Do not render Google route geometry on Apple MapKit.",
    {
      origins: z.array(z.string().min(1)).min(1).max(10),
      destinations: z.array(z.string().min(1)).min(1).max(10),
      travel_mode: z.enum(["DRIVE", "BICYCLE", "WALK", "TWO_WHEELER", "TRANSIT"]),
      departure_time: z.string().nullable().optional(),
    },
  );

  registerTool(
    server,
    env,
    "geocode_location",
    "Convert an address to coordinates or coordinates to an address using Google Geocoding. Google geocoding content must not be used as Apple MapKit map content.",
    {
      address: z.string().nullable().optional(),
      latitude: z.number().min(-90).max(90).nullable().optional(),
      longitude: z.number().min(-180).max(180).nullable().optional(),
      language_code: z.string().optional(),
    },
  );

  registerTool(
    server,
    env,
    "ticket_list_countries",
    "List countries available in the DidaTicket rollinggo distribution catalogue. Use the returned country_code when filtering cities or ticket products.",
    {},
  );

  registerTool(
    server,
    env,
    "ticket_list_cities",
    "List ticket destinations/cities available to the channel, optionally filtered by country codes returned by ticket_list_countries.",
    {
      country_codes: z.array(z.string().min(1)).max(50).optional(),
      language: z.enum(["en", "zh-CN"]).optional(),
    },
  );

  registerTool(
    server,
    env,
    "ticket_list_categories",
    "List ticket product categories and subcategories available to the channel. Use category codes when searching ticket products.",
    {},
  );

  registerTool(
    server,
    env,
    "ticket_search_products",
    "Search the DidaTicket product catalogue by keyword, destination, country, category or exact product code. Returns product-level summary and starting price; use ticket_get_product_details and ticket_get_sku_calendar for package, SKU, date-specific prices and inventory.",
    {
      keyword: z.string().max(200).optional(),
      product_code: z.string().max(100).optional(),
      city_codes: z.array(z.string().min(1)).max(50).optional(),
      country_codes: z.array(z.string().min(1)).max(50).optional(),
      category_codes: z.array(z.string().min(1)).max(50).optional(),
      page: z.number().int().min(1).default(1),
      limit: z.number().int().min(1).max(50).default(20),
      language: z.enum(["en", "zh-CN"]).optional(),
    },
  );

  registerTool(
    server,
    env,
    "ticket_get_product_details",
    "Get a ticket product's description, packages, SKU codes, ticket types, age and party rules, cancellation rules and required contact fields. Product-level price is only indicative; use ticket_get_sku_calendar for date-specific price and inventory.",
    {
      product_code: z.string().min(1).max(100),
      catalog_changes: z.boolean().optional(),
      changed_since: z.string().optional(),
      changed_until: z.string().optional(),
      language: z.enum(["en", "zh-CN"]).optional(),
    },
  );

  registerTool(
    server,
    env,
    "ticket_get_sku_calendar",
    "Get date-specific selling prices, inventory and cutoff times for 1 to 20 Dida SKU codes over a destination-local date range no longer than 90 days. Use SKU codes from ticket_get_product_details. Dates must be yyyy-MM-dd HH:mm:ss.",
    {
      sku_codes: z.array(z.string().min(1)).min(1).max(20),
      start_date: z.string().regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/),
      end_date: z.string().regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/),
      language: z.enum(["en", "zh-CN"]).default("en"),
    },
  );

  registerTool(
    server,
    env,
    "ticket_get_package_extra_info",
    "Get package-specific booking requirements and additional information before checking availability or validating an order. Use package codes from ticket_get_product_details.",
    {
      package_codes: z.array(z.string().min(1)).min(1).max(50),
      language: z.enum(["en", "zh-CN"]).default("en"),
    },
  );

  registerTool(
    server,
    env,
    "ticket_check_availability",
    "Perform a live ticket availability and price check before any order is created. The package_lines array must include package_code, destination-local start_time (yyyy-MM-dd HH:mm:ss), and sku_list with sku_code and count. This tool does not create or pay for an order.",
    {
      package_lines: z.array(z.object({
        package_code: z.string().min(1),
        start_time: z.string().regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/),
        sku_list: z.array(z.object({
          sku_code: z.string().min(1),
          count: z.number().int().min(1),
          price: z.string().optional(),
        })).min(1),
      })).min(1).max(20),
      language: z.enum(["en", "zh-CN"]).default("en"),
    },
  );

  return server;
}

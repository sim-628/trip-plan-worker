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
  inputSchema: Record<string, z.ZodType>,
) {
  server.registerTool(
    name,
    { description, inputSchema },
    async (args: Record<string, unknown>) => {
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

export function createGoogleMapsMcpServer(env: Env) {
  const server = new McpServer({
    name: "trip-plan-google-maps",
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

  return server;
}

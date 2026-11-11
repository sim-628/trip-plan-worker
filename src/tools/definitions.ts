export const OPENAI_TOOLS = [
  {
    type: "function",
    name: "search_places",
    description: "Search Google Places for attractions, landmarks, shopping areas and other points of interest. Results are Google Maps Content and must not be rendered as markers or overlays on Apple MapKit.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        query: { type: "string" },
        location: { type: ["object", "null"], properties: {
          latitude: { type: "number" }, longitude: { type: "number" }
        }, required: ["latitude", "longitude"], additionalProperties: false },
        radius_meters: { type: ["integer", "null"], minimum: 100, maximum: 50000 },
        limit: { type: "integer", minimum: 1, maximum: 20 },
        language_code: { type: ["string", "null"] },
        region_code: { type: ["string", "null"] },
        included_type: { type: ["string", "null"] },
        open_now: { type: ["boolean", "null"] }
      },
      required: ["query", "location", "radius_meters", "limit", "language_code", "region_code", "included_type", "open_now"],
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: "search_nearby_places",
    description: "Search nearby Google Places by included place types and radius. Google Maps Content must not be overlaid on Apple MapKit.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        location: { type: "object", properties: { latitude: { type: "number" }, longitude: { type: "number" } }, required: ["latitude", "longitude"], additionalProperties: false },
        included_types: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 10 },
        radius_meters: { type: "number", minimum: 100, maximum: 50000 },
        limit: { type: "integer", minimum: 1, maximum: 20 },
        language_code: { type: ["string", "null"] }
      },
      required: ["location", "included_types", "radius_meters", "limit", "language_code"],
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: "search_restaurants",
    description: "Find restaurants with optional cuisine, area, rating, review-count and price filters. Rating/count filtering is applied by this service after Google search; it is not a Google-native filter.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        area: { type: "string" },
        cuisine: { type: ["string", "null"] },
        location: { type: ["object", "null"], properties: { latitude: { type: "number" }, longitude: { type: "number" } }, required: ["latitude", "longitude"], additionalProperties: false },
        radius_meters: { type: ["integer", "null"], minimum: 100, maximum: 50000 },
        min_rating: { type: ["number", "null"], minimum: 0, maximum: 5 },
        min_rating_count: { type: ["integer", "null"], minimum: 0 },
        price_levels: { type: ["array", "null"], items: { type: "string", enum: ["PRICE_LEVEL_FREE", "PRICE_LEVEL_INEXPENSIVE", "PRICE_LEVEL_MODERATE", "PRICE_LEVEL_EXPENSIVE", "PRICE_LEVEL_VERY_EXPENSIVE"] } },
        open_now: { type: ["boolean", "null"] },
        limit: { type: "integer", minimum: 1, maximum: 20 },
        language_code: { type: ["string", "null"] }
      },
      required: ["area", "cuisine", "location", "radius_meters", "min_rating", "min_rating_count", "price_levels", "open_now", "limit", "language_code"],
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: "get_place_details",
    description: "Retrieve selected Google Place details by Google Place ID. Do not use its Google Maps Content to annotate Apple MapKit.",
    strict: true,
    parameters: { type: "object", properties: { place_id: { type: "string" }, language_code: { type: ["string", "null"] } }, required: ["place_id", "language_code"], additionalProperties: false }
  },
  {
    type: "function",
    name: "get_route",
    description: "Calculate a Google route. Google Routes content and polylines must not be drawn on Apple MapKit. Use only in a Google Maps context or return permitted textual route information separately.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        origin: { type: "string" },
        destination: { type: "string" },
        travel_mode: { type: "string", enum: ["DRIVE", "BICYCLE", "WALK", "TWO_WHEELER", "TRANSIT"] },
        departure_time: { type: ["string", "null"] },
        routing_preference: { type: ["string", "null"], enum: ["TRAFFIC_UNAWARE", "TRAFFIC_AWARE", "TRAFFIC_AWARE_OPTIMAL", null] },
        alternatives: { type: "boolean" },
        language_code: { type: "string" }
      },
      required: ["origin", "destination", "travel_mode", "departure_time", "routing_preference", "alternatives", "language_code"],
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: "get_route_matrix",
    description: "Calculate a Google route matrix for itinerary ordering. Do not transfer Google route content or polylines to Apple MapKit.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        origins: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 10 },
        destinations: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 10 },
        travel_mode: { type: "string", enum: ["DRIVE", "BICYCLE", "WALK", "TWO_WHEELER", "TRANSIT"] },
        departure_time: { type: ["string", "null"] }
      },
      required: ["origins", "destinations", "travel_mode", "departure_time"],
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: "geocode_location",
    description: "Geocode an address or reverse-geocode coordinates. Google Geocoding content must not be used as Apple MapKit map content.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        address: { type: ["string", "null"] },
        latitude: { type: ["number", "null"] },
        longitude: { type: ["number", "null"] },
        language_code: { type: ["string", "null"] }
      },
      required: ["address", "latitude", "longitude", "language_code"],
      additionalProperties: false
    }
  }
] as const;

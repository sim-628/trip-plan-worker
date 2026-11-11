import { Env, HttpError } from "../types";
import { searchText, searchNearby, searchRestaurants, getPlaceDetails } from "../google/places";
import { getRoute, getRouteMatrix } from "../google/routes";
import { geocodeLocation } from "../google/geocoding";

export const TOOL_NAMES = [
  "search_places", "search_nearby_places", "search_restaurants",
  "get_place_details", "get_route", "get_route_matrix", "geocode_location",
] as const;

export type ToolName = typeof TOOL_NAMES[number];

export async function executeTool(name: string, args: Record<string, any>, env: Env) {
  switch (name as ToolName) {
    case "search_places": return searchText(env, args);
    case "search_nearby_places": return searchNearby(env, args);
    case "search_restaurants": return searchRestaurants(env, args);
    case "get_place_details": return getPlaceDetails(env, args);
    case "get_route": return getRoute(env, args);
    case "get_route_matrix": return getRouteMatrix(env, args);
    case "geocode_location": return geocodeLocation(env, args);
    default: throw new HttpError(404, `Unknown tool: ${name}`, "UNKNOWN_TOOL");
  }
}

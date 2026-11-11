import { Env, HttpError } from "../types";
import { searchText, searchNearby, searchRestaurants, getPlaceDetails } from "../google/places";
import { getRoute, getRouteMatrix } from "../google/routes";
import { geocodeLocation } from "../google/geocoding";
import {
  ticketHealthCheck,
  ticketListCountries,
  ticketListCities,
  ticketListCategories,
  ticketSearchProducts,
  ticketGetProductDetails,
  ticketGetSkuCalendar,
  ticketGetPackageExtraInfo,
  ticketCheckAvailability,
  ticketValidateOrder,
} from "../ticket/client";

export const TOOL_NAMES = [
  "search_places", "search_nearby_places", "search_restaurants",
  "get_place_details", "get_route", "get_route_matrix", "geocode_location",
  "ticket_health_check", "ticket_list_countries", "ticket_list_cities", "ticket_list_categories",
  "ticket_search_products", "ticket_get_product_details", "ticket_get_sku_calendar",
  "ticket_get_package_extra_info", "ticket_check_availability", "ticket_validate_order",
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
    case "ticket_health_check": return ticketHealthCheck(env);
    case "ticket_list_countries": return ticketListCountries(env);
    case "ticket_list_cities": return ticketListCities(env, args);
    case "ticket_list_categories": return ticketListCategories(env);
    case "ticket_search_products": return ticketSearchProducts(env, args);
    case "ticket_get_product_details": return ticketGetProductDetails(env, args);
    case "ticket_get_sku_calendar": return ticketGetSkuCalendar(env, args);
    case "ticket_get_package_extra_info": return ticketGetPackageExtraInfo(env, args);
    case "ticket_check_availability": return ticketCheckAvailability(env, args);
    case "ticket_validate_order": return ticketValidateOrder(env, args);
    default: throw new HttpError(404, `Unknown tool: ${name}`, "UNKNOWN_TOOL");
  }
}

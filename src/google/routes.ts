import { Env, HttpError } from "../types";
import { googleJson, routesUrl } from "./client";

const ROUTE_FIELDS = [
  "routes.duration",
  "routes.distanceMeters",
  "routes.polyline.encodedPolyline",
  "routes.legs.duration",
  "routes.legs.distanceMeters",
  "routes.legs.steps.navigationInstruction",
].join(",");

function waypoint(value: any) {
  if (typeof value === "string") return { address: value };
  if (value && Number.isFinite(value.latitude) && Number.isFinite(value.longitude)) {
    return { location: { latLng: { latitude: value.latitude, longitude: value.longitude } } };
  }
  throw new HttpError(400, "Waypoint must be an address or {latitude, longitude}", "INVALID_ARGUMENT");
}

export async function getRoute(env: Env, args: Record<string, any>) {
  const body = {
    origin: waypoint(args.origin),
    destination: waypoint(args.destination),
    travelMode: args.travel_mode,
    ...(args.departure_time ? { departureTime: args.departure_time } : {}),
    ...(args.routing_preference ? { routingPreference: args.routing_preference } : {}),
    computeAlternativeRoutes: args.alternatives ?? false,
    languageCode: args.language_code ?? "en",
  };
  return googleJson(env, routesUrl("/directions/v2:computeRoutes"), {
    method: "POST",
    headers: { "X-Goog-FieldMask": ROUTE_FIELDS },
    body: JSON.stringify(body),
  });
}

export async function getRouteMatrix(env: Env, args: Record<string, any>) {
  if (args.origins.length * args.destinations.length > 100) {
    throw new HttpError(400, "This endpoint limits a request to 100 route elements", "LIMIT_EXCEEDED");
  }
  const body = {
    origins: args.origins.map((item: unknown) => ({ waypoint: waypoint(item) })),
    destinations: args.destinations.map((item: unknown) => ({ waypoint: waypoint(item) })),
    travelMode: args.travel_mode,
    ...(args.departure_time ? { departureTime: args.departure_time } : {}),
  };
  return googleJson(env, routesUrl("/distanceMatrix/v2:computeRouteMatrix"), {
    method: "POST",
    headers: { "X-Goog-FieldMask": "originIndex,destinationIndex,duration,distanceMeters,status,condition" },
    body: JSON.stringify(body),
  });
}

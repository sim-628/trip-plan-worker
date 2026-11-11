import { Env, HttpError } from "./types";
import { OPENAI_TOOLS } from "./tools/definitions";
import { executeTool, TOOL_NAMES } from "./tools/dispatcher";

function json(data: unknown, status = 200, origin = "*") {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Authorization,Content-Type",
      "Vary": "Origin",
    },
  });
}

function validateArgs(value: unknown): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, "Tool arguments must be a JSON object", "INVALID_ARGUMENT");
  }
  return value as Record<string, any>;
}

function checkCoordinates(lat: unknown, lng: unknown) {
  if (typeof lat !== "number" || lat < -90 || lat > 90 ||
      typeof lng !== "number" || lng < -180 || lng > 180) {
    throw new HttpError(400, "Invalid latitude or longitude", "INVALID_ARGUMENT");
  }
}

function validateToolInput(name: string, args: Record<string, any>) {
  if (!TOOL_NAMES.includes(name as typeof TOOL_NAMES[number])) {
    throw new HttpError(404, `Unknown tool: ${name}`, "UNKNOWN_TOOL");
  }
  if (args.location) checkCoordinates(args.location.latitude, args.location.longitude);

  for (const key of ["limit"]) {
    if (args[key] !== undefined && (!Number.isInteger(args[key]) || args[key] < 1 || args[key] > 20)) {
      throw new HttpError(400, `${key} must be an integer between 1 and 20`, "INVALID_ARGUMENT");
    }
  }
  if (args.radius_meters !== undefined && args.radius_meters !== null &&
      (!Number.isFinite(args.radius_meters) || args.radius_meters < 100 || args.radius_meters > 50000)) {
    throw new HttpError(400, "radius_meters must be between 100 and 50000", "INVALID_ARGUMENT");
  }
  if (name === "search_places" && (typeof args.query !== "string" || !args.query.trim() || args.query.length > 300)) {
    throw new HttpError(400, "query must be a non-empty string of at most 300 characters", "INVALID_ARGUMENT");
  }
  if (name === "search_nearby_places") {
    checkCoordinates(args.location?.latitude, args.location?.longitude);
    if (!Array.isArray(args.included_types) || args.included_types.length === 0 ||
        args.included_types.length > 10 || args.included_types.some((v: unknown) => typeof v !== "string" || !v.trim())) {
      throw new HttpError(400, "included_types must contain 1 to 10 non-empty strings", "INVALID_ARGUMENT");
    }
  }
  if (name === "search_restaurants" && (typeof args.area !== "string" || !args.area.trim() || args.area.length > 200)) {
    throw new HttpError(400, "area must be a non-empty string of at most 200 characters", "INVALID_ARGUMENT");
  }
  if (name === "get_place_details" && (typeof args.place_id !== "string" || args.place_id.length > 200)) {
    throw new HttpError(400, "place_id is required", "INVALID_ARGUMENT");
  }
  if (name === "get_route_matrix") {
    if (!Array.isArray(args.origins) || !Array.isArray(args.destinations) ||
        !args.origins.length || !args.destinations.length ||
        args.origins.length > 10 || args.destinations.length > 10 ||
        args.origins.some((v: unknown) => typeof v !== "string" || !v.trim()) ||
        args.destinations.some((v: unknown) => typeof v !== "string" || !v.trim())) {
      throw new HttpError(400, "origins and destinations must each contain 1 to 10 non-empty addresses", "INVALID_ARGUMENT");
    }
  }
  if (name === "get_route" && (
    typeof args.origin !== "string" || !args.origin.trim() ||
    typeof args.destination !== "string" || !args.destination.trim()
  )) {
    throw new HttpError(400, "origin and destination are required addresses", "INVALID_ARGUMENT");
  }
  if (name === "geocode_location" && !args.address &&
      !(Number.isFinite(args.latitude) && Number.isFinite(args.longitude))) {
    throw new HttpError(400, "Provide an address or both coordinates", "INVALID_ARGUMENT");
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = env.ALLOWED_ORIGIN ?? "*";
    if (request.method === "OPTIONS") return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
        "Access-Control-Allow-Headers": "Authorization,Content-Type",
        "Access-Control-Max-Age": "86400",
      },
    });

    const url = new URL(request.url);
    try {
      if (url.pathname === "/health" && request.method === "GET") {
        return json({ ok: true, service: "trip-plan-worker" }, 200, origin);
      }

      if (!env.APP_API_TOKEN) {
        throw new HttpError(503, "APP_API_TOKEN is not configured", "SERVER_NOT_CONFIGURED");
      }
      if (request.headers.get("Authorization") !== `Bearer ${env.APP_API_TOKEN}`) {
        throw new HttpError(401, "Unauthorized", "UNAUTHORIZED");
      }

      if (url.pathname === "/openai/tools" && request.method === "GET") {
        return json({ tools: OPENAI_TOOLS }, 200, origin);
      }

      if (url.pathname === "/tools" && request.method === "GET") {
        return json({ tools: TOOL_NAMES.map((name) => ({ name })) }, 200, origin);
      }

      if (url.pathname === "/tools/execute" && request.method === "POST") {
        const body = await request.json() as { name?: string; arguments?: unknown };
        if (!body.name) throw new HttpError(400, "name is required", "INVALID_ARGUMENT");
        const args = validateArgs(body.arguments);
        validateToolInput(body.name, args);
        const output = await executeTool(body.name, args, env);
        return json({ ok: true, name: body.name, output }, 200, origin);
      }

      return json({ error: { code: "NOT_FOUND", message: "Route not found" } }, 404, origin);
    } catch (error) {
      const e = error instanceof HttpError
        ? error
        : new HttpError(500, "Unexpected server error", "INTERNAL_ERROR");
      return json({
        ok: false,
        error: { code: e.code, message: e.message, ...(e.details ? { details: e.details } : {}) },
      }, e.status, origin);
    }
  },
};

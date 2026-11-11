import { Env, HttpError } from "../types";
import { googleJson, geocodingUrl } from "./client";

export async function geocodeLocation(env: Env, args: Record<string, any>) {
  const params = new URLSearchParams({ key: env.GOOGLE_MAPS_API_KEY });
  if (args.address) params.set("address", args.address);
  if (args.latitude !== undefined && args.longitude !== undefined) {
    params.set("latlng", `${args.latitude},${args.longitude}`);
  }
  if (args.language_code) params.set("language", args.language_code);
  if (!args.address && (args.latitude === undefined || args.longitude === undefined)) {
    throw new HttpError(400, "Provide address or both latitude and longitude", "INVALID_ARGUMENT");
  }
  return googleJson(env, geocodingUrl(params), { method: "GET" });
}

import { Env, HttpError } from "../types";

const GOOGLE_BASE = "https://places.googleapis.com/v1";
const ROUTES_BASE = "https://routes.googleapis.com";
const GEOCODING_BASE = "https://maps.googleapis.com/maps/api/geocode/json";

export async function googleJson<T>(
  env: Env,
  url: string,
  init: RequestInit = {},
): Promise<T> {
  if (!env.GOOGLE_MAPS_API_KEY) {
    throw new HttpError(503, "Google Maps API key is not configured", "PROVIDER_NOT_CONFIGURED");
  }

  const response = await fetch(url, {
    ...init,
    headers: {
      "X-Goog-Api-Key": env.GOOGLE_MAPS_API_KEY,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });

  const body: any = await response.json().catch(() => null);
  if (!response.ok) {
    const providerError = body && typeof body === "object" ? body.error : undefined;
    throw new HttpError(
      response.status >= 500 ? 502 : response.status,
      providerError?.message ?? "Google Maps request failed",
      providerError?.status ?? "GOOGLE_API_ERROR",
    );
  }
  return body as T;
}

export const placesUrl = (path = "") => `${GOOGLE_BASE}${path}`;
export const routesUrl = (path: string) => `${ROUTES_BASE}${path}`;
export const geocodingUrl = (params: URLSearchParams) => `${GEOCODING_BASE}?${params.toString()}`;

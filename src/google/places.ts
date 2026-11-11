import { Env, HttpError } from "../types";
import { googleJson, placesUrl } from "./client";

const SEARCH_FIELDS = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.location",
  "places.primaryType",
  "places.types",
  "places.rating",
  "places.userRatingCount",
  "nextPageToken",
].join(",");

const DETAIL_FIELDS = [
  "id", "displayName", "formattedAddress", "location", "primaryType",
  "types", "rating", "userRatingCount", "priceLevel", "regularOpeningHours",
  "websiteUri", "nationalPhoneNumber", "editorialSummary",
].join(",");

export async function searchText(env: Env, args: Record<string, any>) {
  const body: Record<string, unknown> = {
    textQuery: args.query,
    pageSize: args.limit ?? 10,
    ...(args.language_code ? { languageCode: args.language_code } : {}),
    ...(args.region_code ? { regionCode: args.region_code } : {}),
  };
  if (args.location) {
    body.locationBias = {
      circle: {
        center: { latitude: args.location.latitude, longitude: args.location.longitude },
        radius: args.radius_meters ?? 5000,
      },
    };
  }
  if (args.included_type) body.includedType = args.included_type;
  if (args.open_now === true) body.openNow = true;

  return googleJson(env, placesUrl("/places:searchText"), {
    method: "POST",
    headers: { "X-Goog-FieldMask": SEARCH_FIELDS },
    body: JSON.stringify(body),
  });
}

export async function searchNearby(env: Env, args: Record<string, any>) {
  const body: Record<string, unknown> = {
    includedTypes: args.included_types,
    maxResultCount: args.limit ?? 20,
    locationRestriction: {
      circle: {
        center: { latitude: args.location.latitude, longitude: args.location.longitude },
        radius: args.radius_meters,
      },
    },
    ...(args.language_code ? { languageCode: args.language_code } : {}),
  };

  return googleJson(env, placesUrl("/places:searchNearby"), {
    method: "POST",
    headers: { "X-Goog-FieldMask": SEARCH_FIELDS },
    body: JSON.stringify(body),
  });
}

export async function searchRestaurants(env: Env, args: Record<string, any>) {
  const query = [
    args.cuisine ? `${args.cuisine} restaurant` : "restaurants",
    args.area,
  ].filter(Boolean).join(" in ");

  const result = await searchText(env, {
    query,
    limit: Math.min(args.limit ?? 10, 20),
    language_code: args.language_code,
    location: args.location,
    radius_meters: args.radius_meters,
    open_now: args.open_now,
  }) as { places?: Array<Record<string, any>> };

  let places = result.places ?? [];
  if (typeof args.min_rating === "number") {
    places = places.filter((place) => typeof place.rating === "number" && place.rating >= args.min_rating);
  }
  if (typeof args.min_rating_count === "number") {
    places = places.filter((place) => (place.userRatingCount ?? 0) >= args.min_rating_count);
  }
  if (args.price_levels?.length) {
    places = places.filter((place) => args.price_levels.includes(place.priceLevel));
  }
  return { places, applied_filters: {
    min_rating: args.min_rating ?? null,
    min_rating_count: args.min_rating_count ?? null,
    price_levels: args.price_levels ?? [],
  } };
}

export async function getPlaceDetails(env: Env, args: Record<string, any>) {
  const placeId = String(args.place_id ?? "");
  if (!/^[A-Za-z0-9_-]+$/.test(placeId)) {
    throw new HttpError(400, "Invalid place_id", "INVALID_ARGUMENT");
  }
  const query = args.language_code
    ? `?languageCode=${encodeURIComponent(args.language_code)}`
    : "";
  return googleJson(env, placesUrl(`/places/${encodeURIComponent(placeId)}${query}`), {
    method: "GET",
    headers: { "X-Goog-FieldMask": DETAIL_FIELDS },
  });
}

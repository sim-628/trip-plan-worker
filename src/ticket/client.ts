import { Env, HttpError } from "../types";

function baseUrl(env: Env) {
  const value = env.DIDA_API_BASE_URL || "https://didatickettest.wysiwysi.com/api/distribution/v1";
  return value.replace(/\/+$/, "");
}

async function request<T>(
  env: Env,
  path: string,
  options: { method?: "GET" | "POST"; query?: URLSearchParams; body?: unknown; language?: string } = {},
): Promise<T> {
  if (!env.DIDA_API_TOKEN) {
    throw new HttpError(503, "DIDA_API_TOKEN is not configured", "TICKET_PROVIDER_NOT_CONFIGURED");
  }

  const url = new URL(baseUrl(env) + path);
  options.query?.forEach((value, key) => url.searchParams.set(key, value));

  const response = await fetch(url.toString(), {
    method: options.method || "GET",
    headers: {
      Authorization: "Bearer " + env.DIDA_API_TOKEN,
      Accept: "application/json",
      "Accept-Language": options.language || env.DIDA_ACCEPT_LANGUAGE || "en",
      ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  });

  const payload: any = await response.json().catch(() => null);
  if (!response.ok || payload?.success === false) {
    const providerError = payload?.error;
    throw new HttpError(
      response.status >= 500 ? 502 : response.status || 502,
      providerError?.message || "Ticket provider request failed",
      providerError?.code || "TICKET_API_ERROR",
      providerError?.trace_id ? { trace_id: providerError.trace_id } : undefined,
    );
  }
  return (payload?.data ?? payload) as T;
}

function commaList(values: string[], field: string, max: number) {
  const cleaned = [...new Set(values.map((value) => value.trim()).filter(Boolean))];
  if (!cleaned.length || cleaned.length > max) {
    throw new HttpError(400, field + " must contain 1 to " + max + " unique values", "INVALID_ARGUMENT");
  }
  return cleaned.join(",");
}

export async function ticketListCountries(env: Env) {
  return request(env, "/countries");
}

export async function ticketListCities(env: Env, args: Record<string, any>) {
  const query = new URLSearchParams();
  if (args.country_codes?.length) query.set("country_codes", commaList(args.country_codes, "country_codes", 50));
  return request(env, "/cities", { query, language: args.language });
}

export async function ticketListCategories(env: Env) {
  return request(env, "/categories");
}

export async function ticketSearchProducts(env: Env, args: Record<string, any>) {
  const query = new URLSearchParams({
    page: String(args.page ?? 1),
    limit: String(args.limit ?? 20),
  });
  if (args.keyword) query.set("keyword", args.keyword);
  if (args.product_code) query.set("product_code", args.product_code);
  if (args.city_codes?.length) query.set("city_codes", commaList(args.city_codes, "city_codes", 50));
  if (args.country_codes?.length) query.set("country_codes", commaList(args.country_codes, "country_codes", 50));
  if (args.category_codes?.length) query.set("category_codes", commaList(args.category_codes, "category_codes", 50));
  return request(env, "/products", { query, language: args.language });
}

export async function ticketGetProductDetails(env: Env, args: Record<string, any>) {
  const code = encodeURIComponent(String(args.product_code));
  const query = new URLSearchParams();
  if (args.catalog_changes) query.set("catalog_changes", "true");
  if (args.changed_since) query.set("changed_since", args.changed_since);
  if (args.changed_until) query.set("changed_until", args.changed_until);
  return request(env, "/products/" + code, { query, language: args.language });
}

export async function ticketGetSkuCalendar(env: Env, args: Record<string, any>) {
  const skuCodes = commaList(args.sku_codes, "sku_codes", 20);
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(args.start_date) ||
      !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(args.end_date)) {
    throw new HttpError(400, "Dates must use yyyy-MM-dd HH:mm:ss in destination local time", "INVALID_ARGUMENT");
  }
  const start = Date.parse(args.start_date.replace(" ", "T") + "+08:00");
  const end = Date.parse(args.end_date.replace(" ", "T") + "+08:00");
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start || end - start > 90 * 24 * 60 * 60 * 1000) {
    throw new HttpError(400, "Calendar range must be valid and no longer than 90 days", "INVALID_ARGUMENT");
  }
  const query = new URLSearchParams({
    sku_codes: skuCodes,
    start_date: args.start_date,
    end_date: args.end_date,
  });
  return request(env, "/skus/calendar", { query, language: args.language || "en" });
}

export async function ticketGetPackageExtraInfo(env: Env, args: Record<string, any>) {
  const query = new URLSearchParams({
    package_codes: commaList(args.package_codes, "package_codes", 50),
  });
  return request(env, "/packages/extra-info", { query, language: args.language || "en" });
}

export async function ticketCheckAvailability(env: Env, args: Record<string, any>) {
  if (!Array.isArray(args.package_lines) || args.package_lines.length < 1 || args.package_lines.length > 20) {
    throw new HttpError(400, "package_lines must contain 1 to 20 package lines", "INVALID_ARGUMENT");
  }
  // Upstream contract expects a JSON array directly, not an object wrapper.
  return request(env, "/availability-check", {
    method: "POST",
    body: args.package_lines,
    language: args.language || "en",
  });
}

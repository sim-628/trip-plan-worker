import { z } from "zod";
const str = z.string().min(1).max(10000),
  opt = str.nullable().optional();
const date = z.iso.date(),
  time = z.iso.datetime({ offset: true }),
  clock = z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/)
    .nullable()
    .optional();
const money = {
  price: z.number().finite().min(0).nullable().optional(),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .nullable()
    .optional(),
};
const coordinate = {
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
};
const journey = {
  departureLatitude: coordinate.latitude,
  departureLongitude: coordinate.longitude,
  arrivalLatitude: coordinate.latitude,
  arrivalLongitude: coordinate.longitude,
  departureTime: time,
  arrivalTime: time,
};
export const rowSchemas = {
  trips: z
    .object({
      tripName: str,
      startDate: date,
      endDate: date,
      coverImage: z.url().nullable().optional(),
      description: opt,
      status: z.enum(["规划中", "进行中", "已完成", "已取消"]),
    })
    .strict(),
  flights: z
    .object({
      airline: str,
      flightNumber: str,
      departureAirport: str,
      departureAirportCode: z.string().regex(/^[A-Z]{3}$/),
      departureTerminal: opt,
      arrivalAirport: str,
      arrivalAirportCode: z.string().regex(/^[A-Z]{3}$/),
      arrivalTerminal: opt,
      ...journey,
      cabinClass: opt,
      bookingReference: opt,
      ticketStatus: opt,
      ...money,
    })
    .strict(),
  hotels: z
    .object({
      hotelName: str,
      hotelNameEn: opt,
      brand: opt,
      starRating: z.number().min(0).max(5).nullable().optional(),
      description: opt,
      phone: opt,
      ...coordinate,
      businessDistrict: opt,
      policyDescription: opt,
      checkinFrom: clock,
      checkoutTo: clock,
      extraInfoList: z
        .array(
          z
            .object({ type: str, description: z.string(), value: z.unknown() })
            .strict(),
        )
        .nullable()
        .optional(),
      facilities: z.array(str).nullable().optional(),
      images: z
        .array(z.object({ url: z.url(), isDefault: z.boolean() }).strict())
        .max(5)
        .nullable()
        .optional(),
      tags: z.array(str).nullable().optional(),
      bookingReference: opt,
      hotelStatus: z.enum([
        "planned",
        "confirmed",
        "checked_in",
        "checked_out",
        "cancelled",
      ]),
      ...money,
    })
    .strict(),
  transports: z
    .object({
      transportType: z.enum(["train", "bus"]),
      operator: str,
      transportNumber: opt,
      departureLocation: str,
      arrivalLocation: str,
      ...journey,
      departurePlatform: opt,
      arrivalPlatform: opt,
      seatClass: opt,
      ticketStatus: opt,
      ...money,
    })
    .strict(),
  pois: z
    .object({
      poiName: str,
      poiType: z.enum([
        "attraction",
        "restaurant",
        "shopping",
        "entertainment",
        "other",
      ]),
      address: str,
      ...coordinate,
      visitStartTime: time.nullable().optional(),
      visitEndTime: time.nullable().optional(),
      openingHours: z.unknown().optional(),
      website: z.url().nullable().optional(),
      bookingReference: opt,
      poiStatus: z.enum(["planned", "visited", "cancelled"]),
      notes: opt,
    })
    .strict(),
};
export type Table = keyof typeof rowSchemas;
export const idFields: Record<Table, string> = {
  trips: "tripId",
  flights: "flightId",
  hotels: "hotelId",
  transports: "transportId",
  pois: "poiId",
};
const changeSchema = z
  .object({
    table: z.enum(["trips", "flights", "hotels", "transports", "pois"]),
    action: z.enum(["insert", "update", "delete"]),
    ref: str,
    recordId: str.optional(),
    data: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();
export const batchSchema = z
  .object({
    operationId: z.string().min(8).max(100),
    tripId: str.nullable(),
    expectedVersion: z.number().int().min(0),
    changes: z.array(changeSchema).min(1).max(50),
    sidecars: z
      .array(
        z
          .object({
            ref: str,
            kind: z.enum(["hotel_stay", "quote", "ticket", "warnings"]),
            data: z.record(z.string(), z.unknown()),
          })
          .strict(),
      )
      .max(100)
      .optional(),
  })
  .strict();
export function validateRow(table: Table, row: any) {
  const data: any = rowSchemas[table].parse(row);
  if (table === "trips" && data.endDate < data.startDate)
    throw Error("endDate precedes startDate");
  for (const [a, b] of [
    ["latitude", "longitude"],
    ["departureLatitude", "departureLongitude"],
    ["arrivalLatitude", "arrivalLongitude"],
  ])
    if ((data[a] != null) !== (data[b] != null))
      throw Error("Coordinates must be a pair");
  if ((data.price != null) !== (data.currency != null))
    throw Error("price and currency must be provided together");
  for (const [a, b] of [
    ["departureTime", "arrivalTime"],
    ["visitStartTime", "visitEndTime"],
  ]) {
    if ((data[a] != null) !== (data[b] != null))
      throw Error("Times must be a pair");
    if (data[a] != null && Date.parse(data[b]) <= Date.parse(data[a]))
      throw Error("End must follow start");
  }
  return data;
}
export function validateBatch(value: unknown) {
  const batch = batchSchema.parse(value);
  const refs = new Set<string>();
  for (const change of batch.changes) {
    if (refs.has(change.ref)) throw Error("Duplicate ref");
    refs.add(change.ref);
    if (change.action === "insert") {
      if (change.recordId) throw Error("Client assigns IDs");
      validateRow(change.table, change.data);
    } else {
      if (!change.recordId) throw Error("recordId required");
      if (change.action === "update")
        rowSchemas[change.table].partial().parse(change.data);
      else if (change.data) throw Error("Delete cannot include data");
    }
  }
  if (
    batch.tripId === null &&
    (batch.expectedVersion !== 0 ||
      batch.changes.filter((c) => c.table === "trips" && c.action === "insert")
        .length !== 1 ||
      batch.changes.some((c) => c.action !== "insert"))
  )
    throw Error("New trip requires exactly one trip insert at version zero");
  if (
    batch.tripId !== null &&
    batch.changes.some((c) => c.table === "trips" && c.action === "insert")
  )
    throw Error("Trip already exists");
  for (const sidecar of batch.sidecars ?? []) {
    if (!refs.has(sidecar.ref))
      throw Error("Sidecar ref must refer to a change in this batch");
    if (sidecar.kind === "hotel_stay") {
      const dates = z
        .object({ checkInDate: date, checkOutDate: date })
        .passthrough()
        .parse(sidecar.data);
      if (dates.checkOutDate <= dates.checkInDate)
        throw Error("Invalid hotel stay dates");
    }
  }
  return batch;
}
export interface LocalSnapshot {
  tripId: string | null;
  version: number;
  tables: Record<Table, Record<string, any>[]>;
  receipts: Record<string, { payload: string; result: any }>;
  sidecars?: Record<string, any[]>;
}
/** Reference reducer only. The future app must persist snapshot and receipt in ONE local DB transaction. */
export function applyLocalChanges(
  snapshot: LocalSnapshot,
  value: unknown,
  makeId = () => crypto.randomUUID(),
  now = new Date().toISOString(),
) {
  const batch = validateBatch(value),
    payload = JSON.stringify(batch),
    previous = snapshot.receipts[batch.operationId];
  if (previous) {
    if (previous.payload !== payload)
      throw Error("operationId reused with different content");
    return { snapshot, result: previous.result };
  }
  if (
    batch.tripId !== snapshot.tripId ||
    batch.expectedVersion !== snapshot.version
  )
    throw Error("VERSION_CONFLICT");
  const next: LocalSnapshot = structuredClone(snapshot),
    ids: Record<string, string> = {};
  if (next.tripId === null) next.tripId = makeId();
  for (const change of [...batch.changes].sort(
    (a, b) => Number(b.table === "trips") - Number(a.table === "trips"),
  )) {
    const rows = next.tables[change.table],
      key = idFields[change.table];
    if (change.action === "insert") {
      const id = change.table === "trips" ? next.tripId : makeId();
      ids[change.ref] = id!;
      rows.push({
        ...validateRow(change.table, change.data),
        [key]: id,
        tripId: next.tripId,
        createdAt: now,
        updatedAt: now,
      });
    } else {
      const i = rows.findIndex(
        (r) => r[key] === change.recordId && r.tripId === next.tripId,
      );
      if (i < 0) throw Error("ROW_NOT_FOUND");
      if (change.action === "delete") {
        if (change.table === "trips")
          throw Error("Cancel the trip instead of deleting its parent");
        rows.splice(i, 1);
        if (next.sidecars) delete next.sidecars[change.recordId!];
      } else {
        ids[change.ref] = change.recordId!;
        const { tripId, createdAt, updatedAt, [key]: id, ...fields } = rows[i];
        rows[i] = {
          ...validateRow(change.table, { ...fields, ...change.data }),
          [key]: id,
          tripId,
          createdAt,
          updatedAt: now,
        };
      }
    }
  }
  for (const sidecar of batch.sidecars ?? []) {
    const id = ids[sidecar.ref];
    if (!id) throw Error("Cannot attach metadata to a deleted row");
    next.sidecars ??= {};
    const existing = next.sidecars[id] ?? [];
    next.sidecars[id] = [
      ...existing.filter((x) => x.kind !== sidecar.kind),
      { kind: sidecar.kind, data: sidecar.data },
    ];
  }
  next.version++;
  const result = {
    status: "applied",
    operationId: batch.operationId,
    tripId: next.tripId,
    version: next.version,
    idMap: ids,
  };
  next.receipts[batch.operationId] = { payload, result };
  return { snapshot: next, result };
}

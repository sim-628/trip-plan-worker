import { describe, it, expect } from "vitest";
import {
  applyLocalChanges,
  validateRow,
  validateBatch,
  LocalSnapshot,
} from "../src/travel/local-store";
function empty(): LocalSnapshot {
  return {
    tripId: null,
    version: 0,
    tables: { trips: [], flights: [], hotels: [], transports: [], pois: [] },
    receipts: {},
  };
}
const batch = {
  operationId: "operation-new-trip",
  tripId: null,
  expectedVersion: 0,
  changes: [
    {
      table: "trips",
      action: "insert",
      ref: "TRIP-1",
      data: {
        tripName: "杭州两日",
        startDate: "2026-11-20",
        endDate: "2026-11-21",
        status: "规划中",
      },
    },
    {
      table: "pois",
      action: "insert",
      ref: "POI-1",
      data: {
        poiName: "西湖",
        poiType: "attraction",
        address: "杭州西湖",
        poiStatus: "planned",
        latitude: null,
        longitude: null,
      },
    },
  ],
};
describe("local transaction contract", () => {
  it("atomically assigns IDs, maps the parent, and deduplicates retries", () => {
    const r = applyLocalChanges(empty(), batch);
    expect(r.snapshot.tables.pois[0].tripId).toBe(r.result.tripId);
    expect(r.snapshot.version).toBe(1);
    expect(applyLocalChanges(r.snapshot, batch).snapshot).toBe(r.snapshot);
  });
  it("rejects stale versions without changing the original", () => {
    const r = applyLocalChanges(empty(), batch);
    expect(() =>
      applyLocalChanges(r.snapshot, {
        ...batch,
        operationId: "different-op",
        tripId: r.result.tripId,
        changes: [
          {
            table: "pois",
            action: "update",
            ref: "POI-1",
            recordId: r.result.idMap["POI-1"],
            data: { notes: "changed" },
          },
        ],
      }),
    ).toThrow("VERSION_CONFLICT");
    expect(r.snapshot.tables.pois[0].notes).toBeUndefined();
  });
  it("rejects system fields and extra table columns", () => {
    expect(() =>
      validateBatch({
        ...batch,
        changes: [
          {
            ...batch.changes[0],
            data: { ...batch.changes[0].data, tripId: "invented" },
          },
        ],
      }),
    ).toThrow();
    expect(() =>
      validateRow("hotels", {
        hotelName: "Hotel",
        hotelStatus: "planned",
        checkInDate: "2026-11-20",
      }),
    ).toThrow();
  });
  it("requires a currency for zero price and paired coordinates", () => {
    expect(() =>
      validateRow("hotels", {
        hotelName: "Hotel",
        hotelStatus: "planned",
        price: 0,
      }),
    ).toThrow();
    expect(() =>
      validateRow("hotels", {
        hotelName: "Hotel",
        hotelStatus: "planned",
        latitude: 10,
      }),
    ).toThrow();
    expect(
      validateRow("hotels", {
        hotelName: "Hotel",
        hotelStatus: "planned",
        price: 0,
        currency: "CNY",
      }).price,
    ).toBe(0);
  });
  it("compares zoned times as instants and enforces real dates", () => {
    expect(() =>
      validateRow("pois", {
        poiName: "x",
        poiType: "other",
        address: "x",
        poiStatus: "planned",
        visitStartTime: "2026-11-20T10:00:00+09:00",
        visitEndTime: "2026-11-20T09:30:00+08:00",
      }),
    ).not.toThrow();
    expect(() =>
      validateRow("trips", {
        tripName: "x",
        status: "规划中",
        startDate: "2026-02-30",
        endDate: "2026-03-01",
      }),
    ).toThrow();
  });
  it("rolls back all changes if a later update is invalid", () => {
    const r = applyLocalChanges(empty(), batch);
    expect(() =>
      applyLocalChanges(r.snapshot, {
        operationId: "update-failing",
        tripId: r.result.tripId,
        expectedVersion: 1,
        changes: [
          {
            table: "trips",
            action: "update",
            ref: "TRIP-1",
            recordId: r.result.tripId,
            data: { tripName: "changed" },
          },
          {
            table: "pois",
            action: "update",
            ref: "POI-1",
            recordId: r.result.idMap["POI-1"],
            data: { latitude: 11 },
          },
        ],
      }),
    ).toThrow();
    expect(r.snapshot.tables.trips[0].tripName).toBe("杭州两日");
  });
});

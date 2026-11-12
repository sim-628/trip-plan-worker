import {
  applyLocalChanges,
  type LocalSnapshot,
} from "../src/travel/local-store";
export type Thread = {
  id: string;
  title: string;
  created: number;
  updated: number;
  timezone: string;
  status: string;
  session?: { id: string; session_token: string };
  messages: any[];
  dispatches: any[];
  required_actions: any[];
  cards: Record<string, any>;
  results: Record<string, any>;
  tripId: string | null;
  pending?: any;
  optimistic?: string;
  error?: string;
};
const DB = "trip-plan-test-v1";
let opened: Promise<IDBDatabase>;
export function database() {
  return (opened ??= new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore("threads", { keyPath: "id" });
      r.result.createObjectStore("trips", { keyPath: "tripId" });
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  }));
}
async function read(store: string, id?: string): Promise<any> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const r =
      id === undefined
        ? db.transaction(store).objectStore(store).getAll()
        : db.transaction(store).objectStore(store).get(id);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
export const getThread = (id: string): Promise<Thread> => read("threads", id);
export const listThreads = async (): Promise<Thread[]> =>
  (await read("threads")).sort((a: Thread, b: Thread) => b.updated - a.updated);
export const listTrips = (): Promise<LocalSnapshot[]> => read("trips");
export const getTrip = (id: string): Promise<LocalSnapshot | undefined> =>
  read("trips", id);
export const emptyTrip = (): LocalSnapshot => ({
  tripId: null,
  version: 0,
  tables: { trips: [], flights: [], hotels: [], transports: [], pois: [] },
  receipts: {},
});
export async function updateThread(
  id: string,
  patch: Partial<Thread>,
): Promise<Thread> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("threads", "readwrite"),
      store = tx.objectStore("threads");
    let next: Thread;
    const r = store.get(id);
    r.onsuccess = () => {
      next = { ...r.result, ...patch, id, updated: Date.now() };
      store.put(next);
    };
    tx.oncomplete = () => resolve(next);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
/** Cache a client result before posting it. Saving tables, receipts and the result
 * in the same IndexedDB transaction survives tab reloads and concurrent tabs. */
export async function actionResult(
  threadId: string,
  call: any,
  decision: "read" | "save" | "reject" | "card",
): Promise<any> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(["threads", "trips"], "readwrite"),
      threads = tx.objectStore("threads"),
      trips = tx.objectStore("trips");
    let result: any, failure: unknown;
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(failure ?? tx.error);
    tx.onabort = () => reject(failure ?? tx.error);
    const r = threads.get(threadId);
    r.onsuccess = () => {
      const thread: Thread = r.result;
      if (!thread) {
        failure = Error("对话不存在");
        tx.abort();
        return;
      }
      if (thread.results[call.call_id]) {
        result = thread.results[call.call_id];
        return;
      }
      const finish = (value: any) => {
        result = value;
        thread.results[call.call_id] = value;
        thread.updated = Date.now();
        threads.put(thread);
      };
      if (decision === "reject") {
        finish({
          call_id: call.call_id,
          success: false,
          error: "用户取消保存；未修改本地表。",
        });
        return;
      }
      if (decision === "card") {
        thread.cards[call.call_id] = {
          name: call.name,
          arguments: call.arguments,
        };
        finish({
          call_id: call.call_id,
          success: true,
          output: {
            status: "displayed",
            count: call.arguments?.cards?.length ?? 0,
          },
        });
        return;
      }
      const query = trips.getAll();
      query.onsuccess = () => {
        try {
          const all: LocalSnapshot[] = query.result,
            args = call.arguments ?? {};
          if (decision === "read") {
            const wanted = args.tripId ?? thread.tripId;
            const snapshot = wanted
              ? all.find((s) => s.tripId === wanted)
              : emptyTrip();
            if (!snapshot)
              throw Error("找不到所选的本地行程，请先在右侧选择行程。");
            const { receipts, ...visible } = snapshot;
            finish({ call_id: call.call_id, success: true, output: visible });
          } else {
            const previous = all.find((s) => s.receipts[args.operationId]);
            const snapshot =
              previous ??
              (args.tripId
                ? all.find((s) => s.tripId === args.tripId)
                : emptyTrip());
            if (!snapshot) throw Error("ROW_NOT_FOUND");
            const changed = applyLocalChanges(snapshot, args);
            trips.put(changed.snapshot);
            thread.tripId = changed.snapshot.tripId;
            finish({
              call_id: call.call_id,
              success: true,
              output: changed.result,
            });
          }
        } catch (e) {
          failure = e;
          tx.abort();
        }
      };
    };
  });
}
export async function cacheFailure(
  threadId: string,
  callId: string,
  error: string,
) {
  const db = await database();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction("threads", "readwrite"),
      store = tx.objectStore("threads"),
      r = store.get(threadId);
    r.onsuccess = () => {
      const t: Thread = r.result;
      t.results[callId] ??= { call_id: callId, success: false, error };
      store.put(t);
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

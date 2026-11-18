/** Minimal promise wrapper over IndexedDB (no dependencies). Browser only. */

const DB_NAME = "training-offline";
const VERSION = 1;
export type StoreName = "workouts" | "sets" | "drafts" | "outbox" | "meta";

let dbPromise: Promise<IDBDatabase> | null = null;

export function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        db.createObjectStore("workouts", { keyPath: "id" });
        db.createObjectStore("sets", { keyPath: "id" }).createIndex("workoutId", "workoutId");
        db.createObjectStore("drafts", { keyPath: "key" }).createIndex("workoutId", "workoutId");
        db.createObjectStore("outbox", { keyPath: "seq" }).createIndex("workoutId", "workoutId");
        db.createObjectStore("meta", { keyPath: "key" });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => {
        dbPromise = null;
        reject(req.error);
      };
    });
  }
  return dbPromise;
}

/** For tests: drop the cached connection. */
export async function closeDb() {
  if (dbPromise) (await dbPromise).close();
  dbPromise = null;
}

export const wrap = <T>(req: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

/**
 * Runs `fn` inside one transaction. Resolves only after the transaction has committed
 * (durably written), which is what "saved on device" means.
 */
export async function withTx<T>(stores: StoreName[], mode: IDBTransactionMode, fn: (tx: IDBTransaction) => Promise<T>): Promise<T> {
  const db = await openDb();
  const tx = db.transaction(stores, mode);
  const done = new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("Transaction aborted"));
  });
  try {
    const result = await fn(tx);
    await done;
    return result;
  } catch (e) {
    try {
      tx.abort();
    } catch {
      /* already finished */
    }
    await done.catch(() => {});
    throw e;
  }
}

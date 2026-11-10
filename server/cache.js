import { createClient } from "redis";

const REDIS_URL = process.env.REDIS_URL || "redis://cache:6379";
const DEFAULT_TTL_SECONDS = 5;
// node-redis has no default connect timeout: against an unroutable host
// (DROPped packets) connect() would hang forever and stall every request.
const CONNECT_TIMEOUT_MS = 1500;

// Waits for the promise with a time limit; false on timeout or rejection.
function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(false), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export const CONTAINERS_CACHE_KEY = "containers:v1";

export function cacheTtlSeconds() {
  const parsed = Number.parseInt(process.env.CACHE_TTL_SECONDS ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TTL_SECONDS;
}

let client = createClient({ url: REDIS_URL });
// Never queue commands while connecting: queueing would make every caller
// wait behind an unbounded connect attempt instead of failing fast.
client.options.disableOfflineQueue = true;
// Redis being down must never crash the app: swallow client-level errors.
client.on("error", () => {});

// In-flight connect() so parallel requests don't call it concurrently.
let connectAttempt = null;

async function ensureConnected() {
  if (client.isReady) return true;
  if (!connectAttempt) {
    connectAttempt = (async () => {
      try {
        if (!(await withTimeout(client.connect(), CONNECT_TIMEOUT_MS))) {
          throw new Error("connect timeout");
        }
        return true;
      } catch {
        // A client whose first connect failed cannot always be reused;
        // recreate it so the next request can try again.
        try {
          await client.disconnect();
        } catch {
          // ignore
        }
        client = createClient({ url: REDIS_URL });
        client.on("error", () => {});
        return false;
      } finally {
        connectAttempt = null;
      }
    })();
  }
  return connectAttempt;
}

export async function isAlive() {
  try {
    if (!(await ensureConnected())) return false;
    return (await withTimeout(client.ping(), CONNECT_TIMEOUT_MS)) === "PONG";
  } catch {
    return false;
  }
}

/** Get a JSON value; returns null on cache miss OR on any Redis failure. */
export async function getJson(key) {
  try {
    if (!(await ensureConnected())) return null;
    const raw = await withTimeout(client.get(key), CONNECT_TIMEOUT_MS);
    return raw === null || raw === false ? null : JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Set a JSON value with a TTL; returns true only when the write succeeded. */
export async function setJson(key, value, ttlSeconds) {
  try {
    if (!(await ensureConnected())) return false;
    const ttl = Number.isFinite(ttlSeconds) && ttlSeconds > 0 ? Math.floor(ttlSeconds) : DEFAULT_TTL_SECONDS;
    const ok = await withTimeout(client.set(key, JSON.stringify(value), { EX: ttl }), CONNECT_TIMEOUT_MS);
    return ok === true;
  } catch {
    return false;
  }
}

/** True when the key exists. Returns false on Redis failure too (fail-open). */
export async function hasKey(key) {
  try {
    if (!(await ensureConnected())) return false;
    return (await withTimeout(client.exists(key), CONNECT_TIMEOUT_MS)) === 1;
  } catch {
    return false;
  }
}

/** Delete a key; returns true when the delete succeeded. */
export async function deleteKey(key) {
  try {
    if (!(await ensureConnected())) return false;
    await withTimeout(client.del(key), CONNECT_TIMEOUT_MS);
    return true;
  } catch {
    return false;
  }
}

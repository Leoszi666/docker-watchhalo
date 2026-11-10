import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";

import { getHostAndContainers, DockerUnavailableError } from "./docker.js";
import { startEventMonitor, sendCrashAlert } from "./alerter.js";
import { checkDb, initDb, insertSnapshot, listSnapshots } from "./db.js";
import {
  CONTAINERS_CACHE_KEY,
  cacheTtlSeconds,
  getJson,
  isAlive,
  setJson,
} from "./cache.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.join(__dirname, "..", "dist");
const PORT = Number(process.env.PORT) || 3000;
const SNAPSHOT_TAGS = [
  "ROUTINE_CHECK",
  "INCIDENT_AUDIT",
  "PRE_DEPLOY",
  "POST_DEPLOY",
];

const app = express();
app.disable("x-powered-by");
app.use(express.json());

app.get("/health", async (_req, res) => {
  const [dbUp, redisUp] = await Promise.all([checkDb(), isAlive()]);
  if (dbUp) {
    res.status(200).json({ status: "ok", db: "up", redis: redisUp ? "up" : "down" });
  } else {
    res.status(503).json({ status: "error", db: "down", redis: redisUp ? "up" : "down" });
  }
});

app.get("/api/containers", async (_req, res) => {
  const cached = await getJson(CONTAINERS_CACHE_KEY);
  if (cached) {
    // updatedAt keeps its original value: it is when Docker was last read.
    return res.json({ ...cached, cached: true });
  }

  try {
    const { host, containers } = await getHostAndContainers();
    const payload = {
      cached: false,
      updatedAt: new Date().toISOString(),
      host,
      containers,
    };
    await setJson(CONTAINERS_CACHE_KEY, payload, cacheTtlSeconds());
    res.json(payload);
  } catch (err) {
    if (err instanceof DockerUnavailableError) {
      return res.status(503).json({ error: "Cannot reach Docker socket" });
    }
    console.error("[api] failed to read Docker state:", err);
    res.status(500).json({ error: "Failed to read Docker state" });
  }
});

app.post("/api/snapshots", async (req, res) => {
  const { tag, note } = req.body ?? {};

  if (!SNAPSHOT_TAGS.includes(tag)) {
    return res.status(400).json({
      error:
        "tag must be one of ROUTINE_CHECK, INCIDENT_AUDIT, PRE_DEPLOY, POST_DEPLOY",
    });
  }
  if (typeof note !== "string" || note.trim().length === 0 || note.length > 500) {
    return res.status(400).json({ error: "note is required (1-500 characters)" });
  }

  try {
    // The server reads the current Docker state itself — the client cannot
    // supply these numbers (PRD §7).
    const { host, containers } = await getHostAndContainers();
    const snapshot = await insertSnapshot({
      hostName: host.name,
      tag,
      note,
      runningCount: containers.filter((c) => c.state === "running").length,
      totalCount: containers.length,
      containers: containers.map((c) => ({
        id: c.id,
        name: c.name,
        state: c.state,
        mem: c.memUsedMB,
      })),
    });
    res.status(201).json(snapshot);
  } catch (err) {
    if (err instanceof DockerUnavailableError) {
      return res.status(503).json({ error: "Cannot reach Docker socket" });
    }
    console.error("[api] failed to save snapshot:", err);
    res.status(500).json({ error: "Failed to save snapshot" });
  }
});

app.get("/api/snapshots", async (_req, res) => {
  try {
    const snapshots = await listSnapshots(20);
    res.json(snapshots);
  } catch (err) {
    console.error("[api] failed to load snapshots:", err);
    res.status(500).json({ error: "Failed to load snapshots" });
  }
});

// Manual Discord crash alert for one container (PRD §17.6).
app.post("/api/containers/:id/alert", async (req, res) => {
  try {
    const { name } = await sendCrashAlert(req.params.id);
    res.json({ ok: true, name });
  } catch (err) {
    if (err?.statusCode) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    console.error("[api] failed to send Discord alert:", err);
    res.status(500).json({ error: "Failed to send Discord alert" });
  }
});

// Unknown /api routes always get a JSON 404 (never the SPA fallback).
app.use("/api", (_req, res) => {
  res.status(404).json({ error: "Not found" });
});

// Built frontend + SPA fallback for every other GET request.
app.use(express.static(DIST_DIR));
app.get("*", (_req, res) => {
  res.sendFile(path.join(DIST_DIR, "index.html"), (err) => {
    if (err && !res.headersSent) {
      res
        .status(503)
        .json({ error: "Frontend not built yet (dist/ missing). Run `npm run build`." });
    }
  });
});

// Invalid JSON bodies and any other uncaught middleware error.
app.use((err, _req, res, _next) => {
  if (err?.type === "entity.parse.failed" || err instanceof SyntaxError) {
    return res.status(400).json({ error: "Invalid JSON body" });
  }
  console.error("[api] unhandled error:", err);
  res.status(500).json({ error: "Internal server error" });
});

process.on("unhandledRejection", (reason) => {
  console.error("[app] unhandled rejection:", reason);
});

async function main() {
  try {
    await initDb();
    console.log("[app] snapshots table ready");
  } catch (err) {
    // Keep serving so /health can report db:"down" instead of a dead process.
    console.error(`[app] database init failed: ${err.message}`);
  }

  const server = app.listen(PORT, "0.0.0.0", () => {
    console.log(`[app] listening on http://0.0.0.0:${PORT}`);
  });

  // Docker Events listener for Discord crash alerting (PRD §17).
  try {
    startEventMonitor();
  } catch (err) {
    console.error(`[alerter] failed to start: ${err.message}`);
  }

  const shutdown = (signal) => {
    console.log(`[app] ${signal} received, shutting down`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main();

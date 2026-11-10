// Discord crash alerting (PRD §17).
//
// Hybrid design: the Docker Events listener always runs and logs what it
// sees, but alerts are only pushed to Discord either
//   - automatically on every abnormal `die` event (DISCORD_AUTO_ALERT=true), or
//   - manually from the dashboard (POST /api/containers/:id/alert).
// The Redis cooldown key (TTL 300s) stores {exitCode, crashedAt} and prevents
// alert storms during crash loops. Recoveries are only announced after a 15s
// stability re-inspection so a crash loop cannot fake a green alert.
import { docker } from "./docker.js";
import { deleteKey, getJson, hasKey, setJson } from "./cache.js";

const COOLDOWN_TTL_SECONDS = 300;
const LOG_TAIL_LINES = 10;
const LOG_MAX_CHARS = 1800;
const LOG_TIMEOUT_MS = 5000;
const WEBHOOK_TIMEOUT_MS = 10000;
const RECONNECT_BASE_MS = 5000;
const RECONNECT_MAX_MS = 60000;
const RECOVERY_VERIFY_DELAY_MS = 15000;

const cooldownKey = (name) => `alert:cooldown:${name}`;
const serverEnv = () => (process.env.SERVER_ENV || "LOCAL-DEV").trim() || "LOCAL-DEV";

// Pending stability verifications keyed by container name (see verifyRecovery).
const pendingRecovery = new Map();
const autoAlertEnabled = () =>
  String(process.env.DISCORD_AUTO_ALERT).toLowerCase() === "true";
const webhookUrl = () => (process.env.DISCORD_WEBHOOK_URL || "").trim();

function alerterError(statusCode, message) {
  return Object.assign(new Error(message), { statusCode });
}

const EXIT_MEANINGS = {
  1: "Application error",
  2: "Misuse of shell builtin",
  125: "Docker failed to run container",
  126: "Command not executable",
  127: "Command not found",
  130: "Interrupted by Ctrl+C (SIGINT)",
  139: "Segmentation fault (SIGSEGV)",
  143: "Terminated (SIGTERM)",
};

function describeExitCode(exitCode, oomKilled) {
  if (!Number.isFinite(exitCode)) return "Unknown exit code";
  if (exitCode === 137) {
    return oomKilled ? "Out of memory (OOM killed)" : "Killed (SIGKILL)";
  }
  if (EXIT_MEANINGS[exitCode]) return EXIT_MEANINGS[exitCode];
  if (exitCode >= 128) return `Terminated by signal ${exitCode - 128}`;
  return `Abnormal exit (code ${exitCode})`;
}

// Docker reports a zero date for containers that never started/finished.
function parseDate(iso) {
  if (!iso || iso.startsWith("0001-01-01")) return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

function formatDuration(ms) {
  let rest = Math.max(1, Math.round(ms / 1000));
  const units = [
    ["d", 86400],
    ["h", 3600],
    ["m", 60],
    ["s", 1],
  ];
  const parts = [];
  for (const [suffix, size] of units) {
    const value = Math.floor(rest / size);
    rest -= value * size;
    if (value > 0) parts.push(`${value}${suffix}`);
    if (parts.length === 2) break;
  }
  return parts.join(" ") || "<1s";
}

function formatUptime(startedAt, finishedAt) {
  const start = parseDate(startedAt);
  const end = parseDate(finishedAt);
  if (start == null || end == null || end < start) return "unknown";
  return formatDuration(end - start);
}

// dockerode does not demultiplex: for non-TTY containers the log stream is
// framed as [type byte][3 pad bytes][payload length u32 BE][payload], with
// type 1 = stdout and 2 = stderr. Without this the embed would contain the
// 8-byte frame headers as binary garbage.
function demuxLogStream(buffer) {
  const chunks = [];
  let offset = 0;
  while (offset < buffer.length) {
    if (offset + 8 > buffer.length) return null;
    const type = buffer[offset];
    const length = buffer.readUInt32BE(offset + 4);
    if ((type !== 1 && type !== 2) || offset + 8 + length > buffer.length) {
      // Not a framed stream (e.g. TTY containers) — use it as raw text.
      return null;
    }
    chunks.push(buffer.toString("utf8", offset + 8, offset + 8 + length));
    offset += 8 + length;
  }
  return chunks.join("");
}

// Resolves with everything received before the stream ends or times out
// (logs are best-effort; a hung stream must not block the alert).
function collectStream(stream, timeoutMs) {
  return new Promise((resolve) => {
    const chunks = [];
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(Buffer.concat(chunks));
    };
    const timer = setTimeout(() => {
      try {
        stream.destroy();
      } catch {
        // ignore
      }
      finish();
    }, timeoutMs);
    stream.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    stream.on("end", finish);
    stream.on("error", finish);
  });
}

async function fetchRecentLogs(containerId) {
  try {
    const result = await docker.getContainer(containerId).logs({
      stdout: true,
      stderr: true,
      follow: false,
      tail: LOG_TAIL_LINES,
      timestamps: false,
    });
    // docker-modem resolves follow:false directly to a Buffer of the muxed
    // stream; older versions return a Node stream — support both.
    let raw = null;
    if (Buffer.isBuffer(result)) {
      raw = result;
    } else if (typeof result?.on === "function") {
      raw = await collectStream(result, LOG_TIMEOUT_MS);
    }
    if (!raw || raw.length === 0) return "";
    const text = demuxLogStream(raw) ?? raw.toString("utf8");
    const cleaned = text
      .replace(/\x1B\[[0-9;]*[A-Za-z]/g, "") // strip ANSI color escapes
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .join("\n");
    return cleaned.length > LOG_MAX_CHARS
      ? `…${cleaned.slice(-LOG_MAX_CHARS)}`
      : cleaned;
  } catch (err) {
    console.error(`[alerter] failed to read logs: ${err.message}`);
    return "";
  }
}

async function postWebhook(payload) {
  const url = webhookUrl();
  if (!url) {
    throw alerterError(
      503,
      "Discord webhook is not configured (DISCORD_WEBHOOK_URL is empty)"
    );
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`Discord webhook responded ${res.status}`);
    }
  } finally {
    clearTimeout(timer);
  }
}

function crashEmbed(ctx, logs) {
  const embed = {
    title: `🔴 Container crashed: ${ctx.name}`,
    color: 15548997,
    timestamp: new Date().toISOString(),
    footer: { text: `docker watch [${serverEnv()}] • Docker event: die` },
    fields: [
      { name: "Container", value: ctx.name, inline: true },
      {
        name: "Exit code",
        value: `${ctx.exitCode} — ${describeExitCode(ctx.exitCode, ctx.oomKilled)}`,
        inline: true,
      },
      { name: "Image", value: ctx.image, inline: true },
      { name: "Uptime before crash", value: ctx.uptime, inline: true },
      { name: "Container ID", value: `\`${ctx.shortId}\``, inline: true },
      { name: "OOM killed", value: ctx.oomKilled ? "yes" : "no", inline: true },
    ],
  };
  if (logs) {
    embed.description = "```\n" + logs + "\n```";
  }
  return { username: "docker watch", embeds: [embed] };
}

function recoveryEmbed(ctx) {
  return {
    username: "docker watch",
    embeds: [
      {
        title: `🟢 Container recovered: ${ctx.name}`,
        color: 5763719,
        timestamp: new Date().toISOString(),
        footer: { text: `docker watch [${serverEnv()}] • Docker event: start` },
        fields: [
          { name: "Container", value: ctx.name, inline: true },
          { name: "Image", value: ctx.image, inline: true },
          { name: "Container ID", value: `\`${ctx.shortId}\``, inline: true },
          { name: "Downtime", value: ctx.downtime, inline: true },
        ],
      },
    ],
  };
}

// Inspect the crashed container for context; fall back to event attributes
// when the container is already gone (e.g. started with --rm).
async function buildCrashContext(event) {
  const attrs = event.Actor?.Attributes ?? {};
  const eventId = event.id || event.Actor?.ID || "";
  const context = {
    name: attrs.name || "(unknown)",
    image: attrs.image || "(unknown)",
    shortId: eventId.slice(0, 12) || "(unknown)",
    exitCode: Number.parseInt(attrs.exitCode ?? "", 10),
    oomKilled: false,
    uptime: "unknown",
  };
  if (!eventId) return { containerId: null, context };

  try {
    const info = await docker.getContainer(eventId).inspect();
    const state = info.State ?? {};
    return {
      containerId: info.Id,
      context: {
        name: (info.Name || context.name).replace(/^\//, ""),
        image: info.Config?.Image || context.image,
        shortId: info.Id.slice(0, 12),
        exitCode:
          typeof state.ExitCode === "number" ? state.ExitCode : context.exitCode,
        oomKilled: Boolean(state.OOMKilled),
        uptime: formatUptime(state.StartedAt, state.FinishedAt),
      },
    };
  } catch (err) {
    console.error(`[alerter] inspect failed for ${context.name}: ${err.message}`);
    return { containerId: null, context };
  }
}

// Manual path: the Discord button in the Snapshots drawer (PRD §17.6).
export async function sendCrashAlert(containerId) {
  if (!webhookUrl()) {
    throw alerterError(
      503,
      "Discord webhook is not configured (DISCORD_WEBHOOK_URL is empty)"
    );
  }

  let info;
  try {
    info = await docker.getContainer(containerId).inspect();
  } catch (err) {
    if (err?.statusCode === 404) {
      throw alerterError(404, "Container not found on this Docker host");
    }
    console.error(`[alerter] inspect failed for ${containerId}: ${err.message}`);
    throw alerterError(502, "Cannot reach Docker to inspect this container");
  }

  const state = info.State ?? {};
  const exitCode = state.ExitCode ?? 0;
  if (exitCode === 0) {
    throw alerterError(
      400,
      "This container exited normally (code 0) — there is no crash to alert"
    );
  }

  const name = (info.Name || "").replace(/^\//, "") || containerId;
  const key = cooldownKey(name);
  if (await hasKey(key)) {
    throw alerterError(429, `Alert cooldown active for ${name} (5 minutes)`);
  }

  const ctx = {
    name,
    image: info.Config?.Image || "(unknown)",
    shortId: (info.Id || "").slice(0, 12),
    exitCode,
    oomKilled: Boolean(state.OOMKilled),
    uptime: formatUptime(state.StartedAt, state.FinishedAt),
  };
  const logs = await fetchRecentLogs(info.Id);

  try {
    await postWebhook(crashEmbed(ctx, logs));
  } catch (err) {
    console.error(`[alerter] webhook failed for ${name}: ${err.message}`);
    throw alerterError(502, `Failed to deliver alert to Discord: ${err.message}`);
  }

  await setJson(key, { exitCode, crashedAt: new Date().toISOString() }, COOLDOWN_TTL_SECONDS);
  console.log(`[alerter] manual alert sent for ${name} (exit ${exitCode})`);
  return { name };
}

async function handleDie(event) {
  const { containerId, context } = await buildCrashContext(event);
  const exitCode = context.exitCode;

  // A fresh die always means "not recovered" — drop any pending verification.
  cancelPendingRecovery(context.name, "container died again");

  if (Number.isFinite(exitCode) && exitCode === 0) {
    console.log(`[alerter] die: ${context.name} exited normally (code 0) — ignored`);
    return;
  }

  console.log(
    `[alerter] die: ${context.name} crashed with exit ${exitCode} ` +
      `(${describeExitCode(exitCode, context.oomKilled)})`
  );

  if (!autoAlertEnabled()) {
    console.log("[alerter] auto alert disabled — crash available for manual alerting");
    return;
  }

  const key = cooldownKey(context.name);
  if (await hasKey(key)) {
    console.log(`[alerter] cooldown active for ${context.name} — alert skipped (crash loop?)`);
    return;
  }

  const logs = containerId ? await fetchRecentLogs(containerId) : "";
  try {
    await postWebhook(crashEmbed(context, logs));
    console.log(`[alerter] auto alert sent to Discord for ${context.name}`);
  } catch (err) {
    console.error(`[alerter] failed to send alert for ${context.name}: ${err.message}`);
    return;
  }
  await setJson(key, { exitCode, crashedAt: new Date().toISOString() }, COOLDOWN_TTL_SECONDS);
}

async function handleStart(event) {
  const attrs = event.Actor?.Attributes ?? {};
  const name = attrs.name || "(unknown)";
  const key = cooldownKey(name);
  const record = await getJson(key);
  if (!record) return;

  // The container crashed (and alerted) before. Do not trust a start event:
  // crash loops flap, so verify stability after a delay before recovering.
  scheduleRecoveryVerification(name, key, record);
}

function scheduleRecoveryVerification(name, key, record) {
  cancelPendingRecovery(name, "superseded by a newer start");
  const timer = setTimeout(() => {
    pendingRecovery.delete(name);
    verifyRecovery(name, key, record).catch((err) =>
      console.error(`[alerter] recovery verification failed for ${name}: ${err.message}`)
    );
  }, RECOVERY_VERIFY_DELAY_MS);
  timer.unref();
  pendingRecovery.set(name, { timer });
  console.log(
    `[alerter] start: ${name} was crashed before — verifying stability in ${RECOVERY_VERIFY_DELAY_MS / 1000}s before recovery alert`
  );
}

function cancelPendingRecovery(name, reason) {
  const pending = pendingRecovery.get(name);
  if (!pending) return;
  clearTimeout(pending.timer);
  pendingRecovery.delete(name);
  console.log(`[alerter] recovery verification for ${name} cancelled (${reason})`);
}

async function verifyRecovery(name, key, record) {
  let info = null;
  try {
    info = await docker.getContainer(name).inspect();
  } catch (err) {
    // 404 etc. — the container is gone, which is not a recovery.
  }
  const running = Boolean(info?.State?.Running) && !info?.State?.Restarting;

  if (!running) {
    // Keep the crash record: a later verified recovery clears it, TTL expires it.
    console.log(
      `[alerter] recovery for ${name} cancelled — not running after the stability delay (crash loop?)`
    );
    return;
  }

  const crashedAt = Date.parse(record?.crashedAt ?? "");
  const downtime = Number.isFinite(crashedAt)
    ? formatDuration(Date.now() - crashedAt)
    : "unknown";

  // Verified stable: clear the record so the next crash alerts again.
  await deleteKey(key);
  console.log(`[alerter] recovery verified for ${name} (downtime ${downtime})`);

  // Recovery embeds only in auto mode: manual mode never sends on its own.
  if (!autoAlertEnabled()) {
    console.log("[alerter] auto alert disabled — recovery available for manual alerting");
    return;
  }

  try {
    await postWebhook(
      recoveryEmbed({
        name,
        image: info?.Config?.Image || "(unknown)",
        shortId: (info?.Id || "").slice(0, 12),
        downtime,
      })
    );
    console.log(`[alerter] recovery alert sent to Discord for ${name}`);
  } catch (err) {
    console.error(`[alerter] failed to send recovery alert for ${name}: ${err.message}`);
  }
}

async function handleEventLine(line) {
  let event;
  try {
    event = JSON.parse(line);
  } catch {
    return; // not JSON — ignore
  }
  // Modern engines use Action; older ones use status.
  const action = event.Action || event.status;
  if (action === "die") return handleDie(event);
  if (action === "start") return handleStart(event);
}

let reconnectAttempt = 0;
let reconnecting = false;

function scheduleReconnect(reason) {
  if (reconnecting) return; // error + end + close can all fire for one drop
  reconnecting = true;
  const delay = Math.min(RECONNECT_BASE_MS * 2 ** reconnectAttempt, RECONNECT_MAX_MS);
  reconnectAttempt += 1;
  console.log(
    `[alerter] Docker events stream lost (${reason}) — reconnecting in ${Math.round(delay / 1000)}s`
  );
  setTimeout(() => connectEventStream(), delay).unref();
}

async function connectEventStream() {
  reconnecting = false;
  let stream;
  try {
    stream = await docker.getEvents({
      filters: JSON.stringify({ type: ["container"], event: ["die", "start"] }),
    });
  } catch (err) {
    console.error(`[alerter] cannot open Docker events stream: ${err.message}`);
    scheduleReconnect("connect failed");
    return;
  }

  reconnectAttempt = 0;
  console.log("[alerter] Docker events stream connected (type=container, event=die|start)");

  let buffer = "";
  stream.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    let newlineIndex;
    while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (line) {
        handleEventLine(line).catch((err) =>
          console.error(`[alerter] event handler failed: ${err.message}`)
        );
      }
    }
  });
  stream.on("error", (err) => scheduleReconnect(err.code || err.message));
  stream.on("end", () => scheduleReconnect("stream ended"));
  stream.on("close", () => scheduleReconnect("stream closed"));
}

export function startEventMonitor() {
  connectEventStream();
}

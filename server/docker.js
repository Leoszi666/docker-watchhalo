import Docker from "dockerode";

const MB = 1024 * 1024;
// Tolerance when comparing the cgroup memory limit against the host's total
// RAM: if they are (almost) equal there is no effective per-container limit.
const MEM_LIMIT_TOLERANCE = MB;

const docker = new Docker({
  socketPath: process.env.DOCKER_SOCKET_PATH || "/var/run/docker.sock",
});

// Shared engine client (list/stats/inspect/events listener in alerter.js).
export { docker };

export class DockerUnavailableError extends Error {
  constructor() {
    super("Cannot reach Docker socket");
    this.name = "DockerUnavailableError";
  }
}

function parseHealth(statusText) {
  if (!statusText) return null;
  if (/\(health:\s*starting\)/i.test(statusText)) return "starting";
  if (/\(unhealthy\)/i.test(statusText)) return "unhealthy";
  if (/\(healthy\)/i.test(statusText)) return "healthy";
  return null;
}

function buildHost(info) {
  return {
    name: (info.Name || "").replace(/^\//, "") || "localhost",
    os: info.OperatingSystem || "",
    kernel: info.KernelVersion || "",
    dockerVersion: info.ServerVersion || "",
    cpus: info.NCPU || 0,
    memTotalMB: Math.round((info.MemTotal || 0) / MB),
  };
}

function mapContainer(row) {
  return {
    id: row.Id.slice(0, 12),
    name: (row.Names?.[0] || "").replace(/^\//, ""),
    image: row.Image || "",
    command: row.Command || "",
    state: row.State,
    statusText: row.Status || "",
    health: parseHealth(row.Status),
    exitCode: null,
    oomKilled: false,
    finishedAt: null,
    restartCount: 0,
    ports: (row.Ports || []).map((p) => ({
      host: p.PublicPort ?? null,
      container: p.PrivatePort,
      proto: p.Type,
    })),
    networks: Object.entries(row.NetworkSettings?.Networks || {}).map(
      ([name, net]) => ({ name, ip: net.IPAddress || null })
    ),
    mounts: (row.Mounts || []).map((m) => ({
      type: m.Type,
      // For named volumes the interesting "source" is the volume name; for
      // binds it is the host path.
      source: m.Type === "volume" ? m.Name || m.Source || "" : m.Source || "",
      target: m.Destination || m.Target || "",
      rw: Boolean(m.RW),
    })),
    memUsedMB: null,
    memLimitMB: null,
    cpuPercent: null,
  };
}

// memory_stats.usage counts page cache; subtracting inactive_file gives the
// value `docker stats` reports (cgroup v2 field name first, v1 fallback).
function computeMemUsedMB(stats) {
  const memStats = stats.memory_stats;
  if (typeof memStats?.usage !== "number") return null;
  const inactive =
    memStats.stats?.inactive_file ?? memStats.stats?.total_inactive_file ?? 0;
  return (memStats.usage - inactive) / MB;
}

function resolveMemLimitMB(stats, hostConfigMemory, hostMemTotalBytes) {
  const limit = stats.memory_stats?.limit;
  if (typeof limit !== "number") return null;
  // No explicit --memory flag, or the limit is just the host's total RAM:
  // both mean "no effective limit" (design.md §6.5).
  if (hostConfigMemory === 0) return null;
  if (Math.abs(limit - hostMemTotalBytes) <= MEM_LIMIT_TOLERANCE) return null;
  return limit / MB;
}

function computeCpuPercent(stats) {
  const cpu = stats.cpu_stats || {};
  const pre = stats.precpu_stats || {};
  const cpuDelta =
    (cpu.cpu_usage?.total_usage ?? 0) - (pre.cpu_usage?.total_usage ?? 0);
  const systemDelta =
    (cpu.system_cpu_usage ?? 0) - (pre.system_cpu_usage ?? 0);
  const onlineCpus =
    cpu.online_cpus ?? cpu.cpu_usage?.percpu_usage?.length ?? 0;
  if (cpuDelta <= 0 || systemDelta <= 0 || onlineCpus <= 0) return null;
  const percent = (cpuDelta / systemDelta) * onlineCpus * 100;
  return Math.round(percent * 10) / 10;
}

// Docker reports a zero date for containers that never finished.
function normalizeFinishedAt(finishedAt) {
  if (!finishedAt || finishedAt.startsWith("0001-01-01")) return null;
  return finishedAt;
}

function unavailable(cause) {
  console.error(`[docker] socket unreachable: ${cause}`);
  return new DockerUnavailableError();
}

/**
 * Read host info + all containers from the Docker Engine API.
 * Throws DockerUnavailableError when the socket is not readable.
 */
export async function getHostAndContainers() {
  let info;
  try {
    info = await docker.info();
  } catch (err) {
    throw unavailable(err.code || err.message);
  }

  let list;
  try {
    list = await docker.listContainers({ all: true });
  } catch (err) {
    throw unavailable(err.code || err.message);
  }

  const hostMemTotalBytes = info.MemTotal || 0;
  const rows = list.map((row) => ({ row, item: mapContainer(row) }));
  const running = rows.filter((r) => r.row.State === "running");
  const stopped = rows.filter((r) => r.row.State !== "running");

  // Stats are slow, so fetch them in parallel; one failing container must
  // not break the response (its memory/CPU stay null).
  const statResults = await Promise.allSettled(
    running.map((r) => docker.getContainer(r.row.Id).stats({ stream: false }))
  );
  running.forEach((r, i) => {
    const result = statResults[i];
    if (result.status !== "fulfilled") {
      console.error(
        `[docker] stats failed for ${r.item.name}: ${result.reason?.message}`
      );
      return;
    }
    r.item.memUsedMB = computeMemUsedMB(result.value);
    r.item.memLimitMB = resolveMemLimitMB(
      result.value,
      r.row.HostConfig?.Memory,
      hostMemTotalBytes
    );
    r.item.cpuPercent = computeCpuPercent(result.value);
  });

  // Inspect is only called for non-running containers (exit code, OOM, ...).
  const inspectResults = await Promise.allSettled(
    stopped.map((r) => docker.getContainer(r.row.Id).inspect())
  );
  stopped.forEach((r, i) => {
    const result = inspectResults[i];
    if (result.status !== "fulfilled") {
      console.error(
        `[docker] inspect failed for ${r.item.name}: ${result.reason?.message}`
      );
      return;
    }
    const state = result.value.State || {};
    r.item.exitCode = state.ExitCode ?? null;
    r.item.oomKilled = Boolean(state.OOMKilled);
    r.item.finishedAt = normalizeFinishedAt(state.FinishedAt);
    r.item.restartCount = result.value.RestartCount ?? 0;
  });

  return { host: buildHost(info), containers: rows.map((r) => r.item) };
}

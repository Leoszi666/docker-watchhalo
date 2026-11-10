import { useCallback, useEffect, useMemo, useState } from 'react';

import { Cpu, Info, MemoryStick, Server } from 'lucide-react';

import { fetchContainers, fetchSnapshots } from './api.js';
import Header from './components/Header.jsx';
import SummaryCards from './components/SummaryCards.jsx';
import AttentionPanel from './components/AttentionPanel.jsx';
import ContainerTable from './components/ContainerTable.jsx';
import InspectDrawer from './components/InspectDrawer.jsx';
import SnapshotDrawer from './components/SnapshotDrawer.jsx';

// Memory thresholds (design.md §6.5/§7). Single source of truth: the HIGH_MEM
// filter, MemoryBar and AttentionPanel import these from here — never duplicate.
export const MEM_WARN = 70;
export const MEM_CRIT = 85;

const POLL_INTERVAL_MS = 5000;
const DOCKER_SOCK = '/var/run/docker.sock';

export function memPercent(container) {
  if (container.memUsedMB == null || container.memLimitMB == null || container.memLimitMB <= 0) {
    return null;
  }
  return (container.memUsedMB / container.memLimitMB) * 100;
}

export function memLevel(percent) {
  if (percent == null) return 'none';
  if (percent >= MEM_CRIT) return 'crit';
  if (percent >= MEM_WARN) return 'warn';
  return 'ok';
}

// High memory = running, with a real limit, at or above the warning threshold.
// A container without a limit is never counted (the "limit" would be host RAM).
export function isHighMem(container) {
  if (container.state !== 'running' || container.memLimitMB == null) return false;
  const percent = memPercent(container);
  return percent != null && percent >= MEM_WARN;
}

// Uptime / finished time comes straight from Docker's Status string
// ("Up 4 days (healthy)" becomes "Up 4 days"; "Exited (137) 14 min ago" becomes "14 min ago").
export function timeText(container) {
  const status = container.statusText || '';
  if (container.state === 'running') {
    return status.replace(/\s*\((?:healthy|unhealthy|health: starting)\)/i, '').trim();
  }
  return status.replace(/^exited\s*(\(\d+\))?\s*/i, '').trim() || status;
}

// Problems first: exited, then highest memory pressure, rest alphabetical.
export function sortContainers(containers) {
  return [...containers].sort((a, b) => {
    const aExited = a.state !== 'running';
    const bExited = b.state !== 'running';
    if (aExited !== bExited) return aExited ? -1 : 1;
    if (aExited && bExited) return a.name.localeCompare(b.name);
    const aHigh = isHighMem(a);
    const bHigh = isHighMem(b);
    if (aHigh !== bHigh) return aHigh ? -1 : 1;
    if (aHigh) return memPercent(b) - memPercent(a);
    return a.name.localeCompare(b.name);
  });
}

export default function App() {
  const [data, setData] = useState(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const [socketError, setSocketError] = useState(false); // 503: Docker socket unreadable
  const [serverError, setServerError] = useState(false); // fetch failed: backend down
  const [paused, setPaused] = useState(false);
  const [filter, setFilter] = useState('ALL');
  const [search, setSearch] = useState('');
  const [inspectId, setInspectId] = useState(null);
  const [snapshotsOpen, setSnapshotsOpen] = useState(false);
  const [snapshots, setSnapshots] = useState(null);
  const [snapshotsError, setSnapshotsError] = useState(false);

  const containers = data?.containers ?? [];
  const host = data?.host ?? null;
  const stale = data != null && (socketError || serverError);
  const inspectContainer = inspectId ? containers.find((c) => c.id === inspectId) ?? null : null;

  const loadContainers = useCallback(async () => {
    try {
      const payload = await fetchContainers();
      setData(payload);
      setSocketError(false);
      setServerError(false);
    } catch (err) {
      if (err.kind === 'network' || err.status !== 503) {
        setServerError(true);
      } else {
        setSocketError(true);
      }
    } finally {
      setInitialLoading(false);
    }
  }, []);

  const loadSnapshots = useCallback(async () => {
    try {
      const list = await fetchSnapshots();
      setSnapshots(list);
      setSnapshotsError(false);
    } catch {
      setSnapshotsError(true);
    }
  }, []);

  useEffect(() => {
    if (paused) return undefined;

    let inFlight = false;
    const tick = () => {
      if (inFlight) return; // skip the cycle while the previous request is unfinished
      inFlight = true;
      loadContainers().finally(() => {
        inFlight = false;
      });
    };

    tick();
    const interval = setInterval(tick, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [paused]);

  useEffect(() => {
    loadSnapshots();
  }, [loadSnapshots]);

  const handleFilterChange = useCallback((next) => {
    setFilter((current) => (current === next ? 'ALL' : next));
  }, []);

  const clearFilters = useCallback(() => {
    setFilter('ALL');
    setSearch('');
  }, []);

  const openInspect = useCallback((container) => setInspectId(container.id), []);
  const closeInspect = useCallback(() => setInspectId(null), []);
  const openSnapshots = useCallback(() => setSnapshotsOpen(true), []);
  const closeSnapshots = useCallback(() => setSnapshotsOpen(false), []);
  const togglePause = useCallback(() => setPaused((current) => !current), []);

  const visible = useMemo(() => {
    let list = containers;
    if (filter === 'RUNNING') {
      list = list.filter((c) => c.state === 'running');
    } else if (filter === 'EXITED') {
      list = list.filter((c) => c.state !== 'running');
    } else if (filter === 'HIGH_MEM') {
      list = list.filter(isHighMem);
    }
    const query = search.trim().toLowerCase();
    if (query) {
      list = list.filter(
        (c) =>
          c.name.toLowerCase().includes(query) ||
          c.image.toLowerCase().includes(query) ||
          (c.ports ?? []).some(
            (p) => String(p.host ?? '').includes(query) || String(p.container ?? '').includes(query)
          )
      );
    }
    return sortContainers(list);
  }, [containers, filter, search]);

  // Host identity lives in the footer as environment meta, next to the socket path.
  const hostFacts = host
    ? [
        { icon: Server, label: host.name, bright: true },
        { icon: Info, label: `Docker ${host.dockerVersion}` },
        { icon: Cpu, label: `${host.cpus} CPU` },
        { icon: MemoryStick, label: `${Math.round(host.memTotalMB / 1024)} GB` },
      ]
    : [];

  return (
    <div className="min-h-screen bg-canvas text-ink">
      <Header
        updatedAt={data?.updatedAt ?? null}
        cached={data?.cached === true}
        paused={paused}
        socketError={socketError}
        serverError={serverError}
        snapshotCount={snapshots?.length ?? null}
        onTogglePause={togglePause}
        onOpenSnapshots={openSnapshots}
      />

      <main className="mx-auto max-w-[1280px] px-4 py-4" aria-busy={initialLoading}>
        {serverError && (
          <div role="alert" className="mb-4 rounded-lg border border-crit/40 bg-crit/10 px-4 py-3 text-[12px] text-crit">
            Cannot reach the server.
          </div>
        )}
        {socketError && (
          <div role="alert" className="mb-4 rounded-lg border border-crit/40 bg-crit/10 px-4 py-3 text-[12px] text-crit">
            Cannot reach Docker socket. Check that /var/run/docker.sock is mounted and readable.
          </div>
        )}

        {initialLoading ? (
          <SkeletonScreen />
        ) : data == null ? (
          <p className="py-10 text-center text-[12px] text-muted">No data yet. Retrying every 5 seconds.</p>
        ) : (
          <div className={stale ? 'opacity-60' : undefined}>
            <SummaryCards containers={containers} filter={filter} onFilterChange={handleFilterChange} />
            <div className="mt-4">
              <AttentionPanel containers={containers} onSelect={openInspect} />
            </div>
            <div className="mt-4">
              <ContainerTable
                containers={containers}
                visible={visible}
                search={search}
                onSearchChange={setSearch}
                onSelect={openInspect}
                onClearFilters={clearFilters}
              />
            </div>
            <footer className="mt-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-[11px] tabular-nums text-muted">
              {hostFacts.length > 0 && (
                <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
                  {hostFacts.map(({ icon: Icon, label, bright }) => (
                    <span key={label} className={`flex items-center gap-1.5 ${bright ? 'text-ink2' : ''}`}>
                      <Icon size={12} aria-hidden="true" />
                      <span>{label}</span>
                    </span>
                  ))}
                </span>
              )}
              <span className="truncate font-mono">{DOCKER_SOCK}</span>
            </footer>
          </div>
        )}
      </main>

      {inspectContainer && <InspectDrawer container={inspectContainer} onClose={closeInspect} />}
      {snapshotsOpen && (
        <SnapshotDrawer
          snapshots={snapshots}
          snapshotsError={snapshotsError}
          onRefresh={loadSnapshots}
          onClose={closeSnapshots}
        />
      )}
    </div>
  );
}

function SkeletonScreen() {
  return (
    <div aria-hidden="true">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="rounded-lg border border-line p-4">
            <div className="h-3 w-16 animate-pulse rounded-sm bg-surface2" />
            <div className="mt-3 h-7 w-12 animate-pulse rounded-sm bg-surface2" />
            <div className="mt-2 h-2.5 w-20 animate-pulse rounded-sm bg-surface2" />
          </div>
        ))}
      </div>
      <div className="mt-4">
        <div className="border-b border-line px-4 py-3">
          <div className="h-3.5 w-24 animate-pulse rounded-sm bg-surface2" />
        </div>
        <div className="divide-y divide-line">
          {Array.from({ length: 5 }).map((_, index) => (
            <div key={index} className="flex items-center gap-4 px-4 py-3.5">
              <div className="h-2 w-2 animate-pulse rounded-full bg-surface2" />
              <div className="h-3 w-40 animate-pulse rounded-sm bg-surface2" />
              <div className="h-3 w-24 animate-pulse rounded-sm bg-surface2" />
              <div className="ml-auto h-3 w-28 animate-pulse rounded-sm bg-surface2" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

import { Search } from 'lucide-react';

import { memLevel, memPercent, timeText } from '../App.jsx';

const CHIP_KINDS = {
  ok: { text: 'text-ok', bg: 'bg-ok/10', border: 'border-ok/30' },
  warn: { text: 'text-warn', bg: 'bg-warn/10', border: 'border-warn/30' },
  crit: { text: 'text-crit', bg: 'bg-crit/10', border: 'border-crit/30' },
  neutral: { text: 'text-ink2', bg: 'bg-surface2', border: 'border-line' },
};

const DOT_KINDS = {
  ok: 'bg-ok',
  warn: 'bg-warn',
  crit: 'bg-crit',
  neutral: 'bg-ink2',
};

// Badge text/kind per design.md §6.4 — status is always text, never color-only.
export function statusInfo(container) {
  const { state, health, exitCode, oomKilled } = container;
  if (state === 'running') {
    if (health === 'unhealthy') return { label: 'UNHEALTHY', kind: 'crit' };
    if (health === 'starting') return { label: 'RUNNING (starting)', kind: 'warn' };
    if (health === 'healthy') return { label: 'RUNNING (healthy)', kind: 'ok' };
    return { label: 'RUNNING', kind: 'ok' };
  }
  if (oomKilled) return { label: 'EXITED (OOM)', kind: 'crit' };
  if (exitCode == null || exitCode === 0) return { label: 'EXITED', kind: 'neutral' };
  return { label: `EXITED (${exitCode})`, kind: 'crit' };
}

function Chip({ kind, children }) {
  const style = CHIP_KINDS[kind];
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-md border px-1.5 py-0.5 text-[11px] font-medium ${style.bg} ${style.border} ${style.text}`}
    >
      {children}
    </span>
  );
}

export function StatusBadge({ container }) {
  const info = statusInfo(container);
  return <Chip kind={info.kind}>{info.label}</Chip>;
}

function formatMB(value) {
  return Math.round(value).toLocaleString('en-US');
}

// Memory cell per design.md §6.5: bar + percent when a real limit exists,
// "no limit" text without a bar, and "—" for stopped containers.
export function MemoryBar({ container }) {
  if (container.state !== 'running' || container.memUsedMB == null) {
    return <span className="text-[12px] text-muted">—</span>;
  }

  const percent = memPercent(container);

  if (percent == null) {
    return (
      <span className="whitespace-nowrap text-[12px] tabular-nums text-ink2">
        {formatMB(container.memUsedMB)} MB (no limit)
      </span>
    );
  }

  const level = memLevel(percent);
  const barClass = level === 'crit' ? 'bg-crit' : level === 'warn' ? 'bg-warn' : 'bg-ok';

  return (
    <div className="w-44 max-w-full">
      <div className="flex items-center gap-2 whitespace-nowrap">
        <span className="text-[12px] tabular-nums text-ink">
          {formatMB(container.memUsedMB)} / {formatMB(container.memLimitMB)} MB
        </span>
        <span className="text-[11px] tabular-nums text-muted">{Math.round(percent)}%</span>
        {level === 'warn' && <Chip kind="warn">ELEVATED</Chip>}
        {level === 'crit' && <Chip kind="crit">CRITICAL</Chip>}
      </div>
      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-surface2">
        <div className={`h-full rounded-full ${barClass}`} style={{ width: `${Math.min(percent, 100)}%` }} />
      </div>
    </div>
  );
}

export default function ContainerTable({ containers, visible, search, onSearchChange, onSelect, onClearFilters }) {
  return (
    <section>
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line px-4 py-3">
        <h2 className="text-[14px] font-semibold">
          Containers
          <span className="ml-1.5 font-normal tabular-nums text-muted">
            ({visible.length}/{containers.length})
          </span>
        </h2>
        <div className="relative">
          <Search
            size={14}
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
          />
          <input
            type="search"
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Search name, image, port…"
            aria-label="Search containers by name, image, or port"
            className="dw-focus w-56 rounded-md border border-line bg-surface2 py-1.5 pl-9 pr-3 text-[12px] text-ink placeholder:text-muted focus:border-lineStrong sm:w-64"
          />
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="px-4 py-10 text-center">
          <p className="text-[12px] text-muted">
            {containers.length === 0
              ? 'No containers found on this Docker host.'
              : search.trim()
                ? `No containers match "${search.trim()}".`
                : 'No containers match the current filter.'}
          </p>
          {containers.length > 0 && (
            <button
              type="button"
              onClick={onClearFilters}
              className="dw-focus mt-4 rounded-md border border-line bg-surface2 px-3 py-1.5 text-[12px] text-ink2 hover:bg-hover hover:text-ink"
            >
              Clear filters
            </button>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] border-collapse text-left">
            <thead>
              <tr className="text-[11px] text-ink2">
                <th scope="col" className="px-4 py-3 font-normal">Name</th>
                <th scope="col" className="px-4 py-3 font-normal">Status</th>
                <th scope="col" className="hidden px-4 py-3 font-normal lg:table-cell">Image</th>
                <th scope="col" className="hidden px-4 py-3 font-normal lg:table-cell">CPU</th>
                <th scope="col" className="px-4 py-3 font-normal">Memory</th>
                <th scope="col" className="px-4 py-3 font-normal">Network</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((container) => (
                <ContainerRow key={container.id} container={container} onSelect={onSelect} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function ContainerRow({ container, onSelect }) {
  const info = statusInfo(container);

  const handleKeyDown = (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onSelect(container);
    }
  };

  return (
    <tr
      tabIndex={0}
      role="button"
      aria-label={`Inspect ${container.name}`}
      onClick={() => onSelect(container)}
      onKeyDown={handleKeyDown}
      className="dw-focus cursor-pointer border-b border-line last:border-b-0 hover:bg-hover"
    >
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <span className={`h-2 w-2 shrink-0 rounded-full ${DOT_KINDS[info.kind]}`} aria-hidden="true" />
          <div className="min-w-0">
            <div className="truncate text-[13px] font-medium text-ink">{container.name}</div>
            <div className="font-mono text-[12px] text-ink2">{container.id}</div>
          </div>
        </div>
      </td>
      <td className="whitespace-nowrap px-4 py-3">
        <StatusBadge container={container} />
        <div className="mt-1 text-[11px] text-ink2">{timeText(container)}</div>
      </td>
      <td className="hidden px-4 py-3 lg:table-cell">
        <span
          title={container.image}
          className="inline-block max-w-[220px] truncate rounded-md bg-surface2 px-2 py-0.5 font-mono text-[12px] text-ink2"
        >
          {container.image}
        </span>
      </td>
      <td className="hidden px-4 py-3 lg:table-cell">
        {container.cpuPercent == null ? (
          <span className="text-[12px] text-muted">—</span>
        ) : (
          <span className="whitespace-nowrap text-[12px] tabular-nums text-ink2">
            {container.cpuPercent.toFixed(1)}%
          </span>
        )}
      </td>
      <td className="px-4 py-3">
        <MemoryBar container={container} />
      </td>
      <td className="px-4 py-3">
        <NetworkInfo container={container} />
      </td>
    </tr>
  );
}

function NetworkInfo({ container }) {
  const publicPorts = (container.ports ?? []).filter((port) => port.host != null);
  const networks = container.networks ?? [];

  return (
    <div className="min-w-0">
      {publicPorts.length === 0 ? (
        <div className="text-[12px] text-muted">internal</div>
      ) : (
        publicPorts.map((port, index) => (
          <div
            key={`port-${index}`}
            className="whitespace-nowrap font-mono text-[12px] text-ink2"
          >
            {port.host}:{port.container}/{port.proto}
          </div>
        ))
      )}
      {networks.map((network, index) => (
        <div key={`net-${index}`} className="whitespace-nowrap font-mono text-[12px] text-muted">
          {network.name}: {network.ip}
        </div>
      ))}
    </div>
  );
}

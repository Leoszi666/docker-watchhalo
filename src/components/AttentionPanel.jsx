import { useMemo, useState } from 'react';

import { ChevronDown, ChevronUp } from 'lucide-react';

import { MEM_CRIT, memPercent, timeText } from '../App.jsx';

function exitedDetail(container) {
  const when = timeText(container);
  if (container.oomKilled) return `exited ${when}, exit ${container.exitCode ?? '?'} (OOM killed)`;
  if (container.exitCode === 137) return `exited ${when}, exit 137 (killed by SIGKILL)`;
  return `exited ${when}, exit ${container.exitCode ?? '?'}`;
}

function memoryDetail(container) {
  const percent = Math.round(memPercent(container));
  return `memory ${Math.round(container.memUsedMB).toLocaleString('en-US')} / ${Math.round(
    container.memLimitMB
  ).toLocaleString('en-US')} MB (${percent}%)`;
}

// One row per problem container, priority: exited first, then memory at or above
// MEM_CRIT, then unhealthy.
function buildRows(containers) {
  const exited = [];
  const memory = [];
  const health = [];

  for (const container of containers) {
    if (container.state !== 'running') {
      exited.push(container);
      continue;
    }
    const percent = memPercent(container);
    if (percent != null && percent >= MEM_CRIT) {
      memory.push(container);
      continue;
    }
    if (container.health === 'unhealthy') {
      health.push(container);
    }
  }

  memory.sort((a, b) => memPercent(b) - memPercent(a));

  return [
    ...exited.map((c) => ({ key: `exit-${c.id}`, container: c, name: c.name, detail: exitedDetail(c) })),
    ...memory.map((c) => ({ key: `mem-${c.id}`, container: c, name: c.name, detail: memoryDetail(c) })),
    ...health.map((c) => ({ key: `health-${c.id}`, container: c, name: c.name, detail: 'healthcheck failing' })),
  ];
}

export default function AttentionPanel({ containers, onSelect }) {
  // With many problem containers (e.g. 19 exited containers on a dev machine),
  // the full list becomes a wall of rows. Show the first few, expand the rest.
  const COLLAPSED_ROWS = 4;
  const [expanded, setExpanded] = useState(false);

  if (containers.length === 0) return null;

  const rows = buildRows(containers);
  const visibleRows = expanded ? rows : rows.slice(0, COLLAPSED_ROWS);
  const hiddenCount = rows.length - visibleRows.length;

  if (rows.length === 0) {
    return (
      <section className="px-4 py-3">
        <p className="text-[12px] text-ok">All {containers.length} containers running, memory normal.</p>
      </section>
    );
  }

  return (
    <section>
      <h2 className="border-b border-line px-4 py-3 text-[14px] font-semibold">
        Needs attention
        <span className="ml-1.5 font-normal tabular-nums text-muted">({rows.length})</span>
      </h2>
      <ul className="divide-y divide-line">
        {visibleRows.map((row) => (
          <li key={row.key}>
            <button
              type="button"
              onClick={() => onSelect(row.container)}
              className="dw-focus flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-hover"
            >
              <span className="h-2 w-2 shrink-0 rounded-full bg-crit" aria-hidden="true" />
              <span className="min-w-0 truncate text-[12px]">
                <span className="font-medium text-ink">{row.name}</span>{' '}
                <span className="tabular-nums text-ink2">{row.detail}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      {hiddenCount > 0 && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          aria-expanded={expanded}
          className="dw-focus flex w-full items-center gap-2 border-t border-line px-4 py-2.5 text-[12px] text-blue hover:bg-hover"
        >
          <ChevronDown size={14} aria-hidden="true" />
          Show {hiddenCount} more problem{hiddenCount > 1 ? 's' : ''}
        </button>
      )}
      {expanded && rows.length > COLLAPSED_ROWS && (
        <button
          type="button"
          onClick={() => setExpanded(false)}
          aria-expanded={true}
          className="dw-focus flex w-full items-center gap-2 border-t border-line px-4 py-2.5 text-[12px] text-blue hover:bg-hover"
        >
          <ChevronUp size={14} aria-hidden="true" />
          Show less
        </button>
      )}
    </section>
  );
}

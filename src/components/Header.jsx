import { Pause, Play } from 'lucide-react';

import dockerLogoUrl from '../assets/docker-logo.svg';

function formatClock(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

export default function Header({
  updatedAt,
  cached,
  paused,
  socketError,
  serverError,
  snapshotCount,
  onTogglePause,
  onOpenSnapshots,
}) {
  const clock = updatedAt ? formatClock(updatedAt) : null;

  let dotClass = 'bg-white/60';
  let statusText = 'Connecting…';
  let showCached = false;
  let showStale = false;

  if (paused) {
    dotClass = 'bg-white/60';
    statusText = 'Paused';
  } else if (serverError) {
    dotClass = 'bg-crit';
    statusText = 'Disconnected';
  } else if (socketError) {
    dotClass = 'bg-warn';
    statusText = clock ? `Updated ${clock}` : 'Stale';
    showStale = true;
  } else if (clock) {
    dotClass = 'bg-ok';
    statusText = `Updated ${clock}`;
    showCached = cached;
  }

  return (
    <header className="sticky top-0 z-40 border-b border-white/15 bg-bar">
      <div className="mx-auto flex h-14 max-w-[1280px] items-center gap-4 px-4">
        <div className="flex min-w-0 items-center gap-2">
          <img src={dockerLogoUrl} alt="" width={22} height={22} className="shrink-0" />
          <span className="whitespace-nowrap text-[14px] font-semibold tracking-tight text-white">
            docker watch
          </span>
        </div>

        <div className="ml-auto flex items-center gap-2 sm:gap-3">
          <div className="flex items-center gap-2 whitespace-nowrap text-[12px] text-white">
            <span className={`h-2 w-2 shrink-0 rounded-full ${dotClass}`} aria-hidden="true" />
            <span className="hidden sm:inline tabular-nums">{statusText}</span>
            {showStale && (
              <span className="hidden rounded-md border border-white/40 bg-white/15 px-1.5 py-0.5 text-[11px] text-white sm:inline">
                Stale
              </span>
            )}
            {showCached && (
              <span className="hidden rounded-md border border-white/30 bg-white/10 px-2 py-1 text-xs font-medium text-white sm:inline">
                cached
              </span>
            )}
          </div>

          <button
            type="button"
            onClick={onTogglePause}
            aria-pressed={paused}
            className="flex items-center gap-1.5 whitespace-nowrap rounded-md border border-white/30 px-3 py-1.5 text-[12px] text-white transition-colors hover:border-white hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
          >
            {paused ? <Play size={12} aria-hidden="true" /> : <Pause size={12} aria-hidden="true" />}
            {paused ? 'Resume' : 'Pause'}
          </button>

          <button
            type="button"
            onClick={onOpenSnapshots}
            className="flex items-center gap-2 whitespace-nowrap rounded-md border border-white/30 px-3 py-1.5 text-[12px] text-white transition-colors hover:border-white hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
          >
            Snapshots
            {snapshotCount != null && (
              <span className="rounded-md bg-white/15 px-1.5 py-0.5 text-[11px] tabular-nums text-white">
                {snapshotCount}
              </span>
            )}
          </button>
        </div>
      </div>
    </header>
  );
}

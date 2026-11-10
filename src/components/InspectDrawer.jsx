import { useEffect, useRef, useState } from 'react';
import { Check, Copy, X } from 'lucide-react';

import { MemoryBar, StatusBadge } from './ContainerTable.jsx';

function formatDateTime(iso) {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return String(iso);
  return date.toLocaleString();
}

export default function InspectDrawer({ container, onClose }) {
  const panelRef = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const previouslyFocused = document.activeElement;
    panelRef.current?.focus();

    const handleKey = (event) => {
      if (event.key === 'Escape') onCloseRef.current();
    };
    document.addEventListener('keydown', handleKey);

    return () => {
      document.removeEventListener('keydown', handleKey);
      if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
        previouslyFocused.focus();
      }
    };
  }, []);

  const networks = container.networks ?? [];
  const ports = container.ports ?? [];
  const mounts = container.mounts ?? [];
  const publicPorts = ports.filter((port) => port.host != null);

  return (
    <div className="fixed inset-0 z-50">
      <div className="dw-fade-in absolute inset-0 bg-black/60" onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Inspect ${container.name}`}
        tabIndex={-1}
        className="dw-animate-in absolute inset-y-0 right-0 flex w-full max-w-[420px] flex-col overflow-y-auto border-l border-line bg-surface shadow-xl focus:outline-none"
      >
        <div className="flex items-start justify-between gap-4 border-b border-line px-4 py-4">
          <div className="min-w-0">
            <h2 className="truncate text-[14px] font-semibold">{container.name}</h2>
            <div className="mt-2">
              <StatusBadge container={container} />
            </div>
            <CopyId id={container.id} />
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="dw-focus shrink-0 rounded-md border border-line p-1.5 text-ink2 hover:bg-hover hover:text-ink"
          >
            <X size={14} aria-hidden="true" />
          </button>
        </div>

        {container.state !== 'running' && (
          <Section label="Condition">
            <Row label="Exit code">{container.exitCode ?? '—'}</Row>
            <Row label="OOM killed">{container.oomKilled ? 'yes' : 'no'}</Row>
            <Row label="Stopped">{formatDateTime(container.finishedAt)}</Row>
            <Row label="Restarts">{container.restartCount ?? 0}</Row>
          </Section>
        )}

        <Section label="Resources">
          <MemoryBar container={container} />
          <Row label="CPU">
            {container.cpuPercent == null ? '—' : `${container.cpuPercent.toFixed(1)}%`}
          </Row>
        </Section>

        <Section label="Image & command">
          <div className="truncate font-mono text-[12px] text-ink2" title={container.image}>
            {container.image}
          </div>
          <div className="break-words font-mono text-[12px] text-ink2">{container.command || '—'}</div>
        </Section>

        <Section label="Network">
          {networks.map((network, index) => (
            <div key={`net-${index}`} className="truncate font-mono text-[12px] text-ink2">
              {network.name}: {network.ip}
            </div>
          ))}
          {publicPorts.map((port, index) => (
            <div key={`port-${index}`} className="truncate font-mono text-[12px] text-ink2">
              {port.host}:{port.container}/{port.proto}
            </div>
          ))}
          {publicPorts.length === 0 && <p className="text-[12px] text-muted">internal</p>}
        </Section>

        <Section label="Storage">
          {mounts.length === 0 ? (
            <p className="text-[12px] text-muted">—</p>
          ) : (
            mounts.map((mount, index) => {
              // Mirrors Compose volume syntax: source:target (mode).
              const summary = `${mount.type} ${mount.source}:${mount.target} (${mount.rw ? 'rw' : 'ro'})`;
              return (
                <div key={`mount-${index}`} className="truncate text-[12px] text-ink2" title={summary}>
                  <span className="text-muted">{mount.type}</span>{' '}
                  <span className="font-mono">{mount.source}:{mount.target}</span>{' '}
                  <span className="text-muted">({mount.rw ? 'rw' : 'ro'})</span>
                </div>
              );
            })
          )}
        </Section>

        <Section label="Healthcheck">
          {container.health ? (
            <span
              className={`text-[12px] ${
                container.health === 'healthy'
                  ? 'text-ok'
                  : container.health === 'unhealthy'
                    ? 'text-crit'
                    : 'text-warn'
              }`}
            >
              {container.health}
            </span>
          ) : (
            <span className="text-[12px] text-muted">none</span>
          )}
        </Section>
      </div>
    </div>
  );
}

function Section({ label, children }) {
  return (
    <section className="border-b border-line px-4 py-4 last:border-b-0">
      <h3 className="text-[11px] text-muted">{label}</h3>
      <div className="mt-2 space-y-0.5">{children}</div>
    </section>
  );
}

function Row({ label, children }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-0.5">
      <span className="shrink-0 text-[12px] text-muted">{label}</span>
      <span className="min-w-0 truncate text-right text-[12px] tabular-nums text-ink">{children}</span>
    </div>
  );
}

function CopyId({ id }) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef(null);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(id);
      setCopied(true);
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard unavailable (e.g. insecure context) — the id stays visible as text.
    }
  };

  return (
    <button
      type="button"
      onClick={copy}
      title="Copy full ID"
      className="dw-focus mt-2 flex items-center gap-1.5 rounded-md border border-line bg-surface2 px-2 py-1 font-mono text-[12px] text-ink2 hover:text-ink"
    >
      {id}
      {copied ? (
        <Check size={12} aria-hidden="true" className="text-ok" />
      ) : (
        <Copy size={12} aria-hidden="true" />
      )}
      {copied && <span className="font-sans text-[11px] text-ok">Copied</span>}
    </button>
  );
}

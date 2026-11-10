import { useEffect, useRef, useState } from 'react';
import { ChevronDown, X } from 'lucide-react';

import { createSnapshot, sendDiscordAlert } from '../api.js';

const TAGS = ['ROUTINE_CHECK', 'INCIDENT_AUDIT', 'PRE_DEPLOY', 'POST_DEPLOY'];
const NOTE_LIMIT = 500;

function formatDateTime(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return String(iso);
  return date.toLocaleString();
}

function formatMem(mem) {
  return mem == null ? '—' : `${Math.round(mem).toLocaleString('en-US')} MB`;
}

export default function SnapshotDrawer({ snapshots, snapshotsError, onRefresh, onClose }) {
  const [tag, setTag] = useState('ROUTINE_CHECK');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(null);
  const [expandedId, setExpandedId] = useState(null);

  const panelRef = useRef(null);
  const toastTimerRef = useRef(null);
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
      clearTimeout(toastTimerRef.current);
      if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
        previouslyFocused.focus();
      }
    };
  }, []);

  const showToast = (message) => {
    setToast(message);
    clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 4000);
  };

  const submit = async (event) => {
    event.preventDefault();
    const trimmed = note.trim();
    if (!trimmed || submitting) return;

    setSubmitting(true);
    setError(null);
    try {
      const saved = await createSnapshot({ tag, note: trimmed });
      setNote('');
      showToast(`Snapshot #${saved.id} saved`);
      onRefresh();
    } catch (err) {
      setError(err.kind === 'network' ? 'Cannot reach the server.' : err.message || 'Cannot save snapshot.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50">
      <div className="dw-fade-in absolute inset-0 bg-black/60" onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Snapshots"
        tabIndex={-1}
        className="dw-animate-in absolute inset-y-0 right-0 flex w-full max-w-[420px] flex-col border-l border-line bg-surface shadow-xl focus:outline-none"
      >
        <div className="flex items-center justify-between border-b border-line px-4 py-4">
          <h2 className="text-[14px] font-semibold">Snapshots</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="dw-focus rounded-md border border-line p-1.5 text-ink2 hover:bg-hover hover:text-ink"
          >
            <X size={14} aria-hidden="true" />
          </button>
        </div>

        <form onSubmit={submit} noValidate className="border-b border-line px-4 py-4">
          {error && (
            <p role="alert" className="mb-3 rounded-md border border-crit/40 bg-crit/10 px-3 py-2 text-[12px] text-crit">
              {error}
            </p>
          )}

          <label htmlFor="snapshot-tag" className="block text-[11px] text-muted">
            Tag
          </label>
          <select
            id="snapshot-tag"
            value={tag}
            onChange={(event) => setTag(event.target.value)}
            className="dw-focus mt-1 w-full rounded-md border border-line bg-surface2 px-3 py-2 text-[12px] text-ink focus:border-lineStrong"
          >
            {TAGS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>

          <label htmlFor="snapshot-note" className="mt-3 block text-[11px] text-muted">
            Note
          </label>
          <textarea
            id="snapshot-note"
            rows={3}
            maxLength={NOTE_LIMIT}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            className="dw-focus mt-1 w-full resize-y rounded-md border border-line bg-surface2 px-3 py-2 text-[12px] text-ink focus:border-lineStrong"
          />

          <p className="mt-2 text-[11px] text-muted">Don't enter personal data.</p>

          <button
            type="submit"
            disabled={!note.trim() || submitting}
            className="dw-focus mt-3 w-full rounded-md border border-blue bg-blue px-4 py-2 text-[12px] font-medium text-white hover:bg-blue/85 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-blue"
          >
            {submitting ? 'Saving…' : 'Record snapshot'}
          </button>
        </form>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          <h3 className="text-[11px] text-muted">History</h3>

          {snapshots == null ? (
            snapshotsError ? (
              <p className="mt-2 text-[12px] text-crit">Cannot reach the server.</p>
            ) : (
              <div className="mt-2 space-y-2" aria-hidden="true">
                {[0, 1, 2].map((index) => (
                  <div key={index} className="h-16 animate-pulse rounded-lg border border-line bg-surface2" />
                ))}
              </div>
            )
          ) : snapshots.length === 0 ? (
            <p className="mt-2 text-[12px] text-muted">
              No snapshots yet. Record one to keep a log of this moment.
            </p>
          ) : (
            <ul className="mt-2 space-y-2">
              {snapshots.map((snapshot) => (
                <SnapshotItem
                  key={snapshot.id}
                  snapshot={snapshot}
                  expanded={expandedId === snapshot.id}
                  onToggle={() =>
                    setExpandedId((current) => (current === snapshot.id ? null : snapshot.id))
                  }
                  onToast={showToast}
                />
              ))}
            </ul>
          )}
        </div>
      </div>

      {toast && (
        <div
          role="status"
          aria-live="polite"
          className="dw-fade-in fixed bottom-4 right-4 z-[60] max-w-[calc(100vw-2rem)] rounded-lg border border-line bg-surface px-4 py-3 text-[12px] text-ink shadow-xl"
        >
          {toast}
        </div>
      )}
    </div>
  );
}

function SnapshotItem({ snapshot, expanded, onToggle, onToast }) {
  const [pendingId, setPendingId] = useState(null);

  const sendAlert = async (entry) => {
    if (pendingId) return;
    setPendingId(entry.id);
    try {
      const saved = await sendDiscordAlert(entry.id);
      onToast?.(`Discord alert sent for ${saved.name || entry.name}`);
    } catch (err) {
      onToast?.(
        err.kind === 'network' ? 'Cannot reach the server.' : err.message || 'Cannot send Discord alert.'
      );
    } finally {
      setPendingId(null);
    }
  };

  return (
    <li className="rounded-lg border border-line">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="dw-focus w-full rounded-lg px-4 py-3 text-left hover:bg-hover"
      >
        <div className="flex items-center gap-2">
          <span className="whitespace-nowrap font-mono text-[12px] text-ink2">#{snapshot.id}</span>
          <TagChip tag={snapshot.tag} />
          <ChevronDown
            size={14}
            aria-hidden="true"
            className={`ml-auto shrink-0 text-muted ${expanded ? 'rotate-180' : ''}`}
          />
        </div>
        <div className="mt-1 flex items-center justify-between gap-2 whitespace-nowrap text-[11px] tabular-nums text-muted">
          <span>{formatDateTime(snapshot.createdAt)}</span>
          <span>
            {snapshot.runningCount}/{snapshot.totalCount} running
          </span>
        </div>
      </button>

      {expanded && (
        <div className="border-t border-line px-4 py-3">
          <div className="rounded-md bg-surface2 px-3 py-2">
            <p className="text-[11px] text-muted">Note</p>
            <p className="mt-0.5 break-words text-[12px] text-ink">{snapshot.note}</p>
          </div>
          <ul className="mt-3">
            {snapshot.containers.map((entry, index) => (
              <li
                key={entry.id ?? index}
                className="flex items-center justify-between gap-4 py-1 text-[12px]"
              >
                <span className={`min-w-0 truncate ${entry.state === 'running' ? 'text-ink2' : 'text-crit'}`}>
                  {entry.name}
                </span>
                <span className="flex shrink-0 items-center gap-2 whitespace-nowrap text-[11px] tabular-nums text-muted">
                  <span>{entry.state}</span>
                  <span className="font-mono">{formatMem(entry.mem)}</span>
                  {entry.state !== 'running' && entry.id && (
                    <button
                      type="button"
                      onClick={() => sendAlert(entry)}
                      disabled={pendingId === entry.id}
                      aria-label={`Send crash alert for ${entry.name} to Discord`}
                      title="Send crash alert to Discord"
                      className="dw-focus rounded p-0.5 text-ink2 hover:text-[#5865F2] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <DiscordIcon />
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </li>
  );
}

function DiscordIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
      <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.865-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.028C.533 9.046-.32 13.58.099 18.058a.082.082 0 0 0 .031.056 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.042-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.372-.291a.074.074 0 0 1 .078-.011c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.011c.12.099.246.198.373.292a.077.077 0 0 1-.007.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.106c.36.699.772 1.363 1.225 1.994a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.055c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.029zM8.02 15.331c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
    </svg>
  );
}

function TagChip({ tag }) {
  const isIncident = tag === 'INCIDENT_AUDIT';
  return (
    <span
      className={`whitespace-nowrap rounded-md border px-1.5 py-0.5 text-[11px] ${
        isIncident ? 'border-crit/30 bg-crit/10 text-crit' : 'border-line bg-surface2 text-ink2'
      }`}
    >
      {tag}
    </span>
  );
}

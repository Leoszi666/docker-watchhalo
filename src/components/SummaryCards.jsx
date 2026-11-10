import { Check } from 'lucide-react';

import { isHighMem } from '../App.jsx';

export default function SummaryCards({ containers, filter, onFilterChange }) {
  const total = containers.length;
  const running = containers.filter((c) => c.state === 'running').length;
  const exited = total - running;
  const highMem = containers.filter(isHighMem).length;

  const cards = [
    { key: 'ALL', label: 'Total', value: total, valueClass: 'text-ink' },
    { key: 'RUNNING', label: 'Running', value: running, valueClass: 'text-ok', accent: true },
    { key: 'EXITED', label: 'Exited', value: exited, valueClass: exited > 0 ? 'text-crit' : 'text-ink2' },
    { key: 'HIGH_MEM', label: 'High memory', value: highMem, valueClass: highMem > 0 ? 'text-warn' : 'text-ink2' },
  ];

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      {cards.map((card) => {
        const active = filter === card.key;
        return (
          <button
            key={card.key}
            type="button"
            aria-pressed={active}
            onClick={() => onFilterChange(card.key)}
            className={`dw-focus rounded-lg border p-4 text-left ${
              active
                ? 'border-blue bg-blue/10'
                : card.accent
                  ? 'border-blue/60 bg-transparent hover:bg-hover'
                  : 'border-line bg-transparent hover:bg-hover'
            }`}
          >
            <div className="text-[11px] text-muted">{card.label}</div>
            <div className={`mt-1 text-[28px] font-semibold leading-none tabular-nums ${card.valueClass}`}>
              {card.value}
            </div>
            <div className="mt-1.5 text-[11px] text-muted">
              {active ? (
                <span className="inline-flex items-center gap-1 text-blue">
                  <Check size={11} aria-hidden="true" />
                  filtering
                </span>
              ) : (
                `of ${total} containers`
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}

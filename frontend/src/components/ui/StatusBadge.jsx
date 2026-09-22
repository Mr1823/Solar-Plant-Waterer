/**
 * One badge for every status on the page: a 6px dot plus an 11px uppercase
 * label, no pill background.
 *
 * The dot colour comes from the FUNCTIONAL status layer, not from the card
 * it happens to sit in. A normal operating state (generating, charging) is
 * green — it never borrows the brand red just because red is the brand.
 */
const dots = {
  // operating normally — nothing for you to do
  generating: 'bg-status-good',
  charging: 'bg-status-good',
  running: 'bg-status-good',
  on: 'bg-status-good',
  ok: 'bg-status-good',

  // off, nothing to see
  idle: 'bg-status-idle',
  off: 'bg-status-idle',
  standby: 'bg-status-idle',
  waiting: 'bg-status-idle',
  discharging: 'bg-status-idle',
  offline: 'bg-status-idle',

  // happening right now / needs you — brand red is reserved for these
  live: 'bg-status-live',
  alert: 'bg-status-live',
  error: 'bg-status-live',
  fault: 'bg-status-live',

  // needs attention soon
  warning: 'bg-status-warning',
  low: 'bg-status-warning',
};

// Coarse tone override, for callers that speak in tones rather than states.
const tones = {
  good: 'bg-status-good',
  active: 'bg-status-good',
  idle: 'bg-status-idle',
  warning: 'bg-status-warning',
  alert: 'bg-status-live',
  error: 'bg-status-live',
};

export function StatusBadge({ status = 'idle', label, pulse = false, tone, title }) {
  const dot = (tone && tones[tone]) || dots[status] || dots.idle;
  const text = label || status;

  return (
    <span
      title={title}
      className="inline-flex items-center gap-2 whitespace-nowrap text-[11px] font-semibold uppercase tracking-[0.06em] text-text-2"
    >
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot} ${pulse ? 'animate-pulse-live' : ''}`} />
      {text}
    </span>
  );
}

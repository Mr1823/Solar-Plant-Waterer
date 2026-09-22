import { Sprout, Sun } from 'lucide-react';
import { formatDistanceToNowStrict } from 'date-fns';
import { StatusBadge } from './ui/StatusBadge';

/**
 * The connection badge is derived from the latest reading's timestamp
 * (isLive === posted within the last 2 minutes), so "Offline" only appears
 * when the ESP32 has actually gone quiet — never beside a fresh reading.
 */
export function Header({ reading, isLive }) {
  const locationName = reading?.location_name || 'My Garden';
  const temperature = reading?.temperature;

  let lastSeen = null;
  if (reading?.timestamp) {
    try {
      lastSeen = formatDistanceToNowStrict(new Date(reading.timestamp), { addSuffix: true });
    } catch {
      lastSeen = null;
    }
  }

  // Red is reserved for live/alert; a quiet ESP32 is taupe, not an alarm.
  const status = !reading ? 'waiting' : isLive ? 'live' : 'offline';
  const label = status === 'waiting' ? 'Waiting for data' : status === 'live' ? 'Live' : 'Offline';

  return (
    <header className="mb-6 flex flex-col justify-between gap-5 sm:flex-row sm:items-center">
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-nested border border-border bg-bg-surface">
          <Sprout className="h-5 w-5 text-brand-red" strokeWidth={1.75} />
        </div>
        <div>
          <h1 className="text-xl font-bold tracking-tight text-text-1">Solar Plant Waterer</h1>
          <p className="mt-0.5 text-[13px] text-text-2">{locationName}</p>
        </div>
      </div>

      <div className="flex items-center gap-5">
        <div className="flex items-center gap-1.5">
          <Sun className="h-4 w-4 text-text-3" strokeWidth={1.75} />
          <span className="text-[13px] font-medium text-text-2">
            {temperature != null ? `${temperature.toFixed(1)}°C` : '--°C'}
          </span>
        </div>

        <div className="flex flex-col items-start gap-1 sm:items-end">
          <StatusBadge
            status={status}
            label={label}
            pulse={status === 'live'}
            title={lastSeen ? `Last reading ${lastSeen}` : undefined}
          />
          {status === 'offline' && lastSeen && (
            <span className="text-[10px] text-text-3">Last reading {lastSeen}</span>
          )}
        </div>
      </div>
    </header>
  );
}

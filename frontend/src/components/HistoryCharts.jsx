import { lazy, memo, Suspense, useEffect, useState } from 'react';
import { useHistory } from '../hooks/useHistory';
import { Card } from './ui/Card';
import { CardHeader } from './ui/CardHeader';
import { EmptyState } from './ui/EmptyState';
import { LineChart } from 'lucide-react';
import { format } from 'date-fns';

// Loaded on demand — see charts/ChartSection.jsx for why.
const ChartSection = lazy(() => import('./charts/ChartSection'));

/** Holds the chart's height so lazy-loading doesn't shift the page. */
function ChartSkeleton({ title }) {
  return (
    <div>
      <h3 className="label-micro mb-2">{title}</h3>
      <div className="h-[180px] animate-pulse rounded-nested bg-bg-base" />
    </div>
  );
}

const RANGES = [
  { key: '24h', label: '24H' },
  { key: '7d', label: '7D' },
  { key: '30d', label: '30D' },
];

const SERIES = [
  { title: 'Solar Power', dataKey: 'solar_power', unit: 'W', gradientId: 'gradSolar', color: 'var(--solar)' },
  // Same accent as the Battery card's sparkline — they must not diverge.
  { title: 'Battery Level', dataKey: 'battery_percentage', unit: '%', gradientId: 'gradBattery', color: 'var(--battery)', cap: 100 },
  { title: 'Temperature', dataKey: 'temperature', unit: '°C', gradientId: 'gradTemp', color: 'var(--temp)' },
];

function HistoryChartsImpl({ liveReading }) {
  const { data, loading, error, range, setRange } = useHistory('24h');

  // Socket readings extend the chart directly rather than triggering a
  // refetch — the server already downsampled what we have, and one new
  // point does not justify re-running the aggregate. Cleared on range
  // change, when fresh buckets arrive anyway.
  const [livePoints, setLivePoints] = useState([]);
  useEffect(() => setLivePoints([]), [range, data]);
  useEffect(() => {
    if (!liveReading?.timestamp) return;
    setLivePoints((prev) =>
      prev.length && prev[prev.length - 1].timestamp === liveReading.timestamp
        ? prev
        : [...prev.slice(-120), liveReading]
    );
  }, [liveReading]);

  // The raw request error belongs in the console, not in the card.
  useEffect(() => {
    if (error) console.error('History request failed:', error);
  }, [error]);

  // No periodic refetch: the chart extends itself from socket readings
  // above. A manual range change still refetches through useHistory.

  const chartData = [...data, ...livePoints]
    .map((r) => {
      const ts = new Date(r.timestamp).getTime();
      if (!Number.isFinite(ts)) return null;
      return {
        ts,
        label: format(ts, 'MMM d, HH:mm'),
        solar_power: r.solar_power,
        battery_percentage: r.battery_percentage,
        temperature: r.temperature,
      };
    })
    .filter(Boolean);

  // Axis ticks stay short; the tooltip carries the full date.
  const tickFormatter = (ts) => format(ts, range === '24h' ? 'HH:mm' : 'MMM d');

  // Hold the previous charts at reduced opacity while a new range loads —
  // no skeleton flash, no layout jump.
  const isRefetching = loading && chartData.length > 0;

  return (
    <Card className="col-span-full">
      <CardHeader icon={LineChart} title="History">
        <div className="flex gap-1 rounded-nested bg-bg-base p-1">
          {RANGES.map((r) => (
            <button
              key={r.key}
              onClick={() => setRange(r.key)}
              className={`cursor-pointer rounded-[8px] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] transition-colors ${
                range === r.key
                  ? 'bg-bg-surface text-text-1 shadow-sm'
                  : 'text-text-2 hover:text-text-1'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </CardHeader>

      {loading && chartData.length === 0 ? (
        <div className="is-loading">
          <EmptyState title="Reading the last 24 hours" message="" />
        </div>
      ) : error ? (
        <EmptyState title="History unavailable" message="Couldn't load readings right now. Try another range in a moment." />
      ) : chartData.length === 0 ? (
        <EmptyState title="No history yet" message="Readings will appear here once the ESP32 starts sending data." />
      ) : (
        <div className={`space-y-5 transition-opacity duration-200 ${isRefetching ? 'opacity-50' : 'opacity-100'}`}>
          <Suspense fallback={SERIES.map((s) => <ChartSkeleton key={s.dataKey} title={s.title} />)}>
            {SERIES.map((s) => (
              <ChartSection key={s.dataKey} {...s} data={chartData} tickFormatter={tickFormatter} />
            ))}
          </Suspense>
        </div>
      )}
    </Card>
  );
}

// The history card redraws only when its own data changes, not on every
// incoming socket reading.
export const HistoryCharts = memo(HistoryChartsImpl);

import { useEffect } from 'react';
import { useHistory } from '../hooks/useHistory';
import { Card } from './ui/Card';
import { CardHeader } from './ui/CardHeader';
import { EmptyState } from './ui/EmptyState';
import { LineChart } from 'lucide-react';
import { format } from 'date-fns';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from 'recharts';

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

/** Round tick spacing: 1, 2, 2.5, 5 × 10ⁿ (2.5 keeps percentages on 25s). */
function niceStep(rough) {
  if (!Number.isFinite(rough) || rough <= 0) return 1;
  const mag = 10 ** Math.floor(Math.log10(rough));
  // 5% tolerance, so a target of ~40 steps by 10 rather than jumping to 20.
  const n = (rough / mag) * 0.95;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag;
}

/**
 * Headroom of 15% above the peak instead of a fixed round ceiling, so the line
 * uses the height it is given. Ticks stay on round numbers below that top,
 * which is why the domain max itself doesn't need to be round.
 */
function yAxis(data, key, cap) {
  const values = data.map((d) => d[key]).filter((v) => typeof v === 'number' && Number.isFinite(v));
  const peak = values.length ? Math.max(...values) : 0;
  if (peak <= 0) return { domain: [0, cap ?? 1], ticks: undefined };

  const top = cap ? Math.min(peak * 1.15, cap) : peak * 1.15;
  const step = niceStep(top / 4);
  const ticks = [];
  for (let t = 0; t <= top + 1e-9; t += step) ticks.push(parseFloat(t.toFixed(4)));

  return { domain: [0, parseFloat(top.toFixed(2))], ticks };
}

function CustomTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-nested border border-border bg-bg-surface px-3 py-2 text-xs shadow-lg">
      <p className="label-micro mb-1">{payload[0].payload?.label}</p>
      {payload.map((p, i) => (
        <p key={i} className="font-medium text-text-1">
          {p.name}: {typeof p.value === 'number' ? p.value.toFixed(1) : p.value} {p.unit || ''}
        </p>
      ))}
    </div>
  );
}

function ChartSection({ title, data, dataKey, color, gradientId, unit, cap, tickFormatter }) {
  const { domain, ticks } = yAxis(data, dataKey, cap);

  return (
    <div>
      <h3 className="label-micro mb-2">{title}</h3>
      <div className="h-[180px]">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 4, right: 6, left: -4, bottom: 0 }}>
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.35} />
                <stop offset="100%" stopColor={color} stopOpacity={0} />
              </linearGradient>
            </defs>
            {/* No grid — one baseline rule, nothing else. */}
            <XAxis
              dataKey="ts"
              type="number"
              scale="time"
              domain={['dataMin', 'dataMax']}
              tickFormatter={tickFormatter}
              tick={{ fill: 'var(--text-3)', fontSize: 10 }}
              axisLine={{ stroke: 'var(--border)' }}
              tickLine={false}
              tickMargin={8}
              interval="preserveStartEnd"
              minTickGap={44}
            />
            <YAxis
              domain={domain}
              ticks={ticks}
              tick={{ fill: 'var(--text-3)', fontSize: 10 }}
              axisLine={false}
              tickLine={false}
              width={38}
              tickMargin={4}
              tickFormatter={(v) => (Number.isInteger(v) ? v : v.toFixed(1))}
            />
            <Tooltip content={<CustomTooltip />} cursor={{ stroke: 'var(--border)' }} />
            <Area
              type="monotone"
              dataKey={dataKey}
              name={title}
              stroke={color}
              strokeWidth={2}
              fill={`url(#${gradientId})`}
              unit={unit}
              dot={false}
              activeDot={{ r: 3, stroke: color, strokeWidth: 2, fill: 'var(--bg-surface)' }}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export function HistoryCharts() {
  const { data, loading, error, range, setRange } = useHistory('24h');

  // The raw request error belongs in the console, not in the card.
  useEffect(() => {
    if (error) console.error('History request failed:', error);
  }, [error]);

  const chartData = data
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
          {SERIES.map((s) => (
            <ChartSection key={s.dataKey} {...s} data={chartData} tickFormatter={tickFormatter} />
          ))}
        </div>
      )}
    </Card>
  );
}

import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from 'recharts';

/**
 * Everything in this file depends on Recharts, which is by far the heaviest
 * dependency in the app. It lives here, behind a dynamic import, so the
 * initial page load ships the cards and KPIs without it and only pulls the
 * charting library once the history section actually renders.
 */

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

export default ChartSection;

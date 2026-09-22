import { useId } from 'react';
import { AreaChart, Area, XAxis, YAxis, ResponsiveContainer } from 'recharts';

/**
 * The Recent Trend line inside the stat cards. Same library, same monotone
 * curve, same 2px stroke and same 35% -> 0% gradient as the History charts —
 * just smaller, with no axes or grid.
 *
 * baseline="zero" anchors to 0 (power, where zero means something);
 * baseline="auto" fits the visible band (battery %, which never nears 0).
 */
export function Sparkline({
  values = [],
  color = 'var(--battery)',
  baseline = 'zero',
  className = '',
  ariaLabel,
}) {
  const gradientId = `spark-${useId().replace(/:/g, '')}`;
  const points = values.filter((v) => typeof v === 'number' && Number.isFinite(v));

  if (points.length < 2) {
    return (
      <div className={`flex items-center justify-center rounded-nested bg-bg-base ${className}`}>
        <span className="label-micro">Not enough data yet</span>
      </div>
    );
  }

  const data = points.map((v, i) => ({ i, v }));
  const domain = baseline === 'zero'
    ? [0, (max) => (max > 0 ? max * 1.15 : 1)]
    : [(min) => min - Math.abs(min) * 0.02 - 1, (max) => max + Math.abs(max) * 0.02 + 1];

  return (
    <div className={`relative ${className}`} role="img" aria-label={ariaLabel}>
      <div className="absolute inset-0">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.35} />
                <stop offset="100%" stopColor={color} stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis dataKey="i" type="number" domain={['dataMin', 'dataMax']} hide />
            <YAxis domain={domain} hide />
            <Area
              type="monotone"
              dataKey="v"
              stroke={color}
              strokeWidth={2}
              fill={`url(#${gradientId})`}
              dot={false}
              activeDot={false}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

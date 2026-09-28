import { memo, useId } from 'react';

/**
 * The Recent Trend line inside the stat cards.
 *
 * This draws its own monotone cubic path rather than using Recharts. The
 * sparklines sit in the always-visible top cards, so importing Recharts here
 * would pull the whole charting library into the initial bundle and defeat
 * lazy-loading the history charts. The interpolation below is the same
 * Fritsch-Carlson monotone curve Recharts uses for type="monotone", so the
 * small lines and the big charts still match visually.
 */

/**
 * Monotone cubic interpolation. Plain cubic smoothing overshoots — it can
 * dip a battery curve below its own minimum between two points, inventing
 * readings that never happened. Monotone guarantees the curve stays within
 * the data's own bounds.
 */
function monotonePath(points) {
  const n = points.length;
  if (n < 2) return '';

  // Secant slopes between consecutive points.
  const delta = [];
  for (let i = 0; i < n - 1; i++) {
    const dx = points[i + 1][0] - points[i][0];
    delta.push(dx === 0 ? 0 : (points[i + 1][1] - points[i][1]) / dx);
  }

  // Tangents: interior points average their neighbouring secants.
  const m = [delta[0]];
  for (let i = 1; i < n - 1; i++) m.push((delta[i - 1] + delta[i]) / 2);
  m.push(delta[n - 2]);

  // Fritsch-Carlson correction: clamp tangents so no segment overshoots.
  for (let i = 0; i < n - 1; i++) {
    if (delta[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i] / delta[i];
    const b = m[i + 1] / delta[i];
    const s = a * a + b * b;
    if (s > 9) {
      const tau = 3 / Math.sqrt(s);
      m[i] = tau * a * delta[i];
      m[i + 1] = tau * b * delta[i];
    }
  }

  let d = `M${points[0][0].toFixed(2)},${points[0][1].toFixed(2)}`;
  for (let i = 0; i < n - 1; i++) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[i + 1];
    const dx = (x1 - x0) / 3;
    d += ` C${(x0 + dx).toFixed(2)},${(y0 + m[i] * dx).toFixed(2)}` +
         ` ${(x1 - dx).toFixed(2)},${(y1 - m[i + 1] * dx).toFixed(2)}` +
         ` ${x1.toFixed(2)},${y1.toFixed(2)}`;
  }
  return d;
}

function SparklineImpl({
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

  const W = 100;
  const H = 36;
  const max = Math.max(...points);
  const min = Math.min(...points);
  const span = max - min;
  const pad = span > 0 ? span * 0.15 : Math.abs(max) * 0.1 || 1;

  // baseline="zero" anchors to 0 (power, where zero means something);
  // "auto" fits the visible band (battery %, which never nears 0).
  const top = baseline === 'zero' ? (max > 0 ? max * 1.15 : 1) : max + pad;
  const bottom = baseline === 'zero' ? 0 : min - pad;
  const range = top - bottom || 1;

  const coords = points.map((v, i) => [
    (i / (points.length - 1)) * W,
    H - ((v - bottom) / range) * H,
  ]);

  const line = monotonePath(coords);
  const area = `${line} L${W},${H} L0,${H} Z`;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className={`h-full w-full overflow-visible ${className}`}
      role="img"
      aria-label={ariaLabel}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.35} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gradientId})`} stroke="none" />
      <path
        d={line}
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

// Redraws only when its own series or colour changes — a soil-moisture
// update shouldn't repaint the solar sparkline.
export const Sparkline = memo(SparklineImpl);

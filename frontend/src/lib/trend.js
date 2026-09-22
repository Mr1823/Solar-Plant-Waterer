/**
 * Pulls a short series out of the history readings for the card sparklines.
 * Demo/seed data is 30 minutes apart, so an hour-long window can hold as few
 * as two points — when that happens we fall back to the last handful of
 * readings and say so in the label instead of drawing a two-point line.
 */
export function recentSeries(history = [], key, { minutes = 60, latest = null, maxPoints = 60 } = {}) {
  const rows = [...history];

  // Keep the sparkline live between history refetches by appending the
  // socket-pushed reading when it is newer than anything we already have.
  if (latest?.timestamp) {
    const lastTs = rows.length ? Date.parse(rows[rows.length - 1].timestamp) : -Infinity;
    if (!(Date.parse(latest.timestamp) <= lastTs)) rows.push(latest);
  }

  const cutoff = Date.now() - minutes * 60 * 1000;
  const windowed = rows.filter((r) => {
    const t = Date.parse(r.timestamp);
    return Number.isFinite(t) && t >= cutoff;
  });

  const inWindow = windowed.length >= 3;
  const source = inWindow ? windowed : rows.slice(-12);
  const values = source
    .map((r) => r[key])
    .filter((v) => typeof v === 'number' && Number.isFinite(v))
    .slice(-maxPoints);

  return {
    values,
    label: inWindow ? `Last ${minutes} min` : 'Recent trend',
    peak: values.length ? Math.max(...values) : null,
  };
}

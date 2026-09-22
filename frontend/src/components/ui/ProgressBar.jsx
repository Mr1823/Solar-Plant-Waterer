export function ProgressBar({ value = 0, max = 100, color = 'battery', size = 'md' }) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100));

  const colorMap = {
    battery: 'bg-battery',
    emerald: 'bg-battery',
    solar: 'bg-solar',
    sky: 'bg-temp',
    water: 'bg-temp',
    rose: 'bg-brand-red',
    good: 'bg-status-good',
    // Magnitude, read functionally: healthy, getting low, needs attention.
    dynamic: pct > 60 ? 'bg-status-good' : pct > 30 ? 'bg-status-warning' : 'bg-brand-red',
  };

  const bgColor = colorMap[color] || colorMap.battery;
  const height = size === 'sm' ? 'h-1' : size === 'lg' ? 'h-3' : 'h-2';

  return (
    <div className={`w-full ${height} overflow-hidden rounded-full bg-border`}>
      <div
        className={`${height} rounded-full ${bgColor} transition-[width] duration-700 ease-out`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

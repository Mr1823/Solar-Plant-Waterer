export function MetricRow({ label, value, unit }) {
  return (
    <div className="flex h-8 items-center justify-between">
      <span className="text-[13px] text-text-2">{label}</span>
      <span className="text-[13px] font-semibold tabular-nums text-text-1">
        {value != null ? value : '--'} <span className="font-normal text-text-2">{unit}</span>
      </span>
    </div>
  );
}

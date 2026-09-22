import { BatteryMedium } from 'lucide-react';
import { Card } from './ui/Card';
import { CardHeader } from './ui/CardHeader';
import { MetricRow } from './ui/MetricRow';
import { ProgressBar } from './ui/ProgressBar';
import { StatusBadge } from './ui/StatusBadge';
import { Sparkline } from './ui/Sparkline';
import { recentSeries } from '../lib/trend';

export function BatteryCard({ reading, history = [] }) {
  const voltage = reading?.battery_voltage;
  const current = reading?.battery_current;
  const power = reading?.battery_power;
  const pct = reading?.battery_percentage;
  const isCharging = current != null && current > 0;

  const trend = recentSeries(history, 'battery_percentage', { latest: reading });
  const trendRange = trend.values.length >= 2
    ? `${Math.min(...trend.values).toFixed(0)}–${Math.max(...trend.values).toFixed(0)}%`
    : null;

  return (
    <Card glow="glow-battery">
      <CardHeader icon={BatteryMedium} title="Battery" iconClass="text-battery">
        {/* Charging is a normal operating state -> green, never brand red. */}
        <StatusBadge
          status={isCharging ? 'charging' : 'idle'}
          label={current == null ? 'No data' : isCharging ? 'Charging' : 'Discharging'}
        />
      </CardHeader>

      <div>
        <div className="stat-hero">
          {pct != null ? pct.toFixed(0) : '--'}
          <span className="stat-unit ml-0.5">%</span>
        </div>
        <p className="mt-1 text-[13px] text-text-2">Charge level</p>
      </div>

      <div className="mt-3">
        <ProgressBar value={pct || 0} max={100} color="dynamic" size="md" />
      </div>

      {/* Same accent as the Battery Level history chart below — the sparkline
          never drifts to brand red. */}
      <div className="mt-5 flex min-h-[76px] max-h-[160px] flex-1 flex-col">
        <div className="mb-2 flex items-center justify-between">
          <span className="label-micro">{trend.label}</span>
          {trendRange && <span className="label-micro">{trendRange}</span>}
        </div>
        <Sparkline
          values={trend.values}
          color="var(--battery)"
          baseline="auto"
          className="min-h-0 flex-1"
          ariaLabel={`Battery level, ${trend.label.toLowerCase()}`}
        />
      </div>

      <div className="mt-4 border-t border-border pt-2">
        <MetricRow label="Voltage" value={voltage?.toFixed(1)} unit="V" />
        <MetricRow label="Current" value={current?.toFixed(2)} unit="A" />
        <MetricRow label="Power" value={power?.toFixed(1)} unit="W" />
      </div>
    </Card>
  );
}

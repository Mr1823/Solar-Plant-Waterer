import { Sun } from 'lucide-react';
import { Card } from './ui/Card';
import { CardHeader } from './ui/CardHeader';
import { MetricRow } from './ui/MetricRow';
import { StatusBadge } from './ui/StatusBadge';
import { Sparkline } from './ui/Sparkline';
import { recentSeries } from '../lib/trend';

export function SolarCard({ reading, history = [] }) {
  const voltage = reading?.solar_voltage;
  const current = reading?.solar_current;
  const power = reading?.solar_power;
  const isGenerating = power != null && power > 0.5;

  const trend = recentSeries(history, 'solar_power', { latest: reading });

  return (
    <Card glow="glow-solar">
      <CardHeader icon={Sun} title="Solar Panel" iconClass="text-solar">
        {/* Generating is a normal operating state -> green, never brand red. */}
        <StatusBadge
          status={isGenerating ? 'generating' : 'idle'}
          label={isGenerating ? 'Generating' : 'Idle'}
        />
      </CardHeader>

      <div>
        <div className="stat-hero">
          {power != null ? power.toFixed(1) : '--'}
          <span className="stat-unit ml-1">W</span>
        </div>
        <p className="mt-1 text-[13px] text-text-2">Current output</p>
      </div>

      {/* 20px from the hero block, and the slack against the taller pump card. */}
      <div className="mt-5 flex min-h-[76px] max-h-[160px] flex-1 flex-col">
        <div className="mb-2 flex items-center justify-between">
          <span className="label-micro">{trend.label}</span>
          {trend.peak != null && (
            <span className="label-micro">Peak {trend.peak.toFixed(1)} W</span>
          )}
        </div>
        <Sparkline
          values={trend.values}
          color="var(--solar)"
          baseline="zero"
          className="min-h-0 flex-1"
          ariaLabel={`Solar power, ${trend.label.toLowerCase()}`}
        />
      </div>

      <div className="mt-4 border-t border-border pt-2">
        <MetricRow label="Voltage" value={voltage?.toFixed(1)} unit="V" />
        <MetricRow label="Current" value={current?.toFixed(2)} unit="A" />
      </div>
    </Card>
  );
}

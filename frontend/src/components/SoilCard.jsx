import { memo } from 'react';
import { Sprout } from 'lucide-react';
import { Card } from './ui/Card';
import { CardHeader } from './ui/CardHeader';
import { ProgressBar } from './ui/ProgressBar';
import { StatusBadge } from './ui/StatusBadge';
import { Sparkline } from './ui/Sparkline';

// Mirrors the firmware's actual logic: it waters on a schedule (07:00 and
// 18:00) and only if soil is below this threshold — not continuously. The
// label here and the decision the pump makes must not disagree.
const SOIL_MOISTURE_THRESHOLD = 30;
const WATERING_TIMES = '07:00 & 18:00';

function soilState(pct) {
  if (pct == null) return { status: 'idle', label: 'No probe' };
  if (pct < SOIL_MOISTURE_THRESHOLD) return { status: 'warning', label: 'Dry' };
  if (pct < 60) return { status: 'good', label: 'Moist' };
  return { status: 'good', label: 'Wet' };
}

function SoilCardImpl({ soilMoisture, trend }) {
  const has = soilMoisture != null;
  const { status, label } = soilState(soilMoisture);

  return (
    <Card>
      <CardHeader icon={Sprout} title="Soil Moisture" iconClass="text-status-good">
        <StatusBadge status={status} label={label} />
      </CardHeader>

      <div>
        <div className="stat-hero">
          {has ? Math.round(soilMoisture) : '—'}
          {has && <span className="stat-unit ml-0.5">%</span>}
        </div>
        <p className="mt-1 text-[13px] text-text-2">
          {has
            ? `Waters at ${WATERING_TIMES} if below ${SOIL_MOISTURE_THRESHOLD}%`
            : 'No probe reporting'}
        </p>
      </div>

      {has && (
        <div className="mt-3">
          <ProgressBar value={soilMoisture} max={100} color="dynamic" size="md" />
        </div>
      )}

      <div className="mt-5 flex min-h-[76px] max-h-[160px] flex-1 flex-col">
        <div className="mb-2 flex items-center justify-between">
          <span className="label-micro">{trend?.label || 'Recent trend'}</span>
          {trend?.peak != null && <span className="label-micro">Peak {Math.round(trend.peak)}%</span>}
        </div>
        <Sparkline
          values={trend?.values || []}
          color="var(--status-good)"
          baseline="auto"
          className="min-h-0 flex-1"
          ariaLabel="Soil moisture, recent trend"
        />
      </div>
    </Card>
  );
}

export const SoilCard = memo(SoilCardImpl);

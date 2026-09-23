import {
  Cloud, CloudDrizzle, CloudFog, CloudLightning, CloudRain, CloudSnow,
  Droplets, Moon, Sun, Thermometer, Wind,
} from 'lucide-react';
import { Card } from './ui/Card';
import { CardHeader } from './ui/CardHeader';

// OpenWeatherMap's `main` condition -> a lucide glyph. Mapped to our own icon
// set rather than loading OWM's PNGs, so the card keeps the design system's
// stroke weight and colour instead of importing someone else's art.
const ICONS = {
  Clear: Sun,
  Clouds: Cloud,
  Rain: CloudRain,
  Drizzle: CloudDrizzle,
  Thunderstorm: CloudLightning,
  Snow: CloudSnow,
  Mist: CloudFog,
  Smoke: CloudFog,
  Haze: CloudFog,
  Fog: CloudFog,
  Dust: CloudFog,
  Sand: CloudFog,
  Ash: CloudFog,
  Squall: CloudLightning,
  Tornado: CloudLightning,
};

function conditionIcon(weather) {
  if (!weather) return Cloud;
  // OWM icon codes end in 'd' or 'n'; a clear night is a moon, not a sun.
  const isNight = typeof weather.icon === 'string' && weather.icon.endsWith('n');
  if (weather.condition === 'Clear' && isNight) return Moon;
  return ICONS[weather.condition] || Cloud;
}

function Stat({ icon: Icon, value, unit, label, title }) {
  return (
    <div title={title}>
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 shrink-0 text-text-3" strokeWidth={1.75} />
        <div className="stat-display">
          {value}
          <span className="stat-unit ml-0.5 text-sm">{unit}</span>
        </div>
      </div>
      <p className="label-micro mt-1.5">{label}</p>
    </div>
  );
}

/**
 * Outside conditions beside what the garden sensor actually reads. The two
 * differ — the sensor sits in the sun — and that gap is the point of showing
 * them together.
 */
export function WeatherCard({ weather, reading }) {
  const Icon = conditionIcon(weather);
  const sensorTemp = reading?.temperature;
  const round = (v) => (typeof v === 'number' ? Math.round(v) : null);

  return (
    <Card>
      <CardHeader
        icon={Icon}
        title="Conditions"
        subtitle={weather?.city || reading?.location_name}
      >
        {weather?.description && (
          <span className="label-micro">{weather.description}</span>
        )}
      </CardHeader>

      <div className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3 lg:grid-cols-6">
        {weather && (
          <Stat
            icon={Icon}
            value={round(weather.temperature) ?? '--'}
            unit="°C"
            label="Outside"
            title={weather.description}
          />
        )}

        <Stat
          icon={Thermometer}
          value={sensorTemp != null ? sensorTemp.toFixed(1) : '--'}
          unit="°C"
          label="Garden sensor"
          title="Measured at the plant"
        />

        {weather?.feels_like != null && (
          <Stat icon={Thermometer} value={round(weather.feels_like)} unit="°C" label="Feels like" />
        )}
        {weather?.humidity != null && (
          <Stat icon={Droplets} value={weather.humidity} unit="%" label="Humidity" />
        )}
        {weather?.wind_speed != null && (
          <Stat icon={Wind} value={weather.wind_speed.toFixed(1)} unit="m/s" label="Wind" />
        )}
        {weather?.clouds != null && (
          <Stat icon={Cloud} value={weather.clouds} unit="%" label="Cloud cover" />
        )}
      </div>

      {!weather && (
        <p className="label-micro mt-5 normal-case">
          Outside conditions unavailable — showing the garden sensor only.
        </p>
      )}
    </Card>
  );
}

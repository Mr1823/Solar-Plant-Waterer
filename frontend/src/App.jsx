import { SocketProvider } from './context/SocketContext';
import { useReadings } from './hooks/useReadings';
import { useHistory } from './hooks/useHistory';
import { useWeather } from './hooks/useWeather';
import { Header } from './components/Header';
import { WeatherCard } from './components/WeatherCard';
import { SolarCard } from './components/SolarCard';
import { BatteryCard } from './components/BatteryCard';
import { PumpCard } from './components/PumpCard';
import { HistoryCharts } from './components/HistoryCharts';
import { AiInsightPanel } from './components/AiInsightPanel';

function Dashboard() {
  const { latest, loading, isLive } = useReadings();
  // Feeds the sparklines in the solar and battery cards; the history card
  // keeps its own copy because it has its own range picker.
  const { data: history } = useHistory('24h');
  // Same coordinates the AI insight uses; the backend falls back to its
  // default location when a reading carries none.
  // Wait for the first reading to settle so the very first weather request
  // already carries the plant's coordinates.
  const { weather } = useWeather(latest?.location_lat, latest?.location_lon, {
    enabled: !loading,
  });

  if (loading && !latest) {
    return (
      <div className="dashboard-container flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-2 border-border border-t-brand-red" />
          <p className="text-sm text-text-2">Connecting to your garden...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="dashboard-container">
      <Header reading={latest} isLive={isLive} />

      <div className="mb-4">
        <WeatherCard weather={weather} reading={latest} />
      </div>

      {/* Single column below 768px; equal-height cards from md up */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 items-stretch gap-4">
        <SolarCard reading={latest} history={history} />
        <BatteryCard reading={latest} history={history} />
        <PumpCard reading={latest} />
      </div>

      <div className="mt-4 space-y-4">
        <HistoryCharts />
        <AiInsightPanel />
      </div>

      <footer className="mt-8 pb-6 text-center">
        <p className="label-micro">
          Solar Plant Waterer • IoT Dashboard
        </p>
      </footer>
    </div>
  );
}

export default function App() {
  return (
    <SocketProvider>
      <Dashboard />
    </SocketProvider>
  );
}

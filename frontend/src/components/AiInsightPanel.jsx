import { useEffect, useState } from 'react';
import { Sparkles, RefreshCw, Loader2 } from 'lucide-react';
import { Card } from './ui/Card';
import { CardHeader } from './ui/CardHeader';
import { EmptyState } from './ui/EmptyState';
import { fetchAiInsight } from '../lib/api';

const REFRESH_MS = 30 * 60 * 1000;

export function AiInsightPanel() {
  const [insight, setInsight] = useState(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [generatedAt, setGeneratedAt] = useState(null);

  const loadInsight = async (force = false) => {
    setLoading(true);
    setFailed(false);
    try {
      const data = await fetchAiInsight(force);
      setInsight(data.insight);
      setGeneratedAt(data.generated_at || new Date().toISOString());
    } catch (err) {
      // Server configuration details stay in the console — the card just says
      // the insight is unavailable and offers the refresh button again.
      console.error('AI insight request failed:', err);
      setInsight(null);
      setFailed(true);
    } finally {
      setLoading(false);
    }
  };

  // Load on mount so the card has something to say when the dashboard opens,
  // then refresh every 30 minutes. Both are unforced, so they ride the
  // server's 5-minute cache: a page reload costs nothing, while the 30-minute
  // tick always finds it expired and generates a genuinely new reading.
  useEffect(() => {
    loadInsight(false);
    const id = setInterval(() => loadInsight(false), REFRESH_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const timeAgo = generatedAt && insight ? formatTimeAgo(new Date(generatedAt)) : null;

  return (
    <Card className="col-span-full">
      <CardHeader icon={Sparkles} title="AI Insight" subtitle={timeAgo} iconClass="text-status-good">
        <button
          onClick={() => loadInsight(true)}
          disabled={loading}
          className="flex cursor-pointer items-center gap-2 rounded-nested px-1 py-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-brand-red transition-opacity hover:opacity-80 disabled:opacity-50"
        >
          {loading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.75} />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.75} />
          )}
          {loading ? 'Analyzing' : 'Refresh Insight'}
        </button>
      </CardHeader>

      {loading ? (
        <div className="is-loading">
          <EmptyState title="Analyzing your garden's rhythm..." message="" />
        </div>
      ) : failed ? (
        <EmptyState
          title="Insight unavailable"
          message="We couldn't generate an insight just now. Try refreshing in a moment."
        />
      ) : insight ? (
        <div className="rounded-nested bg-bg-base p-4">
          <p className="text-sm leading-relaxed text-text-1">{insight}</p>
        </div>
      ) : (
        <EmptyState
          title="No insight yet"
          message="Refresh to get a plain-English read on battery, solar and watering."
        />
      )}
    </Card>
  );
}

function formatTimeAgo(date) {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return 'Just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

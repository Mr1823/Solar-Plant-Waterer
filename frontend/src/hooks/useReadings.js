import { useState, useEffect, useCallback } from 'react';
import { useSocket } from '../context/SocketContext';
import { fetchLatestReading } from '../lib/api';

export function useReadings() {
  const { socket } = useSocket();
  const [latest, setLatest] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const loadLatest = useCallback(async () => {
    try {
      setLoading(true);
      const data = await fetchLatestReading();
      setLatest(data.reading);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadLatest();
  }, [loadLatest]);

  useEffect(() => {
    if (!socket) return;

    const handleNewReading = (reading) => {
      setLatest(reading);
      setError(null);
    };

    socket.on('new-reading', handleNewReading);
    return () => socket.off('new-reading', handleNewReading);
  }, [socket]);

  // Determine live status: reading less than 2 minutes old
  const isLive = latest?.timestamp
    ? (Date.now() - new Date(latest.timestamp).getTime()) < 2 * 60 * 1000
    : false;

  return { latest, loading, error, isLive, refresh: loadLatest };
}

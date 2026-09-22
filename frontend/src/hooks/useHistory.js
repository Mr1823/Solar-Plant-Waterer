import { useState, useEffect, useCallback } from 'react';
import { fetchHistory } from '../lib/api';

export function useHistory(initialRange = '24h') {
  const [range, setRange] = useState(initialRange);
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const result = await fetchHistory(range);
      setData(result.readings || []);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [range]);

  useEffect(() => {
    load();
  }, [load]);

  return { data, loading, error, range, setRange, refresh: load };
}

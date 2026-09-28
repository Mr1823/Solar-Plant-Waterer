import { useEffect, useRef } from 'react';

/**
 * One timer for the whole app.
 *
 * Weather and the AI insight each used to run their own 30-minute
 * setInterval, so the browser held several independent timers that drifted
 * apart and woke the tab at unrelated moments. They now share this one, which
 * also means everything refreshes together rather than the page updating in
 * dribs and drabs.
 *
 * History is deliberately NOT here — it updates from socket readings instead
 * of refetching at all (see HistoryCharts).
 */
const PERIOD_MS = 30 * 60 * 1000;

const listeners = new Set();
let timer = null;

function start() {
  if (timer) return;
  timer = setInterval(() => {
    // Copied before iterating: a listener that unsubscribes during the sweep
    // must not shift the set out from under it.
    for (const fn of [...listeners]) {
      try {
        fn();
      } catch (err) {
        console.error('Scheduled refresh failed:', err);
      }
    }
  }, PERIOD_MS);
}

function stop() {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}

export function useRefreshTick(callback) {
  // Held in a ref so a changing callback identity doesn't churn the
  // subscription — the timer is registered exactly once per consumer.
  const ref = useRef(callback);

  // Assigned in an effect rather than during render: writing to a ref while
  // rendering is what the react(refs) lint rule warns about.
  useEffect(() => {
    ref.current = callback;
  });

  useEffect(() => {
    const fn = () => ref.current?.();
    listeners.add(fn);
    start();
    return () => {
      listeners.delete(fn);
      if (listeners.size === 0) stop();
    };
  }, []);
}

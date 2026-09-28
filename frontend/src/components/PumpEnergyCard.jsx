import { memo, useCallback, useEffect, useState } from 'react';
import { Droplets, Info, Loader2 } from 'lucide-react';
import { Card } from './ui/Card';
import { CardHeader } from './ui/CardHeader';
import { MetricRow } from './ui/MetricRow';
import { StatusBadge } from './ui/StatusBadge';
import { setAdminPin, triggerPump, UnauthorizedError } from '../lib/api';

// A command is confirmed when a later reading reflects it. If the ESP is
// offline or the relay is stuck, nothing ever reflects it — so give up and
// say so rather than showing "Sending..." forever.
const CONFIRM_TIMEOUT_MS = 20000;

// Below this the pump is locked out: a lead-acid pack taken much under half
// charge loses capacity permanently.
const MIN_BATTERY_PCT = 20;

function useCommand(reading) {
  const [pending, setPending] = useState(null);   // { action, sentAt, expect }
  const [state, setState] = useState('idle');     // idle | sending | applied | error
  const [message, setMessage] = useState('');

  const send = useCallback(async (action, expect) => {
    // Named inner function so the PIN retry can recurse without the callback
    // referencing itself while it is still being initialised.
    async function attempt(retriedWithPin) {
      setState('sending');
      setMessage('');
      try {
        await triggerPump(action);
        setPending({ action, sentAt: Date.now(), expect });
      } catch (err) {
        if (err instanceof UnauthorizedError && !retriedWithPin) {
          const pin = window.prompt('Admin PIN (from backend/.env ADMIN_PIN):');
          if (pin) {
            setAdminPin(pin.trim());
            return attempt(true);   // exactly one retry
          }
          setState('error');
          setMessage('PIN required');
          return;
        }
        setState('error');
        setMessage(err instanceof UnauthorizedError ? 'Invalid PIN' : err.message || 'Command failed');
      }
    }
    return attempt(false);
  }, []);

  // Watch incoming readings for the change we asked for.
  useEffect(() => {
    if (!pending || !reading) return;
    if (pending.expect(reading)) {
      setPending(null);
      setState('applied');
      const id = setTimeout(() => setState('idle'), 2500);
      return () => clearTimeout(id);
    }
  }, [reading, pending]);

  useEffect(() => {
    if (!pending) return undefined;
    const id = setTimeout(() => {
      setPending(null);
      setState('error');
      setMessage('No response from device');
    }, CONFIRM_TIMEOUT_MS);
    return () => clearTimeout(id);
  }, [pending]);

  return { send, state, message, busy: state === 'sending' };
}

function PumpEnergyCardImpl({ reading }) {
  const pumpOn = reading?.pump_status === 'on';
  const autoMode = reading?.auto_mode === 1 || reading?.auto_mode === true;
  const battery = reading?.battery_percentage;
  const { send, state, message, busy } = useCommand(reading);

  const batteryTooLow = battery != null && battery < MIN_BATTERY_PCT;

  const label =
    state === 'sending' ? 'Sending…' :
    state === 'applied' ? 'Applied' :
    state === 'error' ? message :
    null;

  const onCalibrate = () => {
    const v = window.prompt('Battery % from the charge controller:');
    const pct = Number(v);
    if (v !== null && Number.isFinite(pct) && pct >= 0 && pct <= 100) {
      send(`set_battery:${Math.round(pct)}`, () => true);
    }
  };

  return (
    <Card>
      <CardHeader
        icon={Droplets}
        title="Pump"
        iconClass={pumpOn ? 'text-status-good' : 'text-text-2'}
      >
        <StatusBadge
          status={pumpOn ? 'running' : 'idle'}
          label={pumpOn ? 'Running' : 'Idle'}
          pulse={pumpOn}
        />
      </CardHeader>

      <div>
        <div className="stat-hero">
          {reading?.pump_energy_today_wh != null ? reading.pump_energy_today_wh.toFixed(2) : '—'}
          <span className="stat-unit ml-1">Wh</span>
        </div>
        <p className="mt-1 text-[13px] text-text-2">
          Used today
          {reading?.waterings_today != null && ` · ${reading.waterings_today} watering${reading.waterings_today === 1 ? '' : 's'}`}
        </p>
      </div>

      <div className="mt-4 border-t border-border pt-2">
        <MetricRow
          label="Last watering"
          value={reading?.pump_last_run_sec != null ? reading.pump_last_run_sec : null}
          unit="s"
        />
        <MetricRow
          label="Last watering used"
          value={reading?.pump_last_run_wh != null ? reading.pump_last_run_wh.toFixed(3) : null}
          unit="Wh"
        />
        <MetricRow
          label="Total used"
          value={reading?.pump_energy_total_wh != null ? reading.pump_energy_total_wh.toFixed(1) : null}
          unit="Wh"
        />
      </div>

      <div className="mt-auto space-y-2 pt-4">
        <div className="flex gap-2">
          <button
            onClick={() => send(pumpOn ? 'off' : 'on', (r) => (r.pump_status === 'on') !== pumpOn)}
            disabled={busy || (!pumpOn && batteryTooLow)}
            title={!pumpOn && batteryTooLow ? `Locked out below ${MIN_BATTERY_PCT}% battery` : undefined}
            className={`flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-nested py-3 text-sm font-semibold text-white transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
              pumpOn ? 'bg-status-idle hover:brightness-95' : 'bg-brand-red hover:brightness-110'
            }`}
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />}
            {pumpOn ? 'Stop Pump' : 'Water Now'}
          </button>

          <button
            onClick={() => send(autoMode ? 'auto_off' : 'auto_on', (r) => (r.auto_mode === 1) !== autoMode)}
            disabled={busy}
            className="cursor-pointer rounded-nested border border-border px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-text-2 transition-colors hover:text-text-1 disabled:opacity-40"
          >
            {autoMode ? 'Auto' : 'Manual'}
          </button>
        </div>

        <div className="flex items-center justify-between">
          <button
            onClick={onCalibrate}
            disabled={busy}
            className="cursor-pointer text-[11px] font-semibold uppercase tracking-[0.06em] text-brand-red transition-opacity hover:opacity-80 disabled:opacity-40"
          >
            Set battery %
          </button>
          {label && (
            <span className={`label-micro normal-case ${state === 'error' ? 'text-brand-red' : ''}`}>
              {label}
            </span>
          )}
        </div>

        {batteryTooLow && (
          <p className="label-micro normal-case text-brand-red">
            Battery below {MIN_BATTERY_PCT}% — pump locked out
          </p>
        )}

        <p className="label-micro flex items-start gap-1.5 normal-case">
          <Info className="mt-0.5 h-3 w-3 shrink-0" strokeWidth={2} />
          Pump energy = run time × 9 W rating. Solar and battery are modelled,
          not measured.
        </p>
      </div>
    </Card>
  );
}

export const PumpEnergyCard = memo(PumpEnergyCardImpl);

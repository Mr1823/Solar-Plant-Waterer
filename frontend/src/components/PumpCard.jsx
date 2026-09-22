import { useState, useEffect } from 'react';
import { Droplets, Play, Square, Plus, Trash2, X } from 'lucide-react';
import { Card } from './ui/Card';
import { CardHeader } from './ui/CardHeader';
import { StatusBadge } from './ui/StatusBadge';
import { fetchSchedules, saveSchedule, deleteSchedule, triggerPump } from '../lib/api';
import { format } from 'date-fns';

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function PumpCard({ reading }) {
  const [schedules, setSchedules] = useState([]);
  const [showEditor, setShowEditor] = useState(false);
  const [editTime, setEditTime] = useState('06:00');
  const [editDays, setEditDays] = useState([0, 1, 2, 3, 4, 5, 6]);
  const [editDuration, setEditDuration] = useState(30);
  const [editId, setEditId] = useState(null);
  const [pumpLoading, setPumpLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const pumpStatus = reading?.pump_status || 'off';
  const lastRun = reading?.pump_last_run;
  const nextRun = reading?.pump_next_scheduled_run;

  useEffect(() => {
    fetchSchedules()
      .then((d) => setSchedules(d.schedules || []))
      .catch(console.error);
  }, []);

  const handleManualPump = async (action) => {
    setPumpLoading(true);
    try {
      await triggerPump(action);
    } catch (err) {
      console.error('Pump command failed:', err);
    } finally {
      setPumpLoading(false);
    }
  };

  const handleSaveSchedule = async () => {
    setSaving(true);
    try {
      const payload = { time: editTime, days: editDays, duration_seconds: editDuration };
      if (editId) payload.id = editId;
      const result = await saveSchedule(payload);
      if (editId) {
        setSchedules((prev) => prev.map((s) => (s.id === editId ? result.schedule : s)));
      } else {
        setSchedules((prev) => [...prev, result.schedule]);
      }
      closeEditor();
    } catch (err) {
      console.error('Failed to save schedule:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    try {
      await deleteSchedule(id);
      setSchedules((prev) => prev.filter((s) => s.id !== id));
    } catch (err) {
      console.error('Failed to delete schedule:', err);
    }
  };

  const openEditor = (schedule = null) => {
    if (schedule) {
      setEditId(schedule.id);
      setEditTime(schedule.time);
      setEditDays(schedule.days);
      setEditDuration(schedule.duration_seconds || 30);
    } else {
      setEditId(null);
      setEditTime('06:00');
      setEditDays([0, 1, 2, 3, 4, 5, 6]);
      setEditDuration(30);
    }
    setShowEditor(true);
  };

  const closeEditor = () => {
    setShowEditor(false);
    setEditId(null);
  };

  const toggleDay = (day) => {
    setEditDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort()
    );
  };

  const formatTime = (ts) => {
    if (!ts) return '--';
    try {
      return format(new Date(ts), 'MMM d, h:mm a');
    } catch {
      return ts;
    }
  };

  return (
    <Card>
      <CardHeader icon={Droplets} title="Water Pump" iconClass="text-text-2">
        {/* Running is normal operation -> green. Idle -> taupe. */}
        <StatusBadge
          status={pumpStatus === 'on' ? 'running' : 'idle'}
          label={pumpStatus === 'on' ? 'Running' : 'Idle'}
          pulse={pumpStatus === 'on'}
        />
      </CardHeader>

      {/* Timing info */}
      <div className="mb-5 grid grid-cols-2 gap-3">
        <div>
          <span className="label-micro">Last Run</span>
          <p className="mt-1.5 text-[13px] font-semibold text-text-1">{formatTime(lastRun)}</p>
        </div>
        <div>
          <span className="label-micro">Next Run</span>
          <p className="mt-1.5 text-[13px] font-semibold text-text-1">{formatTime(nextRun)}</p>
        </div>
      </div>

      {/* Manual control */}
      <button
        onClick={() => handleManualPump(pumpStatus === 'on' ? 'off' : 'on')}
        disabled={pumpLoading}
        className={`flex w-full cursor-pointer items-center justify-center gap-2 rounded-nested py-3 text-sm font-semibold text-white transition-colors duration-200 disabled:opacity-50 ${
          pumpStatus === 'on' ? 'bg-status-idle hover:brightness-95' : 'bg-brand-red hover:brightness-110'
        }`}
      >
        {pumpStatus === 'on' ? <Square className="w-4 h-4" /> : <Play className="w-4 h-4" />}
        {pumpLoading ? 'Sending...' : pumpStatus === 'on' ? 'Stop Pump' : 'Water Now'}
      </button>

      {/* Schedules */}
      <div className="mt-auto border-t border-border pt-4">
        <div className="mb-3 flex items-center justify-between">
          <span className="label-micro">Schedules</span>
          <button
            onClick={() => openEditor()}
            className="flex cursor-pointer items-center gap-1 text-xs font-semibold text-brand-red transition-opacity hover:opacity-80"
          >
            <Plus className="h-3 w-3" strokeWidth={2} /> Add
          </button>
        </div>

        {schedules.length === 0 ? (
          <p className="py-3 text-center text-xs text-text-3">No schedules set</p>
        ) : (
          <div className="space-y-2">
            {schedules.map((s) => (
              <div
                key={s.id}
                className="group flex cursor-pointer items-center justify-between rounded-nested px-1 py-2 transition-colors hover:bg-bg-base"
                onClick={() => openEditor(s)}
              >
                <div>
                  <span className="text-sm font-semibold text-text-1">{s.time}</span>
                  <div className="flex gap-1 mt-1">
                    {DAY_LABELS.map((d, i) => (
                      <span
                        key={i}
                        className={`flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-semibold ${
                          s.days.includes(i) ? 'bg-brand-red text-white' : 'bg-border text-text-2'
                        }`}
                      >
                        {d[0]}
                      </span>
                    ))}
                  </div>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); handleDelete(s.id); }}
                  className="cursor-pointer rounded-[8px] p-1 opacity-0 transition-all hover:bg-bg-base group-hover:opacity-100"
                >
                  <Trash2 className="h-3.5 w-3.5 text-brand-red" strokeWidth={1.75} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Schedule Editor Modal */}
      {showEditor && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-text-1/30 p-4 sm:items-center" onClick={closeEditor}>
          <div
            className="relative w-full max-w-sm rounded-card border border-border bg-bg-surface p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <button onClick={closeEditor} className="absolute right-4 top-4 cursor-pointer rounded-[8px] p-1 transition-colors hover:bg-bg-base">
              <X className="h-4 w-4 text-text-2" />
            </button>

            <h3 className="mb-5 text-base font-semibold text-text-1">{editId ? 'Edit Schedule' : 'New Schedule'}</h3>

            <div className="mb-4">
              <label className="label-micro mb-2 block">Time</label>
              <input
                type="time"
                value={editTime}
                onChange={(e) => setEditTime(e.target.value)}
                className="w-full rounded-nested border border-border bg-bg-base px-3 py-2.5 text-sm text-text-1 transition-colors focus:border-brand-red focus:outline-none"
              />
            </div>

            <div className="mb-4">
              <label className="label-micro mb-2 block">Days</label>
              <div className="flex gap-1.5">
                {DAY_LABELS.map((d, i) => (
                  <button
                    key={i}
                    onClick={() => toggleDay(i)}
                    className={`flex-1 cursor-pointer rounded-nested py-2 text-xs font-semibold transition-colors ${
                      editDays.includes(i)
                        ? 'bg-brand-red text-white'
                        : 'bg-border text-text-2 hover:text-text-1'
                    }`}
                  >
                    {d}
                  </button>
                ))}
              </div>
            </div>

            <div className="mb-6">
              <label className="label-micro mb-2 block">Duration (seconds)</label>
              <input
                type="number"
                min="1"
                max="3600"
                value={editDuration}
                onChange={(e) => setEditDuration(parseInt(e.target.value) || 30)}
                className="w-full rounded-nested border border-border bg-bg-base px-3 py-2.5 text-sm text-text-1 transition-colors focus:border-brand-red focus:outline-none"
              />
            </div>

            <button
              onClick={handleSaveSchedule}
              disabled={saving || editDays.length === 0}
              className="w-full cursor-pointer rounded-nested bg-brand-red py-3 text-sm font-semibold text-white transition-colors hover:brightness-110 disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save Schedule'}
            </button>
          </div>
        </div>
      )}
    </Card>
  );
}

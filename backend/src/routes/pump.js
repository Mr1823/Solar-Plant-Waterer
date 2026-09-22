import { Router } from 'express';
import { runAndSave, queryAll, queryOne } from '../db.js';
import { validateSchedule, validateManualPump } from '../middleware/validate.js';

export default function pumpRoutes(io) {
  const router = Router();

  // GET /api/pump/schedule — list all schedules
  router.get('/schedule', (req, res) => {
    try {
      const rows = queryAll('SELECT * FROM schedules ORDER BY time ASC');
      const schedules = rows.map(r => ({ ...r, days: JSON.parse(r.days) }));
      res.json({ schedules });
    } catch (err) {
      console.error('Error fetching schedules:', err);
      res.status(500).json({ error: 'Failed to fetch schedules' });
    }
  });

  // POST /api/pump/schedule — create or update a schedule
  router.post('/schedule', validateSchedule, (req, res) => {
    try {
      const { id, time, days, duration_seconds = 30, enabled = true } = req.body;

      if (id) {
        runAndSave(
          'UPDATE schedules SET time = ?, days = ?, duration_seconds = ?, enabled = ? WHERE id = ?',
          [time, JSON.stringify(days), duration_seconds, enabled ? 1 : 0, id]
        );
        const updated = queryOne('SELECT * FROM schedules WHERE id = ?', [id]);
        if (!updated) {
          return res.status(404).json({ error: 'Schedule not found' });
        }
        const schedule = { ...updated, days: JSON.parse(updated.days) };
        io.emit('schedule-updated', schedule);
        res.json({ schedule });
      } else {
        const { lastInsertRowid } = runAndSave(
          'INSERT INTO schedules (time, days, duration_seconds, enabled) VALUES (?, ?, ?, ?)',
          [time, JSON.stringify(days), duration_seconds, enabled ? 1 : 0]
        );
        const created = queryOne('SELECT * FROM schedules WHERE id = ?', [lastInsertRowid]);
        const schedule = { ...created, days: JSON.parse(created.days) };
        io.emit('schedule-updated', schedule);
        res.status(201).json({ schedule });
      }
    } catch (err) {
      console.error('Error saving schedule:', err);
      res.status(500).json({ error: 'Failed to save schedule' });
    }
  });

  // DELETE /api/pump/schedule/:id
  router.delete('/schedule/:id', (req, res) => {
    try {
      const { changes } = runAndSave('DELETE FROM schedules WHERE id = ?', [parseInt(req.params.id)]);
      if (changes === 0) {
        return res.status(404).json({ error: 'Schedule not found' });
      }
      io.emit('schedule-deleted', { id: parseInt(req.params.id) });
      res.json({ success: true });
    } catch (err) {
      console.error('Error deleting schedule:', err);
      res.status(500).json({ error: 'Failed to delete schedule' });
    }
  });

  // POST /api/pump/manual — trigger pump on/off
  router.post('/manual', validateManualPump, (req, res) => {
    try {
      const { action } = req.body;
      runAndSave('INSERT INTO pump_commands (command) VALUES (?)', [action]);

      io.emit('pump-command', { action, timestamp: new Date().toISOString() });
      res.json({ success: true, action, message: `Pump command "${action}" sent` });
    } catch (err) {
      console.error('Error sending pump command:', err);
      res.status(500).json({ error: 'Failed to send pump command' });
    }
  });

  // GET /api/pump/status — ESP32 polls this for pending commands
  router.get('/status', (req, res) => {
    try {
      const command = queryOne(
        'SELECT * FROM pump_commands WHERE acknowledged = 0 ORDER BY id DESC LIMIT 1'
      );

      if (command) {
        runAndSave('UPDATE pump_commands SET acknowledged = 1 WHERE id = ?', [command.id]);
        res.json({ pending: true, command: command.command, id: command.id });
      } else {
        res.json({ pending: false });
      }
    } catch (err) {
      console.error('Error checking pump status:', err);
      res.status(500).json({ error: 'Failed to check pump status' });
    }
  });

  return router;
}

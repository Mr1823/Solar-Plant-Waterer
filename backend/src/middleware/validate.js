import { validationResult, body } from 'express-validator';

// Middleware to check for validation errors and return 400 with details
export function handleValidationErrors(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      error: 'Validation failed',
      details: errors.array().map(e => ({ field: e.path, message: e.msg })),
    });
  }
  next();
}

// Validation chain for POST /api/readings
export const validateReading = [
  body('temperature').optional().isFloat({ min: -40, max: 80 }).withMessage('Temperature must be between -40 and 80°C'),
  body('solar_voltage').optional().isFloat({ min: 0 }).withMessage('Solar voltage must be >= 0'),
  body('solar_current').optional().isFloat({ min: 0 }).withMessage('Solar current must be >= 0'),
  body('battery_voltage').optional().isFloat({ min: 0 }).withMessage('Battery voltage must be >= 0'),
  body('battery_current').optional().isFloat().withMessage('Battery current must be a number'),
  body('battery_percentage').optional().isFloat({ min: 0, max: 100 }).withMessage('Battery percentage must be 0-100'),
  body('pump_status').optional().isIn(['on', 'off']).withMessage('Pump status must be "on" or "off"'),
  body('pump_last_run').optional().isISO8601().withMessage('pump_last_run must be ISO 8601'),
  body('pump_next_scheduled_run').optional().isISO8601().withMessage('pump_next_scheduled_run must be ISO 8601'),
  body('location_name').optional().isString().trim(),
  body('location_lat').optional().isFloat({ min: -90, max: 90 }),
  body('location_lon').optional().isFloat({ min: -180, max: 180 }),
  handleValidationErrors,
];

// Validation chain for POST /api/pump/schedule
export const validateSchedule = [
  body('time').matches(/^([01]\d|2[0-3]):([0-5]\d)$/).withMessage('Time must be HH:MM format'),
  body('days').isArray({ min: 1 }).withMessage('Days must be a non-empty array'),
  body('days.*').isInt({ min: 0, max: 6 }).withMessage('Each day must be 0 (Sun) – 6 (Sat)'),
  body('duration_seconds').optional().isInt({ min: 1, max: 3600 }).withMessage('Duration must be 1-3600 seconds'),
  body('enabled').optional().isBoolean(),
  handleValidationErrors,
];

// Validation chain for POST /api/pump/manual
export const validateManualPump = [
  body('action').isIn(['on', 'off']).withMessage('Action must be "on" or "off"'),
  handleValidationErrors,
];

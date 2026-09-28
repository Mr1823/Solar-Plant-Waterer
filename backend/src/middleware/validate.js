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

  // Soil-moisture hardware. Every field is optional so the measured-sensor
  // ESP32 build keeps posting exactly as before — a board sends whatever it
  // actually has, and anything absent is stored as NULL rather than 0.
  //
  // isFloat/isInt reject NaN and Infinity outright (both fail the numeric
  // parse), which is what stops a bad sensor read reaching SQLite.
  body('soil_moisture').optional().isFloat({ min: 0, max: 100 }).withMessage('Soil moisture must be 0-100'),
  body('pump_energy_today_wh').optional().isFloat({ min: 0 }).withMessage('pump_energy_today_wh must be >= 0'),
  body('pump_energy_total_wh').optional().isFloat({ min: 0 }).withMessage('pump_energy_total_wh must be >= 0'),
  body('pump_last_run_sec').optional().isInt({ min: 0, max: 86400 }).withMessage('pump_last_run_sec must be 0-86400'),
  body('pump_last_run_wh').optional().isFloat({ min: 0 }).withMessage('pump_last_run_wh must be >= 0'),
  body('waterings_today').optional().isInt({ min: 0, max: 1000 }).withMessage('waterings_today must be 0-1000'),
  body('solar_energy_today_wh').optional().isFloat({ min: 0 }).withMessage('solar_energy_today_wh must be >= 0'),
  body('solar_energy_total_wh').optional().isFloat({ min: 0 }).withMessage('solar_energy_total_wh must be >= 0'),
  body('irradiance').optional().isFloat({ min: 0, max: 2000 }).withMessage('Irradiance must be 0-2000 W/m2'),
  body('auto_mode').optional().isBoolean().withMessage('auto_mode must be a boolean'),
  body('is_estimated').optional().isBoolean().withMessage('is_estimated must be a boolean'),

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
//
// Actions travel to the device as plain strings through the pump_commands
// table and come back out of GET /api/pump/status, so the set_battery
// payload rides along inside the action itself rather than needing a new
// column or endpoint.
//
// The pattern is deliberately strict: integers 0-100 only, no leading
// zeros, no decimals, no whitespace. A malformed calibration value would
// otherwise reach the firmware as a silently-truncated toFloat().
export const PUMP_ACTION_PATTERN = /^(on|off|auto_on|auto_off|set_battery:(0|[1-9]\d?|100))$/;

export const validateManualPump = [
  body('action')
    .custom((value) => typeof value === 'string' && PUMP_ACTION_PATTERN.test(value))
    .withMessage('Action must be on, off, auto_on, auto_off, or set_battery:<0-100>'),
  handleValidationErrors,
];

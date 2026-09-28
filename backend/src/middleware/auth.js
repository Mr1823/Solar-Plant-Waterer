/**
 * Two separate shared secrets, because the two callers are different:
 *
 *   ESP_DEVICE_KEY — the ESP posts readings with it (x-device-key). Stops
 *                    anyone on the LAN injecting fake sensor data.
 *   ADMIN_PIN      — the dashboard sends it with pump commands (x-admin-pin).
 *                    Stops anyone on the LAN running your pump.
 *
 * Both fail OPEN with a loud warning when unset, rather than locking you out
 * of your own dashboard the moment you pull these changes. Set them in
 * backend/.env and they enforce immediately.
 */

let warnedDevice = false;
let warnedAdmin = false;

/** Constant-time compare, so a wrong key can't be recovered by timing. */
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Guards POST /api/readings — the ESP32 / ESP-12E ingest path. */
export function requireDeviceKey(req, res, next) {
  const expected = process.env.ESP_DEVICE_KEY;

  if (!expected) {
    if (!warnedDevice) {
      console.warn('⚠️  ESP_DEVICE_KEY is not set — /api/readings accepts anonymous posts');
      warnedDevice = true;
    }
    return next();
  }

  if (!safeEqual(req.get('x-device-key') || '', expected)) {
    // Deliberately vague: a device with the wrong key learns only that it
    // was rejected, not whether the header name or the value was wrong.
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

/** Guards POST /api/pump/manual — anything that can physically move water. */
export function requireAdminPin(req, res, next) {
  const expected = process.env.ADMIN_PIN;

  if (!expected) {
    if (!warnedAdmin) {
      console.warn('⚠️  ADMIN_PIN is not set — pump commands are unauthenticated');
      warnedAdmin = true;
    }
    return next();
  }

  if (!safeEqual(req.get('x-admin-pin') || '', expected)) {
    return res.status(401).json({ error: 'Invalid PIN' });
  }
  next();
}

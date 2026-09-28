import Groq from 'groq-sdk';

/**
 * Models are resolved at call time, not hardcoded: this integration broke once
 * already because `llama-3.1-8b-instant` was retired out from under it and the
 * feature failed silently. Set GROQ_MODEL to override; the rest act as
 * fallbacks, so a retired model degrades to a log line instead of a dead card.
 *
 * Note some reasoning-capable models (gpt-oss) spend their token budget on a
 * `reasoning` field and can return empty content — that counts as a failure
 * here and falls through to the next candidate.
 */
const FALLBACK_MODELS = ['qwen/qwen3.8-27b', 'openai/gpt-oss-120b'];

function modelCandidates() {
  const configured = process.env.GROQ_MODEL?.trim();
  if (!configured) return FALLBACK_MODELS;
  return [configured, ...FALLBACK_MODELS.filter((m) => m !== configured)];
}

const SYSTEM_PROMPT = `You are a monitoring assistant for a solar-powered plant watering system. Given sensor data and current weather conditions, give a short, actionable, plain-English status summary or warning. Be concise (2-3 sentences max).

Focus on whatever is most noteworthy: soil moisture against the watering thresholds, battery health, solar performance, pump energy use, and weather impact on watering needs. If rain is expected, say whether the next watering could be skipped. If everything looks normal, say so briefly.

Some values are ESTIMATES, not measurements: on hardware without current sensors, solar power comes from an irradiance model and battery percentage from an energy balance. When the data below is marked as estimated, describe those two as estimates (e.g. "estimated battery around 60%") and do not state them as precise readings. Never invent a value that is marked unavailable.

Reply in plain prose only — no Markdown, no bold, no headings, no bullet points.`;

let groqClient = null;

function getClient() {
  if (!groqClient) {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      throw new Error('GROQ_API_KEY is not set in environment variables');
    }
    groqClient = new Groq({ apiKey });
  }
  return groqClient;
}

/**
 * Generate an AI insight from recent sensor readings.
 * @param {Object} latestReading - The most recent sensor reading
 * @param {Array} recentReadings - Last few readings for trend analysis
 * @returns {Promise<string>} Plain-English insight summary
 */
export async function getInsight(latestReading, recentReadings = [], weatherData = null) {
  const client = getClient();

  // Only include what this board actually reported. A NULL column means the
  // hardware has no such sensor, and printing "null V" invites the model to
  // narrate a measurement that does not exist.
  const estimated = latestReading.is_estimated === 1 || latestReading.is_estimated === true;
  const has = (v) => v !== null && v !== undefined;
  const lines = [];

  if (has(latestReading.soil_moisture)) {
    lines.push(`- Soil moisture: ${latestReading.soil_moisture}% (scheduled watering at 07:00 and 18:00 runs only if below 30%)`);
  }
  if (has(latestReading.temperature)) lines.push(`- Temperature: ${latestReading.temperature}°C`);

  if (has(latestReading.solar_voltage) && has(latestReading.solar_current)) {
    lines.push(`- Solar (measured): ${latestReading.solar_voltage}V / ${latestReading.solar_current}A / ${latestReading.solar_power}W`);
  } else if (has(latestReading.solar_power)) {
    lines.push(`- Solar power: ${latestReading.solar_power}W (ESTIMATED from irradiance${has(latestReading.irradiance) ? ` ${latestReading.irradiance} W/m2` : ''})`);
  }
  if (has(latestReading.solar_energy_today_wh)) {
    lines.push(`- Solar generated today: ${latestReading.solar_energy_today_wh} Wh (estimated)`);
  }

  if (has(latestReading.battery_voltage)) {
    lines.push(`- Battery (measured): ${latestReading.battery_voltage}V / ${latestReading.battery_percentage}% (${latestReading.battery_current > 0 ? 'charging' : 'discharging'})`);
  } else if (has(latestReading.battery_percentage)) {
    lines.push(`- Battery: ${latestReading.battery_percentage}% (ESTIMATED via energy balance on a 144 Wh pack)`);
  }

  lines.push(`- Pump: ${latestReading.pump_status}${has(latestReading.auto_mode) ? ` | mode: ${latestReading.auto_mode ? 'auto' : 'manual'}` : ''}`);
  if (has(latestReading.pump_energy_today_wh)) {
    lines.push(`- Pump used today: ${latestReading.pump_energy_today_wh} Wh across ${latestReading.waterings_today ?? 0} watering(s)`);
  }
  if (has(latestReading.pump_last_run_sec)) {
    lines.push(`- Last watering: ${latestReading.pump_last_run_sec}s using ${latestReading.pump_last_run_wh ?? '?'} Wh`);
  }
  if (has(latestReading.pump_last_run) || has(latestReading.pump_next_scheduled_run)) {
    lines.push(`- Schedule: last ${latestReading.pump_last_run || 'never'} | next ${latestReading.pump_next_scheduled_run || 'not scheduled'}`);
  }
  lines.push(`- Location: ${latestReading.location_name || 'Unknown'}`);

  const dataContext = `
Current Reading (${latestReading.timestamp})${estimated ? ' — solar power and battery % on this board are ESTIMATES' : ''}:
${lines.join('\n')}

${recentReadings.length > 0 ? `Recent trend (last ${recentReadings.length} readings):
- Battery range: ${Math.min(...recentReadings.map(r => r.battery_percentage))}% – ${Math.max(...recentReadings.map(r => r.battery_percentage))}%
- Solar power range: ${Math.min(...recentReadings.map(r => r.solar_power))}W – ${Math.max(...recentReadings.map(r => r.solar_power))}W
- Temperature range: ${Math.min(...recentReadings.map(r => r.temperature))}°C – ${Math.max(...recentReadings.map(r => r.temperature))}°C` : 'No trend data available yet.'}

${weatherData ? `Current Weather (${weatherData.city || 'location'}):
- Condition: ${weatherData.condition} (${weatherData.description})
- Outside temperature: ${weatherData.temperature}°C (feels like ${weatherData.feels_like}°C)
- Humidity: ${weatherData.humidity}%
- Wind: ${weatherData.wind_speed} m/s
- Cloud cover: ${weatherData.clouds}%` : 'Weather data not available.'}
  `.trim();

  const candidates = modelCandidates();
  let lastError = null;

  for (const model of candidates) {
    try {
      const completion = await client.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: dataContext },
        ],
        temperature: 0.4,
        // Headroom: a reasoning model that spends its budget thinking would
        // otherwise hit the limit before writing a single sentence.
        max_tokens: 400,
      });

      const choice = completion.choices?.[0];
      const text = choice?.message?.content?.trim();

      if (text) {
        if (model !== candidates[0]) console.warn(`[groq] fell back to ${model}`);
        return text;
      }

      console.warn(`[groq] ${model} returned no content (finish_reason=${choice?.finish_reason})`);
    } catch (err) {
      console.warn(`[groq] ${model} failed: ${err.message}`);
      lastError = err;
    }
  }

  if (lastError) throw lastError;
  throw new Error('No Groq model returned an insight');
}

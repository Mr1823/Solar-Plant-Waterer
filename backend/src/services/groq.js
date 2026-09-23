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

const SYSTEM_PROMPT = `You are a monitoring assistant for a solar-powered plant watering system. Given sensor data and current weather conditions, give a short, actionable, plain-English status summary or warning. Be concise (2-3 sentences max). Focus on anything unusual or noteworthy — battery health, solar performance, watering schedule status, and weather impact on watering needs. If rain is expected, mention whether the next watering cycle could be skipped. If everything looks normal, say so briefly. Reply in plain prose only — no Markdown, no bold, no headings, no bullet points.`;

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

  const dataContext = `
Current Reading (${latestReading.timestamp}):
- Temperature: ${latestReading.temperature}°C
- Solar: ${latestReading.solar_voltage}V / ${latestReading.solar_current}A / ${latestReading.solar_power}W
- Battery: ${latestReading.battery_voltage}V / ${latestReading.battery_percentage}% (${latestReading.battery_current > 0 ? 'charging' : 'discharging'})
- Pump: ${latestReading.pump_status} | Last run: ${latestReading.pump_last_run || 'never'} | Next: ${latestReading.pump_next_scheduled_run || 'not scheduled'}
- Location: ${latestReading.location_name || 'Unknown'}

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

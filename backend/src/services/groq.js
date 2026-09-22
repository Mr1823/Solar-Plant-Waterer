import Groq from 'groq-sdk';

const SYSTEM_PROMPT = `You are a monitoring assistant for a solar-powered plant watering system. Given sensor data and current weather conditions, give a short, actionable, plain-English status summary or warning. Be concise (2-3 sentences max). Focus on anything unusual or noteworthy — battery health, solar performance, watering schedule status, and weather impact on watering needs. If rain is expected, mention whether the next watering cycle could be skipped. If everything looks normal, say so briefly.`;

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

  const completion = await client.chat.completions.create({
    model: 'llama-3.1-8b-instant',
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: dataContext },
    ],
    temperature: 0.4,
    max_tokens: 200,
  });

  return completion.choices[0]?.message?.content || 'Unable to generate insight.';
}

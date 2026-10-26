import { createApp } from "./app";
import { ACCOUNTS_PATH, DB_PATH, FIXTURE_PATH, PORT, WEB_DIST, BASIC_AUTH, FLOW_FILE, AI, AI_KEYS, WEATHER_MODE, RISK_MODEL_PATH, PREDICTIONS_PATH, CLIMATE_PATH, DECADES_PATH } from "./config";
import { loadClimate, loadDecades } from "./climate";
import { Store } from "./store";
import { WeatherService } from "./weather";
import { EmergencyService } from "./emergency";
import { loadPredictions } from "./predictions";

const store = new Store(DB_PATH, FIXTURE_PATH, ACCOUNTS_PATH);
const weather = new WeatherService(WEATHER_MODE);
weather.start();
// Emergency WA warnings for the outlook map; EMERGENCY_FEED=off skips the feed (offline tests).
const emergency = process.env.EMERGENCY_FEED === "off" ? undefined : new EmergencyService();
emergency?.start();
const server = createApp(store, { flowFile: FLOW_FILE, staticDir: WEB_DIST, basicAuth: BASIC_AUTH, ai: AI, aiKeys: AI_KEYS, weather, emergency, predictions: loadPredictions(RISK_MODEL_PATH, PREDICTIONS_PATH), climate: loadClimate(CLIMATE_PATH), decades: loadDecades(DECADES_PATH) }).listen(PORT, "0.0.0.0", () => {
  console.log(`GreenSpark API (synthetic demo data) on http://localhost:${PORT}`);
  console.log(`Workflow database: ${DB_PATH}`);
  if (WEB_DIST) console.log(`Serving web app from ${WEB_DIST}`);
  if (BASIC_AUTH) console.log("HTTP Basic auth is ON");
  console.log(AI.apiKey ? `AI summaries: ${AI.provider} (${AI.models.support})` : `AI summaries are OFF: no ${AI.provider === "claude" ? "ANTHROPIC" : "GEMINI"}_API_KEY set`);
  console.log(`Weather signals: ${WEATHER_MODE}`);
});
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => { server.close(() => { store.close(); process.exit(0); }); });
}

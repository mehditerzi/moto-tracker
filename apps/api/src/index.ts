import { buildApp } from "./server.js";
import { config } from "./config.js";
import { startCron } from "./notify/cron.js";

const app = buildApp();
app.listen(config.PORT, () => {
  console.log(`[api] listening on http://localhost:${config.PORT}`);
  startCron();
});

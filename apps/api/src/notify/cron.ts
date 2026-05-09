import cron from "node-cron";
import { config } from "../config.js";
import { dispatchForToday } from "./dispatcher.js";

export function startCron(): void {
  if (!config.CRON_ENABLED) {
    console.log("[cron] disabled");
    return;
  }
  const expr = `0 ${config.CRON_HOUR} * * *`;
  cron.schedule(
    expr,
    () => {
      const today = new Date()
        .toLocaleDateString("en-CA", { timeZone: config.CRON_TIMEZONE });
      void dispatchForToday(today)
        .then((s) => console.log(`[cron] dispatched ${s.sent}/${s.total}, expired ${s.expiredEndpoints}`))
        .catch((e) => console.error("[cron] failure", e));
    },
    { timezone: config.CRON_TIMEZONE },
  );
  console.log(`[cron] scheduled '${expr}' in ${config.CRON_TIMEZONE}`);
}

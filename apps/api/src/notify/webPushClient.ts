import webpush from "web-push";
import { config } from "../config.js";

export interface SendPushInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  payload: unknown;
}

export type SendPushResult = { ok: true } | { ok: false; gone: boolean; status: number; message: string };

let _send = defaultSend;
async function defaultSend(input: SendPushInput): Promise<SendPushResult> {
  if (!config.VAPID_PUBLIC_KEY || !config.VAPID_PRIVATE_KEY) {
    return { ok: false, gone: false, status: 0, message: "VAPID keys not configured" };
  }
  webpush.setVapidDetails(
    config.VAPID_SUBJECT,
    config.VAPID_PUBLIC_KEY,
    config.VAPID_PRIVATE_KEY,
  );
  try {
    await webpush.sendNotification(
      { endpoint: input.endpoint, keys: input.keys },
      JSON.stringify(input.payload),
    );
    return { ok: true };
  } catch (e) {
    const err = e as { statusCode?: number; message?: string };
    const status = err.statusCode ?? 500;
    const gone = status === 404 || status === 410;
    return { ok: false, gone, status, message: err.message ?? String(e) };
  }
}

export async function sendPush(input: SendPushInput): Promise<SendPushResult> {
  return _send(input);
}

export function __setSendForTests(impl: typeof defaultSend): void {
  _send = impl;
}
export function __resetSendForTests(): void {
  _send = defaultSend;
}

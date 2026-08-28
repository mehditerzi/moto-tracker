import request from "supertest";
import type { Express } from "express";
import { buildTestApp } from "./buildApp.js";
import { signUpAndSignIn, type AuthedClient } from "./authedRequest.js";
import { addMember, createOrg } from "./org.js";
import type { OrgMode } from "@mototracker/shared";

/**
 * One organization with a member in every role, a rival organization to prove
 * isolation against, and an outsider who belongs to neither.
 *
 * Every fleet test starts here, because almost every assertion worth making is
 * "role X gets Y" or "the rival gets nothing" — and both need the whole cast.
 */
export interface FleetFixture {
  app: Express;
  owner: AuthedClient;
  owner2: AuthedClient;
  manager: AuthedClient;
  staff: AuthedClient;
  driver: AuthedClient;
  /** Signed in, member of nothing. */
  outsider: AuthedClient;
  /** Owner of a different org — the cross-tenant probe. */
  rival: AuthedClient;
  orgId: string;
  rivalOrgId: string;
  van: string;
  truck: string;
  rivalVan: string;
  mode: OrgMode;
}

export async function fleetFixture(mode: OrgMode = "fleet"): Promise<FleetFixture> {
  const app = buildTestApp();
  const owner = await signUpAndSignIn(app, "owner@filo.test");
  const owner2 = await signUpAndSignIn(app, "owner2@filo.test");
  const manager = await signUpAndSignIn(app, "manager@filo.test");
  const staff = await signUpAndSignIn(app, "staff@filo.test");
  const driver = await signUpAndSignIn(app, "driver@filo.test");
  const outsider = await signUpAndSignIn(app, "outsider@filo.test");
  const rival = await signUpAndSignIn(app, "rival@filo.test");

  const orgId = createOrg("Kervan Filo", mode, 10);
  addMember(orgId, owner.user.id, "owner");
  addMember(orgId, manager.user.id, "manager");
  addMember(orgId, staff.user.id, "staff");
  addMember(orgId, driver.user.id, "driver");

  const rivalOrgId = createOrg("Rakip Filo", mode, 10);
  addMember(rivalOrgId, rival.user.id, "owner");

  const van = await createOrgBike(app, owner.cookie, orgId, "Van", "34 ABC 123");
  const truck = await createOrgBike(app, owner.cookie, orgId, "Kamyonet", "06BCD456");
  const rivalVan = await createOrgBike(app, rival.cookie, rivalOrgId, "Rakip Van", "35XYZ789");

  return {
    app,
    owner,
    owner2,
    manager,
    staff,
    driver,
    outsider,
    rival,
    orgId,
    rivalOrgId,
    van,
    truck,
    rivalVan,
    mode,
  };
}

export async function createOrgBike(
  app: Express,
  cookie: string,
  orgId: string,
  nickname: string,
  plate?: string,
): Promise<string> {
  const res = await request(app)
    .post("/api/bikes")
    .set("Cookie", cookie)
    .send({ nickname, orgId, ...(plate ? { plate } : {}) });
  if (res.status !== 201) throw new Error(`createOrgBike: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.id as string;
}

/**
 * `YYYY-MM-DD`, `days` from today — how every deadline in these tests is set.
 *
 * Anchored to the same calendar the API uses (`lib/fleet.ts` → CRON_TIMEZONE),
 * not to the runner's local one: otherwise a CI box in UTC and a laptop in
 * Istanbul disagree about "today" for three hours every evening and a
 * days-remaining assertion goes green or red depending on the clock.
 */
export function isoInDays(days: number): string {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Istanbul" });
  const [y, m, d] = today.split("-").map(Number) as [number, number, number];
  const shifted = new Date(Date.UTC(y, m - 1, d + days));
  return shifted.toISOString().slice(0, 10);
}

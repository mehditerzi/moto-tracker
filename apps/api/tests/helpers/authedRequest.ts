import request from "supertest";
import type { Express } from "express";

export interface AuthedClient {
  cookie: string;
  user: { id: string; email: string };
  agent: ReturnType<typeof request>;
}

export async function signUpAndSignIn(
  app: Express,
  email = `u_${Date.now()}@test.com`,
  password = "supersecret123",
): Promise<AuthedClient> {
  const signup = await request(app)
    .post("/api/auth/sign-up/email")
    .send({ email, password, name: "Test User" });
  const setCookies = signup.headers["set-cookie"];
  if (!setCookies) throw new Error("no Set-Cookie on sign-up; got status " + signup.status);
  const cookie = (Array.isArray(setCookies) ? setCookies : [setCookies])
    .map((c: string) => c.split(";")[0])
    .join("; ");
  return {
    cookie,
    user: { id: signup.body.user.id, email: signup.body.user.email },
    agent: request(app),
  };
}

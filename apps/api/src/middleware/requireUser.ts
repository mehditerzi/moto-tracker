import type { Request, Response, NextFunction } from "express";
import { getAuth } from "../auth/index.js";
import { fromNodeHeaders } from "better-auth/node";

export async function requireUser(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const session = await getAuth().api.getSession({
    headers: fromNodeHeaders(req.headers),
  });
  if (!session?.user) {
    res.status(401).json({ error: "unauthenticated" });
    return;
  }
  req.user = {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name ?? null,
  };
  next();
}

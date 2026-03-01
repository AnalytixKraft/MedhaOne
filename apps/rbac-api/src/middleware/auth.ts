import type { NextFunction, Request, Response } from "express";

import { verifyToken } from "../utils/jwt.js";

export function authenticate(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Missing bearer token" });
  }

  try {
    req.auth = verifyToken(header.slice(7));
    return next();
  } catch {
    return res.status(401).json({ message: "Invalid token" });
  }
}

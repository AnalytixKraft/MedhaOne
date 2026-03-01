import cors from "cors";
import express from "express";

import { env } from "./config/env.js";
import { AppError } from "./lib/errors.js";
import { authRouter } from "./routes/auth.routes.js";
import { organizationsRouter } from "./routes/organizations.routes.js";
import { usersRouter } from "./routes/users.routes.js";

export const app = express();

app.use(cors({ origin: env.CORS_ORIGIN }));
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.use("/auth", authRouter);
app.use("/organizations", organizationsRouter);
app.use("/users", usersRouter);

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (error instanceof AppError) {
    return res.status(error.status).json({
      error_code: error.code,
      message: error.message,
      details: error.details,
    });
  }

  if (error instanceof Error) {
    const status = error.message.includes("Forbidden")
      ? 403
      : error.message.includes("Invalid credentials")
        ? 401
        : error.message.includes("User limit reached")
          ? 409
          : 400;
    return res.status(status).json({ message: error.message });
  }
  return res.status(500).json({ message: "Internal server error" });
});

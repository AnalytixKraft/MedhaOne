import { prisma } from "./lib/prisma.js";
import { app } from "./app.js";
import { env } from "./config/env.js";
import { hashPassword } from "./utils/password.js";
import { seedSuperAdminIfMissing } from "./services/auth.service.js";

async function bootstrap() {
  await prisma.$connect();
  const passwordHash = await hashPassword(env.SUPER_ADMIN_PASSWORD);
  await seedSuperAdminIfMissing(env.SUPER_ADMIN_EMAIL, passwordHash);

  app.listen(env.PORT, () => {
    console.log(`RBAC API listening on http://localhost:${env.PORT}`);
  });
}

bootstrap().catch((error) => {
  console.error("Failed to start RBAC API", error);
  process.exit(1);
});

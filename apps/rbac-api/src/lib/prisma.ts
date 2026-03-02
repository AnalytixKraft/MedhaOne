import { env } from "../config/env.js";
import { PrismaClient } from "@prisma/client";

process.env.DATABASE_URL = env.DATABASE_URL;

export const prisma = new PrismaClient();

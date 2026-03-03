import { config } from "./config.ts";
import { runAiEngine } from "./engine.ts";

async function main(): Promise<void> {
  if (!config.enabled) {
    console.log("[AI] AI testing is disabled (AI_TEST_ENABLED is not true).");
    return;
  }

  const result = await runAiEngine();
  if (!result.success) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(`[AI] Runner failed: ${message}`);
  process.exit(1);
});

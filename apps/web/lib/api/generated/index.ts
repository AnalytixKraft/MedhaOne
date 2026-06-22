/**
 * Ergonomic aliases over the generated OpenAPI types.
 *
 * `schema.ts` is generated from the backend's OpenAPI document — do NOT edit it by
 * hand. Regenerate with `pnpm openapi:generate` after the backend contract changes
 * (CI fails if it is stale). Reference backend DTOs through `Schemas["SomeName"]` so a
 * backend contract change surfaces as a TypeScript error here and in every consumer.
 */
import type { components } from "./schema";

export type Schemas = components["schemas"];

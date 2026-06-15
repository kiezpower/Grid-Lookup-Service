import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("Missing DATABASE_URL environment variable");

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationSql = readFileSync(
  join(__dirname, "../drizzle/0000_grid_lookup_init.sql"),
  "utf-8"
);

const client = postgres(databaseUrl, { max: 1 });

const statements = migrationSql
  .split("--> statement-breakpoint")
  .map((s) => s.trim())
  .filter(Boolean);

for (const statement of statements) {
  await client.unsafe(statement);
}

await client.end();
console.log("Grid-lookup schema applied successfully.");

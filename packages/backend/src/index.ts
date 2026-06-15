import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { swagger } from "@elysiajs/swagger";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { GridLookupRepository } from "./db/repository.js";
import { LookupService } from "./services/lookup.service.js";
import { createGridLookupRouter } from "./routes/lookup.router.js";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("Missing DATABASE_URL environment variable");

const port = Number(process.env.PORT ?? 3000);

const client = postgres(databaseUrl);
const db = drizzle(client);
const repo = new GridLookupRepository(db);
const lookupService = new LookupService(repo);

const __dirname = dirname(fileURLToPath(import.meta.url));
const frontendHtml = readFileSync(join(__dirname, "../../../frontend/src/index.html"), "utf-8");

const app = new Elysia()
  .use(cors())
  .use(
    swagger({
      documentation: {
        info: { title: "Grid Lookup API", version: "1.0.0" },
      },
    })
  )
  .get("/", () => new Response(frontendHtml, { headers: { "Content-Type": "text/html" } }))
  .use(createGridLookupRouter(lookupService))
  .listen(port);

console.log(`Grid Lookup Service running on http://localhost:${port}`);
console.log(`Swagger UI: http://localhost:${port}/swagger`);

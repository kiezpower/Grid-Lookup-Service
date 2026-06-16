#!/usr/bin/env bun
/**
 * MaStR XML Streaming Parser with Dynamic Chunk Detection
 *
 * Dynamically enumerates and processes chunk files from MaStR ZIP:
 * - Marktakteure_1.xml, Marktakteure_2.xml, ...
 * - Netzanschlusspunkte_1.xml, Netzanschlusspunkte_2.xml, ...
 * - EinheitenSolar_1.xml, EinheitenSolar_2.xml, ...
 *
 * PLZ→SNB mapping uses a two-step join:
 *   EinheitenSolar.LokationMaStRNummer → Netzanschlusspunkte.NetzbetreiberMaStRNummer
 *
 * Targets <3min processing, ~512MB RAM (NP join map holds ~5.7M entries).
 */

import { $ } from "bun";
import postgres from "postgres";
import { Readable } from "stream";
import {
  parseMarktakteure,
  parseNetzanschlusspunkte,
  parsePlzVotes,
  aggregatePlzVotes,
  selectPlzWinners,
} from "../services/mastr-xml-parser.js";
import { populateDatabase } from "../services/mastr-db-populator.js";

async function ensureGridLookupTablesExist(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error("Missing DATABASE_URL environment variable");
  }

  const client = postgres(databaseUrl, {
    max: 1,
    idle_timeout: 5,
    connect_timeout: 10,
  });

  try {
    const checks = await client<
      { tableName: string; exists: boolean }[]
    >`select v.table_name as "tableName", to_regclass('public.' || v.table_name) is not null as "exists"
      from (values ('grid_lookup_operators'), ('zip_operator_mapping')) as v(table_name)`;

    const missing = checks
      .filter((row) => !row.exists)
      .map((row) => row.tableName);

    if (missing.length > 0) {
      throw new Error(
        `Missing required grid lookup table(s): ${missing.join(", ")}. Run \"cd packages/backend && bun run db:migrate:grid-lookup\" (or \"bun run db:migrate\") first.`,
      );
    }
  } finally {
    await client.end();
  }
}

async function enumerateChunkFiles(
  zipPath: string,
  pattern: string,
): Promise<string[]> {
  const result = await $`unzip -l ${zipPath}`.text();
  const lines = result.split("\n");
  const files: string[] = [];

  const regex = new RegExp(pattern.replace("*", "\\d+"));

  for (const line of lines) {
    const match = line.match(/([^\s]+\.xml)$/);
    if (match && regex.test(match[1])) {
      files.push(match[1]);
    }
  }

  return files.sort((a, b) => {
    const aNum = parseInt(a.match(/_(\d+)\.xml$/)?.[1] || "0");
    const bNum = parseInt(b.match(/_(\d+)\.xml$/)?.[1] || "0");
    return aNum - bNum;
  });
}

async function streamFileFromZip(
  zipPath: string,
  fileName: string,
): Promise<Readable> {
  const proc = Bun.spawn(
    ["sh", "-c", `unzip -p "${zipPath}" "${fileName}" | iconv -f UTF-16 -t UTF-8 2>/dev/null || unzip -p "${zipPath}" "${fileName}"`],
    { stdout: "pipe" },
  );
  return Readable.from(proc.stdout);
}

async function collectChunkedXml<T>(
  zipPath: string,
  pattern: string,
  parser: (stream: Readable, ...args: any[]) => Promise<T[]>,
  ...parserArgs: any[]
): Promise<T[]> {
  const chunkFiles = await enumerateChunkFiles(zipPath, pattern);

  if (chunkFiles.length === 0) {
    console.warn(`⚠️  No files found matching pattern: ${pattern}`);
    return [];
  }

  console.log(`📦 Found ${chunkFiles.length} chunks for ${pattern}`);
  const allResults: T[] = [];

  for (const [index, fileName] of chunkFiles.entries()) {
    console.log(
      `   Processing chunk ${index + 1}/${chunkFiles.length}: ${fileName}`,
    );
    const stream = await streamFileFromZip(zipPath, fileName);
    const results = await parser(stream, ...parserArgs);
    allResults.push(...results);
    console.log(
      `   ✓ Parsed ${results.length} entries (total: ${allResults.length})`,
    );
  }

  return allResults;
}

async function processChunkedXml<T>(
  zipPath: string,
  pattern: string,
  onChunk: (results: T[]) => Promise<void> | void,
  parser: (stream: Readable, ...args: any[]) => Promise<T[]>,
  ...parserArgs: any[]
): Promise<void> {
  const chunkFiles = await enumerateChunkFiles(zipPath, pattern);

  if (chunkFiles.length === 0) {
    console.warn(`⚠️  No files found matching pattern: ${pattern}`);
    return;
  }

  console.log(`📦 Found ${chunkFiles.length} chunks for ${pattern}`);

  for (const [index, fileName] of chunkFiles.entries()) {
    console.log(
      `   Processing chunk ${index + 1}/${chunkFiles.length}: ${fileName}`,
    );
    const stream = await streamFileFromZip(zipPath, fileName);
    const results = await parser(stream, ...parserArgs);
    await onChunk(results);
    console.log(`   ✓ Parsed ${results.length} entries`);
  }
}

async function parseMastrZip(zipPath: string) {
  const startTime = Date.now();
  console.log("=== MaStR XML Streaming Parser ===");
  console.log(`ZIP: ${zipPath}\n`);

  console.log("[0/5] Checking database schema...");
  await ensureGridLookupTablesExist();
  console.log("✓ Required tables found\n");

  // Phase 1: Parse Marktakteure — SNB-prefix filter applied inside parser
  console.log("[1/5] Parsing Marktakteure (SNB only)...");
  const operators = await collectChunkedXml(
    zipPath,
    "Marktakteure_*.xml",
    parseMarktakteure,
  );
  console.log(`✓ Grid operators (SNB-prefixed): ${operators.length}\n`);

  // Phase 2: Build LokationMaStRNummer → NetzbetreiberMaStRNummer lookup map.
  // EinheitenSolar does not carry a NetzbetreiberMaStRNummer field; the join
  // via Netzanschlusspunkte is the only way to resolve PLZ → SNB.
  console.log("[2/5] Building Netzanschlusspunkte join map...");
  const lokationToNetzbetreiber = new Map<string, string>();
  const npFiles = await enumerateChunkFiles(zipPath, "Netzanschlusspunkte_*.xml");

  if (npFiles.length === 0) {
    console.warn("⚠️  No Netzanschlusspunkte chunks found — PLZ votes will be empty");
  } else {
    console.log(`📦 Found ${npFiles.length} chunks for Netzanschlusspunkte_*.xml`);
    for (const [index, fileName] of npFiles.entries()) {
      console.log(
        `   Processing chunk ${index + 1}/${npFiles.length}: ${fileName}`,
      );
      const stream = await streamFileFromZip(zipPath, fileName);
      await parseNetzanschlusspunkte(stream, lokationToNetzbetreiber);
      console.log(
        `   ✓ Map size: ${lokationToNetzbetreiber.size.toLocaleString()} entries`,
      );
    }
  }
  console.log(
    `✓ Netzanschlusspunkte map: ${lokationToNetzbetreiber.size.toLocaleString()} SEL→SNB pairs\n`,
  );

  // Phase 3: Parse PLZ votes from EinheitenSolar using the join map
  console.log("[3/5] Parsing EinheitenSolar for PLZ votes...");
  const aggregated = new Map<string, Map<string, number>>();
  await processChunkedXml(
    zipPath,
    "EinheitenSolar_*.xml",
    async (chunkVotes) => {
      const chunkAggregated = aggregatePlzVotes(chunkVotes);
      for (const [plz, votes] of chunkAggregated.entries()) {
        let target = aggregated.get(plz);
        if (!target) {
          target = new Map<string, number>();
          aggregated.set(plz, target);
        }
        for (const [mastrNummer, count] of votes.entries()) {
          target.set(mastrNummer, (target.get(mastrNummer) ?? 0) + count);
        }
      }
    },
    parsePlzVotes,
    "EinheitSolar",
    ["NetzbetreiberMaStRNummer", "NetzbetreiberMastrNummer"],
    lokationToNetzbetreiber,
  );
  console.log(`✓ Unique PLZs covered: ${aggregated.size}\n`);

  // Phase 4: Select winners
  console.log("[4/5] Selecting winners...");
  const winners = selectPlzWinners(aggregated);
  console.log(`✓ Winners selected: ${winners.length}\n`);

  // Phase 5: Populate database
  console.log("[5/5] Populating database...");
  await populateDatabase(operators, winners);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const memUsageMB = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1);

  console.log(`\n⏱️  Processing time: ${elapsed}s`);
  console.log(`💾 Memory usage: ${memUsageMB} MB`);

  if (parseFloat(elapsed) > 180) {
    console.warn("⚠️  Exceeded 3min target!");
  }
  if (parseFloat(memUsageMB) > 512) {
    console.warn("⚠️  Exceeded 512MB RAM target!");
  }

  return {
    operators,
    plzAggregation: aggregated,
    winners,
    metrics: {
      timeSeconds: parseFloat(elapsed),
      memoryMB: parseFloat(memUsageMB),
    },
  };
}

const zipPath = process.argv[2] || process.env.MASTR_ZIP_PATH;

if (!zipPath) {
  console.error("Usage: bun run scripts/parse-mastr.ts <path-to-mastr.zip>");
  console.error(
    "   or: MASTR_ZIP_PATH=/path/to/mastr.zip bun run scripts/parse-mastr.ts",
  );
  process.exit(1);
}

parseMastrZip(zipPath)
  .then((result) => {
    console.log("\n✅ Parsing and database population complete!");
    console.log(`   Operators: ${result.operators.length}`);
    console.log(`   PLZ coverage: ${result.plzAggregation.size}`);
    console.log(`   Winners inserted: ${result.winners.length}`);
    process.exit(0);
  })
  .catch((err) => {
    console.error("❌ Parsing failed:", err);
    process.exit(1);
  });

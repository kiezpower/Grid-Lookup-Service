#!/usr/bin/env bun
/**
 * MaStR JSON Export — PLZ → Netzbetreiber mapping
 *
 * Runs the same XML parsing pipeline as parse-mastr.ts (phases 1–4) but
 * writes a static JSON file instead of populating the database.
 *
 * Output format: { [plz: string]: PlzEntry }
 * Used to generate SEO pages per postal code on the KiezPower website.
 */

import { $ } from "bun";
import { Readable } from "stream";
import {
  parseMarktakteure,
  parseNetzanschlusspunkte,
  parsePlzVotes,
  aggregatePlzVotes,
  selectPlzWinners,
} from "../services/mastr-xml-parser.js";
import type { GridOperatorInsert } from "../types/index.js";

interface PlzEntry {
  name: string;
  mastrNummer: string;
  plzCity?: string;
  city?: string;
  street?: string;
  houseNumber?: string;
  zipCode?: string;
  state?: string;
  country?: string;
  bdewId?: string;
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
    console.log(`   Processing chunk ${index + 1}/${chunkFiles.length}: ${fileName}`);
    const stream = await streamFileFromZip(zipPath, fileName);
    const results = await parser(stream, ...parserArgs);
    allResults.push(...results);
    console.log(`   ✓ Parsed ${results.length} entries (total: ${allResults.length})`);
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
    console.log(`   Processing chunk ${index + 1}/${chunkFiles.length}: ${fileName}`);
    const stream = await streamFileFromZip(zipPath, fileName);
    const results = await parser(stream, ...parserArgs);
    await onChunk(results);
    console.log(`   ✓ Parsed ${results.length} entries`);
  }
}

async function parseMastrToJson(zipPath: string, outputPath: string): Promise<void> {
  const startTime = Date.now();
  console.log("=== MaStR JSON Export ===");
  console.log(`ZIP:    ${zipPath}`);
  console.log(`Output: ${outputPath}\n`);

  // Phase 1: Parse Marktakteure — only SNB-prefixed legal entities
  console.log("[1/4] Parsing Marktakteure (SNB only)...");
  const operators = await collectChunkedXml(
    zipPath,
    "Marktakteure_*.xml",
    parseMarktakteure,
  );
  console.log(`✓ Grid operators: ${operators.length}\n`);

  const operatorByMastr = new Map<string, GridOperatorInsert>();
  for (const op of operators) {
    operatorByMastr.set(op.mastrNummer, op);
  }

  // Phase 2: Build LokationMaStRNummer → NetzbetreiberMaStRNummer join map
  console.log("[2/4] Building Netzanschlusspunkte join map...");
  const lokationToNetzbetreiber = new Map<string, string>();
  const npFiles = await enumerateChunkFiles(zipPath, "Netzanschlusspunkte_*.xml");

  if (npFiles.length === 0) {
    console.warn("⚠️  No Netzanschlusspunkte chunks found — PLZ votes will be empty");
  } else {
    console.log(`📦 Found ${npFiles.length} chunks for Netzanschlusspunkte_*.xml`);
    for (const [index, fileName] of npFiles.entries()) {
      console.log(`   Processing chunk ${index + 1}/${npFiles.length}: ${fileName}`);
      const stream = await streamFileFromZip(zipPath, fileName);
      await parseNetzanschlusspunkte(stream, lokationToNetzbetreiber);
      console.log(`   ✓ Map size: ${lokationToNetzbetreiber.size.toLocaleString()} entries`);
    }
  }
  console.log(`✓ Join map: ${lokationToNetzbetreiber.size.toLocaleString()} SEL→SNB pairs\n`);

  // Phase 3: Parse PLZ votes from EinheitenSolar using the join map
  console.log("[3/4] Parsing EinheitenSolar for PLZ votes...");
  const aggregated = new Map<string, Map<string, number>>();
  const plzCityVotes = new Map<string, Map<string, number>>();
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
      for (const { plz, city } of chunkVotes) {
        if (!city) continue;
        let cityMap = plzCityVotes.get(plz);
        if (!cityMap) {
          cityMap = new Map<string, number>();
          plzCityVotes.set(plz, cityMap);
        }
        cityMap.set(city, (cityMap.get(city) ?? 0) + 1);
      }
    },
    parsePlzVotes,
    "EinheitSolar",
    ["NetzbetreiberMaStRNummer", "NetzbetreiberMastrNummer"],
    lokationToNetzbetreiber,
  );
  console.log(`✓ Unique PLZs: ${aggregated.size}\n`);

  // Phase 4: Select winner per PLZ and build JSON output
  console.log("[4/4] Selecting winners and writing JSON...");
  const winners = selectPlzWinners(aggregated);

  const plzMap: Record<string, PlzEntry> = {};
  let matched = 0;

  for (const winner of winners) {
    const op = operatorByMastr.get(winner.mastrNummer);
    if (!op) continue;
    matched++;

    const cityMap = plzCityVotes.get(winner.plz);
    let plzCity: string | undefined;
    if (cityMap) {
      let maxVotes = 0;
      for (const [city, count] of cityMap.entries()) {
        if (count > maxVotes) { maxVotes = count; plzCity = city; }
      }
    }

    plzMap[winner.plz] = {
      name: op.name,
      mastrNummer: op.mastrNummer,
      ...(plzCity && { plzCity }),
      ...(op.city && { city: op.city }),
      ...(op.street && { street: op.street }),
      ...(op.houseNumber && { houseNumber: op.houseNumber }),
      ...(op.zipCode && { zipCode: op.zipCode }),
      ...(op.state && { state: op.state }),
      ...(op.country && { country: op.country }),
      ...(op.bdewId && { bdewId: op.bdewId }),
    };
  }

  await Bun.write(outputPath, JSON.stringify(plzMap, null, 2));

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const memUsageMB = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1);
  const fileSizeKB = ((await Bun.file(outputPath).size) / 1024).toFixed(0);

  console.log(`✓ Written ${matched} PLZ entries to ${outputPath} (${fileSizeKB} KB)\n`);
  console.log(`⏱️  Processing time: ${elapsed}s`);
  console.log(`💾 Memory usage: ${memUsageMB} MB`);

  if (parseFloat(elapsed) > 180) {
    console.warn("⚠️  Exceeded 3min target!");
  }
  if (parseFloat(memUsageMB) > 512) {
    console.warn("⚠️  Exceeded 512MB RAM target!");
  }
}

const zipPath = process.argv[2] || process.env.MASTR_ZIP_PATH;
const outputPath =
  process.argv[3] || process.env.MASTR_JSON_OUTPUT || "./plz-netzbetreiber.json";

if (!zipPath) {
  console.error(
    "Usage: bun run src/scripts/parse-mastr-json.ts <path-to-mastr.zip> [output.json]",
  );
  console.error(
    "   or: MASTR_ZIP_PATH=/path/to/mastr.zip bun run src/scripts/parse-mastr-json.ts",
  );
  process.exit(1);
}

parseMastrToJson(zipPath, outputPath)
  .then(() => {
    console.log("\n✅ JSON export complete!");
    process.exit(0);
  })
  .catch((err) => {
    console.error("❌ Export failed:", err);
    process.exit(1);
  });

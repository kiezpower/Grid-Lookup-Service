import { createReadStream } from "node:fs";
import { parseMarktakteure, parsePlzVotes, aggregatePlzVotes, selectPlzWinners } from "../services/mastr-xml-parser.js";
import { populateDatabase } from "../services/mastr-db-populator.js";

const [marktakteureFile, plzVotesFile] = process.argv.slice(2);

if (!marktakteureFile || !plzVotesFile) {
  console.error("Usage: bun run src/scripts/import-mastr.ts <Marktakteure.xml> <Einheiten.xml>");
  process.exit(1);
}

console.log(`Parsing operators from: ${marktakteureFile}`);
const operators = await parseMarktakteure(createReadStream(marktakteureFile));
console.log(`Found ${operators.length} grid operators.`);

console.log(`Parsing PLZ votes from: ${plzVotesFile}`);
const votes = await parsePlzVotes(createReadStream(plzVotesFile));
const aggregated = aggregatePlzVotes(votes);
const winners = selectPlzWinners(aggregated);
console.log(`Found ${winners.length} PLZ→operator mappings.`);

await populateDatabase(operators, winners);

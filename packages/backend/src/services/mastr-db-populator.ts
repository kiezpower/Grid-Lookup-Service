import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { gridLookupOperators, zipOperatorMapping } from "../db/schema.js";
import type { GridOperatorInsert } from "../types/index.js";
import type { PlzWinner } from "./mastr-xml-parser.js";
import { inArray, sql, eq } from "drizzle-orm";
import { resolveGridOperatorOutreachEmail } from "./provider-email-resolver.js";

export async function populateDatabase(
  operators: GridOperatorInsert[],
  plzWinners: PlzWinner[],
) {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("Missing DATABASE_URL environment variable");

  const client = postgres(databaseUrl, {
    max: 1,
    idle_timeout: 20,
    connect_timeout: 30,
  });
  const db = drizzle(client);

  console.log("\n=== Database Population ===");

  try {
    console.log(`[1/2] Inserting ${operators.length} grid operators...`);

    const mastrToId = new Map<string, string>();
    const operatorBatchSize = 1000;

    for (let i = 0; i < operators.length; i += operatorBatchSize) {
      const slice = operators.slice(i, i + operatorBatchSize);
      const upserted = await db
        .insert(gridLookupOperators)
        .values(
          slice.map((operator) => ({
            mastrNummer: operator.mastrNummer,
            name: operator.name,
            bdewId: operator.bdewId ?? null,
            street: operator.street ?? null,
            houseNumber: operator.houseNumber ?? null,
            zipCode: operator.zipCode ?? null,
            city: operator.city ?? null,
            state: operator.state ?? null,
            country: operator.country ?? null,
            email: resolveGridOperatorOutreachEmail(operator.mastrNummer),
            acerCode: operator.acerCode ?? null,
            isClosedGrid: operator.isClosedGrid ?? false,
            status: operator.status ?? null,
          })),
        )
        .onConflictDoUpdate({
          target: gridLookupOperators.mastrNummer,
          set: {
            name: sql`excluded.name`,
            bdewId: sql`excluded.bdew_id`,
            street: sql`excluded.street`,
            houseNumber: sql`excluded.house_number`,
            zipCode: sql`excluded.zip_code`,
            city: sql`excluded.city`,
            state: sql`excluded.state`,
            country: sql`excluded.country`,
            email: sql`excluded.email`,
            acerCode: sql`excluded.acer_code`,
            isClosedGrid: sql`excluded.is_closed_grid`,
            status: sql`excluded.status`,
            updatedAt: new Date(),
          },
        })
        .returning({
          id: gridLookupOperators.id,
          mastrNummer: gridLookupOperators.mastrNummer,
        });

      for (const row of upserted) {
        mastrToId.set(row.mastrNummer, row.id);
      }
    }

    console.log(`✓ Processed ${mastrToId.size} unique operators`);

    console.log(`[2/2] Inserting ${plzWinners.length} ZIP mappings...`);

    const allPlz = Array.from(new Set(plzWinners.map((winner) => winner.plz)));
    const plzBatchSize = 2000;
    const existingByPlz = new Map<
      string,
      { id: string; voteCount: number; gridOperatorId: string }
    >();

    for (let i = 0; i < allPlz.length; i += plzBatchSize) {
      const chunk = allPlz.slice(i, i + plzBatchSize);
      const rows = await db
        .select({
          id: zipOperatorMapping.id,
          plz: zipOperatorMapping.plz,
          voteCount: zipOperatorMapping.voteCount,
          gridOperatorId: zipOperatorMapping.gridOperatorId,
        })
        .from(zipOperatorMapping)
        .where(inArray(zipOperatorMapping.plz, chunk));

      for (const row of rows) {
        const current = existingByPlz.get(row.plz);
        if (!current || row.voteCount > current.voteCount) {
          existingByPlz.set(row.plz, row);
        }
      }
    }

    const inserts: Array<{ plz: string; gridOperatorId: string; voteCount: number }> = [];
    const updates: Array<{ id: string; gridOperatorId: string; voteCount: number }> = [];
    let skipped = 0;

    for (const winner of plzWinners) {
      const operatorId = mastrToId.get(winner.mastrNummer);
      if (!operatorId) {
        skipped++;
        continue;
      }

      const existing = existingByPlz.get(winner.plz);
      if (!existing) {
        inserts.push({ plz: winner.plz, gridOperatorId: operatorId, voteCount: winner.voteCount });
        continue;
      }

      if (winner.voteCount > existing.voteCount) {
        updates.push({ id: existing.id, gridOperatorId: operatorId, voteCount: winner.voteCount });
      } else {
        skipped++;
      }
    }

    for (const update of updates) {
      await db
        .update(zipOperatorMapping)
        .set({ gridOperatorId: update.gridOperatorId, voteCount: update.voteCount })
        .where(eq(zipOperatorMapping.id, update.id));
    }

    const insertBatchSize = 1000;
    for (let i = 0; i < inserts.length; i += insertBatchSize) {
      await db.insert(zipOperatorMapping).values(inserts.slice(i, i + insertBatchSize));
    }

    console.log(
      `✓ Inserted ${inserts.length} new mappings, updated ${updates.length}, skipped ${skipped}`,
    );
    console.log("\n✅ Database population complete!");
  } finally {
    await client.end();
  }
}

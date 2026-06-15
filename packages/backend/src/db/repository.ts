import { eq, desc, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { gridLookupOperators, zipOperatorMapping } from "./schema.js";
import type { GridOperator, GridOperatorInsert, ZipOperatorMappingInsert } from "../types/index.js";

export type { GridOperator };

export type GridLookupDb = PostgresJsDatabase<Record<string, never>>;

export class GridLookupRepository {
  constructor(private readonly db: GridLookupDb) {}

  async findOperatorsByPlz(plz: string): Promise<GridOperator[]> {
    const rows = await this.db
      .select({
        id: gridLookupOperators.id,
        mastrNummer: gridLookupOperators.mastrNummer,
        name: gridLookupOperators.name,
        bdewId: gridLookupOperators.bdewId,
        street: gridLookupOperators.street,
        houseNumber: gridLookupOperators.houseNumber,
        zipCode: gridLookupOperators.zipCode,
        city: gridLookupOperators.city,
        state: gridLookupOperators.state,
        country: gridLookupOperators.country,
        email: gridLookupOperators.email,
        phone: gridLookupOperators.phone,
        website: gridLookupOperators.website,
        acerCode: gridLookupOperators.acerCode,
        isClosedGrid: gridLookupOperators.isClosedGrid,
        status: gridLookupOperators.status,
        createdAt: gridLookupOperators.createdAt,
        updatedAt: gridLookupOperators.updatedAt,
        voteCount: zipOperatorMapping.voteCount,
      })
      .from(zipOperatorMapping)
      .innerJoin(
        gridLookupOperators,
        eq(zipOperatorMapping.gridOperatorId, gridLookupOperators.id)
      )
      .where(eq(zipOperatorMapping.plz, plz))
      .orderBy(desc(zipOperatorMapping.voteCount));

    return rows.map((r) => ({
      id: r.id,
      mastrNummer: r.mastrNummer,
      name: r.name,
      bdewId: r.bdewId,
      street: r.street,
      houseNumber: r.houseNumber,
      zipCode: r.zipCode,
      city: r.city,
      state: r.state,
      country: r.country,
      email: r.email,
      phone: r.phone,
      website: r.website,
      acerCode: r.acerCode,
      isClosedGrid: r.isClosedGrid,
      status: r.status,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));
  }

  async upsertOperator(data: GridOperatorInsert): Promise<string> {
    const result = await this.db
      .insert(gridLookupOperators)
      .values({
        mastrNummer: data.mastrNummer,
        name: data.name,
        bdewId: data.bdewId ?? null,
        street: data.street ?? null,
        houseNumber: data.houseNumber ?? null,
        zipCode: data.zipCode ?? null,
        city: data.city ?? null,
        state: data.state ?? null,
        country: data.country ?? null,
        email: data.email ?? null,
        acerCode: data.acerCode ?? null,
        isClosedGrid: data.isClosedGrid ?? false,
        status: data.status ?? null,
      })
      .onConflictDoUpdate({
        target: gridLookupOperators.mastrNummer,
        set: {
          name: data.name,
          bdewId: data.bdewId ?? null,
          street: data.street ?? null,
          houseNumber: data.houseNumber ?? null,
          zipCode: data.zipCode ?? null,
          city: data.city ?? null,
          state: data.state ?? null,
          country: data.country ?? null,
          email: data.email ?? null,
          acerCode: data.acerCode ?? null,
          isClosedGrid: data.isClosedGrid ?? false,
          status: data.status ?? null,
          updatedAt: new Date(),
        },
      })
      .returning({ id: gridLookupOperators.id });

    return result[0].id;
  }

  async upsertZipMapping(data: ZipOperatorMappingInsert): Promise<void> {
    await this.db
      .insert(zipOperatorMapping)
      .values({
        plz: data.plz,
        gridOperatorId: data.gridOperatorId,
        voteCount: data.voteCount,
      })
      .onConflictDoUpdate({
        target: [zipOperatorMapping.plz, zipOperatorMapping.gridOperatorId],
        set: { voteCount: data.voteCount },
      });
  }

  async batchUpsertOperators(
    operators: GridOperatorInsert[]
  ): Promise<Map<string, string>> {
    const mastrToId = new Map<string, string>();
    const BATCH = 500;

    for (let i = 0; i < operators.length; i += BATCH) {
      const slice = operators.slice(i, i + BATCH);
      const result = await this.db
        .insert(gridLookupOperators)
        .values(
          slice.map((op) => ({
            mastrNummer: op.mastrNummer,
            name: op.name,
            bdewId: op.bdewId ?? null,
            street: op.street ?? null,
            houseNumber: op.houseNumber ?? null,
            zipCode: op.zipCode ?? null,
            city: op.city ?? null,
            state: op.state ?? null,
            country: op.country ?? null,
            email: op.email ?? null,
            acerCode: op.acerCode ?? null,
            isClosedGrid: op.isClosedGrid ?? false,
            status: op.status ?? null,
          }))
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
        .returning({ id: gridLookupOperators.id, mastrNummer: gridLookupOperators.mastrNummer });

      result.forEach((r) => mastrToId.set(r.mastrNummer, r.id));
    }

    return mastrToId;
  }

  async batchUpsertZipMappings(mappings: ZipOperatorMappingInsert[]): Promise<void> {
    const BATCH = 1000;

    for (let i = 0; i < mappings.length; i += BATCH) {
      const slice = mappings.slice(i, i + BATCH);
      await this.db
        .insert(zipOperatorMapping)
        .values(slice)
        .onConflictDoUpdate({
          target: [zipOperatorMapping.plz, zipOperatorMapping.gridOperatorId],
          set: { voteCount: sql`excluded.vote_count` },
        });
    }
  }
}

import { pgTable, text, uuid, timestamp, integer, index, uniqueIndex, boolean } from "drizzle-orm/pg-core";

export const gridLookupOperators = pgTable(
  "grid_lookup_operators",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    mastrNummer: text("mastr_nummer").notNull().unique(),
    name: text("name").notNull(),
    bdewId: text("bdew_id"),
    street: text("street"),
    houseNumber: text("house_number"),
    zipCode: text("zip_code"),
    city: text("city"),
    state: text("state"),
    country: text("country"),
    email: text("email"),
    phone: text("phone"),
    website: text("website"),
    acerCode: text("acer_code"),
    isClosedGrid: boolean("is_closed_grid").notNull().default(false),
    status: text("status"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    mastrNummerIdx: uniqueIndex("grid_lookup_operators_mastr_nummer_idx").on(t.mastrNummer),
  })
);

export const zipOperatorMapping = pgTable(
  "zip_operator_mapping",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    plz: text("plz").notNull(),
    gridOperatorId: uuid("grid_operator_id")
      .notNull()
      .references(() => gridLookupOperators.id, { onDelete: "cascade" }),
    voteCount: integer("vote_count").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    plzIdx: index("zip_operator_mapping_plz_idx").on(t.plz),
    plzOperatorIdx: uniqueIndex("zip_operator_mapping_plz_operator_idx").on(
      t.plz,
      t.gridOperatorId
    ),
  })
);

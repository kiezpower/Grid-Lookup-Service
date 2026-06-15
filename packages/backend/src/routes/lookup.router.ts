import { Elysia, t } from "elysia";
import type { LookupService } from "../services/lookup.service.js";

export function createGridLookupRouter(lookupService: LookupService) {
  return new Elysia({ prefix: "/api/v1/grid-operator" }).get(
    "/lookup/:plz",
    async ({ params, set }) => {
      const { plz } = params;

      if (!/^\d{5}$/.test(plz)) {
        set.status = 400;
        return { error: "INVALID_PLZ", message: "PLZ must be exactly 5 digits." };
      }

      const result = await lookupService.lookup(plz);

      if (result.kind === "not_found") {
        set.status = 404;
        return { error: "NOT_FOUND", message: "No grid operator found for this PLZ." };
      }

      if (result.kind === "unique") {
        return {
          match: "unique" as const,
          operator: {
            id: result.operator.id,
            name: result.operator.name,
            mastrNummer: result.operator.mastrNummer,
            bdewId: result.operator.bdewId,
            street: result.operator.street,
            houseNumber: result.operator.houseNumber,
            zipCode: result.operator.zipCode,
            city: result.operator.city,
            state: result.operator.state,
            country: result.operator.country,
            email: result.operator.email,
            phone: result.operator.phone,
            website: result.operator.website,
            acerCode: result.operator.acerCode,
            isClosedGrid: result.operator.isClosedGrid,
            status: result.operator.status,
          },
        };
      }

      return {
        match: "multi" as const,
        operators: result.operators.map((op) => ({
          id: op.id,
          name: op.name,
          mastrNummer: op.mastrNummer,
          bdewId: op.bdewId,
          street: op.street,
          houseNumber: op.houseNumber,
          zipCode: op.zipCode,
          city: op.city,
          state: op.state,
          country: op.country,
          email: op.email,
          phone: op.phone,
          website: op.website,
          acerCode: op.acerCode,
          isClosedGrid: op.isClosedGrid,
          status: op.status,
        })),
      };
    },
    {
      params: t.Object({ plz: t.String() }),
      detail: {
        summary: "PLZ → Grid Operator Lookup",
        description:
          "Resolves the responsible distribution grid operator(s) for a German postal code. Returns `unique` when exactly one operator covers the area, `multi` for border zones.",
        tags: ["Grid Lookup"],
      },
    }
  );
}

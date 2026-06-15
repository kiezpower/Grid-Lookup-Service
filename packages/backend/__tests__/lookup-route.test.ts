import { describe, it, expect, mock } from "bun:test";
import { Elysia } from "elysia";
import { createGridLookupRouter } from "../src/routes/lookup.router.js";
import type { LookupService } from "../src/services/lookup.service.js";
import type { GridOperator } from "../src/types/index.js";

const BERLIN_OPERATOR: GridOperator = {
  id: "aaaa0000-0000-0000-0000-000000000001",
  mastrNummer: "SNB000001",
  name: "Stromnetz Berlin GmbH",
  bdewId: "9900123456789",
  street: "Hauptstraße 1",
  houseNumber: "1",
  zipCode: "10115",
  city: "Berlin",
  state: "Berlin",
  country: "Deutschland",
  email: null,
  phone: null,
  website: null,
  acerCode: null,
  isClosedGrid: false,
  status: "Aktiv",
  createdAt: new Date("2024-01-01T00:00:00Z"),
  updatedAt: new Date("2024-01-01T00:00:00Z"),
};

const BORDER_OPERATOR: GridOperator = {
  id: "bbbb0000-0000-0000-0000-000000000002",
  mastrNummer: "SNB000002",
  name: "E.DIS Netz GmbH",
  bdewId: null,
  street: "Fürstenwalder Straße 10",
  houseNumber: "10",
  zipCode: "15517",
  city: "Fürstenwalde",
  state: "Brandenburg",
  country: "Deutschland",
  email: null,
  phone: null,
  website: null,
  acerCode: null,
  isClosedGrid: false,
  status: "Aktiv",
  createdAt: new Date("2024-01-01T00:00:00Z"),
  updatedAt: new Date("2024-01-01T00:00:00Z"),
};

const makeMockService = (
  impl: (plz: string) => ReturnType<LookupService["lookup"]>
): LookupService => ({ lookup: mock(impl) } as unknown as LookupService);

const makeApp = (service: LookupService) =>
  new Elysia().use(createGridLookupRouter(service));

describe("GET /api/v1/grid-operator/lookup/:plz", () => {
  it("returns 400 for a non-numeric PLZ", async () => {
    const app = makeApp(makeMockService(async () => ({ kind: "not_found" })));
    const res = await app.handle(
      new Request("http://localhost/api/v1/grid-operator/lookup/ABCDE")
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("INVALID_PLZ");
  });

  it("returns 400 for a PLZ with fewer than 5 digits", async () => {
    const app = makeApp(makeMockService(async () => ({ kind: "not_found" })));
    const res = await app.handle(
      new Request("http://localhost/api/v1/grid-operator/lookup/1234")
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("INVALID_PLZ");
  });

  it("returns 404 when no operator is found for the PLZ", async () => {
    const app = makeApp(makeMockService(async () => ({ kind: "not_found" })));
    const res = await app.handle(
      new Request("http://localhost/api/v1/grid-operator/lookup/99999")
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("NOT_FOUND");
  });

  it("Fall A — returns match=unique with operator for a single-operator PLZ", async () => {
    const app = makeApp(
      makeMockService(async () => ({ kind: "unique", operator: BERLIN_OPERATOR }))
    );
    const res = await app.handle(
      new Request("http://localhost/api/v1/grid-operator/lookup/10115")
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.match).toBe("unique");
    expect(body.operator.id).toBe(BERLIN_OPERATOR.id);
    expect(body.operator.name).toBe("Stromnetz Berlin GmbH");
    expect(body.operator.mastrNummer).toBe("SNB000001");
    expect(body.operator.bdewId).toBe("9900123456789");
    expect(body.operator.street).toBe("Hauptstraße 1");
    expect(body.operator.city).toBe("Berlin");
    expect(body.operator.isClosedGrid).toBe(false);
  });

  it("Fall B — returns match=multi with all operators for a border-zone PLZ", async () => {
    const app = makeApp(
      makeMockService(async () => ({
        kind: "multi",
        operators: [BERLIN_OPERATOR, BORDER_OPERATOR],
      }))
    );
    const res = await app.handle(
      new Request("http://localhost/api/v1/grid-operator/lookup/18347")
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.match).toBe("multi");
    expect(body.operators).toHaveLength(2);
    expect(body.operators[0].name).toBe("Stromnetz Berlin GmbH");
    expect(body.operators[1].name).toBe("E.DIS Netz GmbH");
    expect(body.operators[1].bdewId).toBeNull();
    expect(body.operators[1].street).toBe("Fürstenwalder Straße 10");
  });

  it("does not expose createdAt/updatedAt in the response", async () => {
    const app = makeApp(
      makeMockService(async () => ({ kind: "unique", operator: BERLIN_OPERATOR }))
    );
    const res = await app.handle(
      new Request("http://localhost/api/v1/grid-operator/lookup/10115")
    );
    const body = await res.json();
    expect(body.operator.createdAt).toBeUndefined();
    expect(body.operator.updatedAt).toBeUndefined();
  });
});

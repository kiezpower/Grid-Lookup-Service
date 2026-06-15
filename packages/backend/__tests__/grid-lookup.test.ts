import { describe, it, expect } from "bun:test";
import { Readable } from "stream";
import { parseMarktakteure, parsePlzVotes, aggregatePlzVotes } from "../src/services/mastr-xml-parser.js";
import { LookupService } from "../src/services/lookup.service.js";
import type { GridLookupRepository } from "../src/db/repository.js";
import type { GridOperator } from "../src/types/index.js";

// --- mastr-xml-parser ---

describe("parseMarktakteure", () => {
  it("parses a valid Marktakteur entry", async () => {
    const xml = `
<Marktakteur>
  <MastrNummer>SNB123456</MastrNummer>
  <Firmenname>Stadtwerke Musterstadt GmbH</Firmenname>
  <Marktfunktion>Stromnetzbetreiber</Marktfunktion>
  <BDEW_DVGW_ID>9900987654321</BDEW_DVGW_ID>
  <Ort>Musterstadt</Ort>
  <Personenart>JuristischePerson</Personenart>
</Marktakteur>`;

    const stream = Readable.from([xml]);
    const result = await parseMarktakteure(stream);

    expect(result).toHaveLength(1);
    expect(result[0].mastrNummer).toBe("SNB123456");
    expect(result[0].name).toBe("Stadtwerke Musterstadt GmbH");
    expect(result[0].bdewId).toBe("9900987654321");
    expect(result[0].city).toBe("Musterstadt");
  });

  it("discards natural persons (DSGVO)", async () => {
    const xml = `
<Marktakteur>
  <MastrNummer>PERSON999</MastrNummer>
  <Firmenname>Max Mustermann</Firmenname>
  <Marktfunktion>Stromnetzbetreiber</Marktfunktion>
  <Personenart>NatuerlichePerson</Personenart>
</Marktakteur>`;

    const stream = Readable.from([xml]);
    const result = await parseMarktakteure(stream);

    expect(result).toHaveLength(0);
  });

  it("skips entries without MastrNummer or name", async () => {
    const xml = `
<Marktakteur>
  <Ort>Berlin</Ort>
</Marktakteur>`;

    const stream = Readable.from([xml]);
    const result = await parseMarktakteure(stream);

    expect(result).toHaveLength(0);
  });
});

describe("parsePlzVotes + aggregatePlzVotes", () => {
  it("extracts PLZ→MaStR votes from a solar units XML", async () => {
    const xml = `
<EinheitSolar>
  <Postleitzahl>10115</Postleitzahl>
  <NetzbetreiberMaStRNummer>SNB123456</NetzbetreiberMaStRNummer>
</EinheitSolar>
<EinheitSolar>
  <Postleitzahl>10115</Postleitzahl>
  <NetzbetreiberMaStRNummer>SNB123456</NetzbetreiberMaStRNummer>
</EinheitSolar>
<EinheitSolar>
  <Postleitzahl>10115</Postleitzahl>
  <NetzbetreiberMaStRNummer>SNB999999</NetzbetreiberMaStRNummer>
</EinheitSolar>`;

    const stream = Readable.from([xml]);
    const votes = await parsePlzVotes(stream, "EinheitSolar");
    const agg = aggregatePlzVotes(votes);

    expect(agg.get("10115")?.get("SNB123456")).toBe(2);
    expect(agg.get("10115")?.get("SNB999999")).toBe(1);
  });

  it("ignores entries with invalid PLZ format", async () => {
    const xml = `
<EinheitSolar>
  <Postleitzahl>ABCDE</Postleitzahl>
  <NetzbetreiberMaStRNummer>SNB123456</NetzbetreiberMaStRNummer>
</EinheitSolar>`;

    const stream = Readable.from([xml]);
    const votes = await parsePlzVotes(stream, "EinheitSolar");

    expect(votes).toHaveLength(0);
  });
});

// --- LookupService ---

const makeMockRepo = (operators: GridOperator[]): GridLookupRepository =>
  ({
    findOperatorsByPlz: async (_plz: string) => operators,
  } as unknown as GridLookupRepository);

describe("LookupService.lookup", () => {
  it("returns not_found when no operators exist", async () => {
    const service = new LookupService(makeMockRepo([]));
    const result = await service.lookup("10115");
    expect(result.kind).toBe("not_found");
  });

  it("returns unique for a single operator", async () => {
    const op: GridOperator = {
      id: "uuid-1",
      mastrNummer: "SNB123456",
      name: "Stadtwerke Berlin",
      bdewId: null,
      street: null,
      houseNumber: null,
      zipCode: null,
      city: "Berlin",
      state: null,
      country: null,
      email: null,
      phone: null,
      website: null,
      acerCode: null,
      isClosedGrid: false,
      status: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const service = new LookupService(makeMockRepo([op]));
    const result = await service.lookup("10115");
    expect(result.kind).toBe("unique");
    if (result.kind === "unique") {
      expect(result.operator.name).toBe("Stadtwerke Berlin");
    }
  });

  it("returns multi for multiple operators (border zone)", async () => {
    const ops: GridOperator[] = [
      { id: "uuid-1", mastrNummer: "SNB1", name: "Op A", bdewId: null, street: null, houseNumber: null, zipCode: null, city: null, state: null, country: null, email: null, phone: null, website: null, acerCode: null, isClosedGrid: false, status: null, createdAt: new Date(), updatedAt: new Date() },
      { id: "uuid-2", mastrNummer: "SNB2", name: "Op B", bdewId: null, street: null, houseNumber: null, zipCode: null, city: null, state: null, country: null, email: null, phone: null, website: null, acerCode: null, isClosedGrid: false, status: null, createdAt: new Date(), updatedAt: new Date() },
    ];
    const service = new LookupService(makeMockRepo(ops));
    const result = await service.lookup("18347");
    expect(result.kind).toBe("multi");
    if (result.kind === "multi") {
      expect(result.operators).toHaveLength(2);
    }
  });
});

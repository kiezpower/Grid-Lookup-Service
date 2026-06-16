import { createInterface } from "readline";
import { Readable } from "stream";
import type { GridOperatorInsert } from "../types/index.js";

export interface PlzVote {
  plz: string;
  mastrNummer: string;
  city?: string;
}

export interface MastrParseResult {
  operators: GridOperatorInsert[];
  plzVotes: PlzVote[];
}

const PLZ_RE = /^\d{5}$/;

function extractField(line: string, tag: string): string | null {
  const open = `<${tag}>`;
  const close = `</${tag}>`;
  const start = line.indexOf(open);
  if (start === -1) return null;
  const end = line.indexOf(close, start);
  if (end === -1) return null;
  return line.slice(start + open.length, end).trim() || null;
}

function extractFirstField(line: string, tags: string[]): string | null {
  for (const tag of tags) {
    const value = extractField(line, tag);
    if (value) return value;
  }
  return null;
}

function stripXmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function isNaturalPerson(personType: string | null): boolean {
  // Text format (old exports): "NatuerlichePerson"
  // Numeric format (export v26+): 518 = Natürliche Person, 517 = Juristische Person
  return personType === "NatuerlichePerson" || personType === "518";
}

function hasExactStromnetzbetreiberRole(entry: string): boolean {
  // Text format (old exports): "Stromnetzbetreiber" in Marktfunktion/Marktrolle
  // Numeric format (export v26+): SNB-prefixed MaStrNummer is the definitive indicator
  // — the MaStrNummer check in extractGridOperatorInsert covers this case
  return (
    /<(?:Marktfunktion|Marktrolle|Funktionsart)>\s*Stromnetzbetreiber\s*<\/(?:Marktfunktion|Marktrolle|Funktionsart)>/i.test(entry) ||
    /<MastrNummer>\s*SNB/i.test(entry)
  );
}

function extractGridOperatorInsert(entry: string): GridOperatorInsert | null {
  const personType = extractField(entry, "Personenart");
  if (isNaturalPerson(personType)) return null;

  if (!hasExactStromnetzbetreiberRole(entry)) return null;

  const mastrNummer = extractField(entry, "MastrNummer");
  const name =
    extractFirstField(entry, ["Firmenname", "Name", "Bezeichnung"]);

  if (!mastrNummer || !name || !mastrNummer.startsWith("SNB")) {
    return null;
  }

  const street = extractFirstField(entry, ["Strasse", "Straße", "Street"]);
  const houseNumber = extractFirstField(entry, ["Hausnummer", "HouseNumber"]);
  const zipCode = extractFirstField(entry, ["Postleitzahl", "PLZ", "ZipCode"]);
  const city = extractFirstField(entry, ["Ort", "City"]);
  const state = extractFirstField(entry, ["Bundesland", "State"]);
  const country = extractFirstField(entry, ["Land", "Country"]);
  const email = extractFirstField(entry, ["E-Mail", "Email", "EmailAdresse"]);
  const acerCode = extractFirstField(entry, ["ACERCode", "AcerCode", "ACER_Code"]);
  const status = extractFirstField(entry, ["Status", "Aktivitaet", "Aktiv"]);
  const isClosedGridValue = extractFirstField(entry, [
    "IstGeschlossenesVerteilernetz",
    "IstGeschlossenesNetz",
    "GeschlossenesVerteilernetz",
  ]);
  const isClosedGrid = isClosedGridValue
    ? /^(true|1|ja)$/i.test(isClosedGridValue)
    : false;
  const bdewId = extractField(entry, "BDEW_DVGW_ID");

  return {
    mastrNummer: stripXmlEntities(mastrNummer),
    name: stripXmlEntities(name),
    bdewId: bdewId ? stripXmlEntities(bdewId) : undefined,
    street: street ? stripXmlEntities(street) : undefined,
    houseNumber: houseNumber ? stripXmlEntities(houseNumber) : undefined,
    zipCode: zipCode ? stripXmlEntities(zipCode) : undefined,
    city: city ? stripXmlEntities(city) : undefined,
    state: state ? stripXmlEntities(state) : undefined,
    country: country ? stripXmlEntities(country) : undefined,
    email: email ? stripXmlEntities(email) : undefined,
    acerCode: acerCode ? stripXmlEntities(acerCode) : undefined,
    isClosedGrid,
    status: status ? stripXmlEntities(status) : undefined,
  };
}

// Only accept legal-entity entries whose exact market function is
// Stromnetzbetreiber and whose MaStR number is SNB-prefixed. This prevents
// natural persons and asset owners from being seeded into grid_lookup_operators.
export async function parseMarktakteure(
  stream: Readable,
): Promise<GridOperatorInsert[]> {
  const operators: GridOperatorInsert[] = [];
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  const startTag = "<Marktakteur>";
  const endTag = "</Marktakteur>";
  let buffer = "";

  for await (const line of rl) {
    const sanitized = line.replace(/\u0000/g, "").replace(/\uFEFF/g, "");
    buffer += sanitized.trim();

    while (true) {
      const start = buffer.indexOf(startTag);
      if (start === -1) {
        if (buffer.length > endTag.length) {
          buffer = buffer.slice(-endTag.length);
        }
        break;
      }

      const end = buffer.indexOf(endTag, start);
      if (end === -1) {
        buffer = buffer.slice(start);
        break;
      }

      const entry = buffer.slice(start, end + endTag.length);
      buffer = buffer.slice(end + endTag.length);

      const operator = extractGridOperatorInsert(entry);
      if (operator) operators.push(operator);
    }
  }

  return operators;
}

// Populates lokationToNetzbetreiber with SEL→SNB pairs from Netzanschlusspunkte_*.xml.
// Each Netzanschlusspunkt links a LokationMaStRNummer (SEL) to the responsible
// NetzbetreiberMaStRNummer (SNB) — the only place in the MaStR export that
// directly identifies the grid operator for a physical connection point.
export async function parseNetzanschlusspunkte(
  stream: Readable,
  lokationToNetzbetreiber: Map<string, string>,
): Promise<void> {
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  const startTag = "<Netzanschlusspunkt>";
  const endTag = "</Netzanschlusspunkt>";
  let buffer = "";

  for await (const line of rl) {
    const sanitized = line.replace(/\u0000/g, "").replace(/\uFEFF/g, "");
    buffer += sanitized.trim();

    while (true) {
      const start = buffer.indexOf(startTag);
      if (start === -1) {
        if (buffer.length > endTag.length) {
          buffer = buffer.slice(-endTag.length);
        }
        break;
      }

      const end = buffer.indexOf(endTag, start);
      if (end === -1) {
        buffer = buffer.slice(start);
        break;
      }

      const entry = buffer.slice(start, end + endTag.length);
      buffer = buffer.slice(end + endTag.length);

      const lokation = extractField(entry, "LokationMaStRNummer");
      const snb = extractField(entry, "NetzbetreiberMaStRNummer");

      if (lokation && snb) {
        lokationToNetzbetreiber.set(lokation, snb);
      }
    }
  }
}

// EinheitenSolar_*.xml does NOT contain a NetzbetreiberMaStRNummer field.
// When lokationToNetzbetreiber is provided, the function resolves the SNB via
// LokationMaStRNummer (populated from Netzanschlusspunkte). The mastrTags
// fallback is kept for unit types that do carry the tag directly (e.g. future
// export versions or other Einheiten types).
export async function parsePlzVotes(
  stream: Readable,
  tag: string,
  mastrTags: string[] = [
    "NetzbetreiberMaStRNummer",
    "NetzbetreiberMastrNummer",
  ],
  lokationToNetzbetreiber?: Map<string, string>,
): Promise<PlzVote[]> {
  const votes: PlzVote[] = [];
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  const startTag = `<${tag}>`;
  const endTag = `</${tag}>`;
  let buffer = "";

  for await (const line of rl) {
    const sanitized = line.replace(/\u0000/g, "").replace(/\uFEFF/g, "");
    buffer += sanitized.trim();

    while (true) {
      const start = buffer.indexOf(startTag);
      if (start === -1) {
        if (buffer.length > endTag.length) {
          buffer = buffer.slice(-endTag.length);
        }
        break;
      }

      const end = buffer.indexOf(endTag, start);
      if (end === -1) {
        buffer = buffer.slice(start);
        break;
      }

      const entry = buffer.slice(start, end + endTag.length);
      buffer = buffer.slice(end + endTag.length);

      const plz = extractField(entry, "Postleitzahl");
      const city = extractField(entry, "Ort") ?? undefined;

      let mastrNummer: string | null = null;
      if (lokationToNetzbetreiber) {
        const lokation = extractField(entry, "LokationMaStRNummer");
        if (lokation) {
          mastrNummer = lokationToNetzbetreiber.get(lokation) ?? null;
        }
      } else {
        mastrNummer =
          mastrTags
            .map((candidateTag) => extractField(entry, candidateTag))
            .find((value): value is string => Boolean(value)) ?? null;
      }

      if (plz && PLZ_RE.test(plz) && mastrNummer) {
        votes.push({ plz, mastrNummer, city });
      }
    }
  }

  return votes;
}

export function aggregatePlzVotes(
  votes: PlzVote[],
): Map<string, Map<string, number>> {
  const result = new Map<string, Map<string, number>>();

  for (const { plz, mastrNummer } of votes) {
    if (!result.has(plz)) result.set(plz, new Map());
    const inner = result.get(plz)!;
    inner.set(mastrNummer, (inner.get(mastrNummer) ?? 0) + 1);
  }

  return result;
}

export interface PlzWinner {
  plz: string;
  mastrNummer: string;
  voteCount: number;
}

export function selectPlzWinners(
  aggregated: Map<string, Map<string, number>>,
): PlzWinner[] {
  const winners: PlzWinner[] = [];

  for (const [plz, votes] of aggregated.entries()) {
    let maxCount = 0;
    let winnerMastr = "";

    for (const [mastrNummer, count] of votes.entries()) {
      if (count > maxCount) {
        maxCount = count;
        winnerMastr = mastrNummer;
      }
    }

    if (winnerMastr && maxCount > 0) {
      winners.push({ plz, mastrNummer: winnerMastr, voteCount: maxCount });
    }
  }

  return winners;
}

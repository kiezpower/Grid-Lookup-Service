# Grid Lookup Service

A standalone REST API that resolves the responsible German electricity distribution grid operator (Netzbetreiber) for any postal code (PLZ). Data is sourced from the [Marktstammdatenregister (MaStR)](https://www.marktstammdatenregister.de/), the official German energy market register published by the Bundesnetzagentur.

## What it does

Given a 5-digit German postal code, the service returns:

- **`unique`** — exactly one grid operator is responsible for this area
- **`multi`** — the PLZ sits on a grid border, two or more operators share it
- **`404`** — no data found for this PLZ

A minimal web UI is served at `/` for manual lookups. The Swagger API docs are available at `/swagger`.

## Architecture

```
grid-lookup-service/
├── packages/
│   ├── backend/                  Elysia (Bun) REST API
│   │   └── src/
│   │       ├── index.ts          Server entry point
│   │       ├── config.ts         Tunable defaults (maxMultiResults, minVoteCount)
│   │       ├── db/
│   │       │   ├── schema.ts     Drizzle table definitions
│   │       │   ├── repository.ts Data access layer
│   │       │   └── migrate.ts    Schema migration runner
│   │       ├── drizzle/
│   │       │   └── 0000_grid_lookup_init.sql
│   │       ├── routes/
│   │       │   └── lookup.router.ts   GET /api/v1/grid-operator/lookup/:plz
│   │       ├── services/
│   │       │   ├── lookup.service.ts         Core resolution logic
│   │       │   ├── mastr-xml-parser.ts       Streaming MaStR XML parser
│   │       │   ├── mastr-db-populator.ts     Batch DB import
│   │       │   └── provider-email-resolver.ts Outreach email override map
│   │       ├── static/
│   │       │   └── grid-provider-emails.json  Manual email overrides per MaStR-Nr.
│   │       ├── types/
│   │       └── scripts/
│   │           └── import-mastr.ts   CLI import runner
│   └── frontend/
│       └── src/index.html            Minimal lookup UI (served by the backend)
├── docker-compose.yml            PostgreSQL 16
├── .env.example
└── package.json                  Bun workspace root
```

## Requirements

- [Bun](https://bun.sh/) ≥ 1.1
- Docker (for local PostgreSQL)

## Setup

```bash
# 1. Clone and install
git clone <repo-url> grid-lookup-service
cd grid-lookup-service
bun install

# 2. Configure environment
cp .env.example .env
# Edit .env if needed (DATABASE_URL, PORT, DEFAULT_OUTREACH_EMAIL)

# 3. Start the database
docker-compose up -d

# 4. Apply the schema
bun run db:migrate

# 5. Start the development server
bun run dev
```

The service is now running at `http://localhost:3000`.

## Importing MaStR data

Download the full MaStR export from the [Bundesnetzagentur](https://www.marktstammdatenregister.de/MaStR/Daten/Abruf). You need two XML files:

| File | Purpose |
|---|---|
| `Marktakteure.xml` | Operator master data (name, BDEW-ID, address) |
| `EinheitenStrom.xml` (or similar) | PLZ→operator vote data |

Then run:

```bash
bun run mastr:import <path/to/Marktakteure.xml> <path/to/EinheitenStrom.xml>
```

The importer:
1. Parses operators from `Marktakteure.xml` using a RAM-efficient streaming parser
2. Derives PLZ→operator mappings by vote count (most appearances per PLZ wins)
3. Upserts everything into PostgreSQL in batches

**DSGVO note:** Entries with `<Personenart>NatuerlichePerson</Personenart>` are automatically discarded. Only legal entities (GmbH, AG, Stadtwerke, AöR) are stored.

## API

### `GET /api/v1/grid-operator/lookup/:plz`

**Parameters**

| Name | Type   | Description              |
|------|--------|--------------------------|
| `plz` | string | 5-digit German postal code |

**Response — unique match**

```json
{
  "match": "unique",
  "operator": {
    "id": "...",
    "name": "Stromnetz Berlin GmbH",
    "mastrNummer": "SNB000001",
    "bdewId": "9900123456789",
    "street": "Puschkinallee 52",
    "houseNumber": "52",
    "zipCode": "12435",
    "city": "Berlin",
    "state": "Berlin",
    "country": "Deutschland",
    "email": null,
    "phone": null,
    "website": null,
    "acerCode": null,
    "isClosedGrid": false,
    "status": "Aktiv"
  }
}
```

**Response — border zone (multi)**

```json
{
  "match": "multi",
  "operators": [ { ... }, { ... } ]
}
```

**Error responses**

| Status | Error code    | Reason                           |
|--------|---------------|----------------------------------|
| 400    | `INVALID_PLZ` | PLZ is not exactly 5 digits      |
| 404    | `NOT_FOUND`   | No operator found for this PLZ   |

## Email overrides

`packages/backend/src/static/grid-provider-emails.json` maps MaStR numbers to verified outreach email addresses. This overrides whatever email is in the MaStR data (which is often absent or outdated).

```json
{
  "SNB000001": {
    "name": "Stromnetz Berlin GmbH",
    "email": "netzanschluss@stromnetz-berlin.de"
  }
}
```

If no entry exists for an operator, the value of `DEFAULT_OUTREACH_EMAIL` from `.env` is used.

## Environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `DATABASE_URL` | yes | — | PostgreSQL connection string |
| `PORT` | no | `3000` | HTTP port |
| `DEFAULT_OUTREACH_EMAIL` | no | `outreach@example.com` | Fallback email when no override exists |

## Running tests

```bash
bun run test
```

Tests cover the MaStR XML parser, the lookup service, and the HTTP route layer. No database is required — the repository is mocked.

## Scripts

| Command | Description |
|---|---|
| `bun run dev` | Start with hot reload |
| `bun run build` | Compile to `dist/` |
| `bun run start` | Run compiled build |
| `bun run db:migrate` | Apply SQL schema to the database |
| `bun run mastr:import <operators.xml> <einheiten.xml>` | Import MaStR data |
| `bun run test` | Run all tests |
| `bun run typecheck` | TypeScript type check |


Beide Scripts starten vom MaStR-Gesamtexport-ZIP und laufen dieselbe 4-Phasen-Pipeline:

| Script | Befehl | Ausgabe |
|--------|--------|---------|
| `src/scripts/parse-mastr.ts` | `bun run mastr:parse <mastr.zip>` | Populiert `grid_lookup_operators` + `zip_operator_mapping` in der DB |
| `src/scripts/parse-mastr-json.ts` | `bun run mastr:parse-json <mastr.zip> [output.json]` | Schreibt `plz-netzbetreiber.json` für statische SEO-Seiten |

### parse-mastr-json — JSON Export

```bash
bun run mastr:parse-json /pfad/zu/Gesamtdatenexport.zip ./plz-netzbetreiber.json
# oder via Env-Vars:
MASTR_ZIP_PATH=/pfad/zu/export.zip MASTR_JSON_OUTPUT=./data.json bun run mastr:parse-json
```

Ausgabe-Format (`plz-netzbetreiber.json`):

```json
{
  "10115": {
    "name": "Stromnetz Berlin GmbH",
    "mastrNummer": "SNB900003602568",
    "city": "Berlin",
    "street": "Puschkinallee",
    "houseNumber": "52A",
    "zipCode": "12435",
    "state": "Berlin",
    "country": "Deutschland",
    "bdewId": "9900614000000"
  }
}
```

### parse-mastr — DB Import

```bash
DATABASE_URL=postgresql://... bun run mastr:parse /pfad/zu/Gesamtdatenexport.zip
```

Voraussetzung: Migration muss gelaufen sein (`bun run db:migrate:grid-lookup`).
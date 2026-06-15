import type { GridOperator } from "./grid-operator.js";

export interface LookupQuery {
  plz: string;
}

export type LookupResult =
  | { kind: "unique"; operator: GridOperator }
  | { kind: "multi"; operators: GridOperator[] }
  | { kind: "not_found" };

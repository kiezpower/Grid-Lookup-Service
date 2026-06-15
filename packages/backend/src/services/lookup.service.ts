import type { GridLookupRepository } from "../db/repository.js";
import type { LookupResult } from "../types/index.js";

export class LookupService {
  constructor(private readonly repo: GridLookupRepository) {}

  async lookup(plz: string): Promise<LookupResult> {
    const operators = await this.repo.findOperatorsByPlz(plz);

    if (operators.length === 0) return { kind: "not_found" };
    if (operators.length === 1) return { kind: "unique", operator: operators[0] };
    return { kind: "multi", operators };
  }
}

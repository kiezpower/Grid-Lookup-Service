export interface GridLookupConfig {
  /** Maximum number of operators to return for a multi-match PLZ */
  maxMultiResults: number;
  /** Minimum vote count threshold for including a mapping */
  minVoteCount: number;
}

export const DEFAULT_CONFIG: GridLookupConfig = {
  maxMultiResults: 10,
  minVoteCount: 1,
};

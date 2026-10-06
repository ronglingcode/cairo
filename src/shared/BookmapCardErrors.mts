export const BOOKMAP_CARD_ERRORS = {
  "observation-changed": "Observation changed; read evidence again",
  "setup-changed": "Setup changed; read evidence again",
  "invalid-observation": "Invalid observation interpretation",
  "invalid-setup": "Invalid setup interpretation",
  "missing-observation-evidence": "Interpretation references missing observation evidence",
  "missing-evidence": "Interpretation references missing evidence",
  "unknown-bounce": "Interpretation selects an unknown bounce",
  "unsupported-pattern": "Interpretation pattern lacks supporting structure",
  "unmeasured-price": "Interpretation contains an unmeasured price or distance",
} as const
export type BookmapCardErrorCode = keyof typeof BOOKMAP_CARD_ERRORS
export class BookmapCardError extends Error {
  readonly code: BookmapCardErrorCode
  constructor(code: BookmapCardErrorCode) { super(BOOKMAP_CARD_ERRORS[code]); this.code=code }
}

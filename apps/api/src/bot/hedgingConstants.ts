export const HedgeEvaluationResult = {
  HEDGED: "hedged",
  SKIPPED: "skipped",
  NOT_NEEDED: "not_needed",
} as const;

export type HedgeEvaluationResultType =
  (typeof HedgeEvaluationResult)[keyof typeof HedgeEvaluationResult];

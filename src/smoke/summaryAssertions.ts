import type { ClinicalSummaryView } from "../shared/clinicalSummaryMessages";

export function assertNoInternalIdentifiersInSummary(
  summary: ClinicalSummaryView,
  identifiers: readonly string[],
): void {
  const visibleText = summary.items.map((item) => item.text).join("\n");
  const leakedIdentifier = identifiers.find(
    (identifier) => identifier.length > 0 && visibleText.includes(identifier),
  );
  if (leakedIdentifier) {
    throw new Error("Rendered summary contains an internal identifier.");
  }
}

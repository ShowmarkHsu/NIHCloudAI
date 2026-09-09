import {
  createClinicalSnapshotCollector,
  type ClinicalSnapshotCollectorConfiguration,
  type ClinicalSnapshotCollectorResult,
  type ClinicalSnapshotScope,
} from './clinicalSnapshotCollector';

export type LabVerticalSliceScope = ClinicalSnapshotScope;
export type LabVerticalSliceResult = ClinicalSnapshotCollectorResult;
export type LabVerticalSliceConfiguration = ClinicalSnapshotCollectorConfiguration;

/** Compatibility interface for the completed R1 lab-only callers. */
export function createLabVerticalSlice(configuration: LabVerticalSliceConfiguration) {
  const collector = createClinicalSnapshotCollector(configuration);
  return Object.freeze({
    ingest(scope: LabVerticalSliceScope, terminalResult: unknown): LabVerticalSliceResult | null {
      return collector.ingest(scope, terminalResult);
    },
    discardSession(sessionId: string): void {
      collector.discardSession(sessionId);
    },
  });
}

/** Extracts only the legacy terminal lab envelope; it never exposes a row. */
export function terminalLabResultFromFetchEvent(value: unknown): unknown | null {
  if (!Array.isArray(value)) return null;
  const result = value.find((candidate) =>
    typeof candidate === 'object' && candidate !== null
    && (Reflect.get(candidate, 'dataType') === 'labdata' || Reflect.get(candidate, 'dataType') === 'lab'),
  );
  if (result === undefined || typeof result !== 'object' || result === null) return null;
  const status = Reflect.get(result, 'status');
  return status === 'success' || status === 'nodata' ? result : null;
}

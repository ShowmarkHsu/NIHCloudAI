import { z } from "zod";

/** Opaque identifiers are stable only for the lifetime of a data session. */
export const IdentifierSchema = z.string().trim().min(1, "must not be empty");
export type Identifier = z.infer<typeof IdentifierSchema>;

/** JSON-safe date/time representation used throughout the domain contract. */
export const DateTimeSchema = z
  .string()
  .trim()
  .min(1, "date/time must not be empty")
  .refine((value) => Number.isFinite(Date.parse(value)), {
    message: "must be a valid date/time string",
  });
export type DateTime = z.infer<typeof DateTimeSchema>;

export const SourceRecordTypeSchema = z.enum([
  "encounter",
  "medication",
  "allergy",
  "lab",
  "imaging",
  "discharge",
  "hospitalization",
  "procedure",
  "vital",
  "immunization",
  "other",
]);
export type SourceRecordType = z.infer<typeof SourceRecordTypeSchema>;

/**
 * The smallest independently citable unit returned by a data adapter.
 * Type-specific content stays in `data`; the envelope is deliberately strict
 * so misspelled fields cannot silently enter the model input contract.
 */
export const SourceRecordSchema = z
  .object({
    id: IdentifierSchema,
    patientId: IdentifierSchema,
    sessionId: IdentifierSchema,
    type: SourceRecordTypeSchema,
    recordedAt: DateTimeSchema,
    summary: z.string().trim().min(1),
    data: z.record(z.string(), z.unknown()),
  })
  .strict();
export type SourceRecord = z.infer<typeof SourceRecordSchema>;

export const SourceReferenceSchema = IdentifierSchema;
export type SourceReference = z.infer<typeof SourceReferenceSchema>;

export const SourceRefsSchema = z
  .array(SourceReferenceSchema)
  .min(1, "at least one source reference is required")
  .refine((refs) => new Set(refs).size === refs.length, {
    message: "source references must be unique",
  });
export type SourceRefs = z.infer<typeof SourceRefsSchema>;

/** A normalized collection for exactly one patient and one data session. */
export const PatientSnapshotSchema = z
  .object({
    patientId: IdentifierSchema,
    sessionId: IdentifierSchema,
    capturedAt: DateTimeSchema,
    records: z.array(SourceRecordSchema),
  })
  .strict()
  .superRefine((snapshot, context) => {
    const ids = new Set<string>();
    snapshot.records.forEach((record, index) => {
      if (ids.has(record.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["records", index, "id"],
          message: `duplicate source record id: ${record.id}`,
        });
      }
      ids.add(record.id);

      if (record.patientId !== snapshot.patientId) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["records", index, "patientId"],
          message: "source record patientId does not match snapshot patientId",
        });
      }
      if (record.sessionId !== snapshot.sessionId) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["records", index, "sessionId"],
          message: "source record sessionId does not match snapshot sessionId",
        });
      }
    });
  });
export type PatientSnapshot = z.infer<typeof PatientSnapshotSchema>;

export const ClinicalFactTypeSchema = z.enum([
  "event",
  "medication",
  "allergy",
  "lab",
  "imaging",
  "discharge",
  "hospitalization",
  "trend",
  "other",
]);
export type ClinicalFactType = z.infer<typeof ClinicalFactTypeSchema>;

/** A source-backed statement produced by a direct rule or normalization step. */
export const ClinicalFactSchema = z
  .object({
    id: IdentifierSchema,
    patientId: IdentifierSchema,
    sessionId: IdentifierSchema,
    type: ClinicalFactTypeSchema,
    text: z.string().trim().min(1),
    sourceRefs: SourceRefsSchema,
    derived: z.boolean().optional(),
    createdAt: DateTimeSchema.optional(),
  })
  .strict();
export type ClinicalFact = z.infer<typeof ClinicalFactSchema>;

export const SafetySignalKindSchema = z.enum([
  "abnormal-lab",
  "lab-trend",
  "medication-overlap",
  "duplicate-test",
  "allergy-risk",
  "missing-data",
  "contradiction",
  "other",
]);
export type SafetySignalKind = z.infer<typeof SafetySignalKindSchema>;

export const SafetySignalSeveritySchema = z.enum(["attention", "urgent-review"]);
export type SafetySignalSeverity = z.infer<typeof SafetySignalSeveritySchema>;

/** A deterministic signal that asks a clinician to inspect source facts. */
export const SafetySignalSchema = z
  .object({
    id: IdentifierSchema,
    patientId: IdentifierSchema,
    sessionId: IdentifierSchema,
    kind: SafetySignalKindSchema,
    text: z.string().trim().min(1),
    sourceRefs: SourceRefsSchema,
    severity: SafetySignalSeveritySchema,
    createdAt: DateTimeSchema.optional(),
  })
  .strict();
export type SafetySignal = z.infer<typeof SafetySignalSchema>;

export const SummaryItemSectionSchema = z.enum([
  "timeline",
  "medication",
  "allergy",
  "lab",
  "imaging",
  "hospitalization",
  "discharge",
  "uncertainty",
]);
export type SummaryItemSection = z.infer<typeof SummaryItemSectionSchema>;

export const SummaryImportanceSchema = z.enum([
  "routine",
  "attention",
  "urgent-review",
]);
export type SummaryImportance = z.infer<typeof SummaryImportanceSchema>;

/** Every summary item is visible and therefore must cite at least one source. */
export const SummaryItemSchema = z
  .object({
    id: IdentifierSchema,
    section: SummaryItemSectionSchema,
    text: z.string().trim().min(1),
    sourceRefs: SourceRefsSchema,
    importance: SummaryImportanceSchema,
  })
  .strict();
export type SummaryItem = z.infer<typeof SummaryItemSchema>;

/** Non-clinical metadata needed to reproduce how a summary was generated. */
export const SummaryProvenanceSchema = z
  .object({
    providerId: IdentifierSchema,
    model: IdentifierSchema,
    promptVersion: IdentifierSchema,
    schemaVersion: IdentifierSchema,
    rulesVersion: IdentifierSchema,
  })
  .strict();
export type SummaryProvenance = z.infer<typeof SummaryProvenanceSchema>;

/**
 * Structured output shown to a clinician.  The standalone schema validates
 * shape and identity among nested facts/signals; source existence is checked
 * by validateClinicalSummaryAgainstSnapshot at the data-session seam.
 */
export const ClinicalSummarySchema = z
  .object({
    patientId: IdentifierSchema,
    sessionId: IdentifierSchema,
    generatedAt: DateTimeSchema,
    provenance: SummaryProvenanceSchema,
    items: z.array(SummaryItemSchema),
    facts: z.array(ClinicalFactSchema).optional(),
    safetySignals: z.array(SafetySignalSchema).optional(),
  })
  .strict()
  .superRefine((summary, context) => {
    summary.facts?.forEach((fact, index) => {
      if (fact.patientId !== summary.patientId) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["facts", index, "patientId"],
          message: "clinical fact patientId does not match summary patientId",
        });
      }
      if (fact.sessionId !== summary.sessionId) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["facts", index, "sessionId"],
          message: "clinical fact sessionId does not match summary sessionId",
        });
      }
    });
    summary.safetySignals?.forEach((signal, index) => {
      if (signal.patientId !== summary.patientId) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["safetySignals", index, "patientId"],
          message: "safety signal patientId does not match summary patientId",
        });
      }
      if (signal.sessionId !== summary.sessionId) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["safetySignals", index, "sessionId"],
          message: "safety signal sessionId does not match summary sessionId",
        });
      }
    });
  });
export type ClinicalSummary = z.infer<typeof ClinicalSummarySchema>;

/**
 * Validate one structured summary against the exact patient snapshot that was
 * used to create it.  The function throws a ZodError for malformed values,
 * patient/session mismatches, or any source reference absent from the
 * snapshot.  Parsing happens first so callers never receive a partially
 * trusted result.
 */
export function validateClinicalSummaryAgainstSnapshot(
  summaryInput: unknown,
  snapshotInput: unknown,
): ClinicalSummary {
  const snapshot = PatientSnapshotSchema.parse(snapshotInput);
  const summary = ClinicalSummarySchema.parse(summaryInput);
  const sourceIds = new Set(snapshot.records.map((record) => record.id));
  const issues: z.ZodIssue[] = [];

  const containsIdentifier = (text: string, identifier: string): boolean => {
    const escaped = identifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(
      `(^|[^\\p{L}\\p{N}_-])${escaped}($|[^\\p{L}\\p{N}_-])`,
      "u",
    ).test(text);
  };

  if (summary.patientId !== snapshot.patientId) {
    issues.push({
      code: z.ZodIssueCode.custom,
      path: ["patientId"],
      message: "summary patientId does not match snapshot patientId",
    });
  }
  if (summary.sessionId !== snapshot.sessionId) {
    issues.push({
      code: z.ZodIssueCode.custom,
      path: ["sessionId"],
      message: "summary sessionId does not match snapshot sessionId",
    });
  }

  summary.items.forEach((item, index) => {
    item.sourceRefs.forEach((sourceRef, refIndex) => {
      if (!sourceIds.has(sourceRef)) {
        issues.push({
          code: z.ZodIssueCode.custom,
          path: ["items", index, "sourceRefs", refIndex],
          message: `source reference does not exist in patient snapshot: ${sourceRef}`,
        });
      }
    });

    const internalIdentifiers = new Set([
      snapshot.patientId,
      snapshot.sessionId,
      ...snapshot.records.map((record) => record.id),
      ...(summary.facts ?? []).map((fact) => fact.id),
      ...(summary.safetySignals ?? []).map((signal) => signal.id),
    ]);
    if (
      [...internalIdentifiers].some((identifier) =>
        containsIdentifier(item.text, identifier),
      )
    ) {
      issues.push({
        code: z.ZodIssueCode.custom,
        path: ["items", index, "text"],
        message:
          "visible summary text contains an internal identifier; use sourceRefs instead",
      });
    }
  });

  const checkReferences = (
    records: readonly { sourceRefs: readonly string[] }[] | undefined,
    pathName: "facts" | "safetySignals",
  ) => {
    records?.forEach((record, index) => {
      record.sourceRefs.forEach((sourceRef, refIndex) => {
        if (!sourceIds.has(sourceRef)) {
          issues.push({
            code: z.ZodIssueCode.custom,
            path: [pathName, index, "sourceRefs", refIndex],
            message: `source reference does not exist in patient snapshot: ${sourceRef}`,
          });
        }
      });
    });
  };
  checkReferences(summary.facts, "facts");
  checkReferences(summary.safetySignals, "safetySignals");

  const importanceRank: Record<SummaryImportance, number> = {
    routine: 0,
    attention: 1,
    "urgent-review": 2,
  };
  summary.safetySignals?.forEach((signal, index) => {
    const coveringItems = summary.items.filter((item) =>
      signal.sourceRefs.every((sourceRef) => item.sourceRefs.includes(sourceRef)),
    );
    if (coveringItems.length === 0) {
      issues.push({
        code: z.ZodIssueCode.custom,
        path: ["safetySignals", index],
        message: "safety signal is not covered by a summary item",
      });
      return;
    }
    if (
      !coveringItems.some(
        (item) => importanceRank[item.importance] >= importanceRank[signal.severity],
      )
    ) {
      issues.push({
        code: z.ZodIssueCode.custom,
        path: ["safetySignals", index, "severity"],
        message: "summary item lowers the safety signal importance",
      });
    }
  });

  if (issues.length > 0) {
    throw new z.ZodError(issues);
  }
  return summary;
}

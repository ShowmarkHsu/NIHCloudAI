import { z } from "zod";
import {
  ClinicalFactSchema,
  type ClinicalFact,
  type ClinicalSummary,
  PatientSnapshotSchema,
  type PatientSnapshot,
  SafetySignalSchema,
  type SafetySignal,
  SummaryItemSchema,
  validateClinicalSummaryAgainstSnapshot,
} from "../domain";
import type { JsonSchema, SummaryProvider } from "../providers";
import {
  CURRENT_CLINICAL_SUMMARY_CONTRACT,
  createClinicalSummaryProvenance,
} from "./clinicalSummaryContract";

const ModelSummaryOutputSchema = z
  .object({
    items: z.array(SummaryItemSchema),
  })
  .strict();

const MODEL_OUTPUT_JSON_SCHEMA: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["items"],
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "section", "text", "sourceRefs", "importance"],
        properties: {
          id: { type: "string", minLength: 1 },
          section: {
            type: "string",
            enum: [
              "timeline",
              "medication",
              "allergy",
              "lab",
              "imaging",
              "hospitalization",
              "discharge",
              "uncertainty",
            ],
          },
          text: { type: "string", minLength: 1 },
          sourceRefs: {
            type: "array",
            minItems: 1,
            uniqueItems: true,
            items: { type: "string", minLength: 1 },
          },
          importance: {
            type: "string",
            enum: ["routine", "attention", "urgent-review"],
          },
        },
      },
    },
  },
};

type GenerateClinicalSummaryOptions = Readonly<{
  snapshot: PatientSnapshot;
  facts?: readonly ClinicalFact[];
  safetySignals?: readonly SafetySignal[];
  provider: SummaryProvider;
  signal?: AbortSignal;
  now?: () => Date;
}>;

function validateIdentity(
  snapshot: PatientSnapshot,
  values: readonly { patientId: string; sessionId: string }[],
  label: string,
): void {
  for (const value of values) {
    if (
      value.patientId !== snapshot.patientId ||
      value.sessionId !== snapshot.sessionId
    ) {
      throw new Error(`${label} does not belong to the active patient session.`);
    }
  }
}

function buildPromptPayload(
  snapshot: PatientSnapshot,
  facts: readonly ClinicalFact[],
  safetySignals: readonly SafetySignal[],
) {
  return {
    records: snapshot.records.map((record) => ({
      sourceRef: record.id,
      type: record.type,
      recordedAt: record.recordedAt,
      summary: record.summary,
      data: record.data,
    })),
    facts: facts.map(({ id, type, text, sourceRefs, derived }) => ({
      id,
      type,
      text,
      sourceRefs,
      derived: derived ?? false,
    })),
    safetySignals: safetySignals.map(
      ({ id, kind, text, sourceRefs, severity }) => ({
        id,
        kind,
        text,
        sourceRefs,
        severity,
      }),
    ),
  };
}

function removeStandaloneInternalIdentifierAnnotations(
  text: string,
  identifiers: readonly string[],
): string {
  let normalized = text;
  for (const identifier of identifiers) {
    const escaped = identifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    normalized = normalized.replace(
      new RegExp(
        `(?:\\(\\s*${escaped}\\s*\\)|（\\s*${escaped}\\s*）|\\[\\s*${escaped}\\s*\\]|【\\s*${escaped}\\s*】)`,
        "gu",
      ),
      (annotation, offset, source) => {
        const previous = source.at(offset - 1) ?? "";
        const next = source.at(offset + annotation.length) ?? "";
        if (!previous || !next || /\s/u.test(previous) || /\s/u.test(next)) return "";
        return /[A-Za-z0-9%/]/u.test(previous) && /[\p{L}\p{N}]/u.test(next)
          ? " "
          : "";
      },
    );
  }
  return normalized
    .replace(/\s+([，。；：！？,.!?;:])/gu, "$1")
    .replace(/\s{2,}/gu, " ")
    .trim();
}

/**
 * The summary module's single interface. It owns prompt construction,
 * identifier minimization, model-output parsing, and source validation.
 */
export async function generateClinicalSummary(
  options: GenerateClinicalSummaryOptions,
): Promise<ClinicalSummary> {
  const snapshot = PatientSnapshotSchema.parse(options.snapshot);
  const facts = (options.facts ?? []).map((fact) => ClinicalFactSchema.parse(fact));
  const safetySignals = (options.safetySignals ?? []).map((signal) =>
    SafetySignalSchema.parse(signal),
  );

  validateIdentity(snapshot, facts, "Clinical fact");
  validateIdentity(snapshot, safetySignals, "Safety signal");

  const promptPayload = buildPromptPayload(snapshot, facts, safetySignals);
  const result = await options.provider.generateSummary({
    messages: [
      {
        role: "system",
        content: CURRENT_CLINICAL_SUMMARY_CONTRACT.systemPrompt,
      },
      {
        role: "user",
        content: JSON.stringify(promptPayload),
      },
    ],
    outputSchema: MODEL_OUTPUT_JSON_SCHEMA,
    signal: options.signal,
  });

  const modelOutput = ModelSummaryOutputSchema.parse(result.output);
  const internalIdentifiers = [
    snapshot.patientId,
    snapshot.sessionId,
    ...snapshot.records.map((record) => record.id),
    ...facts.map((fact) => fact.id),
    ...safetySignals.map((signal) => signal.id),
  ];
  const summary = {
    patientId: snapshot.patientId,
    sessionId: snapshot.sessionId,
    generatedAt: (options.now ?? (() => new Date()))().toISOString(),
    provenance: createClinicalSummaryProvenance({
      providerId: result.providerId,
      model: result.model,
    }),
    items: modelOutput.items.map((item) =>
      SummaryItemSchema.parse({
        ...item,
        text: removeStandaloneInternalIdentifierAnnotations(
          item.text,
          internalIdentifiers,
        ),
      }),
    ),
    facts,
    safetySignals,
  };

  return validateClinicalSummaryAgainstSnapshot(summary, snapshot);
}

import { z } from 'zod';

import {
  CLINICAL_CASE_SET_VERSION,
  CLINICAL_PROJECTION_CONTRACT_VERSION,
  CLINICAL_RULES_VERSION,
  CLINICAL_SUMMARY_PROMPT_VERSION,
  CLINICAL_SUMMARY_SCHEMA_VERSION,
  RELEASE_MANIFEST_SCHEMA_VERSION,
  clinicalCaseSetVersionSchema,
  clinicalProjectionContractVersionSchema,
  clinicalRulesVersionSchema,
  clinicalSummaryPromptVersionSchema,
  clinicalSummarySchemaVersionSchema,
  releaseManifestSchemaVersionSchema,
} from '../contracts/versions';

export const OLLAMA_MODEL = 'gemma4:e2b-it-qat' as const;
export const OLLAMA_MODEL_DIGEST =
  'sha256:07ea59a474013479c8b6b802bef095c40e964a1d776ba02f264c0e30e1aede0c' as const;
export const OPENROUTER_ENDPOINT =
  'https://openrouter.ai/api/v1/chat/completions' as const;
export const OPENROUTER_MODEL = 'openai/gpt-4.1-mini' as const;
export const OPENROUTER_ROUTE = 'azure' as const;

const gitCommitSchema = z.string().regex(/^[a-f0-9]{40}$/);
const sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const releaseSemverSchema = z.string().regex(/^\d+\.\d+\.\d+$/);
// Upstream Chrome provenance may use three or four numeric version components.
const chromeBuildVersionSchema = z.string().regex(/^\d+(?:\.\d+){2,3}$/);

const artifactSchema = z.object({
  artifact: z.literal('nihcloudai-extension.zip'),
  version: releaseSemverSchema,
  sha256: sha256Schema,
}).strict().readonly();

const providerEvidenceSchema = z.object({
  configurationSha256: sha256Schema,
  clinicalAcceptanceSha256: sha256Schema,
}).strict().readonly();

const ollamaConfigurationSchema = z.object({
  endpoint: z.literal('http://127.0.0.1:11434'),
  model: z.literal(OLLAMA_MODEL),
  digest: z.literal(OLLAMA_MODEL_DIGEST),
  timeoutSeconds: z.literal(180),
}).strict().readonly();

const openRouterConfigurationSchema = z.object({
  endpoint: z.literal(OPENROUTER_ENDPOINT),
  model: z.literal(OPENROUTER_MODEL),
  route: z.literal(OPENROUTER_ROUTE),
  temperature: z.literal(0),
  topP: z.literal(1),
  seed: z.literal(0),
  reasoningEffort: z.literal('medium'),
  reasoningExclude: z.literal(true),
  maxTokens: z.literal(4096),
  stream: z.literal(false),
  strictJsonSchema: z.literal(true),
  tools: z.literal(false),
  plugins: z.literal(false),
  webSearch: z.literal(false),
  allowFallbacks: z.literal(false),
  quantization: z.literal('bf16'),
  zdr: z.literal(true),
  dataCollection: z.literal('deny'),
  requireParameters: z.literal(true),
}).strict().readonly();

export const releaseManifestV1Schema = z.object({
  schemaVersion: releaseManifestSchemaVersionSchema,
  artifact: artifactSchema,
  source: z.object({
    upstreamCommit: gitCommitSchema,
    nihCloudAiCommit: gitCommitSchema,
    extensionVersion: chromeBuildVersionSchema,
  }).strict().readonly(),
  contracts: z.object({
    projectionVersion: clinicalProjectionContractVersionSchema,
    promptVersion: clinicalSummaryPromptVersionSchema,
    summaryVersion: clinicalSummarySchemaVersionSchema,
    rulesVersion: clinicalRulesVersionSchema,
    caseSetVersion: clinicalCaseSetVersionSchema,
  }).strict().readonly(),
  providers: z.object({
    ollama: ollamaConfigurationSchema,
    openRouter: openRouterConfigurationSchema,
  }).strict().readonly(),
  evidence: z.object({
    ollama: providerEvidenceSchema,
    openRouter: providerEvidenceSchema,
    openRouterMetadataSha256: sha256Schema,
  }).strict().readonly(),
}).strict().readonly();

export type ReleaseManifestV1 = z.infer<typeof releaseManifestV1Schema>;

export {
  CLINICAL_CASE_SET_VERSION,
  CLINICAL_PROJECTION_CONTRACT_VERSION,
  CLINICAL_RULES_VERSION,
  CLINICAL_SUMMARY_PROMPT_VERSION,
  CLINICAL_SUMMARY_SCHEMA_VERSION,
  RELEASE_MANIFEST_SCHEMA_VERSION,
};

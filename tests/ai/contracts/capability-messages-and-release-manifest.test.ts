import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  backgroundBoundCapabilityMessageSchema,
  capabilityMessageSchema,
  capabilitySequenceProgressionSchema,
  contentCapabilityMessageSchema,
  iframeCapabilityMessageSchema,
} from '../../../src/ai/contracts/messages';
import {
  CLINICAL_PROJECTION_CONTRACT_VERSION,
  CLINICAL_RULES_VERSION,
  CLINICAL_SUMMARY_PROMPT_VERSION,
  CLINICAL_SUMMARY_SCHEMA_VERSION,
  RELEASE_MANIFEST_SCHEMA_VERSION,
} from '../../../src/ai/contracts/versions';
import {
  OLLAMA_MODEL_DIGEST,
  releaseManifestV1Schema,
} from '../../../src/ai/release/runtimeManifest';

const sessionId = 'ds_1234567890abcdef';

const emptyCoverage = {
  encounter: { status: 'confirmed-empty', recordCount: 0 },
  'western-medication': { status: 'confirmed-empty', recordCount: 0 },
  'chinese-medication': { status: 'confirmed-empty', recordCount: 0 },
  allergy: { status: 'confirmed-empty', recordCount: 0 },
  lab: { status: 'confirmed-empty', recordCount: 0 },
  imaging: { status: 'confirmed-empty', recordCount: 0 },
  procedure: { status: 'confirmed-empty', recordCount: 0 },
  discharge: { status: 'confirmed-empty', recordCount: 0 },
  'adult-health-check': {
    status: 'out-of-scope', recordCount: 0, reasonCode: 'SOURCE_NOT_IN_CONTRACT',
  },
  'cancer-screening': {
    status: 'out-of-scope', recordCount: 0, reasonCode: 'SOURCE_NOT_IN_CONTRACT',
  },
  'hepatitis-bc': {
    status: 'out-of-scope', recordCount: 0, reasonCode: 'SOURCE_NOT_IN_CONTRACT',
  },
  'ckm-derived': {
    status: 'out-of-scope', recordCount: 0, reasonCode: 'SOURCE_NOT_IN_CONTRACT',
  },
};

const sealedSnapshot = {
  schemaVersion: 'patient-snapshot.v1',
  contractVersion: CLINICAL_PROJECTION_CONTRACT_VERSION,
  patientId: 'pt_1234567890abcdef',
  sessionId,
  revision: 1,
  capturedAt: '2026-08-14T05:30:00.000Z',
  records: [],
  coverage: emptyCoverage,
};

const contentStart = {
  schemaVersion: 'ai-capability-message.v1',
  type: 'content.data-session.started',
  sessionId,
  revision: 1,
  sequence: 1,
};

const iframeGenerate = {
  schemaVersion: 'ai-capability-message.v1',
  type: 'iframe.summary.generate',
  sessionId,
  revision: 1,
  sequence: 2,
  provider: 'ollama',
};

function sealedSnapshotMessage(snapshot: unknown) {
  return {
    schemaVersion: 'ai-capability-message.v1',
    type: 'content.snapshot.sealed',
    sessionId,
    revision: 1,
    sequence: 1,
    snapshot,
  };
}

const releaseManifest = {
  schemaVersion: RELEASE_MANIFEST_SCHEMA_VERSION,
  artifact: {
    artifact: 'nihcloudai-extension.zip',
    version: '26.0702.1',
    sha256: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  },
  source: {
    upstreamCommit: 'cad76e59c60eafc2947939fc44d7683ba9f7ab9d',
    nihCloudAiCommit: 'f89997b6c45e61546ff92f2ecceb82e7170a2daf',
    extensionVersion: '26.0702.1',
  },
  contracts: {
    projectionVersion: CLINICAL_PROJECTION_CONTRACT_VERSION,
    promptVersion: CLINICAL_SUMMARY_PROMPT_VERSION,
    summaryVersion: CLINICAL_SUMMARY_SCHEMA_VERSION,
    rulesVersion: CLINICAL_RULES_VERSION,
    caseSetVersion: 'clinical-case-set.v1',
  },
  providers: {
    ollama: {
      endpoint: 'http://127.0.0.1:11434',
      model: 'gemma4:e2b-it-qat',
      digest: OLLAMA_MODEL_DIGEST,
      timeoutSeconds: 180,
    },
    openRouter: {
      endpoint: 'https://openrouter.ai/api/v1/chat/completions',
      model: 'openai/gpt-oss-120b',
      route: 'deepinfra/bf16',
      temperature: 0,
      topP: 1,
      seed: 0,
      reasoningEffort: 'medium',
      reasoningExclude: true,
      maxTokens: 4096,
      stream: false,
      strictJsonSchema: true,
      tools: false,
      plugins: false,
      webSearch: false,
      allowFallbacks: false,
      quantization: 'bf16',
      zdr: true,
      dataCollection: 'deny',
      requireParameters: true,
    },
  },
  evidence: {
    ollama: {
      configurationSha256: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      clinicalAcceptanceSha256: 'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
    },
    openRouter: {
      configurationSha256: 'sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
      clinicalAcceptanceSha256: 'sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
    },
    openRouterMetadataSha256: 'sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
  },
};

describe('closed capability messages', () => {
  it('accepts only closed content, iframe, and background capabilities', () => {
    expect(contentCapabilityMessageSchema.safeParse(contentStart).success).toBe(true);
    expect(iframeCapabilityMessageSchema.safeParse(iframeGenerate).success).toBe(true);
    expect(capabilityMessageSchema.safeParse({
      schemaVersion: 'ai-capability-message.v1',
      type: 'background.lifecycle.status',
      sessionId,
      revision: 1,
      sequence: 3,
      status: 'snapshot-sealed',
    }).success).toBe(true);
    expect(contentCapabilityMessageSchema.safeParse(
      sealedSnapshotMessage(sealedSnapshot),
    ).success).toBe(true);
  });

  it('rejects generic RPC, arbitrary method/action/args, missing fields, and identity taint', () => {
    const genericRpc = structuredClone(contentStart);
    Reflect.set(genericRpc, 'type', 'rpc.invoke');
    Reflect.set(genericRpc, 'method', 'anything');
    Reflect.set(genericRpc, 'args', []);
    const arbitraryAction = structuredClone(contentStart);
    Reflect.set(arbitraryAction, 'action', 'anything');
    const iframeArgs = structuredClone(iframeGenerate);
    Reflect.set(iframeArgs, 'args', []);
    const iframeMetadata = structuredClone(iframeGenerate);
    Reflect.set(iframeMetadata, 'metadata', {});
    const patientName = structuredClone(contentStart);
    Reflect.set(patientName, 'patientName', 'Synthetic Patient');
    const nationalId = structuredClone(contentStart);
    Reflect.set(nationalId, 'nationalId', 'SYNTHETIC-ID');
    const displayIdentity = structuredClone(contentStart);
    Reflect.set(displayIdentity, 'displayIdentity', {});
    const coercedSequence = structuredClone(contentStart);
    Reflect.set(coercedSequence, 'sequence', '1');
    for (const invalidMessage of [genericRpc, arbitraryAction, iframeArgs, iframeMetadata, patientName, nationalId, displayIdentity, coercedSequence]) {
      expect(capabilityMessageSchema.safeParse(invalidMessage).success).toBe(false);
    }

    const missingSession = structuredClone(contentStart);
    Reflect.deleteProperty(missingSession, 'sessionId');
    expect(contentCapabilityMessageSchema.safeParse(missingSession).success).toBe(false);

    const identityTaintedSnapshot = structuredClone(sealedSnapshot);
    Reflect.set(identityTaintedSnapshot, 'displayIdentity', { displayName: 'Synthetic Patient' });
    expect(contentCapabilityMessageSchema.safeParse(
      sealedSnapshotMessage(identityTaintedSnapshot),
    ).success).toBe(false);
  });

  it('requires a background-only sender tab binding and rejects revision or sequence rollback shapes', () => {
    expect(backgroundBoundCapabilityMessageSchema.safeParse({
      senderTabId: 19,
      message: contentStart,
    }).success).toBe(true);
    expect(backgroundBoundCapabilityMessageSchema.safeParse({
      senderTabId: '19',
      message: contentStart,
    }).success).toBe(false);

    const revisionMismatch = structuredClone(sealedSnapshot);
    revisionMismatch.revision = 2;
    expect(contentCapabilityMessageSchema.safeParse(
      sealedSnapshotMessage(revisionMismatch),
    ).success).toBe(false);

    const previous = structuredClone(contentStart);
    previous.sequence = 2;
    const next = structuredClone(iframeGenerate);
    next.sequence = 1;
    expect(capabilitySequenceProgressionSchema.safeParse({
      previous,
      next,
    }).success).toBe(false);
  });
});

describe('closed release manifest v1', () => {
  it('accepts the fixed artifact, exact contract versions, providers, and evidence hashes', () => {
    expect(releaseManifestV1Schema.safeParse(releaseManifest).success).toBe(true);
  });

  it('rejects ranges, unknown fields, missing fixed Provider fields, and coercion', () => {
    const versionRange = structuredClone(releaseManifest);
    Reflect.set(
      versionRange.contracts,
      'projectionVersion',
      '^clinical-projection.v1',
    );
    expect(releaseManifestV1Schema.safeParse(versionRange).success).toBe(false);

    const unknownField = structuredClone(releaseManifest);
    Reflect.set(unknownField, 'metadata', {});
    expect(releaseManifestV1Schema.safeParse(unknownField).success).toBe(false);

    const missingProviderField = structuredClone(releaseManifest);
    Reflect.deleteProperty(missingProviderField.providers.openRouter, 'zdr');
    expect(releaseManifestV1Schema.safeParse(missingProviderField).success).toBe(false);

    const wrongType = structuredClone(releaseManifest);
    Reflect.set(wrongType.providers.ollama, 'timeoutSeconds', '180');
    expect(releaseManifestV1Schema.safeParse(wrongType).success).toBe(false);
  });

  it('keeps the checked-in JSON Schema closed and aligned to the runtime schema version', () => {
    const schemaPath = resolve(process.cwd(), 'release', 'manifest.schema.json');
    const schema = JSON.parse(readFileSync(schemaPath, 'utf8')) as {
      additionalProperties: boolean;
      properties: { schemaVersion: { const: string } };
    };

    expect(schema.additionalProperties).toBe(false);
    expect(schema.properties.schemaVersion.const).toBe(RELEASE_MANIFEST_SCHEMA_VERSION);
  });
});

import { iframeCapabilityMessageSchema } from '../ai/contracts/messages';
import type { PatientSnapshotV1 } from '../ai/contracts/patientSnapshot';
import type {
  ProviderGenerationResult,
  SummaryProvider,
} from '../ai/providers/backgroundProviderBoundary';
import { sealVersionedPatientSnapshot } from '../ai/projection/builder';
import { createSealedSummaryRequest } from '../ai/summary/providerRequest';
import type { FixedFiveSectionSummary } from '../ai/contracts/summary';
import type { RevisionScope } from '../ai/session/coordinator';
import type { RouterSender } from './aiMessageRouter';
import type { RouterResult } from './routerResult';

type SnapshotStore = Readonly<{
  active: (scope: RevisionScope) => PatientSnapshotV1 | null;
}>;

type ProviderBoundary = Readonly<{
  storeOpenRouterSessionSecret: (scope: RevisionScope, secret: string) => void;
  grantRemoteConsent: (scope: RevisionScope) => void;
  cancel: (scope: RevisionScope) => boolean;
  generate: (scope: RevisionScope, provider: SummaryProvider, request: NonNullable<ReturnType<typeof createSealedSummaryRequest>>) => Promise<ProviderGenerationResult>;
}>;

type Router = Readonly<{
  route: (message: unknown, sender: RouterSender) => RouterResult;
}>;

type PublicSourceAlias = Readonly<{label: string}>;

const PUBLIC_SOURCE_FAMILY_LABELS = Object.freeze({
  encounter: '就醫來源',
  'western-medication': '西藥來源',
  'chinese-medication': '中藥來源',
  allergy: '過敏來源',
  lab: '檢驗來源',
  imaging: '影像來源',
  procedure: '處置來源',
  discharge: '出院來源',
} as const);

/**
 * The iframe must see only opaque, local labels, but those labels still need
 * to identify the sealed source family truthfully. Numbering is local to a
 * family so a mixed snapshot cannot present every source as a lab citation.
 */
function publicAliasLabels(snapshot: PatientSnapshotV1): ReadonlyMap<string, string> {
  const countByFamily = new Map<keyof typeof PUBLIC_SOURCE_FAMILY_LABELS, number>();
  const labelsBySourceRef = new Map<string, string>();
  for (const record of snapshot.records) {
    const sourceFamily = record.sourceFamily;
    const nextCount = (countByFamily.get(sourceFamily) ?? 0) + 1;
    countByFamily.set(sourceFamily, nextCount);
    labelsBySourceRef.set(
      record.sourceRef,
      `${PUBLIC_SOURCE_FAMILY_LABELS[sourceFamily]} ${nextCount}`,
    );
  }
  return labelsBySourceRef;
}

function publicAliases(snapshot: PatientSnapshotV1): readonly PublicSourceAlias[] {
  const labelsBySourceRef = publicAliasLabels(snapshot);
  return Object.freeze(snapshot.records.map((record) => Object.freeze({
    label: labelsBySourceRef.get(record.sourceRef)!,
  })));
}

function publicSummary(snapshot: PatientSnapshotV1, summary: FixedFiveSectionSummary) {
  const aliasesBySourceRef = publicAliasLabels(snapshot);
  return Object.freeze({
    sections: Object.freeze(summary.sections.map((section) => Object.freeze({
      heading: section.heading,
      content: section.content,
      sourceAliases: Object.freeze(section.sourceRefs.map((sourceRef) => aliasesBySourceRef.get(sourceRef)).filter((label): label is string => label !== undefined)),
    }))),
  });
}

/**
 * The extension-origin UI may request only a public coverage projection or a
 * fixed provider operation. This broker is deliberately the sole bridge from
 * the iframe to the sealed background snapshot/provider boundaries.
 */
export function createIframeSummaryBroker(configuration: Readonly<{
  router: Router;
  snapshots: SnapshotStore;
  provider: ProviderBoundary;
}>) {
  return Object.freeze({
    async receive(message: unknown, sender: RouterSender): Promise<unknown> {
      const routed = configuration.router.route(message, sender);
      if (!routed.accepted) return routed;
      const parsed = iframeCapabilityMessageSchema.safeParse(message);
      if (!parsed.success) return {accepted: false, reason: 'invalid-message'};
      const tabId = sender.tabId;
      if (tabId === undefined) return {accepted: false, reason: 'sender-tab-mismatch'};
      const scope = {tabId, sessionId: parsed.data.sessionId, revision: parsed.data.revision};
      const snapshot = configuration.snapshots.active(scope);
      if (snapshot === null) return {accepted: false, reason: 'scope-mismatch'};

      if (parsed.data.type === 'iframe.active-revision.read') {
        if (parsed.data.contractVersion !== snapshot.contractVersion) return {accepted: false, reason: 'scope-mismatch'};
        return Object.freeze({
          accepted: true,
          view: Object.freeze({
            coverage: snapshot.coverage,
            sourceAliases: publicAliases(snapshot),
          }),
        });
      }
      if (parsed.data.type === 'iframe.openrouter.session-secret.set') {
        configuration.provider.storeOpenRouterSessionSecret(scope, parsed.data.secret);
        return {accepted: true};
      }
      if (parsed.data.type === 'iframe.openrouter.consent.grant') {
        configuration.provider.grantRemoteConsent(scope);
        return {accepted: true};
      }
      if (parsed.data.type === 'iframe.summary.discard') {
        configuration.provider.cancel(scope);
        return {accepted: true};
      }
      if (parsed.data.type === 'iframe.summary.review' || parsed.data.type === 'iframe.summary.copy') {
        return {accepted: true};
      }

      const sealed = sealVersionedPatientSnapshot(snapshot);
      const request = sealed === null ? null : createSealedSummaryRequest({
        tabId,
        patientId: snapshot.patientId,
        sessionId: scope.sessionId,
        revision: scope.revision,
        contractVersion: snapshot.contractVersion,
      }, sealed);
      if (request === null) return {accepted: false, reason: 'scope-mismatch'};
      const result = await configuration.provider.generate(scope, parsed.data.provider, request);
      if (configuration.snapshots.active(scope) === null) return {accepted: false, reason: 'scope-mismatch'};
      return result.status === 'completed'
        ? Object.freeze({accepted: true, result: {status: 'completed', summary: publicSummary(snapshot, result.summary)}})
        : Object.freeze({accepted: true, result});
    },
  });
}

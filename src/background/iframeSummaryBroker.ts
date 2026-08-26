import { iframeCapabilityMessageSchema } from '../ai/contracts/messages';
import type { PatientSnapshotV1 } from '../ai/contracts/patientSnapshot';
import type { SummaryProvider } from '../ai/providers/backgroundProviderBoundary';
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
  generate: (scope: RevisionScope, provider: SummaryProvider, request: NonNullable<ReturnType<typeof createSealedSummaryRequest>>) => Promise<
    | Readonly<{status: 'completed'; summary: FixedFiveSectionSummary}>
    | Readonly<{status: 'permission-required' | 'consent-required' | 'secret-unavailable' | 'timeout' | 'cancelled' | 'failed' | 'transport-failed' | 'response-unreadable' | 'provider-http-failed' | 'provider-output-missing' | 'provider-output-truncated' | 'validation-structure-failed' | 'validation-alias-failed' | 'validation-content-failed' | 'validation-content-metadata-failed' | 'validation-content-negative-failed' | 'validation-content-negative-not-found-failed' | 'validation-content-negative-normal-failed' | 'validation-content-negative-none-word-failed' | 'validation-content-negative-none-word-outside-supported-sections-failed' | 'validation-content-negative-none-word-multiple-failed' | 'validation-content-negative-none-word-unrelated-to-allergy-failed' | 'validation-content-negative-none-word-allergy-source-unsupported-failed' | 'validation-content-negative-none-word-allergy-phrase-unsupported-failed' | 'validation-content-data-gap-failed' | 'validation-content-bounds-failed' | 'validation-length-failed'}>
  >;
}>;

type Router = Readonly<{
  route: (message: unknown, sender: RouterSender) => RouterResult;
}>;

type PublicSourceAlias = Readonly<{label: string}>;

function publicAliases(snapshot: PatientSnapshotV1): readonly PublicSourceAlias[] {
  return Object.freeze(snapshot.records.map((_record, index) => Object.freeze({label: `檢驗來源 ${index + 1}`})));
}

function publicSummary(snapshot: PatientSnapshotV1, summary: FixedFiveSectionSummary) {
  const aliasesBySourceRef = new Map(snapshot.records.map((record, index) => [record.sourceRef, `檢驗來源 ${index + 1}`]));
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

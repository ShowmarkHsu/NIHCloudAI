import { describe, expect, it, vi } from 'vitest';

import { createClosedBackgroundMessageRouter } from '../../../src/background/aiMessageRouter';
import { createIframeSummaryBroker } from '../../../src/background/iframeSummaryBroker';
import { createSealedSnapshotStore } from '../../../src/background/sealedSnapshotStore';
import { createLabVerticalSlice } from '../../../src/ai/integration/labVerticalSlice';
import { isSealedSummaryRequest } from '../../../src/ai/summary/providerRequest';

const tabId = 31;
const sessionId = 'ds_iframe_broker_session_0001';
const extensionOrigin = 'chrome-extension://unit-test-extension';
const iframeSender = {
  tabId,
  url: `${extensionOrigin}/ai-frame.html`,
  origin: extensionOrigin,
};

function providerSummary() {
  return {
    schemaVersion: 'clinical-summary.v1' as const,
    timeWindows: {
      medicationsAndAllergies: 'current-available-data' as const,
      recentCourseAndTests: 'past-90-days' as const,
      admissionsProceduresAndDischarge: 'past-1-year' as const,
    },
    sections: [
      {heading: '核對重點' as const, content: '重'.repeat(40), sourceRefs: ['sr_iframe_broker_source_000001']},
      {heading: '目前用藥與過敏' as const, content: '要'.repeat(40), sourceRefs: ['sr_iframe_broker_source_000001']},
      {heading: '近期病程與檢查' as const, content: '點'.repeat(40), sourceRefs: ['sr_iframe_broker_source_000001']},
      {heading: '住院、手術與出院' as const, content: '資'.repeat(40), sourceRefs: []},
      {heading: '資料缺口與待確認' as const, content: `資料缺口：${'待'.repeat(40)}；待確認：${'核'.repeat(40)}`, sourceRefs: []},
    ],
  };
}

function setup() {
  const scope = {tabId, sessionId, revision: 1} as const;
  const snapshot = createLabVerticalSlice({
    now: () => '2026-08-21T00:00:00.000Z',
    issueSourceReference: () => 'sr_iframe_broker_source_000001',
  }).ingest({
    patientId: 'pt_iframe_broker_patient_00001', sessionId, revision: 1,
  }, {
    status: 'success', dataType: 'labdata', recordCount: 1,
    data: {rObject: [{
      hosp: 'Synthetic Lab;outpatient;0000000000', real_inspect_date: '2026/08/20',
      order_code: 'LAB-001', assay_item_name: 'Synthetic analyte', assay_value: '1.0',
      unit_data: 'mg/dL', consult_value: '0-2', assay_mark: '0',
    }]},
  })!.sealed.snapshot;
  const snapshots = createSealedSnapshotStore();
  expect(snapshots.put(scope, snapshot)).toBe(true);
  const provider = {
    storeOpenRouterSessionSecret: vi.fn(),
    grantRemoteConsent: vi.fn(),
    cancel: vi.fn(() => true),
    generate: vi.fn(async (_scope, _provider, request) => {
      expect(isSealedSummaryRequest(request)).toBe(true);
      expect(request.prompt).not.toContain('sr_iframe_broker_source_000001');
      return {status: 'completed' as const, summary: providerSummary()};
    }),
  };
  const router = createClosedBackgroundMessageRouter({
    allowedContentOrigin: 'https://medcloud2.nhi.gov.tw',
    allowedIframeUrl: `${extensionOrigin}/ai-frame.html`,
    activeScopeForTab(candidateTabId) {
      return candidateTabId === tabId ? scope : null;
    },
  });
  return {scope, snapshots, provider, broker: createIframeSummaryBroker({router, snapshots, provider})};
}

function message(type: string, sequence: number, extra = {}) {
  return {
    schemaVersion: 'ai-capability-message.v1', type, sessionId, revision: 1, sequence, ...extra,
  };
}

describe('extension-origin iframe summary broker', () => {
  it('returns only coverage and local labels to the iframe, then executes a sealed fixed provider request', async () => {
    const {broker, provider} = setup();
    const read = await broker.receive(message('iframe.active-revision.read', 1, {
      contractVersion: 'clinical-projection.v1',
    }), iframeSender);
    expect(read).toMatchObject({accepted: true, view: {sourceAliases: [{label: '檢驗來源 1'}]}});
    expect(JSON.stringify(read)).not.toContain('sr_iframe_broker_source_000001');
    expect(JSON.stringify(read)).not.toContain('pt_iframe_broker_patient_00001');

    const generated = await broker.receive(message('iframe.summary.generate', 2, {provider: 'ollama'}), iframeSender);
    expect(generated).toMatchObject({
      accepted: true,
      result: {status: 'completed'},
    });
    expect((generated as {result: {summary: {sections: Array<{sourceAliases: string[]}>}}}).result.summary.sections[0]?.sourceAliases).toEqual(['檢驗來源 1']);
    expect(JSON.stringify(generated)).not.toContain('sr_iframe_broker_source_000001');
    expect(provider.generate).toHaveBeenCalledOnce();
  });

  it('allows session-only BYOK and consent only from the exact iframe, and invalidates an old revision', async () => {
    const {broker, provider} = setup();
    expect(await broker.receive(message('iframe.openrouter.session-secret.set', 1, {secret: 'synthetic-secret'}), iframeSender)).toEqual({accepted: true});
    expect(await broker.receive(message('iframe.openrouter.consent.grant', 2), iframeSender)).toEqual({accepted: true});
    expect(provider.storeOpenRouterSessionSecret).toHaveBeenCalledWith({tabId, sessionId, revision: 1}, 'synthetic-secret');
    expect(provider.grantRemoteConsent).toHaveBeenCalledWith({tabId, sessionId, revision: 1});

    expect(await broker.receive(message('iframe.summary.generate', 3, {provider: 'ollama'}), {
      ...iframeSender, url: `${extensionOrigin}/popup.html`,
    })).toEqual({accepted: false, reason: 'sender-url-mismatch'});
    expect(await broker.receive({
      ...message('iframe.summary.generate', 4, {provider: 'ollama'}), revision: 2,
    }, iframeSender)).toEqual({accepted: false, reason: 'scope-mismatch'});
  });

  it('lets only the exact iframe discard its own in-flight operation', async () => {
    const {broker, provider} = setup();

    expect(await broker.receive(message('iframe.summary.discard', 1), iframeSender)).toEqual({accepted: true});
    expect(provider.cancel).toHaveBeenCalledWith({tabId, sessionId, revision: 1});

    expect(await broker.receive(message('iframe.summary.discard', 2), {
      ...iframeSender, url: `${extensionOrigin}/popup.html`,
    })).toEqual({accepted: false, reason: 'sender-url-mismatch'});
    expect(provider.cancel).toHaveBeenCalledOnce();
  });
});

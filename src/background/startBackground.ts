import { createClinicalSummaryCoordinator } from "./clinicalSummaryCoordinator";
import { createClinicalSummaryMessageHandler } from "./clinicalSummaryMessageHandler";
import { createClinicalRuleMessageHandler } from "./clinicalRuleMessageHandler";
import { createProviderConnectionMessageHandler } from "./providerConnectionMessageHandler";
import {
  createPatientSnapshotMessageHandler,
  type SnapshotContentSource,
} from "./patientSnapshotMessageHandler";
import { createPatientSnapshotStore } from "./patientSnapshotStore";
import { createSecretMessageHandler } from "./secretMessageHandler";
import { createSessionSecretVault } from "./sessionSecretVault";
import { createSummaryProviderFactory } from "./summaryProviderFactory";
import type { TrustedSender } from "./trustedSender";

export function startBackground(options: Readonly<{
  contentSources?: readonly SnapshotContentSource[];
  trustedUiSender?: TrustedSender;
  summaryTimeoutMs?: number;
}> = {}): void {
  const vault = createSessionSecretVault();
  const snapshotStore = createPatientSnapshotStore();
  const providerFactory = createSummaryProviderFactory({ secrets: vault });
  const summaryCoordinator = createClinicalSummaryCoordinator({
    snapshots: snapshotStore,
    secrets: vault,
    providerFactory,
    timeoutMs: options.summaryTimeoutMs,
  });
  const handleSecretMessage = createSecretMessageHandler(vault);
  const handlePatientSnapshotMessage =
    createPatientSnapshotMessageHandler(snapshotStore, {
      resetSummary: () => summaryCoordinator.reset(),
      contentSources: options.contentSources,
    });
  const handleClinicalSummaryMessage =
    createClinicalSummaryMessageHandler(summaryCoordinator, {
      trustedSender: options.trustedUiSender,
    });
  const handleClinicalRuleMessage = createClinicalRuleMessageHandler(snapshotStore, {
    trustedSender: options.trustedUiSender,
  });
  const handleProviderConnectionMessage = createProviderConnectionMessageHandler({
    providerFactory,
    trustedSender: options.trustedUiSender,
  });

  void vault.configure();

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    void (async () =>
      (await handleSecretMessage(message, sender)) ??
      (await handlePatientSnapshotMessage(message, sender)) ??
      (await handleClinicalSummaryMessage(message, sender)) ??
      (await handleClinicalRuleMessage(message, sender)) ??
      (await handleProviderConnectionMessage(message, sender)))().then((response) => {
      if (response !== undefined) sendResponse(response);
    });
    return true;
  });
}

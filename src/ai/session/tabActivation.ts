import {
  contentCapabilityMessageSchema,
  type ContentCapabilityMessage,
} from '../contracts/messages';
import {
  createTabScopedRevisionCoordinator,
  type RevisionScope,
} from './coordinator';

export const AI_SUMMARY_TAB_ID = 'ai-summary' as const;

type DataSessionStartedMessage = Extract<
  ContentCapabilityMessage,
  { type: 'content.data-session.started' }
>;

export type AiTabActivation = Readonly<{
  selectedTabId: typeof AI_SUMMARY_TAB_ID;
  tabId: number;
  scope: RevisionScope;
  message: DataSessionStartedMessage;
}>;

type TabScopedRevisionCoordinator = ReturnType<typeof createTabScopedRevisionCoordinator>;

function createDataSessionStartedMessage(
  scope: RevisionScope,
  sequence: number,
): DataSessionStartedMessage {
  const parsed = contentCapabilityMessageSchema.parse({
    schemaVersion: 'ai-capability-message.v1',
    type: 'content.data-session.started',
    sessionId: scope.sessionId,
    revision: scope.revision,
    sequence,
  });

  if (parsed.type !== 'content.data-session.started') {
    throw new TypeError('AI tab activation must emit a data-session-started message');
  }
  return Object.freeze(parsed);
}

/**
 * Converts an explicit AI tab selection into the first closed capability of a
 * tab-scoped data session. It deliberately does not send the message: content
 * runtime wiring, iframe UI, providers, and manifest changes remain later
 * boundaries.
 */
export function createAiTabActivation(coordinator: TabScopedRevisionCoordinator) {
  return Object.freeze({
    activate(
      selectedTabId: unknown,
      tabId: number,
      sessionId: string,
      sequence: number,
    ): AiTabActivation | null {
      if (selectedTabId !== AI_SUMMARY_TAB_ID) return null;

      const scope = coordinator.startSession(tabId, sessionId);
      return Object.freeze({
        selectedTabId: AI_SUMMARY_TAB_ID,
        tabId,
        scope,
        message: createDataSessionStartedMessage(scope, sequence),
      });
    },
  });
}

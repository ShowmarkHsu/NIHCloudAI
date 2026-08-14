import {
  contentCapabilityMessageSchema,
  iframeCapabilityMessageSchema,
  type ContentCapabilityMessage,
  type IframeCapabilityMessage,
} from '../ai/contracts/messages';

export type RouterSender = {
  tabId?: number;
  url?: string;
  origin?: string;
};

export type ActiveRevisionScope = Readonly<{
  tabId: number;
  sessionId: string;
  revision: number;
}>;

type RouterConfiguration = Readonly<{
  allowedContentOrigin: string;
  allowedIframeUrl: string;
  activeScopeForTab: (tabId: number) => ActiveRevisionScope | null;
}>;

type RouterRejectReason =
  | 'invalid-message'
  | 'sender-url-mismatch'
  | 'sender-origin-mismatch'
  | 'sender-tab-mismatch'
  | 'scope-mismatch'
  | 'sequence-rollback';

export type RouterResult =
  | Readonly<{ accepted: true }>
  | Readonly<{ accepted: false; reason: RouterRejectReason }>;

type RoutedMessage = ContentCapabilityMessage | IframeCapabilityMessage;

function rejected(reason: RouterRejectReason): RouterResult {
  return { accepted: false, reason };
}

function isValidTabId(tabId: number | undefined): tabId is number {
  return tabId !== undefined && Number.isSafeInteger(tabId) && tabId >= 0;
}

function exactUrl(value: string | undefined): URL | null {
  if (value === undefined) return null;
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function originOf(url: URL): string {
  return url.protocol === 'chrome-extension:'
    ? `${url.protocol}//${url.host}`
    : url.origin;
}

function messageKind(message: unknown): RoutedMessage | null {
  const content = contentCapabilityMessageSchema.safeParse(message);
  if (content.success) return content.data;

  const iframe = iframeCapabilityMessageSchema.safeParse(message);
  return iframe.success ? iframe.data : null;
}

function senderMatches(
  sender: RouterSender,
  message: RoutedMessage,
  allowedContentOrigin: string,
  allowedIframeUrl: URL,
): RouterRejectReason | null {
  if (!isValidTabId(sender.tabId)) return 'sender-tab-mismatch';

  const senderUrl = exactUrl(sender.url);
  if (senderUrl === null) return 'sender-url-mismatch';

  const isContent = message.type.startsWith('content.');
  const iframeOrigin = originOf(allowedIframeUrl);
  const senderUrlOrigin = originOf(senderUrl);
  const expectedOrigin = isContent ? allowedContentOrigin : iframeOrigin;
  const urlAllowed = isContent
    ? senderUrlOrigin === allowedContentOrigin
    : senderUrl.href === allowedIframeUrl.href;
  if (!urlAllowed) return 'sender-url-mismatch';
  if (sender.origin !== expectedOrigin || senderUrlOrigin !== sender.origin) {
    return 'sender-origin-mismatch';
  }

  return null;
}

/**
 * Validates the only capability messages accepted by the background boundary.
 * This router intentionally performs no storage, provider, or UI work: B4's
 * later commits attach accepted messages to those narrowly scoped operations.
 */
export function createClosedBackgroundMessageRouter(configuration: RouterConfiguration) {
  const contentOrigin = new URL(configuration.allowedContentOrigin).origin;
  const iframeUrl = new URL(configuration.allowedIframeUrl);
  const lastSequenceByDirection = new Map<string, number>();

  return Object.freeze({
    route(message: unknown, sender: RouterSender): RouterResult {
      const parsedMessage = messageKind(message);
      if (parsedMessage === null) return rejected('invalid-message');

      const senderRejection = senderMatches(sender, parsedMessage, contentOrigin, iframeUrl);
      if (senderRejection !== null) return rejected(senderRejection);

      const tabId = sender.tabId;
      if (tabId === undefined) return rejected('sender-tab-mismatch');
      const activeScope = configuration.activeScopeForTab(tabId);
      if (
        activeScope === null
        || activeScope.tabId !== tabId
        || activeScope.sessionId !== parsedMessage.sessionId
        || activeScope.revision !== parsedMessage.revision
      ) {
        return rejected('scope-mismatch');
      }

      const direction = parsedMessage.type.startsWith('content.') ? 'content' : 'iframe';
      const sequenceKey = `${direction}:${tabId}:${parsedMessage.sessionId}:${parsedMessage.revision}`;
      const previousSequence = lastSequenceByDirection.get(sequenceKey);
      if (previousSequence !== undefined && parsedMessage.sequence <= previousSequence) {
        return rejected('sequence-rollback');
      }

      lastSequenceByDirection.set(sequenceKey, parsedMessage.sequence);
      return { accepted: true };
    },
  });
}

import { describe, expect, it } from 'vitest';

import {
  createClosedBackgroundMessageRouter,
  type RouterSender,
} from '../../../src/background/aiMessageRouter';

const sessionId = 'ds_security_router_0001';
const extensionOrigin = 'chrome-extension://unit-test-extension';
const contentOrigin = 'https://medcloud2.nhi.gov.tw';

function contentSender(tabId = 17): RouterSender {
  return {
    tabId,
    url: `${contentOrigin}/imu/IMUE1000/IMUE0001`,
    origin: contentOrigin,
  };
}

function iframeSender(tabId = 17): RouterSender {
  return {
    tabId,
    url: `${extensionOrigin}/ai-frame.html`,
    origin: extensionOrigin,
  };
}

function contentStarted(sequence = 1, revision = 1) {
  return {
    schemaVersion: 'ai-capability-message.v1',
    type: 'content.data-session.started',
    sessionId,
    revision,
    sequence,
  };
}

function iframeGenerate(sequence = 1, revision = 1) {
  return {
    schemaVersion: 'ai-capability-message.v1',
    type: 'iframe.summary.generate',
    sessionId,
    revision,
    sequence,
    provider: 'ollama',
  };
}

function router() {
  return createClosedBackgroundMessageRouter({
    allowedContentOrigin: contentOrigin,
    allowedIframeUrl: `${extensionOrigin}/ai-frame.html`,
    activeScopeForTab(tabId) {
      return tabId === 17 ? { tabId, sessionId, revision: 1 } : null;
    },
  });
}

describe('closed background message router', () => {
  it('accepts current closed capabilities from the exact allowed content page and iframe', () => {
    const messageRouter = router();

    expect(messageRouter.route(contentStarted(), contentSender())).toEqual({ accepted: true });
    expect(messageRouter.route(iframeGenerate(), iframeSender())).toEqual({ accepted: true });
  });

  it('rejects URL, origin, and tab sender mismatches before routing a capability', () => {
    const messageRouter = router();
    const wrongContentUrl = contentSender();
    wrongContentUrl.url = 'https://evil.example/imu/IMUE1000/IMUE0001';
    const wrongOrigin = iframeSender();
    wrongOrigin.origin = 'chrome-extension://another-extension';
    const missingTab = contentSender();
    Reflect.deleteProperty(missingTab, 'tabId');

    expect(messageRouter.route(contentStarted(), wrongContentUrl)).toEqual({
      accepted: false, reason: 'sender-url-mismatch',
    });
    expect(messageRouter.route(iframeGenerate(), wrongOrigin)).toEqual({
      accepted: false, reason: 'sender-origin-mismatch',
    });
    expect(messageRouter.route(contentStarted(), missingTab)).toEqual({
      accepted: false, reason: 'sender-tab-mismatch',
    });
  });

  it('rejects every non-allowed extension page even when its origin is otherwise valid', () => {
    const messageRouter = router();
    const popupSender = iframeSender();
    popupSender.url = `${extensionOrigin}/popup.html`;

    expect(messageRouter.route(iframeGenerate(), popupSender)).toEqual({
      accepted: false, reason: 'sender-url-mismatch',
    });
  });

  it('rejects cross-tab replay and a stale revision without consuming the current sequence', () => {
    const messageRouter = router();
    const otherTabSender = contentSender(29);

    expect(messageRouter.route(contentStarted(), otherTabSender)).toEqual({
      accepted: false, reason: 'scope-mismatch',
    });
    expect(messageRouter.route(contentStarted(1, 0), contentSender())).toEqual({
      accepted: false, reason: 'invalid-message',
    });
    expect(messageRouter.route(contentStarted(1, 2), contentSender())).toEqual({
      accepted: false, reason: 'scope-mismatch',
    });
    expect(messageRouter.route(contentStarted(), contentSender())).toEqual({ accepted: true });
  });

  it('rejects sequence rollback per trusted sender direction', () => {
    const messageRouter = router();

    expect(messageRouter.route(contentStarted(2), contentSender())).toEqual({ accepted: true });
    expect(messageRouter.route(contentStarted(1), contentSender())).toEqual({
      accepted: false, reason: 'sequence-rollback',
    });
    expect(messageRouter.route(iframeGenerate(1), iframeSender())).toEqual({ accepted: true });
  });

  it('rejects generic RPC and rejects capability types from the wrong trusted sender class', () => {
    const messageRouter = router();

    expect(messageRouter.route({ type: 'rpc.invoke' }, contentSender())).toEqual({
      accepted: false, reason: 'invalid-message',
    });
    expect(messageRouter.route(iframeGenerate(), contentSender())).toEqual({
      accepted: false, reason: 'sender-url-mismatch',
    });
    expect(messageRouter.route(contentStarted(), iframeSender())).toEqual({
      accepted: false, reason: 'sender-url-mismatch',
    });
  });
});

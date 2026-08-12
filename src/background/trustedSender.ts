export type TrustedSender = (sender: chrome.runtime.MessageSender) => boolean;

export const isTrustedExtensionPage: TrustedSender = (sender) =>
  sender.id === chrome.runtime.id &&
  sender.url?.startsWith(chrome.runtime.getURL("")) === true;

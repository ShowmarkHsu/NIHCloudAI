import { startBackground } from "../background/startBackground";

const SMOKE_ORIGIN = "http://127.0.0.1:4173";
const SMOKE_PATH_PREFIX = "/smoke/";

function isSyntheticSmokePage(sender: chrome.runtime.MessageSender): boolean {
  if (sender.id !== chrome.runtime.id || !sender.url) return false;
  try {
    const url = new URL(sender.url);
    return url.origin === SMOKE_ORIGIN && url.pathname.startsWith(SMOKE_PATH_PREFIX);
  } catch {
    return false;
  }
}

startBackground({
  contentSources: [
    {
      origin: "http://127.0.0.1:4173",
      pathPrefix: "/smoke/",
    },
  ],
  trustedUiSender: isSyntheticSmokePage,
  summaryTimeoutMs: 180_000,
});

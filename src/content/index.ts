import { createNhiCloudAdapter } from "../adapters/nhi";
import { createDataSession } from "../session";
import {
  createContentBridge,
  createRuntimeSnapshotPublisher,
} from "./contentBridge";

const NHI_ORIGIN = "https://medcloud2.nhi.gov.tw";

function isNhiCloudPage(location: Location): boolean {
  return location.origin === NHI_ORIGIN && location.pathname.startsWith("/imu/");
}

if (isNhiCloudPage(window.location)) {
  const adapter = createNhiCloudAdapter({
    fetch: globalThis.fetch.bind(globalThis),
    sessionStorage: window.sessionStorage,
    now: () => new Date(),
  });
  const session = createDataSession();
  const publisher = createRuntimeSnapshotPublisher(chrome.runtime);
  const bridge = createContentBridge({
    adapter,
    session,
    publisher,
    scheduler: {
      setInterval: (callback, milliseconds) =>
        window.setInterval(callback, milliseconds),
      clearInterval: (handle) => window.clearInterval(handle as number),
    },
  });

  void bridge.start();
  window.addEventListener(
    "pagehide",
    () => {
      void bridge.stop();
    },
    { once: true },
  );
}

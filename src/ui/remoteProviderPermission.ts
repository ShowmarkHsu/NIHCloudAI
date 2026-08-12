const OPENROUTER_PERMISSION = "https://openrouter.ai/*";

export async function requestOpenRouterHostPermission(): Promise<boolean> {
  if (typeof chrome === "undefined" || !chrome.permissions) return false;
  const permissions = { origins: [OPENROUTER_PERMISSION] };
  if (await chrome.permissions.contains(permissions)) return true;
  return chrome.permissions.request(permissions);
}

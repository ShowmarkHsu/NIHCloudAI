const PROVIDER_ORIGINS = Object.freeze({
  ollama: 'http://127.0.0.1:11434/*',
  openrouter: 'https://openrouter.ai/*',
});

/**
 * Preserve the iframe click's user gesture, while making an unavailable or
 * rejected Chrome Permissions API fail closed instead of leaving the UI idle.
 */
export async function requestOptionalHostPermission(request, provider) {
  try {
    return await request({origins: [PROVIDER_ORIGINS[provider]]});
  } catch {
    return false;
  }
}

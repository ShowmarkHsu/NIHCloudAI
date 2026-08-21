import { describe, expect, it } from 'vitest';

// @ts-expect-error -- Node release scripts are intentionally plain ESM.
import { assessReleaseReadiness } from '../../../scripts/verify-release-readiness.mjs';

const manifest = {
  manifest_version: 3,
  permissions: ['storage', 'clipboardWrite'],
  host_permissions: [
    'https://medcloud2.nhi.gov.tw/*',
    'https://drugtw.com/*',
  ],
};

describe('B6 release readiness gate', () => {
  it('accepts the fixed minimal manifest surface and a clean production artifact', () => {
    expect(assessReleaseReadiness({
      manifest,
      artifacts: [
        { path: 'dist/background.js', contents: '(()=>{})();' },
        { path: 'dist/manifest.json', contents: JSON.stringify(manifest) },
      ],
    })).toEqual([]);
  });

  it('rejects extra permissions, broad host grants, source maps, and secret-shaped values', () => {
    const expandedManifest = structuredClone(manifest);
    expandedManifest.permissions.push('scripting');
    expandedManifest.host_permissions.push('https://*/*');

    expect(assessReleaseReadiness({
      manifest: expandedManifest,
      artifacts: [
        { path: 'dist/content.js.map', contents: '{"version":3}' },
        { path: 'dist/content.js', contents: 'const key = "sk-or-v1-1234567890abcdefghijk";' },
      ],
    })).toEqual([
      'manifest permissions must be exactly: clipboardWrite, storage',
      'manifest host permissions must be exactly: https://drugtw.com/*, https://medcloud2.nhi.gov.tw/*',
      'release artifact must not include source maps: dist/content.js.map',
      'release artifact contains a secret-shaped value: dist/content.js',
    ]);
  });
});

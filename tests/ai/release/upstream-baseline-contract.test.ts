import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';

import {describe, expect, it} from 'vitest';

describe('fixed upstream remote topology contract', () => {
  it('pins every recorded remote role instead of checking only its value types', () => {
    const baseline = JSON.parse(readFileSync(
      resolve(process.cwd(), 'docs', 'upstream-sync', 'baseline.json'),
      'utf8',
    )) as {remoteTopology: {roles: Record<string, unknown>}};

    expect(baseline.remoteTopology.roles).toMatchObject({
      origin: {
        repository: 'https://github.com/ShowmarkHsu/NHITW_cloud_analyzer_react_MUI.git',
        configured: true,
        readable: true,
        writable: true,
      },
      upstream: {
        repository: 'https://github.com/leescot/NHITW_cloud_analyzer_react_MUI.git',
        configured: true,
        readable: true,
        writable: false,
      },
      nicloudai: {
        repository: 'https://github.com/ShowmarkHsu/NIHCloudAI.git',
        configured: true,
        readable: true,
        writable: true,
      },
    });
  });
});

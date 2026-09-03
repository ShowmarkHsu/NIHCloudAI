import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';

import {describe, expect, it} from 'vitest';

describe('fixed upstream remote topology contract', () => {
  it('keeps historical upstream provenance separate from current product identity', () => {
    const baseline = JSON.parse(readFileSync(
      resolve(process.cwd(), 'docs', 'upstream-sync', 'baseline.json'),
      'utf8',
    )) as {
      schemaVersion: number;
      product: {name: string; integrationRepositoryAtCapture: string};
      upstream: {version: string};
      canonicalMigration: Record<string, string>;
    };
    const packageJson = JSON.parse(readFileSync(
      resolve(process.cwd(), 'package.json'),
      'utf8',
    )) as {name: string; version: string; repository: {url: string}};

    expect(baseline.schemaVersion).toBe(3);
    expect(baseline.product).toEqual({
      name: 'NIHCloudAI',
      integrationRepositoryAtCapture:
        'https://github.com/ShowmarkHsu/NHITW_cloud_analyzer_react_MUI.git',
    });
    expect(baseline.upstream.version).toBe('26.0702.1');
    expect(baseline.canonicalMigration).toEqual({
      method: 'two-tree-patch',
      canonicalBaseCommit: 'f48a7411786ecd7b6586ff26e33a446827d378b0',
      upstreamSnapshotCommit: 'cad76e59c60eafc2947939fc44d7683ba9f7ab9d',
      upstreamSnapshotTree: '935820baf34e8e8f2ae01e26b29eac3af786f559',
      importCommit: 'f7debf69835bd8261cb767c9c27a741b255456c9',
      importTree: 'eb743c59a961a7782c4aaed028c316a120f9d9a0',
      patchSha256: 'b2c9209795b2f6ea832dd96163c496b26b21cab8e64b0c1917e2ce7830183236',
    });
    expect(packageJson).toMatchObject({
      name: 'nihcloudai',
      version: '0.2.0',
      repository: {url: 'https://github.com/ShowmarkHsu/NIHCloudAI.git'},
    });
  });

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

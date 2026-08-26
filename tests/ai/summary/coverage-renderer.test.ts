import {expect, it} from 'vitest';

import type {SnapshotCoverage} from '../../../src/ai/contracts/coverage';
import {FIXED_FIVE_SECTION_HEADINGS} from '../../../src/ai/contracts/summary';
import {renderDeterministicCoverageSections} from '../../../src/ai/summary/coverageRenderer';

const coverage = {
  encounter: {status: 'has-data', recordCount: 1},
  'western-medication': {status: 'has-data', recordCount: 1},
  'chinese-medication': {status: 'has-data', recordCount: 1},
  allergy: {status: 'has-data', recordCount: 1},
  lab: {status: 'has-data', recordCount: 1},
  imaging: {status: 'has-data', recordCount: 1},
  procedure: {status: 'has-data', recordCount: 1},
  discharge: {status: 'has-data', recordCount: 1},
  'adult-health-check': {status: 'out-of-scope', recordCount: 0, reasonCode: 'SOURCE_NOT_IN_CONTRACT'},
  'cancer-screening': {status: 'out-of-scope', recordCount: 0, reasonCode: 'SOURCE_NOT_IN_CONTRACT'},
  'hepatitis-bc': {status: 'out-of-scope', recordCount: 0, reasonCode: 'SOURCE_NOT_IN_CONTRACT'},
  'ckm-derived': {status: 'out-of-scope', recordCount: 0, reasonCode: 'SOURCE_NOT_IN_CONTRACT'},
} satisfies SnapshotCoverage;

it('deterministically brings concise multi-family Provider facts into the approved total-length band', () => {
  const rendered = renderDeterministicCoverageSections(
    FIXED_FIVE_SECTION_HEADINGS.map((heading, index) => ({
      heading,
      content: index < 4 ? '已收集事實' : '',
      sourceAliases: index < 4 ? ['S1'] : [],
    })),
    coverage,
  );
  const hanCount = rendered.reduce((total, section) =>
    total + [...section.content].filter((character) => /\p{Script=Han}/u.test(character)).length, 0);

  expect(hanCount).toBeGreaterThanOrEqual(180);
  expect(hanCount).toBeLessThanOrEqual(260);
});

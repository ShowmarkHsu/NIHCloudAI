import {
  parseFixedFiveSectionSummary,
  type FixedFiveSectionSummary,
} from '../contracts/summary';

function formatParsedFixedFiveSectionSummary(
  summary: FixedFiveSectionSummary,
): string {
  return summary.sections
    .map(({ heading, content }) => `【${heading}】\n${content}`)
    .join('\n\n')
    .concat('\n');
}

export function formatFixedFiveSectionSummary(value: unknown): string {
  return formatParsedFixedFiveSectionSummary(parseFixedFiveSectionSummary(value));
}

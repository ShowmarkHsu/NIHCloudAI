import { describe, expect, it } from 'vitest';

import {
  sanitizeFreeText,
  sanitizeProjectionSourceFamily,
} from '../../../src/ai/contracts/projectionSanitizer';
import {
  acceptOpaqueSourceReference,
  createSourceReferenceVault,
  resolveVaultReference,
} from '../../../src/ai/contracts/referenceVault';

const scope = {
  sessionId: 'ds_synthetic_session_0001',
  revision: 1,
  contractVersion: 'clinical-projection.v1',
};

const imagingRecord = {
  sourceFamily: 'imaging',
  sourceRef: 'sr_imaging_synthetic_0001',
  date: '2026-08-14',
  facility: 'Synthetic Imaging Center',
  examCode: 'IMG-001',
  examName: 'Synthetic scan',
  bodySite: null,
  reportText: 'De-identified synthetic report.',
};

describe('projection sanitizer source quarantine', () => {
  it('accepts a complete synthetic source family and preserves no partial output', () => {
    const result = sanitizeProjectionSourceFamily(
      'imaging',
      [imagingRecord],
      ['Synthetic Patient', 'SYNTHETIC-MRN'],
    );

    expect(result).toEqual({
      status: 'accepted',
      sourceFamily: 'imaging',
      records: [imagingRecord],
    });
    expect(result?.status).toBe('accepted');
    if (result?.status === 'accepted') {
      expect(Object.isFrozen(result.records)).toBe(true);
      expect(result.records).toHaveLength(1);
    }
  });

  it('converts safe free text to plain text and rejects identity-tainted text', () => {
    expect(
      sanitizeFreeText('<p>  De-identified\nreport. </p>', ['Synthetic Patient']),
    ).toEqual({status: 'accepted', text: 'De-identified report.'});
    expect(
      sanitizeFreeText('Patient name: Synthetic Patient', ['Synthetic Patient']),
    ).toEqual({status: 'rejected', reasonCode: 'SOURCE_IDENTITY_TAINT'});
    expect(
      sanitizeFreeText('A123456789', ['Synthetic Patient']),
    ).toEqual({status: 'rejected', reasonCode: 'SOURCE_IDENTITY_TAINT'});
  });

  it('quarantines the entire family for unknown, missing, wrong-type, identity-tainted, or noncanonical free text', () => {
    const cases: readonly [unknown, 'SOURCE_SCHEMA_REJECTED' | 'SOURCE_IDENTITY_TAINT' | 'SOURCE_TEXT_SANITIZATION_FAILED'][] = [
      [
        [
          imagingRecord,
          {
            sourceFamily: 'imaging',
            sourceRef: 'sr_imaging_synthetic_0002',
            date: '2026-08-14',
            facility: 'Synthetic Imaging Center',
            examCode: null,
            examName: 'Unsafe scan',
            bodySite: null,
            reportText: null,
            unexpectedField: 'must-not-pass-through',
          },
        ],
        'SOURCE_SCHEMA_REJECTED',
      ],
      [
        [
          {
            sourceFamily: 'imaging',
            sourceRef: 'sr_imaging_synthetic_0002',
            date: '2026-08-14',
            facility: 'Synthetic Imaging Center',
            examCode: null,
            examName: 'Missing report field',
            bodySite: null,
          },
        ],
        'SOURCE_SCHEMA_REJECTED',
      ],
      [
        [
          {
            sourceFamily: 'imaging',
            sourceRef: 'sr_imaging_synthetic_0002',
            date: '2026-08-14',
            facility: 'Synthetic Imaging Center',
            examCode: null,
            examName: 'Wrong report type',
            bodySite: null,
            reportText: 42,
          },
        ],
        'SOURCE_SCHEMA_REJECTED',
      ],
      [
        [
          {
            sourceFamily: 'imaging',
            sourceRef: 'sr_imaging_synthetic_0002',
            date: '2026-08-14',
            facility: 'Synthetic Patient Hospital',
            examCode: null,
            examName: 'Identity-tainted facility',
            bodySite: null,
            reportText: null,
          },
        ],
        'SOURCE_IDENTITY_TAINT',
      ],
      [
        [
          {
            sourceFamily: 'imaging',
            sourceRef: 'sr_imaging_synthetic_0002',
            date: '2026-08-14',
            facility: 'Synthetic Imaging Center',
            examCode: null,
            examName: 'Overlength report',
            bodySite: null,
            reportText: 'x'.repeat(8_001),
          },
        ],
        'SOURCE_SCHEMA_REJECTED',
      ],
      [
        [
          {
            sourceFamily: 'imaging',
            sourceRef: 'sr_imaging_synthetic_0002',
            date: '2026-08-14',
            facility: 'Synthetic Imaging Center',
            examCode: null,
            examName: 'Markup must be normalized before projection',
            bodySite: null,
            reportText: '<p>De-identified report.</p>',
          },
        ],
        'SOURCE_TEXT_SANITIZATION_FAILED',
      ],
    ];

    for (const [records, reasonCode] of cases) {
      const result = sanitizeProjectionSourceFamily(
        'imaging',
        records,
        ['Synthetic Patient'],
      );
      expect(result).toEqual({
        status: 'quarantined',
        sourceFamily: 'imaging',
        records: [],
        reasonCode,
      });
    }
  });

  it('rejects unknown source families and mismatched family records without a fallback', () => {
    expect(
      sanitizeProjectionSourceFamily(
        'adult-health-check',
        [imagingRecord],
        ['Synthetic Patient'],
      ),
    ).toBeNull();

    expect(
      sanitizeProjectionSourceFamily(
        'lab',
        [imagingRecord],
        ['Synthetic Patient'],
      ),
    ).toEqual({
      status: 'quarantined',
      sourceFamily: 'lab',
      records: [],
      reasonCode: 'SOURCE_SCHEMA_REJECTED',
    });
  });
});

describe('local source-reference vault', () => {
  it('accepts only strict, opaque, metadata-only local entries', () => {
    const vault = createSourceReferenceVault({
      scope,
      entries: [
        {
          sourceRef: 'sr_imaging_synthetic_0001',
          sourceFamily: 'imaging',
          recordIndex: 0,
        },
      ],
    });

    expect(vault).not.toBeNull();
    expect(Object.isFrozen(vault)).toBe(true);
    expect(vault).not.toHaveProperty('patientId');
    expect(vault).not.toHaveProperty('displayIdentity');
    expect(vault).not.toHaveProperty('rawPayload');
    expect(vault).not.toHaveProperty('metadata');
  });

  it('rejects duplicate refs, duplicate locations, direct identifiers, and arbitrary containers', () => {
    const baseEntry = {
      sourceRef: 'sr_imaging_synthetic_0001',
      sourceFamily: 'imaging',
      recordIndex: 0,
    };
    const duplicateRef = createSourceReferenceVault({
      scope,
      entries: [
        baseEntry,
        {
          sourceRef: 'sr_imaging_synthetic_0001',
          sourceFamily: 'imaging',
          recordIndex: 1,
        },
      ],
    });
    const duplicateLocation = createSourceReferenceVault({
      scope,
      entries: [
        baseEntry,
        {
          sourceRef: 'sr_imaging_synthetic_0002',
          sourceFamily: 'imaging',
          recordIndex: 0,
        },
      ],
    });
    const tainted = createSourceReferenceVault({
      scope,
      entries: [
        {
          sourceRef: 'sr_imaging_synthetic_0001',
          sourceFamily: 'imaging',
          recordIndex: 0,
          patientName: 'Synthetic Patient',
        },
      ],
    });
    const arbitrary = createSourceReferenceVault({
      scope,
      entries: [baseEntry],
      other: [],
    });

    expect(duplicateRef).toBeNull();
    expect(duplicateLocation).toBeNull();
    expect(tainted).toBeNull();
    expect(arbitrary).toBeNull();
  });

  it('only resolves a reference in the exact local session, revision, and contract scope', () => {
    const vault = createSourceReferenceVault({
      scope,
      entries: [
        {
          sourceRef: 'sr_imaging_synthetic_0001',
          sourceFamily: 'imaging',
          recordIndex: 0,
        },
      ],
    });
    expect(vault).not.toBeNull();

    expect(
      resolveVaultReference(vault, 'sr_imaging_synthetic_0001', scope),
    ).toEqual({sourceFamily: 'imaging', recordIndex: 0});
    expect(
      resolveVaultReference(vault, 'sr_imaging_synthetic_0001', {
        sessionId: 'ds_synthetic_session_0001',
        revision: 2,
        contractVersion: 'clinical-projection.v1',
      }),
    ).toBeNull();
    expect(
      resolveVaultReference(vault, 'sr_not_in_vault_000001', scope),
    ).toBeNull();
    expect(acceptOpaqueSourceReference('ds_synthetic_session_0001')).toBeNull();
    expect(
      acceptOpaqueSourceReference('sr_imaging_synthetic_0001'),
    ).toBe('sr_imaging_synthetic_0001');
  });
});

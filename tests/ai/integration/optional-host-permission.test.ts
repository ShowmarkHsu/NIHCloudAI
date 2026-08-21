import {describe, expect, it, vi} from 'vitest';

import {requestOptionalHostPermission} from '../../../src/ai/iframe/optionalHostPermission';

describe('optional provider host permission', () => {
  it('fails closed when Chrome rejects an optional host request', async () => {
    const request = vi.fn().mockRejectedValue(new Error('synthetic permissions API rejection'));

    await expect(requestOptionalHostPermission(request, 'openrouter')).resolves.toBe(false);
    expect(request).toHaveBeenCalledWith({origins: ['https://openrouter.ai/*']});
  });
});

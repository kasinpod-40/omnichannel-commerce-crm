import { describe, expect, it } from 'vitest';

import { getLarkText } from './lark-field-value';

describe('getLarkText', () => {
  it('อ่าน value แบบ primitive จาก Lark field wrapper', () => {
    expect(getLarkText({ value: 'ORD-001' })).toBe('ORD-001');
  });

  it('อ่าน rich text array', () => {
    expect(getLarkText([{ text: 'ORD-' }, { text: '002' }])).toBe('ORD-002');
  });
});

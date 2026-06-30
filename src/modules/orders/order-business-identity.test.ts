import { describe, expect, it } from 'vitest';

import { resolveOrderBusinessIdentity } from './order-business-identity';

describe('resolveOrderBusinessIdentity', () => {
  it('ใช้ order_number สำหรับ LINE แม้มี external_order_id', () => {
    expect(resolveOrderBusinessIdentity({
      order_number: 'ORD-20260630-0001',
      external_order_id: 'LINE-EXTERNAL-1',
    }, 'LINE')).toEqual({
      orderNumber: 'ORD-20260630-0001',
      externalOrderId: 'LINE-EXTERNAL-1',
      displayOrderNumber: 'ORD-20260630-0001',
    });
  });

  it('ใช้ external_order_id สำหรับ Marketplace', () => {
    expect(resolveOrderBusinessIdentity({
      order_number: 'ORD-INTERNAL-1',
      external_order_id: '260630TH000001',
    }, 'Shopee')).toMatchObject({
      displayOrderNumber: '260630TH000001',
    });
  });

  it('อ่าน alias ของ Lark field แบบ case-insensitive', () => {
    expect(resolveOrderBusinessIdentity({
      'Order Number': [{ text: 'ORD-ALIAS-1' }],
    }, 'LINE').displayOrderNumber).toBe('ORD-ALIAS-1');
  });

  it('ไม่ fallback เป็น record id เมื่อเลขธุรกิจหาย', () => {
    expect(resolveOrderBusinessIdentity({}, 'LINE').displayOrderNumber).toBe('');
  });
});

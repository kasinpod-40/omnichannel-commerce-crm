import { ORDER_FIELDS } from '../../core/lark-fields';
import { getLarkText } from '../../utils/lark-field-value';

export type OrderBusinessChannel = 'LINE' | 'Shopee' | 'Lazada' | 'TikTok Shop';

const ORDER_NUMBER_ALIASES = [
  ORDER_FIELDS.ORDER_NUMBER,
  'Order Number',
  'order no',
  'order_no',
  'เลขที่คำสั่งซื้อ',
] as const;

const EXTERNAL_ORDER_ID_ALIASES = [
  ORDER_FIELDS.EXTERNAL_ORDER_ID,
  'External Order ID',
  'marketplace_order_id',
  'Marketplace Order ID',
  'เลขคำสั่งซื้อ Marketplace',
] as const;

function readFirstText(fields: Record<string, unknown>, aliases: readonly string[]): string {
  for (const alias of aliases) {
    const direct = getLarkText(fields[alias], '').trim();
    if (direct) return direct;

    const matchedKey = Object.keys(fields).find(
      (key) => key.trim().toLocaleLowerCase('en-US') === alias.trim().toLocaleLowerCase('en-US'),
    );
    if (!matchedKey) continue;
    const matched = getLarkText(fields[matchedKey], '').trim();
    if (matched) return matched;
  }
  return '';
}

export function isMarketplaceOrderChannel(channel: string): boolean {
  const normalized = channel.trim().toLocaleLowerCase('en-US');
  return normalized.includes('shopee') || normalized.includes('lazada') || normalized.includes('tiktok');
}

export interface OrderBusinessIdentity {
  orderNumber: string;
  externalOrderId: string | null;
  displayOrderNumber: string;
}

/**
 * Source of truth ของเลขคำสั่งซื้อที่ผู้ใช้เห็น
 * - LINE/Internal CRM ใช้ order_number
 * - Marketplace ใช้ external_order_id เท่านั้น เพื่อไม่ให้ผู้ใช้สับสนกับเลขภายในของระบบ
 * - record id ไม่ถูกใช้เป็นข้อความให้ผู้ใช้เห็น
 */
export function resolveOrderBusinessIdentity(
  fields: Record<string, unknown>,
  channel: string,
): OrderBusinessIdentity {
  const orderNumber = readFirstText(fields, ORDER_NUMBER_ALIASES);
  const externalOrderId = readFirstText(fields, EXTERNAL_ORDER_ID_ALIASES) || null;
  const displayOrderNumber = isMarketplaceOrderChannel(channel)
    ? externalOrderId ?? ''
    : orderNumber;

  return { orderNumber, externalOrderId, displayOrderNumber };
}


const DOCUMENT_NUMBER_PREFIX = /^(?:QT|INV|TAX)-/i;

/**
 * ขยายคำค้นธุรกิจให้รองรับการวางเลขเอกสาร เช่น QT-ORD-... หรือ INV-12345
 * โดย Backend ยังเป็นผู้ตัดสินผลค้นหาและไม่ใช้ record_id เป็นคำค้นของผู้ใช้
 */
export function expandOrderBusinessSearchTerms(value: string): string[] {
  const normalized = value.trim().toLocaleLowerCase('th-TH');
  if (!normalized) return [];
  const stripped = normalized.replace(DOCUMENT_NUMBER_PREFIX, '');
  return stripped && stripped !== normalized ? [normalized, stripped] : [normalized];
}

import { DiscountType } from './entities/voucher.entity';

export interface DiscountResult {
  discountAmount: number;
  discountLabel: string;
}

/**
 * Menghitung nilai diskon berdasarkan tipe diskon dan nilai pesanan.
 *
 * - PERCENTAGE: Potongan persentase dari orderTotal, dibatasi max_discount jika ada.
 * - FIXED_AMOUNT: Potongan nominal tetap, tidak boleh melebihi orderTotal.
 *
 * @returns DiscountResult { discountAmount, discountLabel }
 */
export function calculateDiscount(
  discountType: DiscountType,
  discountValue: number,
  orderTotal: number,
  maxDiscount: number | null,
): DiscountResult {
  if (discountType === DiscountType.PERCENTAGE) {
    const rawDiscount = (discountValue / 100) * orderTotal;
    const discountAmount = maxDiscount !== null
      ? Math.min(rawDiscount, maxDiscount)
      : rawDiscount;

    return {
      discountAmount: Math.round(discountAmount * 100) / 100, // hindari floating point
      discountLabel: `${discountValue}%${maxDiscount !== null ? ` (maks ${formatRupiah(maxDiscount)})` : ''}`,
    };
  }

  if (discountType === DiscountType.FIXED_AMOUNT) {
    const discountAmount = Math.min(discountValue, orderTotal);

    return {
      discountAmount: Math.round(discountAmount * 100) / 100,
      discountLabel: `Potongan ${formatRupiah(discountValue)}`,
    };
  }

  return { discountAmount: 0, discountLabel: '' };
}

function formatRupiah(value: number): string {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}
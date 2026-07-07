/**
 * Fitur-fitur yang akan di-rate-limit.
 * Setiap enum mewakili satu fitur bisnis dengan limit-nya sendiri.
 */
export enum ThrottlerFeature {
  /** Pencarian produk / search */
  SEARCH = 'search',
  /** Proses checkout / pembayaran */
  CHECKOUT = 'checkout',
  /** Cek ongkos kirim (Biteship) */
  SHIPPING = 'shipping',
  /** Login / register / forgot-password */
  AUTH = 'auth',
  /** API publik / general */
  PUBLIC = 'public',
  /** Admin panel */
  ADMIN = 'admin',
  /** Review & rating */
  REVIEW = 'review',
  /** Chat / messaging */
  CHAT = 'chat',
  /** Upload file */
  UPLOAD = 'upload',
}
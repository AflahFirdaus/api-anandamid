# 📘 AnandamID API Tutorial — Swagger Guide

## Panduan Lengkap: Dari Registrasi Hingga Pembayaran Sukses

Swagger UI tersedia di:
- **Local:** `http://localhost:3030/api/docs`
- **Staging:** `https://staging.anandam.id/api/docs`
- **Production:** `https://anandam.id/api/docs`

---

## 1. REGISTRASI AKUN BARU

**Endpoint:** `POST /api/v1/user/auth/register`

Di Swagger UI, buka tag **User Auth**, cari endpoint `POST /user/auth/register`, klik **Try it out**.

**Request Body:**
```json
{
  "full_name": "Budi Santoso",
  "email": "budi@example.com",
  "password": "Password123!",
  "phone_number": "081234567890"
}
```

**Response (201):**
```json
{
  "message": "Registrasi berhasil",
  "user": {
    "id": "uuid-user-budi",
    "full_name": "Budi Santoso",
    "email": "budi@example.com",
    "phone_number": "081234567890"
  },
  "access_token": "eyJhbGciOi..."
}
```

> 💡 **Simpan `access_token`!** Ini akan dipakai untuk semua request berikutnya.

---

## 2. LOGIN (Alternatif jika sudah punya akun)

**Endpoint:** `POST /api/v1/auth/login`

**Request Body:**
```json
{
  "username": "budi@example.com",
  "password": "Password123!"
}
```

**Response (200):**
```json
{
  "access_token": "eyJhbGciOi...",
  "refresh_token": "eyJhbGciOi..."
}
```

---

## 3. SETUP AUTHENTICATION DI SWAGGER

Setelah dapat `access_token`, semua endpoint yang membutuhkan autentikasi harus menyertakan token.

**Caranya:**
1. Klik tombol **Authorize** 🔒 di pojok kanan atas Swagger UI
2. Di kolom **JWT-auth**, masukkan: `Bearer eyJhbGciOi...` (ganti dengan token asli)
3. Klik **Authorize**, lalu **Close**

> ✅ Sekarang semua endpoint yang ada ikon gembok 🔒 akan otomatis mengirim token.

---

## 4. LIHAT PRODUK YANG TERSEDIA

**Endpoint:** `GET /api/v1/products` (Public — no auth needed)

Buka tag **Products**, klik **Try it out**, lalu **Execute**.

**Response (200):**
```json
{
  "data": [
    {
      "id": "uuid-product-1",
      "name": "Laptop ASUS ROG",
      "price": 15000000,
      "images": [{ "thumbnail_url": "/uploads/categories/laptop.jpg" }],
      "variants": [
        {
          "id": "uuid-variant-1",
          "variant_name": "Hitam 16GB",
          "price_normal": 15000000,
          "price_discount": 0,
          "stock": 10
        }
      ]
    }
  ],
  "total": 50
}
```

> 📝 **Catat `product_id` dan `variant_name`** untuk langkah berikutnya.

---

## 5. TAMBAH ALAMAT PENGIRIMAN

**Endpoint:** `POST /api/v1/user/auth/addresses` 🔒

**Request Body:**
```json
{
  "label": "Rumah",
  "recipient_name": "Budi Santoso",
  "phone_number": "081234567890",
  "full_address": "Jl. Merdeka No. 123, Kel. Sukamaju, Kec. Cimahi Selatan, Kota Cimahi 40512",
  "is_default": true
}
```

**Response (201):**
```json
{
  "message": "Alamat berhasil ditambahkan",
  "address": {
    "id": "uuid-address-1",
    "label": "Rumah",
    "recipient_name": "Budi Santoso",
    "phone_number": "081234567890",
    "full_address": "Jl. Merdeka No. 123...",
    "is_default": true
  }
}
```

> 📝 **Catat `address.id`** untuk checkout nanti.

---

## 6. CEK ONGKOS KIRIM (Optional)

**Endpoint:** `POST /api/v1/shipping/rates`

Buka tag **Shipping**, cari `POST /shipping/rates`.

**Request Body:**
```json
{
  "originPostalCode": "65139",
  "destinationPostalCode": "40512",
  "couriers": "jne,jnt,sicepat",
  "items": [
    {
      "name": "Laptop ASUS ROG",
      "weight": 2.5,
      "value": 15000000,
      "quantity": 1
    }
  ]
}
```

**Response (200):**
```json
{
  "origin": { ... },
  "destination": { ... },
  "pricing": [
    {
      "courier_name": "JNE",
      "courier_service_name": "REG",
      "price": 25000,
      "duration": "2-3 days"
    },
    {
      "courier_name": "JNT",
      "courier_service_name": "EZ",
      "price": 18000,
      "duration": "2-3 days"
    }
  ]
}
```

> 📝 **Pilih salah satu ongkir** (misal Rp 18.000) untuk dimasukkan ke `shipping_cost` saat checkout.

---

## 7. TAMBAH PRODUK KE KERANJANG (Cart-based Checkout)

### 7a. Tambah ke Cart

**Endpoint:** `POST /api/v1/cart/add` 🔒

**Request Body:**
```json
{
  "product_id": "uuid-product-1",
  "quantity": 1,
  "variasi": "Hitam 16GB"
}
```

**Response (201):**
```json
{
  "message": "Produk berhasil ditambahkan ke keranjang",
  "cart": {
    "id": "uuid-cart-1",
    "product": { "id": "uuid-product-1", "name": "Laptop ASUS ROG" },
    "selected_variasi": "Hitam 16GB",
    "quantity": 1
  }
}
```

### 7b. Lihat Isi Keranjang

**Endpoint:** `GET /api/v1/cart` 🔒

**Response (200):**
```json
[
  {
    "id": "uuid-cart-1",
    "product": { "id": "uuid-product-1", "name": "Laptop ASUS ROG" },
    "selected_variasi": "Hitam 16GB",
    "quantity": 1
  }
]
```

> 📝 **Catat `cart.id`** (misal `uuid-cart-1`).

---

## 8. CHECKOUT + BAYAR (Langkah Paling Penting!) ⭐

Ada **dua cara** checkout:

### Cara A: Checkout dari Keranjang (Cart-based)

**Endpoint:** `POST /api/v1/orders/checkout` 🔒

Buka tag **Orders**, cari `POST /orders/checkout`.

**Request Body:**
```json
{
  "cart_ids": ["uuid-cart-1"],
  "shipping_cost": 18000,
  "address_id": "uuid-address-1",
  "notes": "Tolong dibungkus kado ya"
}
```

### Cara B: Checkout Langsung (Direct — tanpa cart)

```json
{
  "direct_item": {
    "product_id": "uuid-product-1",
    "quantity": 1,
    "variasi": "Hitam 16GB"
  },
  "shipping_cost": 18000,
  "address_id": "uuid-address-1",
  "notes": "Tolong kirim cepat ya"
}
```

**Response (200) — INI YANG PENTING:**
```json
{
  "message": "Checkout berhasil, silakan lanjutkan pembayaran",
  "order": {
    "id": "uuid-order-1",
    "invoice_number": "INV-20260702-4821",
    "total_price": 15018000,
    "status": "PENDING",
    "items": [
      {
        "product_name": "Laptop ASUS ROG",
        "variasi": "Hitam 16GB",
        "quantity": 1,
        "price": 15000000
      }
    ]
  },
  "payment": {
    "token": "snap-token-abc123...",
    "redirect_url": "https://app.sandbox.midtrans.com/snap/v1/..."
  }
}
```

> 🎉 **Selamat!** Order sudah terbuat dengan status `PENDING` dan Midtrans payment token sudah ter-generate.

---

## 9. LAKUKAN PEMBAYARAN

### Jika di Production:
Arahkan user ke `payment.redirect_url` untuk menyelesaikan pembayaran di halaman Midtrans Snap.

### Untuk Testing (Sandbox):
Buka `payment.redirect_url` di browser. Gunakan **simulasi pembayaran** Midtrans:

| Metode Pembayaran | Simulasi |
|---|---|
| **Credit Card** | Card: `4811 1111 1111 1114`, CVV: `123`, Exp: future date |
| **Bank Transfer (BCA)** | Klik "Bayar" → pembayaran akan auto-success |
| **GoPay / Shopeepay** | Klik "Bayar" → pembayaran akan auto-success |
| **Indomaret / Alfamart** | Klik "Bayar" → pembayaran akan auto-success |

Setelah pembayaran sukses di halaman Midtrans, user akan di-redirect kembali ke website Anda.

---

## 10. MIDTRANS WEBHOOK (Otomatis)

Setelah pembayaran sukses, Midtrans akan mengirim **HTTP POST notification** ke:

**Endpoint:** `POST /api/v1/payment/webhook`

Server akan otomatis:
- ✅ Verifikasi signature notifikasi
- ✅ Log `Order ID`, `transaction_status`, `fraud_status`
- ✅ Update status order di database (via TODO di `handleNotification`)

> ⚠️ **Catatan Developer:** Logic update status di database perlu diimplementasikan di `PaymentService.handleNotification()` sesuai dengan flow bisnis Anda.

---

## 11. CEK STATUS ORDER

**Endpoint:** `GET /api/v1/orders/my-orders` 🔒

**Response (200):**
```json
[
  {
    "id": "uuid-order-1",
    "invoice_number": "INV-20260702-4821",
    "total_price": 15018000,
    "status": "PENDING",
    "created_at": "2026-07-02T11:30:00.000Z",
    "items": [
      {
        "product_name": "Laptop ASUS ROG",
        "variasi": "Hitam 16GB",
        "quantity": 1,
        "price": 15000000,
        "product": {
          "thumbnail": "/uploads/categories/laptop.jpg"
        }
      }
    ]
  }
]
```

---

## 12. ADMIN: UPDATE STATUS ORDER (Setelah Pembayaran Terverifikasi)

**Endpoint:** `PATCH /api/v1/orders/:id/status` 🔒 (Admin only, pakai `JwtAuthGuard`)

> ⚠️ Butuh login admin (`POST /api/v1/auth/login` dengan kredensial admin)

**Request Body:**
```json
{
  "status": "LUNAS"
}
```

**Response (200):**
```json
{
  "message": "Status pesanan berhasil diubah menjadi LUNAS",
  "order": {
    "id": "uuid-order-1",
    "status": "LUNAS"
  }
}
```

> 📦 Setelah status `LUNAS`, stok produk otomatis berkurang di `updateOrderStatus()`.

---

## 📊 RINGKASAN FLOW LENGKAP

```
1. POST /user/auth/register          → Daftar akun
2. POST /auth/login                   → Login (opsional, dapat token saat register)
3. 🔒 Authorize di Swagger           → Masukkan Bearer token
4. GET  /products                     → Lihat produk
5. POST /user/auth/addresses          → Tambah alamat
6. POST /shipping/rates               → Cek ongkir (opsional)
7. POST /cart/add                     → Tambah ke keranjang
   GET  /cart                         → Lihat keranjang
8. POST /orders/checkout              → CHECKOUT + DAPAT TOKEN MIDTRANS ⭐
9. Buka payment.redirect_url          → Bayar di Midtrans
10. (Otomatis) POST /payment/webhook  → Midtrans kirim notifikasi sukses
11. GET  /orders/my-orders            → Cek status order
12. PATCH /orders/:id/status          → Admin update ke LUNAS
```

---

## 🔑 TIPS SWAGGER

1. **Authorize sekali** — Setelah login/register, klik **Authorize** 🔒 dan masukkan `Bearer <token>`. Semua endpoint terkunci akan otomatis ter-autentikasi.

2. **Gunakan contoh di schema** — Setiap DTO di Swagger menampilkan contoh request body. Klik **Schema** untuk melihat detail.

3. **Response codes** — Perhatikan response codes di setiap endpoint: `200` = sukses, `400` = bad request, `404` = not found, `500` = server error.

4. **Download OpenAPI spec** — Kunjungi `/api/docs-json` untuk mendapatkan file OpenAPI JSON yang bisa di-import ke Postman, Insomnia, atau tools lainnya.

---

> **Dokumentasi ini dibuat otomatis oleh Swagger + ditulis manual untuk kemudahan onboarding developer baru.**
> Last updated: 2 Juli 2026
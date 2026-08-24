# Laporan Pekerjaan: Migrasi OTP dari WhatsApp ke Email (Anandam.ID)

**Tanggal:** 21 Agustus 2026
**Ruang lingkup:** Backend (`anandamid-backend`) & Frontend (`anandam-frontend-v6`)
**Status:** Selesai & terverifikasi (email OTP berhasil terkirim via SMTP port 587)

---

## 1. Latar Belakang

Sebelumnya, seluruh kebutuhan verifikasi OTP (registrasi, login, Google, lupa kata sandi,
dsb.) dikirim melalui **WhatsApp**. Karena akun WhatsApp terkendala, perlu dilakukan
migrasi saluran pengiriman OTP menjadi **Email**, dengan tetap mempertahankan **nomor
WhatsApp sebagai field wajib** (sesuai kebutuhan akun), namun **OTP dikirim & diverifikasi
via email**.

---

## 2. Ringkasan Perubahan

### 2.1 Backend (`anandamid-backend`)
| File | Perubahan |
|------|-----------|
| `src/migrations/1787400000000-AddEmailOtpFields.ts` (baru) | Migrasi menambah kolom `is_email_verified`, `email_otp`, `email_otp_expires`. Kolom WhatsApp sengaja **tidak di-drop** (untuk kemudahan rollback). |
| `src/user/entities/user.entity.ts` | Menambah field `is_email_verified`, `email_otp`, `email_otp_expires`; field `is_whatsapp_verified`, `whatsapp_otp`, `whatsapp_otp_expires` di-comment (tidak dipakai). |
| `src/notification/email.service.ts` | Menambah `sendOtp(to, otpCode)` (HTML email branded) + perbaikan koneksi SMTP (lihat Bagian 3). |
| `src/user/user.service.ts` | Semua alur OTP (register, login, verify-otp, resend-otp, google, update-phone, forgot-password) dialihkan dari `whatsappService` → `emailService`, identitas OTP dari `phone_number` → `email`, dan kode WhatsApp lama di-comment. |
| `src/user/dto/verify-otp.dto.ts`, `resend-otp.dto.ts` | Field `phone_number` → `email` (validasi `@IsEmail`). |
| `src/user/user.controller.ts` | Endpoint `verify-otp`, `resend-otp`, `forgot-password-otp`, `verify-forgot-password-otp` kini menerima `email`. |

### 2.2 Frontend (`anandam-frontend-v6`)
| File | Perubahan |
|------|-----------|
| `src/services/userAuthService.ts` | `verifyOtp`, `resendOtp`, `forgotPasswordOtp`, `verifyForgotPasswordOtp` memakai `email`; tipe return `registerUser`, `updatePhoneOtp`, `googleRegisterPhone` → `email`. |
| `src/components/Navbar/AuthModal.tsx` | State `otpPhone`/`forgotPhone` → `otpEmail`/`forgotEmail`; semua handler & UI verifikasi OTP menggunakan **email**; tombol/teks "WhatsApp" → "Email"; menghapus UI "Ganti nomor WhatsApp" (tidak relevan untuk OTP email). Kolom nomor WhatsApp tetap wajib di form register. |

**Deploy database:** perlu menjalankan migrasi `AddEmailOtpFields` sebelum aplikasi dijalankan
(`npm run migration:run` bila menggunakan script TypeORM).

---

## 3. Hambatan & Penanggulangan

| # | Hambatan | Gejala | Penyebab | Penanganan |
|---|----------|--------|----------|------------|
| 1 | SMTP gagal total | `connect ENETUNREACH 2606:4700:...:587` | Server aplikasi tidak punya route IPv6; Node memilih IPv6 (AAA record) lebih dulu sehingga gagal sebelum coba IPv4 | **Force IPv4** pada transporter `connectionOptions.lookup → family: 4`. |
| 2 | Host SMTP salah/ter-proxy | `connect timeout` ke Cloudflare (104.21.x / 172.67.x) | `mail.anandam.id` masih **CNAME → anandam.id** dan berstatus **Proxied** (orange cloud) yang tidak meneruskan port SMTP | Ubah DNS `mail.anandam.id` menjadi **A → 217.21.72.99, DNS only (abu-abu)**. Verifikasi: `nslookup` & `curl smtp://...`. |
| 3 | Port SMTP salah | `0 bytes received` / TCP connect tapi tanpa balasan | Server mail Niagahoster (`srv149.niagahoster.com`) tidak menyapa di 587 secara andal | Uji `openssl s_client` → ternyata **587 (STARTTLS)** dan **465 (SMTPS)** bekerja; diputuskan memakai **port 587 (STARTTLS)**. |
| 4 | Header SMTP tidak terbaca | `Greeting never received` | Pada 465 (TLS implicit), aplikasi Node gagal negosiasi; jalur STARTTLS di 587 lebih toleran | Menggunakan `SMTP_PORT=587` (secure=false, STARTTLS). |
| 5 | Potensi TLS versi lama | (pencegahan) | Server Exim shared-hosting bisa menawarkan TLS lama yang dinonaktifkan Node | Menambah `tls.minVersion: 'TLSv1'` pada transporter. |

**Konfigurasi SMTP final yang berhasil** (`.env` server):
```ini
SMTP_HOST=mail.anandam.id     # → A record 217.21.72.99 (DNS only)
SMTP_PORT=587
SMTP_USER=noreply@anandam.id
SMTP_PASS=********
SMTP_FROM_EMAIL=noreply@anandam.id
```

---

## 4. Catatan Pengembangan (Next Steps / Catatan)

1. **Deploy & build** — pastikan perubahan sudah dideploy ke server:
   ```bash
   cd /var/www/api-anandamid
   npm run build
   pm2 restart api-anandamid
   ```
   Verifikasi dist sudah versi baru: `grep -c connectionOptions dist/src/notification/email.service.js` (harus `1`).

2. **DNS (sudah beres)** — `mail.anandam.id` harus **DNS only** menunjuk `217.21.72.99`. Jika belum, jangan ubah ke Proxied karena SMTP tidak akan tembus.

3. **Mencegah masuk SPAM (penting untuk Gmail)** — pastikan di DNS zona `anandam.id` tersedia:
   - **SPF** (TXT): `v=spf1 include:relay.niagahoster.com ~all` (sesuai petunjuk penyedia).
   - **DKIM** (diambil dari cPanel/Niagahoster sebagai record TXT).
   - **DMARC** (TXT): `v=DMARC1; p=none; rua=mailto:admin@anandam.id`.
   Tanpa ini, email bisa terkirim tapi masuk **folder Spam**.

4. **Kolom lama pada DB dibiarkan** — kolom `whatsapp_otp*`, `is_whatsapp_verified` sengaja dipertahankan di DB (kode di-comment) agar mudah rollback. Jika sudah yakin, kolom tersebut bisa dibersihkan lewat migrasi terpisah.

5. **Kredensial email** — `noreply@anandam.id` harus berupa akun email yang valid di server mail Niagahoster; jika tidak ada, buat di cPanel → Email Accounts (atau pakai akun yang sudah ada seperti `admin@anandam.id`).

6. **Pembersihan kode mati** — komponen `PhoneChangeForm` di `AuthModal.tsx` sudah tidak dirender (dead code). Bisa dihapus untuk kebersihan, tidak wajib.

7. **Pengujian** — Frontend dijalankan di localhost mengarah ke API server. Alur yang perlu diuji: registrasi, login (email belum verifikasi), kirim ulang OTP, dan lupa kata sandi — semuanya harus mengirim OTP ke email.

---

*Laporan disusun sebagai dokumentasi pekerjaan migrasi OTP WhatsApp → Email.*
import {
  Injectable,
  ConflictException,
  UnauthorizedException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './entities/user.entity';
import { UserAddress } from './entities/user-address.entity';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { OAuth2Client } from 'google-auth-library';
import * as crypto from 'crypto';
import { NotificationService } from '../notification/notification.service';
import { EmailService } from '../notification/email.service';
import { Voucher, VoucherType } from '../voucher/entities/voucher.entity';
import { WhatsappService } from '../notification/whatsapp.service';
import { RegisterDto } from './dto/register.dto';
import { GoogleRegisterPhoneDto } from './dto/google-register-phone.dto';

@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name);
  private googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

  constructor(
    @InjectRepository(User)
    private userRepo: Repository<User>,
    @InjectRepository(UserAddress)
    private addressRepo: Repository<UserAddress>,
    @InjectRepository(Voucher)
    private voucherRepo: Repository<Voucher>,
    private jwtService: JwtService,
    private readonly notificationService: NotificationService,
    private readonly whatsappService: WhatsappService,
    private readonly emailService: EmailService,
  ) {}

  // ================= REGISTER =================
  async register(dto: RegisterDto) {
    const formattedPhone = this.whatsappService.formatPhoneNumber(
      dto.phone_number,
    );
    const normalizedEmail = dto.email.toLowerCase().trim();

    // Cek duplikasi email (case-insensitive)
    const existingUser = await this.userRepo.findOne({
      where: { email: normalizedEmail },
    });
    if (existingUser) throw new ConflictException('Email sudah terdaftar!');

    // Cek duplikasi nomor WA (semua format: 08xxx, 628xxx, +628xxx)
    const phoneVariants = [
      formattedPhone,
      '0' + formattedPhone.replace(/^62/, ''),
      '+' + formattedPhone,
    ];
    for (const variant of phoneVariants) {
      const existingPhone = await this.userRepo.findOne({
        where: { phone_number: variant },
      });
      if (existingPhone) {
        throw new ConflictException('Nomor WhatsApp sudah terdaftar!');
      }
    }

    const hashedPassword = await bcrypt.hash(dto.password, 10);
    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
    const otpExpires = new Date(Date.now() + 5 * 60 * 1000); // 5 menit

    const newUser = this.userRepo.create({
      full_name: dto.full_name,
      email: normalizedEmail,
      password: hashedPassword,
      phone_number: formattedPhone,
      birth_date: dto.birth_date ? new Date(dto.birth_date) : null,
      gender: dto.gender,
      // ── OTP sekarang via Email ──
      is_email_verified: false,
      email_otp: otpCode,
      email_otp_expires: otpExpires,
      // ── OTP via WhatsApp dinonaktifkan sementara ──
      // is_whatsapp_verified: false,
      // whatsapp_otp: otpCode,
      // whatsapp_otp_expires: otpExpires,
    });

    const savedUser = await this.userRepo.save(newUser);

    // Kirim OTP via Email (non-blocking agar registrasi tetap cepat)
    this.emailService.sendOtp(savedUser.email, otpCode).catch((err) =>
      this.logger.error('Gagal kirim register OTP via email', err),
    );
    // this.whatsappService
    //   .sendOtp(savedUser.phone_number, otpCode)
    //   .catch((err) =>
    //     this.whatsappService['logger'].error('Gagal kirim register OTP', err),
    //   );

    return {
      status: 'NEED_VERIFICATION',
      email: savedUser.email,
      message: 'Registrasi berhasil. Silakan verifikasi OTP Email Anda.',
    };
  }

  /**
   * Cari voucher NEW_USER yang aktif dan masih berlaku.
   * Return kode voucher pertama yang ditemukan, atau null jika tidak ada.
   */
  private async findActiveNewUserVoucherCode(): Promise<string | null> {
    const now = new Date();
    const voucher = await this.voucherRepo
      .createQueryBuilder('v')
      .where('v.type = :type', { type: VoucherType.NEW_USER })
      .andWhere('v.is_active = true')
      .andWhere('v.start_date <= :now', { now })
      .andWhere('v.end_date >= :now', { now })
      .andWhere('(v.max_usage = 0 OR v.current_usage < v.max_usage)')
      .orderBy('v.created_at', 'DESC')
      .getOne();
    return voucher?.code ?? null;
  }

  /**
   * Cari user berdasarkan nomor telepon dengan berbagai format.
   * Support: 08xxx, 628xxx, +628xxx, atau hanya digits.
   * Auto-fix nomor user lama ke format 628xxx.
   */
  private async findUserByPhone(phone: string): Promise<User | null> {
    let variants: string[] = [];

    // Bersihkan nomor dari karakter non-digit
    const digits = phone.replace(/\D/g, '');

    // Generate semua kemungkinan format
    if (digits.startsWith('62')) {
      variants.push(digits);                       // 62812...
      variants.push('0' + digits.substring(2));     // 0812...
      variants.push('+' + digits);                  // +62812...
    } else if (digits.startsWith('0')) {
      variants.push(digits);                       // 0812...
      variants.push('62' + digits.substring(1));    // 62812...
      variants.push('+62' + digits.substring(1));   // +62812...
    } else {
      variants.push(digits);                       // 812...
      variants.push('0' + digits);                  // 0812...
      variants.push('62' + digits);                 // 62812...
      variants.push('+62' + digits);                // +62812...
    }

    // Cari dengan LIKE untuk mencocokkan digits terakhir (jika exact match gagal)
    for (const v of variants) {
      let user = await this.userRepo.findOne({ where: { phone_number: v }, relations: ['addresses'] });
      if (user) {
        // Auto-fix ke format 628xxx
        const standardFormat = this.whatsappService.formatPhoneNumber(phone);
        if (user.phone_number !== standardFormat) {
          user.phone_number = standardFormat;
          await this.userRepo.save(user);
        }
        return user;
      }
    }

    // Fallback: LIKE search dengan 7 digit terakhir (untuk nomor yang sangat tidak konsisten)
    const last7 = digits.slice(-7);
    if (last7.length >= 7) {
      const users = await this.userRepo.find({ relations: ['addresses'] });
      const match = users.find(u => u.phone_number && u.phone_number.replace(/\D/g, '').endsWith(last7));
      if (match) {
        const standardFormat = this.whatsappService.formatPhoneNumber(phone);
        match.phone_number = standardFormat;
        await this.userRepo.save(match);
        return match;
      }
    }

    return null;
  }

  /**
   * Cari user berdasarkan email (case-insensitive).
   * OTP kini dikirim & diverifikasi via email.
   */
  private async findUserByEmail(email: string): Promise<User | null> {
    const normalized = email?.toLowerCase().trim();
    if (!normalized) return null;
    return this.userRepo.findOne({
      where: { email: normalized },
      relations: ['addresses'],
    });
  }

  // ================= LOGIN =================
  async login(email: string, pass: string) {
    const user = await this.userRepo.findOne({
      where: { email },
      relations: ['addresses'],
    });

    if (!user || !(await bcrypt.compare(pass, user.password))) {
      throw new UnauthorizedException('Email atau password salah');
    }
    if (!user.is_active)
      throw new UnauthorizedException('Akun Anda dinonaktifkan');

    // Cek verifikasi Email
    if (!user.is_email_verified) {
      const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
      const otpExpires = new Date(Date.now() + 5 * 60 * 1000); // 5 menit

      user.email_otp = otpCode;
      user.email_otp_expires = otpExpires;
      await this.userRepo.save(user);

      // Kirim OTP via Email (non-blocking)
      this.emailService.sendOtp(user.email, otpCode).catch((err) =>
        this.logger.error('Gagal kirim login OTP via email', err),
      );
      // this.whatsappService
      //   .sendOtp(user.phone_number, otpCode)
      //   .catch((err) =>
      //     this.whatsappService['logger'].error('Gagal kirim login OTP', err),
      //   );

      return {
        status: 'NEED_VERIFICATION',
        email: user.email,
        message: 'Email belum terverifikasi. OTP baru telah dikirim.',
      };
    }

    const payload = { sub: user.id, email: user.email, role: 'USER' };
    const accessToken = this.jwtService.sign(payload, { expiresIn: '1h' });
    const refreshToken = this.jwtService.sign(payload, { expiresIn: '7d' });
    const hashedRT = await bcrypt.hash(refreshToken, 10);

    await this.userRepo.update(user.id, { hashed_refresh_token: hashedRT });

    return {
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_in: 3600,
      user: {
        id: user.id,
        full_name: user.full_name,
        email: user.email,
        phone_number: user.phone_number,
        avatar_url: user.avatar_url,
        birth_date: user.birth_date,
        gender: user.gender,
        addresses: user.addresses,
      },
    };
  }

  // ================= VERIFY OTP =================
  async verifyOtp(email: string, otp: string) {
    if (!email || !otp) {
      throw new BadRequestException('Email dan OTP wajib diisi!');
    }

    const user = await this.findUserByEmail(email);

    if (!user) {
      throw new UnauthorizedException(
        'User dengan email tersebut tidak ditemukan!',
      );
    }

    if (!user.email_otp || user.email_otp !== otp) {
      throw new UnauthorizedException('Kode OTP salah!');
    }

    if (!user.email_otp_expires || user.email_otp_expires < new Date()) {
      throw new UnauthorizedException('Kode OTP sudah kadaluarsa!');
    }

    user.is_email_verified = true;
    user.email_otp = null;
    user.email_otp_expires = null;
    await this.userRepo.save(user);

    // Kirim Welcome Voucher (fire-and-forget)
    this.findActiveNewUserVoucherCode()
      .then((voucherCode) =>
        this.notificationService.sendWelcomeVoucherNotif(
          user.id,
          user.full_name,
          voucherCode,
        ),
      )
      .catch(() => {
        /* silent */
      });

    const payload = { sub: user.id, email: user.email, role: 'USER' };
    const accessToken = this.jwtService.sign(payload, { expiresIn: '1h' });
    const refreshToken = this.jwtService.sign(payload, { expiresIn: '7d' });
    const hashedRT = await bcrypt.hash(refreshToken, 10);

    await this.userRepo.update(user.id, { hashed_refresh_token: hashedRT });

    return {
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_in: 3600,
      user: {
        id: user.id,
        full_name: user.full_name,
        email: user.email,
        phone_number: user.phone_number,
        avatar_url: user.avatar_url,
        birth_date: user.birth_date,
        gender: user.gender,
        addresses: user.addresses || [],
      },
    };
  }

  // ================= RESEND OTP =================
  async resendOtp(email: string) {
    if (!email) {
      throw new BadRequestException('Email wajib diisi!');
    }

    const user = await this.findUserByEmail(email);
    if (!user) {
      throw new UnauthorizedException(
        'User dengan email tersebut tidak ditemukan!',
      );
    }

    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
    const otpExpires = new Date(Date.now() + 5 * 60 * 1000); // 5 menit

    user.email_otp = otpCode;
    user.email_otp_expires = otpExpires;
    await this.userRepo.save(user);

    const sent = await this.emailService.sendOtp(user.email, otpCode);
    if (!sent) {
      throw new BadRequestException(
        'Gagal mengirim Email OTP. Silakan coba lagi.',
      );
    }

    return {
      message: 'Kode OTP baru berhasil dikirim ke Email Anda.',
    };
  }

  // ================= GOOGLE LOGIN =================
  async googleLogin(token: string) {
    try {
      const response = await fetch(
        'https://www.googleapis.com/oauth2/v3/userinfo',
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      );

      if (!response.ok)
        throw new UnauthorizedException('Token Google tidak valid');
      const payload = await response.json();
      const { email, name, picture } = payload;

      let user = await this.userRepo.findOne({
        where: { email },
        relations: ['addresses'],
      });

      if (!user) {
        return {
          status: 'NEED_PHONE_NUMBER',
          email,
          name: name || 'Google User',
          picture,
        };
      }

      // If user exists but doesn't have a phone_number, ask them to provide one
      if (!user.phone_number) {
        return {
          status: 'NEED_PHONE_NUMBER',
          email: user.email,
          name: user.full_name,
          picture: user.avatar_url,
          phone_number: null,
        };
      }

      // If user has a phone_number but hasn't verified via OTP yet, ask them to verify
      if (!user.is_email_verified) {
        // Generate & send OTP
        const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
        const otpExpires = new Date(Date.now() + 5 * 60 * 1000);
        user.email_otp = otpCode;
        user.email_otp_expires = otpExpires;
        await this.userRepo.save(user);
        this.emailService.sendOtp(user.email, otpCode).catch((err) =>
          this.logger.error('Gagal kirim Google OTP via email', err),
        );
        // this.whatsappService
        //   .sendOtp(user.phone_number, otpCode)
        //   .catch((err) =>
        //     this.whatsappService['logger'].error('Gagal kirim Google OTP', err),
        //   );
        return {
          status: 'NEED_VERIFICATION',
          email: user.email,
          message: 'Akun Anda sudah terdaftar. Silakan verifikasi OTP via email.',
        };
      }
      // NEW: For users who registered via Email/Google and have a WA number but
      // haven't verified via OTP yet, ask them to verify. OTP dikirim via email.
      // This is handled by the !user.is_email_verified check above.

      if (!user.is_active)
        throw new UnauthorizedException('Akun Anda dinonaktifkan');

      const jwtPayload = { sub: user.id, email: user.email, role: 'USER' };
      const accessToken = this.jwtService.sign(jwtPayload, { expiresIn: '1h' });
      const refreshToken = this.jwtService.sign(jwtPayload, {
        expiresIn: '7d',
      });
      const hashedRT = await bcrypt.hash(refreshToken, 10);

      await this.userRepo.update(user.id, { hashed_refresh_token: hashedRT });

      return {
        access_token: accessToken,
        refresh_token: refreshToken,
        expires_in: 3600,
        user: {
          id: user.id,
          full_name: user.full_name,
          email: user.email,
          phone_number: user.phone_number,
          avatar_url: user.avatar_url,
          birth_date: user.birth_date,
          gender: user.gender,
          addresses: user.addresses || [],
        },
      };
    } catch (error) {
      if (error instanceof UnauthorizedException) throw error;
      throw new UnauthorizedException('Gagal autentikasi dengan Google');
    }
  }

  // ================= GOOGLE REGISTER PHONE =================
  async googleRegisterPhone(dto: GoogleRegisterPhoneDto) {
    const { token, phone_number, birth_date, gender, full_name } = dto;
    const formattedPhone = this.whatsappService.formatPhoneNumber(phone_number);

    try {
      const response = await fetch(
        'https://www.googleapis.com/oauth2/v3/userinfo',
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      );

      if (!response.ok)
        throw new UnauthorizedException('Token Google tidak valid');
      const payload = await response.json();
      const { email, name, picture } = payload;
      const normalizedEmail = email.toLowerCase().trim();

      let user = await this.userRepo.findOne({
        where: { email: normalizedEmail },
      });

      const existingPhone = await this.userRepo.findOne({
        where: { phone_number: formattedPhone },
      });
      if (existingPhone && (!user || existingPhone.id !== user.id)) {
        throw new ConflictException(
          'Nomor WhatsApp sudah digunakan oleh akun lain!',
        );
      }

      const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
      const otpExpires = new Date(Date.now() + 5 * 60 * 1000); // 5 menit

      if (!user) {
        // NEW USER: create account + send OTP
        const randomPassword = Math.random().toString(36).slice(-10);
        const hashedPassword = await bcrypt.hash(randomPassword, 10);

        user = this.userRepo.create({
          email: normalizedEmail,
          full_name: full_name || name || 'Google User',
          password: hashedPassword,
          avatar_url: picture,
          phone_number: formattedPhone,
          birth_date: birth_date ? new Date(birth_date) : null,
          gender: gender || null,
          is_email_verified: false,
          email_otp: otpCode,
          email_otp_expires: otpExpires,
          // is_whatsapp_verified: false,
          // whatsapp_otp: otpCode,
          // whatsapp_otp_expires: otpExpires,
        });

        await this.userRepo.save(user);

        // Kirim OTP via Email (non-blocking)
        this.emailService.sendOtp(normalizedEmail, otpCode).catch((err) =>
          this.logger.error('Gagal kirim google register OTP via email', err),
        );
        // this.whatsappService
        //   .sendOtp(formattedPhone, otpCode)
        //   .catch((err) =>
        //     this.whatsappService['logger'].error(
        //       'Gagal kirim google register OTP',
        //       err,
        //     ),
        //   );

        return {
          status: 'NEED_VERIFICATION',
          email: normalizedEmail,
          message: 'OTP berhasil dikirim ke Email Anda.',
        };
      }

      // EXISTING USER: update profile data only
      user.phone_number = formattedPhone;
      if (birth_date) user.birth_date = new Date(birth_date);
      if (gender) user.gender = gender;
      if (full_name) user.full_name = full_name;

      // CRITICAL FIX: If user has already verified email, jangan reset is_email_verified
      // dan jangan kirim OTP ulang. Langsung buat token dan login user.
      if (user.is_email_verified) {
        await this.userRepo.save(user);

        const jwtPayload = { sub: user.id, email: user.email, role: 'USER' };
        const accessToken = this.jwtService.sign(jwtPayload, {
          expiresIn: '1h',
        });
        const refreshToken = this.jwtService.sign(jwtPayload, {
          expiresIn: '7d',
        });
        const hashedRT = await bcrypt.hash(refreshToken, 10);
        await this.userRepo.update(user.id, { hashed_refresh_token: hashedRT });

        return {
          access_token: accessToken,
          refresh_token: refreshToken,
          expires_in: 3600,
          user: {
            id: user.id,
            full_name: user.full_name,
            email: normalizedEmail,
            phone_number: user.phone_number,
            avatar_url: user.avatar_url || picture,
            birth_date: user.birth_date,
            gender: user.gender,
            addresses: user.addresses || [],
          },
        };
      }

      // Existing user but NOT yet verified: send OTP for verification
      user.is_email_verified = false;
      user.email_otp = otpCode;
      user.email_otp_expires = otpExpires;
      await this.userRepo.save(user);

      // Kirim OTP via Email (non-blocking)
      this.emailService.sendOtp(normalizedEmail, otpCode).catch((err) =>
        this.logger.error('Gagal kirim google register OTP via email', err),
      );
      // this.whatsappService
      //   .sendOtp(formattedPhone, otpCode)
      //   .catch((err) =>
      //     this.whatsappService['logger'].error(
      //       'Gagal kirim google register OTP',
      //       err,
      //     ),
      //   );

      return {
        status: 'NEED_VERIFICATION',
        email: normalizedEmail,
        message: 'OTP berhasil dikirim ke Email Anda.',
      };
    } catch (error) {
      if (
        error instanceof ConflictException ||
        error instanceof UnauthorizedException ||
        error instanceof BadRequestException
      ) {
        throw error;
      }
      throw new UnauthorizedException(
        'Gagal memproses data Google & Nomor WhatsApp',
      );
    }
  }

  // ================= GET PROFILE =================
  async getProfile(userId: string) {
    try {
      const user = await this.userRepo.findOne({
        where: { id: userId },
        relations: ['addresses'],
      });

      if (!user) throw new UnauthorizedException('User tidak ditemukan');

      return {
        id: user.id,
        full_name: user.full_name,
        email: user.email,
        phone_number: user.phone_number,
        avatar_url: user.avatar_url,
        birth_date: user.birth_date,
        gender: user.gender,
        addresses: user.addresses || [],
      };
    } catch (error) {
      this.logger.error('Error Detail di Profile:', error);
      throw error;
    }
  }

  // ================= UPDATE PROFILE =================
  async updateProfile(userId: string, dto: any) {
    try {
      const user = await this.userRepo.findOne({ where: { id: userId } });
      if (!user) throw new UnauthorizedException('User tidak ditemukan');

      if (dto.full_name) user.full_name = dto.full_name;
      if (dto.phone_number !== undefined) user.phone_number = dto.phone_number;
      if (dto.avatar_url !== undefined) user.avatar_url = dto.avatar_url;
      if (dto.gender !== undefined) user.gender = dto.gender;
      if (dto.birth_date !== undefined) {
        user.birth_date = dto.birth_date === '' ? null : dto.birth_date;
      }

      await this.userRepo.save(user);

      return {
        id: user.id,
        full_name: user.full_name,
        email: user.email,
        phone_number: user.phone_number,
        avatar_url: user.avatar_url,
        birth_date: user.birth_date,
        gender: user.gender,
      };
    } catch (error) {
      this.logger.error('Gagal Update Profile:', error);
      throw error;
    }
  }

  // ================= UPDATE PHONE NUMBER (SEBELUM VERIFIKASI OTP) =================
  async updatePhone(current_phone: string, new_phone: string) {
    if (!current_phone || !new_phone) {
      throw new BadRequestException('Nomor lama dan nomor baru wajib diisi!');
    }

    const formattedNewPhone = this.whatsappService.formatPhoneNumber(new_phone);

    // Cari user berdasarkan nomor lama
    const user = await this.findUserByPhone(current_phone);
    if (!user) {
      throw new UnauthorizedException('Nomor WhatsApp lama tidak ditemukan!');
    }

    // Cek apakah nomor baru sudah dipakai akun lain (kecuali akun yang sama)
    const existingPhone = await this.userRepo.findOne({
      where: { phone_number: formattedNewPhone },
    });
    if (existingPhone && existingPhone.id !== user.id) {
      throw new ConflictException('Nomor WhatsApp sudah digunakan oleh akun lain!');
    }

    // Update nomor HP + reset OTP
    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
    const otpExpires = new Date(Date.now() + 5 * 60 * 1000);

    user.phone_number = formattedNewPhone;
    user.is_email_verified = false;
    user.email_otp = otpCode;
    user.email_otp_expires = otpExpires;
    // user.is_whatsapp_verified = false;
    // user.whatsapp_otp = otpCode;
    // user.whatsapp_otp_expires = otpExpires;
    await this.userRepo.save(user);

    // Kirim OTP ke email terdaftar (bukan ke nomor baru)
    this.emailService.sendOtp(user.email, otpCode).catch((err) =>
      this.logger.error('Gagal kirim update-phone OTP via email', err),
    );
    // this.whatsappService
    //   .sendOtp(formattedNewPhone, otpCode)
    //   .catch((err) =>
    //     this.whatsappService['logger'].error('Gagal kirim update-phone OTP', err),
    //   );

    return {
      status: 'NEED_VERIFICATION',
      email: user.email,
      message: 'Nomor WhatsApp berhasil diperbarui. Silakan verifikasi OTP via email.',
    };
  }

  // ================= ADDRESS MANAGEMENT =================

  async addAddress(userId: string, dto: any) {
    if (dto.is_default) {
      await this.addressRepo.update(
        { user: { id: userId } },
        { is_default: false },
      );
    }
    const newAddress = this.addressRepo.create({
      ...dto,
      user: { id: userId },
    });
    return await this.addressRepo.save(newAddress);
  }

  async getMyAddresses(userId: string) {
    return await this.addressRepo.find({
      where: { user: { id: userId } },
      order: { is_default: 'DESC', created_at: 'DESC' },
    });
  }

  async setDefaultAddress(userId: string, addressId: string) {
    await this.addressRepo.update(
      { user: { id: userId } },
      { is_default: false },
    );
    await this.addressRepo.update(
      { id: addressId, user: { id: userId } },
      { is_default: true },
    );
    return { message: 'Alamat utama berhasil diubah' };
  }

  async deleteAddress(userId: string, addressId: string) {
    await this.addressRepo.delete({ id: addressId, user: { id: userId } });
    return { message: 'Alamat berhasil dihapus' };
  }

  // ================= AUTH UTILS =================

  async logout(userId: string) {
    await this.userRepo.update(userId, { hashed_refresh_token: null });
    return { message: 'Berhasil logout' };
  }

  async refresh(refreshToken: string) {
    try {
      const payload = this.jwtService.verify(refreshToken);
      const user = await this.userRepo.findOne({ where: { id: payload.sub } });
      if (!user || !user.hashed_refresh_token)
        throw new UnauthorizedException();

      const isMatch = await bcrypt.compare(
        refreshToken,
        user.hashed_refresh_token,
      );
      if (!isMatch)
        throw new UnauthorizedException('Refresh token tidak valid');

      const newPayload = { sub: user.id, email: user.email, role: 'USER' };
      return {
        access_token: this.jwtService.sign(newPayload, { expiresIn: '1h' }),
        expires_in: 3600,
      };
    } catch (err) {
      throw new UnauthorizedException('Token tidak valid atau expired');
    }
  }

  async updateAvatar(userId: string, avatarUrl: string) {
    await this.userRepo.update(userId, { avatar_url: avatarUrl });
    return { message: 'Avatar berhasil diupdate', avatar_url: avatarUrl };
  }

  // ================= FORGOT PASSWORD VIA OTP EMAIL =================
  async forgotPasswordOtp(email: string) {
    if (!email) {
      throw new BadRequestException('Email wajib diisi!');
    }

    const user = await this.findUserByEmail(email);
    if (!user) {
      throw new UnauthorizedException(
        'Email tidak terdaftar!',
      );
    }

    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
    const otpExpires = new Date(Date.now() + 5 * 60 * 1000); // 5 menit

    user.email_otp = otpCode;
    user.email_otp_expires = otpExpires;
    await this.userRepo.save(user);

    const sent = await this.emailService.sendOtp(user.email, otpCode);
    if (!sent) {
      throw new BadRequestException(
        'Gagal mengirim OTP. Silakan coba lagi.',
      );
    }

    return {
      message: 'Kode OTP reset password berhasil dikirim ke Email Anda.',
      email: user.email,
    };
  }

  async verifyForgotPasswordOtp(email: string, otp: string, new_password: string) {
    if (!email || !otp || !new_password) {
      throw new BadRequestException('Email, OTP, dan password baru wajib diisi!');
    }

    if (new_password.length < 8) {
      throw new BadRequestException('Password minimal 8 karakter!');
    }

    const user = await this.findUserByEmail(email);
    if (!user) {
      throw new UnauthorizedException('User tidak ditemukan!');
    }

    if (!user.email_otp || user.email_otp !== otp) {
      throw new UnauthorizedException('Kode OTP salah!');
    }

    if (!user.email_otp_expires || user.email_otp_expires < new Date()) {
      throw new UnauthorizedException('Kode OTP sudah kadaluarsa!');
    }

    // Reset OTP fields
    user.email_otp = null;
    user.email_otp_expires = null;

    // Hash & update password baru
    const hashedPassword = await bcrypt.hash(new_password, 10);
    user.password = hashedPassword;

    // Hapus refresh token (force logout dari semua perangkat)
    user.hashed_refresh_token = null;

    await this.userRepo.save(user);

    return {
      message: 'Password berhasil direset. Silakan login dengan password baru.',
    };
  }

  // ================= PASSWORD MANAGEMENT =================

  async changePassword(userId: string, dto: any) {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('User tidak ditemukan');

    const isMatch = await bcrypt.compare(dto.old_password, user.password);
    if (!isMatch) throw new UnauthorizedException('Password lama Anda salah');

    const hashedPassword = await bcrypt.hash(dto.new_password, 10);
    await this.userRepo.update(userId, { password: hashedPassword });

    return { message: 'Password berhasil diperbarui' };
  }

  async forgotPassword(email: string) {
    const user = await this.userRepo.findOne({ where: { email } });
    if (!user) throw new UnauthorizedException('Email tidak terdaftar!');

    const token = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 3600000); // 1 Jam

    await this.userRepo.update(user.id, {
      reset_token: token,
      reset_token_expires: expires,
    });

    const frontendUrl = process.env.FRONTEND_URL;
    const resetLink = `${frontendUrl}/reset-password?token=${token}`;

    await this.emailService.send({
      to: email,
      subject: 'Reset Password Akun Anandam',
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
          <h2 style="color: #2563eb;">Halo, ${user.full_name}!</h2>
          <p>Kami menerima permintaan reset password untuk akun Anda di Anandam Computer.</p>
          <p>Klik tombol di bawah ini untuk mengatur ulang password Anda:</p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${resetLink}" style="background: #2563eb; color: white; padding: 12px 25px; border-radius: 8px; text-decoration: none; font-weight: bold; display: inline-block;">Reset Password</a>
          </div>
          <p style="color: #666; font-size: 14px;">Link ini akan kadaluarsa dalam 1 jam.</p>
          <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;" />
          <p style="color: #999; font-size: 12px;">Jika Anda tidak merasa melakukan permintaan ini, silakan abaikan email ini.</p>
        </div>
      `,
    });

    return { message: 'Link reset password sudah dikirim ke email.' };
  }

  async resetPassword(token: string, newPass: string) {
    // 1. Cari user berdasarkan token
    const user = await this.userRepo.findOne({
      where: { reset_token: token },
    });

    // 2. Validasi
    if (
      !user ||
      !user.reset_token_expires ||
      user.reset_token_expires < new Date()
    ) {
      throw new UnauthorizedException(
        'Token tidak valid atau sudah kadaluarsa',
      );
    }

    // 3. Hash password baru
    const hashedPassword = await bcrypt.hash(newPass, 10);

    // 🔥 4. PERBAIKAN: Gunakan .save() agar datanya pasti tersimpan ke database
    user.password = hashedPassword;
    user.reset_token = null;
    user.reset_token_expires = null;

    await this.userRepo.save(user);

    return { message: 'Password berhasil diperbarui, silakan login kembali.' };
  }

  async getAllUsers(query: any) {
    const page = parseInt(query.page) || 1;
    const limit = parseInt(query.limit) || 20;
    const search = query.search || '';
    const skip = (page - 1) * limit;

    const qb = this.userRepo
      .createQueryBuilder('user')
      .leftJoinAndSelect('user.addresses', 'addresses')
      .orderBy('user.created_at', 'DESC')
      .skip(skip)
      .take(limit);

    if (search) {
      qb.where(
        'user.full_name ILIKE :search OR user.email ILIKE :search OR user.phone_number ILIKE :search',
        { search: `%${search}%` },
      );
    }

    const [data, total] = await qb.getManyAndCount();

    const sanitized = data.map(
      ({
        password,
        hashed_refresh_token,
        reset_token,
        reset_token_expires,
        ...u
      }) => u,
    );

    return {
      data: sanitized,
      total,
      page,
      last_page: Math.ceil(total / limit),
    };
  }

  async getUserById(id: string) {
    const user = await this.userRepo.findOne({
      where: { id },
      relations: ['addresses'],
    });
    if (!user) throw new UnauthorizedException('User tidak ditemukan');

    const {
      password,
      hashed_refresh_token,
      reset_token,
      reset_token_expires,
      ...result
    } = user;
    return result;
  }

  async toggleUserActive(id: string) {
    const user = await this.userRepo.findOne({ where: { id } });
    if (!user) throw new UnauthorizedException('User tidak ditemukan');

    user.is_active = !user.is_active;
    await this.userRepo.save(user);

    return {
      message: `User berhasil di${user.is_active ? 'aktifkan' : 'nonaktifkan'}`,
      is_active: user.is_active,
    };
  }
}

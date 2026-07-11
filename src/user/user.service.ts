import { Injectable, ConflictException, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './entities/user.entity';
import { UserAddress } from './entities/user-address.entity'; 
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { OAuth2Client } from 'google-auth-library';
import { Resend } from 'resend';
import * as crypto from 'crypto';
import { NotificationService } from '../notification/notification.service';
import { Voucher, VoucherType } from '../voucher/entities/voucher.entity';

@Injectable()
export class UserService {
  private googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID); 
  private resend = new Resend(process.env.RESEND_API_KEY);

  constructor(
    @InjectRepository(User)
    private userRepo: Repository<User>,
    @InjectRepository(UserAddress) 
    private addressRepo: Repository<UserAddress>, 
    @InjectRepository(Voucher)
    private voucherRepo: Repository<Voucher>,
    private jwtService: JwtService,
    private readonly notificationService: NotificationService,
  ) {}

  // ================= REGISTER =================
  async register(dto: any) {
    const existingUser = await this.userRepo.findOne({ where: { email: dto.email } });
    if (existingUser) throw new ConflictException('Email sudah terdaftar!');

    const hashedPassword = await bcrypt.hash(dto.password, 10);
    const newUser = this.userRepo.create({
      full_name: dto.full_name,
      email: dto.email,
      password: hashedPassword,
      phone_number: dto.phone_number,
      birth_date: dto.birth_date,
      gender: dto.gender,
    });

    const savedUser = await this.userRepo.save(newUser);
    const { password, ...result } = savedUser;

    // Send welcome notification (fire-and-forget — never blocks registration)
    this.findActiveNewUserVoucherCode()
      .then((voucherCode) =>
        this.notificationService.sendWelcomeVoucherNotif(savedUser.id, savedUser.full_name, voucherCode),
      )
      .catch(() => {/* silent — notif failure must not affect registration */});

    return result;
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

  // ================= LOGIN =================
  async login(email: string, pass: string) {
    const user = await this.userRepo.findOne({ 
      where: { email },
      relations: ['addresses'] 
    });

    if (!user || !(await bcrypt.compare(pass, user.password))) {
      throw new UnauthorizedException('Email atau password salah');
    }
    if (!user.is_active) throw new UnauthorizedException('Akun Anda dinonaktifkan');

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

  // ================= GOOGLE LOGIN =================
  async googleLogin(token: string) {
    try {
      const response = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) throw new UnauthorizedException('Token Google tidak valid');
      const payload = await response.json();
      const { email, name, picture } = payload;

      let user = await this.userRepo.findOne({ 
        where: { email },
        relations: ['addresses'] 
      });

      if (!user) {
        const randomPassword = Math.random().toString(36).slice(-10);
        const hashedPassword = await bcrypt.hash(randomPassword, 10);

        const newUser = this.userRepo.create({
          email: email,
          full_name: name || 'Google User',
          password: hashedPassword,
          avatar_url: picture,
        });
        user = await this.userRepo.save(newUser);

        // Notif: welcome voucher untuk pendaftar baru via Google
        this.findActiveNewUserVoucherCode()
          .then((voucherCode) =>
            this.notificationService.sendWelcomeVoucherNotif(user!.id, user!.full_name, voucherCode),
          )
          .catch(() => {/* silent */});

      } else if (!user.avatar_url && picture) {
        user.avatar_url = picture;
        await this.userRepo.save(user);
      }

      if (!user.is_active) throw new UnauthorizedException('Akun Anda dinonaktifkan');

      const jwtPayload = { sub: user.id, email: user.email, role: 'USER' };
      const accessToken = this.jwtService.sign(jwtPayload, { expiresIn: '1h' });
      const refreshToken = this.jwtService.sign(jwtPayload, { expiresIn: '7d' });
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
      throw new UnauthorizedException('Gagal autentikasi dengan Google');
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
      console.error("Error Detail di Profile:", error);
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
        user.birth_date = dto.birth_date === "" ? null : dto.birth_date;
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
      console.error("Gagal Update Profile:", error);
      throw error;
    }
  }

  // ================= ADDRESS MANAGEMENT =================
  
  async addAddress(userId: string, dto: any) {
    if (dto.is_default) {
      await this.addressRepo.update({ user: { id: userId } }, { is_default: false });
    }
    const newAddress = this.addressRepo.create({
      ...dto,
      user: { id: userId }
    });
    return await this.addressRepo.save(newAddress);
  }

  async getMyAddresses(userId: string) {
    return await this.addressRepo.find({
      where: { user: { id: userId } },
      order: { is_default: 'DESC', created_at: 'DESC' }
    });
  }

  async setDefaultAddress(userId: string, addressId: string) {
    await this.addressRepo.update({ user: { id: userId } }, { is_default: false });
    await this.addressRepo.update({ id: addressId, user: { id: userId } }, { is_default: true });
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
      if (!user || !user.hashed_refresh_token) throw new UnauthorizedException();
      
      const isMatch = await bcrypt.compare(refreshToken, user.hashed_refresh_token);
      if (!isMatch) throw new UnauthorizedException('Refresh token tidak valid');

      const newPayload = { sub: user.id, email: user.email, role: 'USER' };
      return { access_token: this.jwtService.sign(newPayload, { expiresIn: '1h' }), expires_in: 3600 };
    } catch (err) {
      throw new UnauthorizedException('Token tidak valid atau expired');
    }
  }

  async updateAvatar(userId: string, avatarUrl: string) {
    await this.userRepo.update(userId, { avatar_url: avatarUrl });
    return { message: 'Avatar berhasil diupdate', avatar_url: avatarUrl };
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
      reset_token_expires: expires
    });

    const frontendUrl = process.env.FRONTEND_URL;
    const resetLink = `${frontendUrl}/reset-password?token=${token}`;
    
    await this.resend.emails.send({
      from: 'Anandam Computer <no-reply@anandam.id>',
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
      `
    });

    return { message: 'Link reset password sudah dikirim ke email.' };
  }

  async resetPassword(token: string, newPass: string) {
    // 1. Cari user berdasarkan token
    const user = await this.userRepo.findOne({ 
      where: { reset_token: token } 
    });

    // 2. Validasi
    if (!user || !user.reset_token_expires || user.reset_token_expires < new Date()) {
      throw new UnauthorizedException('Token tidak valid atau sudah kadaluarsa');
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

      const qb = this.userRepo.createQueryBuilder('user')
          .leftJoinAndSelect('user.addresses', 'addresses')
          .orderBy('user.created_at', 'DESC')
          .skip(skip)
          .take(limit);

      if (search) {
          qb.where(
              'user.full_name ILIKE :search OR user.email ILIKE :search OR user.phone_number ILIKE :search',
              { search: `%${search}%` }
          );
      }

      const [data, total] = await qb.getManyAndCount();

      const sanitized = data.map(({ 
          password, hashed_refresh_token, reset_token, reset_token_expires, ...u 
      }) => u);

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

      const { password, hashed_refresh_token, reset_token, reset_token_expires, ...result } = user;
      return result;
  }

  async toggleUserActive(id: string) {
      const user = await this.userRepo.findOne({ where: { id } });
      if (!user) throw new UnauthorizedException('User tidak ditemukan');

      user.is_active = !user.is_active;
      await this.userRepo.save(user);

      return { 
          message: `User berhasil di${user.is_active ? 'aktifkan' : 'nonaktifkan'}`,
          is_active: user.is_active 
      };
  }
}


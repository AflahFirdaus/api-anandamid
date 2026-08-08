import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Admin } from './admin.entity/admin.entity';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';

@Injectable()
export class AdminService implements OnModuleInit {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    @InjectRepository(Admin)
    private repo: Repository<Admin>,
  ) {}

  async findByUsername(username: string): Promise<Admin | null> {
    return this.repo.findOne({ where: { username } });
  }

  // 1. Tambahkan Method untuk simpan hash Refresh Token
  async updateRefreshToken(id: string, hashedRT: string | null) {
    try {
      await this.repo.update(id, {
        hashed_refresh_token: hashedRT,
      });
    } catch (err) {
      this.logger.error('Gagal update refresh token di database:', err);
    }
  }

  async findByIdWithRT(id: string): Promise<Admin | null> {
    return this.repo.findOne({
      where: { id },
      select: ['id', 'username', 'password', 'hashed_refresh_token'],
    });
  }

  // AUTO SEED — hanya berjalan jika diset eksplisit ADMIN_SEED_ENABLED=true.
  // Ini mencegah akun admin tersembunyi terbentuk di produksi tanpa disengaja,
  // meskipun ADMIN_SEED_PASSWORD masih terisi di .env.
  async onModuleInit() {
    const seedEnabled = process.env.ADMIN_SEED_ENABLED === 'true';

    if (!seedEnabled) {
      this.logger.log(
        'Auto-seed admin dinonaktifkan (ADMIN_SEED_ENABLED != true).',
      );
      return;
    }

    const username = process.env.ADMIN_SEED_USERNAME || 'admin';
    const password = process.env.ADMIN_SEED_PASSWORD;

    if (!password) {
      this.logger.warn(
        'ADMIN_SEED_PASSWORD belum diset di .env — auto-seed admin dilewati.',
      );
      return;
    }

    const existingAdmin = await this.findByUsername(username);

    if (!existingAdmin) {
      const hash = await bcrypt.hash(password, 10);

      await this.repo.save({
        username,
        password: hash,
      });

      this.logger.log(
        `Admin default "${username}" berhasil di-seed.`,
      );
    }
  }
}

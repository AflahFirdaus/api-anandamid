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
    await this.repo.update(id, {
      hashed_refresh_token: hashedRT,
    });
  }

  async findByIdWithRT(id: string): Promise<Admin | null> {
    return this.repo.findOne({
      where: { id },
      select: ['id', 'username', 'password', 'hashed_refresh_token'],
    });
  }

  // AUTO SEED
  async onModuleInit() {
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

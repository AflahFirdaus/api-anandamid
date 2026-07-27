import { ConfigService } from '@nestjs/config';
import { TypeOrmModuleOptions } from '@nestjs/typeorm';

export const TypeOrmConfig = (
  configService: ConfigService,
): TypeOrmModuleOptions => ({
  type: 'postgres',
  host: configService.get<string>('DB_HOST'),
  port: configService.get<number>('DB_PORT'),
  username: configService.get<string>('DB_USER'),
  password: configService.get<string>('DB_PASSWORD'),
  database: configService.get<string>('DB_NAME'),
  autoLoadEntities: true,
  synchronize: false,
  // ⚡ Connection pool untuk production traffic
  extra: {
    max: parseInt(configService.get<string>('DB_POOL_MAX') || '20', 10),
    idleTimeoutMillis: parseInt(
      configService.get<string>('DB_POOL_IDLE_TIMEOUT') || '30000',
      10,
    ),
    connectionTimeoutMillis: parseInt(
      configService.get<string>('DB_POOL_CONNECT_TIMEOUT') || '5000',
      10,
    ),
  },
});

import { NestFactory, Reflector } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe, ClassSerializerInterceptor } from '@nestjs/common';
import { WinstonLogger } from './common/winston-logger';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { ThrottlerExceptionFilter } from './common/filters/throttler-exception.filter';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import compression from 'compression';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: new WinstonLogger(),
  });
  const isProduction = process.env.NODE_ENV === 'production';

  // ⚡ Graceful shutdown — tutup koneksi dengan aman saat SIGTERM/SIGINT
  app.enableShutdownHooks();

  // 🔒 Helmet — HTTP security headers
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );

  // ⚡ Gzip compression — perkecil response size (JSON, HTML, etc)
  app.use(compression());

  // Cookie parser
  app.use(cookieParser());

  // CORS
  const allowedOrigins = [
    'http://localhost:5173',
    'http://localhost:5174',
    'http://localhost:5175',
    'http://192.168.1.178:5173',
    'http://192.168.1.178:5174',
    'https://staging.anandam.id',
    'https://admin.anandam.id',
    'https://admin-staging.anandam.id',
    'https://anandam.id',
    'https://fe-ecommerce-anandam-id.pages.dev',
  ];

  app.enableCors({
    origin: (origin, callback) => {
      if (
        !origin ||
        allowedOrigins.includes(origin) ||
        origin.endsWith('.anandam.id') ||
        origin.endsWith('.anandamcomputer.com')
      ) {
        callback(null, true);
      } else {
        callback(null, true); // Fallback allow for development flexibility
      }
    },
    credentials: true,
  });

  app.setGlobalPrefix('api/v1');

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  app.useGlobalInterceptors(new ClassSerializerInterceptor(app.get(Reflector)));
  app.useGlobalFilters(new AllExceptionsFilter(), new ThrottlerExceptionFilter());

  // Static files (uploads)
  app.useStaticAssets(join(process.cwd(), 'uploads'), {
    prefix: '/uploads/',
  });

  // Swagger — hanya aktif di non-production
  if (!isProduction) {
    const config = new DocumentBuilder()
      .setTitle('AnandamID API')
      .setDescription('API documentation for AnandamID e-commerce backend')
      .setVersion('1.0')
      .addBearerAuth(
        {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          name: 'JWT',
          description: 'Enter JWT token',
          in: 'header',
        },
        'JWT-auth',
      )
      .addServer('http://localhost:3030/api/v1', 'Local')
      .addServer('https://staging.anandam.id/api/v1', 'Staging')
      .addServer('https://anandam.id/api/v1', 'Production')
      .build();

    const doc = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, doc);
  }

  await app.listen(3030);
}
bootstrap();

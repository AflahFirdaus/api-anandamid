import { LoggerService } from '@nestjs/common';
import * as winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';

const isProduction = process.env.NODE_ENV === 'production';

const transports: winston.transport[] = [
  // Console output (always)
  new winston.transports.Console({
    format: winston.format.combine(
      winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
      winston.format.colorize(),
      winston.format.printf(({ timestamp, level, message, context, trace }) => {
        return `${timestamp} [${context || 'App'}] ${level}: ${message}${trace ? `\n${trace}` : ''}`;
      }),
    ),
  }),
];

// File logging — hanya di production
if (isProduction) {
  transports.push(
    new DailyRotateFile({
      filename: 'logs/application-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxFiles: '30d',
      maxSize: '20m',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json(),
      ),
    }),
    new DailyRotateFile({
      filename: 'logs/error-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxFiles: '30d',
      maxSize: '20m',
      level: 'error',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json(),
      ),
    }),
  );
}

const winstonLogger = winston.createLogger({
  level: isProduction ? 'info' : 'debug',
  transports,
});

export class WinstonLogger implements LoggerService {
  log(message: string, context?: string) {
    winstonLogger.info(message, { context });
  }
  error(message: string, trace?: string, context?: string) {
    winstonLogger.error(message, { context, trace });
  }
  warn(message: string, context?: string) {
    winstonLogger.warn(message, { context });
  }
  debug(message: string, context?: string) {
    winstonLogger.debug(message, { context });
  }
  verbose(message: string, context?: string) {
    winstonLogger.verbose(message, { context });
  }
}
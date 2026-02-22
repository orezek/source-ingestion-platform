import pino, { type LevelWithSilent, type Logger } from 'pino';

export type AppLogger = Logger;

export type AppLogLevel = LevelWithSilent;

type CreateLoggerOptions = {
  pretty?: boolean;
};

export const createLogger = (level: AppLogLevel, options?: CreateLoggerOptions): AppLogger =>
  pino({
    level,
    timestamp: pino.stdTimeFunctions.isoTime,
    base: {
      service: 'job-ingestion-service',
    },
    transport:
      options?.pretty && process.stdout.isTTY
        ? {
            target: 'pino-pretty',
            options: {
              colorize: true,
              translateTime: 'SYS:standard',
              ignore: 'pid,hostname',
              singleLine: false,
            },
          }
        : undefined,
  });

import pino, { type LevelWithSilent, type Logger } from 'pino';

export type AppLogger = Logger;

export type AppLogLevel = LevelWithSilent;

export const createLogger = (level: AppLogLevel): AppLogger =>
  pino({
    level,
    timestamp: pino.stdTimeFunctions.isoTime,
    base: {
      service: 'job-ingestion-service',
    },
  });

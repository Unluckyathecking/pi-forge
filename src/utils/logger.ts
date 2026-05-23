/**
 * Simple structured logger
 *
 * Outputs JSON lines for machine parsing.
 * Respects LOG_LEVEL environment variable.
 */

export interface Logger {
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
  debug(message: string, meta?: Record<string, unknown>): void;
}

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

function parseLogLevel(level: string | undefined): number {
  if (level === undefined || level === '') return LEVELS.info;
  const normalized = level.toLowerCase().trim() as LogLevel;
  return LEVELS[normalized] ?? LEVELS.info;
}

export function createLogger(name: string): Logger {
  const currentLevel = parseLogLevel(process.env.LOG_LEVEL);

  function log(
    level: LogLevel,
    message: string,
    meta?: Record<string, unknown>
  ): void {
    if (LEVELS[level] < currentLevel) return;
    const entry: Record<string, unknown> = {
      time: new Date().toISOString(),
      name,
      level,
      message,
    };
    if (meta && Object.keys(meta).length > 0) {
      Object.assign(entry, meta);
    }
    const line = JSON.stringify(entry);
    if (level === 'error') {
      console.error(line);
    } else {
      console.log(line);
    }
  }

  return {
    info: (message: string, meta?: Record<string, unknown>): void =>
      log('info', message, meta),
    warn: (message: string, meta?: Record<string, unknown>): void =>
      log('warn', message, meta),
    error: (message: string, meta?: Record<string, unknown>): void =>
      log('error', message, meta),
    debug: (message: string, meta?: Record<string, unknown>): void =>
      log('debug', message, meta),
  };
}

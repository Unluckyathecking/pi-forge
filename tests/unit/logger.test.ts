import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { createLogger } from '../../src/utils/logger.js';

describe('Logger', () => {
  let stdout: jest.SpiedFunction<typeof process.stdout.write>;
  let stderr: jest.SpiedFunction<typeof process.stderr.write>;
  let logSpy: jest.SpiedFunction<typeof console.log>;
  let errorSpy: jest.SpiedFunction<typeof console.error>;
  const originalLevel = process.env.LOG_LEVEL;

  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    stdout = jest.spyOn(process.stdout, 'write').mockReturnValue(true);
    stderr = jest.spyOn(process.stderr, 'write').mockReturnValue(true);
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    stdout.mockRestore();
    stderr.mockRestore();
    if (originalLevel === undefined) {
      delete process.env.LOG_LEVEL;
    } else {
      process.env.LOG_LEVEL = originalLevel;
    }
  });

  it('emits structured JSON for each log level', () => {
    delete process.env.LOG_LEVEL;
    const logger = createLogger('test');

    logger.info('hello', { key: 'value' });

    expect(logSpy).toHaveBeenCalledTimes(1);
    const line = String(logSpy.mock.calls[0][0]);
    const parsed = JSON.parse(line) as Record<string, unknown>;
    expect(parsed.name).toBe('test');
    expect(parsed.level).toBe('info');
    expect(parsed.message).toBe('hello');
    expect(parsed.key).toBe('value');
    expect(typeof parsed.time).toBe('string');
  });

  it('routes error logs to console.error', () => {
    delete process.env.LOG_LEVEL;
    const logger = createLogger('test');

    logger.error('boom', { cause: 'fire' });

    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(logSpy).not.toHaveBeenCalled();
    const parsed = JSON.parse(String(errorSpy.mock.calls[0][0])) as Record<string, unknown>;
    expect(parsed.level).toBe('error');
    expect(parsed.cause).toBe('fire');
  });

  it('suppresses debug below threshold and emits when LOG_LEVEL=debug', () => {
    process.env.LOG_LEVEL = 'info';
    let logger = createLogger('test');
    logger.debug('hidden');
    expect(logSpy).not.toHaveBeenCalled();

    process.env.LOG_LEVEL = 'debug';
    logger = createLogger('test');
    logger.debug('shown');
    expect(logSpy).toHaveBeenCalledTimes(1);
  });

  it('treats unknown LOG_LEVEL as info default', () => {
    process.env.LOG_LEVEL = 'bogus';
    const logger = createLogger('test');
    logger.warn('w');
    logger.debug('hidden');
    expect(logSpy).toHaveBeenCalledTimes(1);
  });

  it('omits the meta object when empty', () => {
    delete process.env.LOG_LEVEL;
    const logger = createLogger('test');
    logger.info('plain');
    const parsed = JSON.parse(String(logSpy.mock.calls[0][0])) as Record<string, unknown>;
    expect(parsed).not.toHaveProperty('key');
  });
});

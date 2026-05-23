import { describe, it, expect } from '@jest/globals';
import {
  ForgeError,
  ConfigError,
  GitError,
  GateError,
  ValidationError,
  OrchestratorError,
} from '../../src/core/errors.js';

describe('errors', () => {
  it('ForgeError has code and context', () => {
    const err = new ForgeError('msg', 'CODE', { key: 'val' });
    expect(err.message).toBe('msg');
    expect(err.code).toBe('CODE');
    expect(err.context).toEqual({ key: 'val' });
  });

  it('ConfigError sets correct code', () => {
    const err = new ConfigError('bad config');
    expect(err.code).toBe('CONFIG_ERROR');
  });

  it('GitError sets correct code', () => {
    const err = new GitError('git failed');
    expect(err.code).toBe('GIT_ERROR');
  });

  it('GateError captures gate and exit code', () => {
    const err = new GateError('test failed', 'test', 1, 'output');
    expect(err.gate).toBe('test');
    expect(err.exitCode).toBe(1);
    expect(err.output).toBe('output');
  });

  it('ValidationError carries issues', () => {
    const err = new ValidationError('invalid', ['a', 'b']);
    expect(err.issues).toEqual(['a', 'b']);
  });

  it('OrchestratorError accepts custom code', () => {
    const err = new OrchestratorError('fail', 'CUSTOM_CODE');
    expect(err.code).toBe('CUSTOM_CODE');
  });
});

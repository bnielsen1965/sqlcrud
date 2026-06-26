import { describe, it, expect } from 'vitest';
import Constants from '../lib/constants.js';

describe('Constants', () => {
  it('should define SchemaTable', () => {
    expect(Constants.SchemaTable).toBe('schemas');
  });

  it('should define APIKeysTable', () => {
    expect(Constants.APIKeysTable).toBe('apikeys');
  });

  describe('SchemaTypes', () => {
    it('should map string to TEXT', () => {
      expect(Constants.SchemaTypes['string']).toBe('TEXT');
    });

    it('should map integer to INTEGER', () => {
      expect(Constants.SchemaTypes['integer']).toBe('INTEGER');
    });

    it('should map float to REAL', () => {
      expect(Constants.SchemaTypes['float']).toBe('REAL');
    });

    it('should map boolean to INTEGER', () => {
      expect(Constants.SchemaTypes['boolean']).toBe('INTEGER');
    });

    it('should map time to TEXT', () => {
      expect(Constants.SchemaTypes['time']).toBe('TEXT');
    });

    it('should map datetime to TEXT', () => {
      expect(Constants.SchemaTypes['datetime']).toBe('TEXT');
    });

    it('should map json to TEXT', () => {
      expect(Constants.SchemaTypes['json']).toBe('TEXT');
    });

    it('should return undefined for unknown types', () => {
      expect(Constants.SchemaTypes['unknown']).toBeUndefined();
    });
  });
});

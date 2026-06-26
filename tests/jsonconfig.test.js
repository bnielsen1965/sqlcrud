import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import FS from 'fs';
import path from 'path';
import JSONConfig from '../lib/jsonconfig.js';

const TEST_DIR = path.join(process.cwd(), 'tests', '__fixtures__');

describe('JSONConfig', () => {
  const validConfigPath = path.join(TEST_DIR, 'valid-config.json');
  const invalidConfigPath = path.join(TEST_DIR, 'invalid-config.json');
  const missingConfigPath = path.join(TEST_DIR, 'does-not-exist.json');

  beforeEach(() => {
    // Create test fixtures directory
    if (!FS.existsSync(TEST_DIR)) {
      FS.mkdirSync(TEST_DIR, { recursive: true });
    }

    // Create valid config file
    FS.writeFileSync(validConfigPath, JSON.stringify({
      debug: true,
      WebServer: { port: 3000 },
      Database: { filename: 'test.db' }
    }));

    // Create invalid JSON config file
    FS.writeFileSync(invalidConfigPath, '{ "key": "value", }');
  });

  afterEach(() => {
    // Clean up test fixtures
    if (FS.existsSync(TEST_DIR)) {
      FS.rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  describe('readConfig', () => {
    it('should read and parse a valid JSON config file', () => {
      const config = JSONConfig.readConfig(validConfigPath);
      expect(config).toEqual({
        debug: true,
        WebServer: { port: 3000 },
        Database: { filename: 'test.db' }
      });
    });

    it('should throw an error for a non-existent file', () => {
      expect(() => JSONConfig.readConfig(missingConfigPath)).toThrow(
        /Error reading configuration file/
      );
    });

    it('should throw an error for invalid JSON', () => {
      expect(() => JSONConfig.readConfig(invalidConfigPath)).toThrow(
        /Error parsing JSON/
      );
    });

    it('should include position info for JSON syntax errors', () => {
      expect(() => JSONConfig.readConfig(invalidConfigPath)).toThrow(
        /JSON syntax error/
      );
    });
  });

  describe('merge', () => {
    it('should merge two flat objects', () => {
      const o1 = { a: 1, b: 2 };
      const o2 = { b: 3, c: 4 };
      const result = JSONConfig.merge(o1, o2);
      expect(result).toEqual({ a: 1, b: 3, c: 4 });
    });

    it('should not modify the first object', () => {
      const o1 = { a: 1 };
      const o2 = { b: 2 };
      JSONConfig.merge(o1, o2);
      expect(o1).toEqual({ a: 1 });
    });

    it('should handle empty objects', () => {
      expect(JSONConfig.merge({}, { a: 1 })).toEqual({ a: 1 });
      expect(JSONConfig.merge({ a: 1 }, {})).toEqual({ a: 1 });
      expect(JSONConfig.merge({}, {})).toEqual({});
    });

    it('should override with second object values', () => {
      const o1 = { a: 'original' };
      const o2 = { a: 'override' };
      const result = JSONConfig.merge(o1, o2);
      expect(result.a).toBe('override');
    });

    it('should only copy own properties', () => {
      function Proto() {}
      Proto.prototype.inherited = true;
      const o1 = {};
      const o2 = new Proto();
      o2.own = 'value';
      const result = JSONConfig.merge(o1, o2);
      expect(result).toEqual({ own: 'value' });
      expect(result.inherited).toBeUndefined();
    });
  });
});

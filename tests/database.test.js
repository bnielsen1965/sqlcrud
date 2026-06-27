import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import FS from 'fs';
import path from 'path';
import Database from '../lib/database.js';

const TEST_DB_FILE = path.join(process.cwd(), 'tests', '__testdb__', 'database-test.db');

describe('Database', () => {
  let db;
  let started = false;

  function createFreshDb() {
    const dir = path.dirname(TEST_DB_FILE);
    if (!FS.existsSync(dir)) {
      FS.mkdirSync(dir, { recursive: true });
    }
    if (FS.existsSync(TEST_DB_FILE)) {
      FS.unlinkSync(TEST_DB_FILE);
    }
    db = new Database({ filename: TEST_DB_FILE });
    db.start();
    started = true;
  }

  function cleanup() {
    if (started && db && db.database) {
      try { db.stop(); } catch { /* already closed */ }
    }
    started = false;
    if (FS.existsSync(TEST_DB_FILE)) {
      FS.unlinkSync(TEST_DB_FILE);
    }
  }

  beforeEach(() => {
    createFreshDb();
  });

  afterEach(() => {
    cleanup();
  });

  describe('constructor and config', () => {
    it('should use default filename when none provided', () => {
      const defaultDb = new Database({});
      expect(defaultDb.Config.filename).toBe('default.db');
    });

    it('should use provided filename', () => {
      const customDb = new Database({ filename: 'custom.db' });
      expect(customDb.Config.filename).toBe('custom.db');
    });
  });

  describe('start/stop', () => {
    beforeEach(() => {
      // Reset - db was already started by top-level beforeEach
      started = false;
    });

    it('should stop without error after start', () => {
      expect(() => db.stop()).not.toThrow();
      started = false;
    });

    it('should have an open database after start', () => {
      // exec should work after start
      expect(() => db.exec('CREATE TABLE IF NOT EXISTS test (id INTEGER)')).not.toThrow();
      db.stop();
      started = false;
    });
  });

  describe('getTableList', () => {
    it('should return empty list for new database', () => {
      const tables = db.getTableList();
      expect(tables).toEqual([]);
    });

    it('should list created tables', () => {
      db.exec('CREATE TABLE test_table (id INTEGER PRIMARY KEY)');
      const tables = db.getTableList();
      expect(tables).toContain('test_table');
    });

    it('should exclude sqlite internal tables', () => {
      db.exec('CREATE TABLE test_table (id INTEGER PRIMARY KEY)');
      const tables = db.getTableList();
      for (const table of tables) {
        expect(table.startsWith('sqlite_')).toBe(false);
      }
    });
  });

  describe('exec', () => {
    it('should execute SQL statements', () => {
      expect(() => db.exec('CREATE TABLE test (id INTEGER)')).not.toThrow();
    });
  });

  describe('prepare', () => {

    it('should prepare and execute statements', () => {
      db.exec('CREATE TABLE test (id INTEGER, name TEXT)');
      const stmt = db.prepare('INSERT INTO test (id, name) VALUES (?, ?)');
      stmt.run(1, 'test');

      const select = db.prepare('SELECT name FROM test WHERE id = ?');
      const result = select.get(1);
      expect(result.name).toBe('test');
    });

    it('should prepare statements with named parameters', () => {
      db.exec('CREATE TABLE test2 (id INTEGER, name TEXT)');
      const stmt = db.prepare('INSERT INTO test2 (id, name) VALUES ($id, $name)');
      stmt.run({ $id: 1, $name: 'test' });
    });
  });

  describe('stop guard', () => {
    it('should not throw when stop is called without start', () => {
      const freshDb = new Database({ filename: TEST_DB_FILE });
      expect(() => freshDb.stop()).not.toThrow();
    });

    it('should not throw when stop is called twice', () => {
      expect(() => db.stop()).not.toThrow();
      expect(() => db.stop()).not.toThrow();
      started = false;
    });
  });

 });

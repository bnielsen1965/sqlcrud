import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import FS from 'fs';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';
import Schema from '../lib/schema.js';

const TEST_DB = path.join(process.cwd(), 'tests', '__testdb__', 'schema-test.db');

// Wrapper to make DatabaseSync compatible with Schema's expected interface
function createTestDatabase() {
  const dir = path.dirname(TEST_DB);
  if (!FS.existsSync(dir)) {
    FS.mkdirSync(dir, { recursive: true });
  }
  if (FS.existsSync(TEST_DB)) {
    FS.unlinkSync(TEST_DB);
  }
  const db = new DatabaseSync(TEST_DB);

  return {
    exec(sql) {
      return db.exec(sql);
    },
    prepare(sql) {
      return db.prepare(sql);
    },
    close() {
      db.close();
    }
  };
}

describe('Schema', () => {
  describe('jsTypeToSQL', () => {
    it('should convert string to TEXT', () => {
      expect(Schema.jsTypeToSQL('string')).toBe('TEXT');
    });

    it('should convert integer to INTEGER', () => {
      expect(Schema.jsTypeToSQL('integer')).toBe('INTEGER');
    });

    it('should convert float to REAL', () => {
      expect(Schema.jsTypeToSQL('float')).toBe('REAL');
    });

    it('should convert boolean to INTEGER', () => {
      expect(Schema.jsTypeToSQL('boolean')).toBe('INTEGER');
    });

    it('should convert time to TEXT', () => {
      expect(Schema.jsTypeToSQL('time')).toBe('TEXT');
    });

    it('should convert datetime to TEXT', () => {
      expect(Schema.jsTypeToSQL('datetime')).toBe('TEXT');
    });

    it('should convert json to TEXT', () => {
      expect(Schema.jsTypeToSQL('json')).toBe('TEXT');
    });

    it('should handle case-insensitive types', () => {
      expect(Schema.jsTypeToSQL('STRING')).toBe('TEXT');
      expect(Schema.jsTypeToSQL('Integer')).toBe('INTEGER');
    });

    it('should throw for unknown types', () => {
      expect(() => Schema.jsTypeToSQL('unknown')).toThrow(
        /No schema type defined for unknown/
      );
    });
  });

  describe('validateModelName', () => {
    it('should accept valid model names', () => {
      expect(() => Schema.validateModelName('users')).not.toThrow();
      expect(() => Schema.validateModelName('_internal')).not.toThrow();
      expect(() => Schema.validateModelName('a1_b2')).not.toThrow();
    });

    it('should reject empty or null model names', () => {
      expect(() => Schema.validateModelName('')).toThrow(/Invalid model name/);
      expect(() => Schema.validateModelName(null)).toThrow(/Invalid model name/);
      expect(() => Schema.validateModelName(undefined)).toThrow(/Invalid model name/);
    });

    it('should reject model names with invalid characters', () => {
      expect(() => Schema.validateModelName('my-model')).toThrow(/Invalid model name/);
      expect(() => Schema.validateModelName('1abc')).toThrow(/Invalid model name/);
      expect(() => Schema.validateModelName('has space')).toThrow(/Invalid model name/);
      expect(() => Schema.validateModelName("has'dquote")).toThrow(/Invalid model name/);
    });
  });

  describe('validateFieldName', () => {
    it('should accept valid field names', () => {
      expect(() => Schema.validateFieldName('name')).not.toThrow();
      expect(() => Schema.validateFieldName('_id')).not.toThrow();
      expect(() => Schema.validateFieldName('a1_b2')).not.toThrow();
    });

    it('should reject empty or null field names', () => {
      expect(() => Schema.validateFieldName('')).toThrow(/Invalid field name/);
      expect(() => Schema.validateFieldName(null)).toThrow(/Invalid field name/);
      expect(() => Schema.validateFieldName(undefined)).toThrow(/Invalid field name/);
    });

    it('should reject field names with invalid characters', () => {
      expect(() => Schema.validateFieldName('my-field')).toThrow(/Invalid field name/);
      expect(() => Schema.validateFieldName('1abc')).toThrow(/Invalid field name/);
      expect(() => Schema.validateFieldName('has space')).toThrow(/Invalid field name/);
    });
  });

  describe('validateFieldNameForParams', () => {
    it('should accept valid non-reserved field names', () => {
      expect(() => Schema.validateFieldNameForParams('name')).not.toThrow();
      expect(() => Schema.validateFieldNameForParams('_id')).not.toThrow();
    });

    it('should reject reserved field names', () => {
      expect(() => Schema.validateFieldNameForParams('model')).toThrow(/reserved/);
      expect(() => Schema.validateFieldNameForParams('schema')).toThrow(/reserved/);
    });

    it('should reject invalid field names', () => {
      expect(() => Schema.validateFieldNameForParams('')).toThrow(/Invalid field name/);
      expect(() => Schema.validateFieldNameForParams('bad-name')).toThrow(/Invalid field name/);
    });
  });

  describe('paramKey', () => {
    it('should prefix field names with $fld_', () => {
      expect(Schema.paramKey('name')).toBe('$fld_name');
      expect(Schema.paramKey('_id')).toBe('$fld__id');
    });
  });

  describe('schemaToColumns', () => {
    it('should generate basic column definitions', () => {
      const schema = {
        name: { type: 'string' },
        age: { type: 'integer' }
      };
      const columns = Schema.schemaToColumns(schema);
      expect(columns).toContain('name TEXT');
      expect(columns).toContain('age INTEGER');
    });

    it('should handle unique constraint', () => {
      const schema = {
        email: { type: 'string', unique: true }
      };
      const columns = Schema.schemaToColumns(schema);
      expect(columns).toContain('email TEXT UNIQUE');
    });

    it('should handle primary key constraint', () => {
      const schema = {
        id: { type: 'integer', primary: true }
      };
      const columns = Schema.schemaToColumns(schema);
      expect(columns).toContain('id INTEGER PRIMARY KEY');
    });

    it('should handle notnull constraint', () => {
      const schema = {
        name: { type: 'string', notnull: true }
      };
      const columns = Schema.schemaToColumns(schema);
      expect(columns).toContain('name TEXT NOT NULL');
    });

    it('should handle length constraint for strings', () => {
      const schema = {
        name: { type: 'string', length: 50 }
      };
      const columns = Schema.schemaToColumns(schema);
      expect(columns).toContain('CHECK(length(name) <= 50)');
    });

    it('should throw for length on non-string fields', () => {
      const schema = {
        count: { type: 'integer', length: 10 }
      };
      expect(() => Schema.schemaToColumns(schema)).toThrow(
        /Property "length" is not valid on schema field count/
      );
    });

    it('should throw for invalid field properties', () => {
      const schema = {
        name: { type: 'string', invalidProp: true }
      };
      expect(() => Schema.schemaToColumns(schema)).toThrow(
        /Invalid schema field property invalidProp/
      );
    });

    it('should throw for invalid field definitions', () => {
      const schema = {
        name: 'string'
      };
      expect(() => Schema.schemaToColumns(schema)).toThrow(
        /not a valid schema field definition/
      );
    });

    it('should handle multiple constraints', () => {
      const schema = {
        id: { type: 'integer', primary: true, notnull: true }
      };
      const columns = Schema.schemaToColumns(schema);
      expect(columns).toContain('id INTEGER PRIMARY KEY NOT NULL');
    });

    it('should join multiple columns with comma', () => {
      const schema = {
        name: { type: 'string' },
        age: { type: 'integer' },
        score: { type: 'float' }
      };
      const columns = Schema.schemaToColumns(schema);
      expect(columns).toContain(', ');
    });
  });

  describe('validateSchema', () => {
    it('should validate a valid schema', () => {
      const schema = {
        name: { type: 'string' },
        age: { type: 'integer' }
      };
      expect(Schema.validateSchema(schema)).toBe(true);
    });

    it('should reject non-object schemas', () => {
      expect(() => Schema.validateSchema(null)).toThrow(/Schema must be a JSON object/);
      expect(() => Schema.validateSchema('not an object')).toThrow(/Schema must be a JSON object/);
      expect(() => Schema.validateSchema([1, 2, 3])).toThrow(/Schema must be a JSON object/);
    });

    it('should reject fields without type', () => {
      const schema = { name: {} };
      expect(() => Schema.validateSchema(schema)).toThrow(/must have a 'type' property/);
    });

    it('should reject invalid types', () => {
      const schema = { name: { type: 'blob' } };
      expect(() => Schema.validateSchema(schema)).toThrow(/Invalid type 'blob'/);
    });

    it('should reject non-object field definitions', () => {
      const schema = { name: 'string' };
      expect(() => Schema.validateSchema(schema)).toThrow(/must be an object/);
    });

    it('should accept all valid types', () => {
      const validTypes = ['string', 'integer', 'float', 'boolean', 'json', 'datetime', 'time'];
      for (const type of validTypes) {
        const schema = { field: { type } };
        expect(Schema.validateSchema(schema)).toBe(true);
      }
    });

    it('should reject negative length', () => {
      const schema = { name: { type: 'string', length: -1 } };
      expect(() => Schema.validateSchema(schema)).toThrow(/length must be a positive number/);
    });

    it('should reject non-number length', () => {
      const schema = { name: { type: 'string', length: 'ten' } };
      expect(() => Schema.validateSchema(schema)).toThrow(/length must be a positive number/);
    });

    it('should reject non-boolean unique', () => {
      const schema = { name: { type: 'string', unique: 'yes' } };
      expect(() => Schema.validateSchema(schema)).toThrow(/'unique' must be a boolean/);
    });

    it('should reject non-boolean primary', () => {
      const schema = { name: { type: 'string', primary: 1 } };
      expect(() => Schema.validateSchema(schema)).toThrow(/'primary' must be a boolean/);
    });

    it('should reject non-boolean notnull', () => {
      const schema = { name: { type: 'string', notnull: 'true' } };
      expect(() => Schema.validateSchema(schema)).toThrow(/'notnull' must be a boolean/);
    });
  });

  describe('schemaFromObject', () => {
    it('should infer string type from string values', () => {
      const schema = Schema.schemaFromObject({ name: 'John' });
      expect(schema.name.type).toBe('string');
    });

    it('should infer integer type from integer values', () => {
      const schema = Schema.schemaFromObject({ age: 30 });
      expect(schema.age.type).toBe('integer');
    });

    it('should infer float type from float values', () => {
      const schema = Schema.schemaFromObject({ price: 9.99 });
      expect(schema.price.type).toBe('float');
    });

    it('should infer boolean type from boolean values', () => {
      const schema = Schema.schemaFromObject({ active: true });
      expect(schema.active.type).toBe('boolean');
    });

    it('should infer json type from object values', () => {
      const schema = Schema.schemaFromObject({ data: { nested: true } });
      expect(schema.data.type).toBe('json');
    });

    it('should skip null and undefined values', () => {
      const schema = Schema.schemaFromObject({ a: null, b: undefined, c: 'value' });
      expect(schema.a).toBeUndefined();
      expect(schema.b).toBeUndefined();
      expect(schema.c.type).toBe('string');
    });

    it('should set length constraint for string values', () => {
      const schema = Schema.schemaFromObject({ name: 'Hello' });
      expect(schema.name.length).toBe(5);
    });

    it('should set notnull for trimmed strings', () => {
      const schema = Schema.schemaFromObject({ name: 'Hello World' });
      expect(schema.name.notnull).toBe(true);
    });
  });

  describe('database operations', () => {
    let testDb;

    beforeEach(() => {
      testDb = createTestDatabase();
    });

    afterEach(() => {
      testDb.close();
      if (FS.existsSync(TEST_DB)) {
        FS.unlinkSync(TEST_DB);
      }
    });

    describe('init', () => {
      it('should initialize the schemas table', () => {
        Schema.init(testDb);
        const stmt = testDb.prepare("SELECT name FROM sqlite_schema WHERE type = 'table'");
        const tables = stmt.all();
        expect(tables).toContainEqual({ name: 'schemas' });
      });
    });

    describe('initTable', () => {
      it('should create a table from a schema', () => {
        const schema = {
          name: { type: 'string', notnull: true },
          age: { type: 'integer' }
        };
        Schema.initTable('users', schema, testDb);

        const stmt = testDb.prepare("SELECT name FROM sqlite_schema WHERE type = 'table'");
        const tables = stmt.all();
        expect(tables).toContainEqual({ name: 'users' });
      });

      it('should not fail if table already exists', () => {
        const schema = { name: { type: 'string' } };
        Schema.initTable('users', schema, testDb);
        Schema.initTable('users', schema, testDb); // Should not throw
      });
    });

    describe('createSchema / getSchema', () => {
      beforeEach(() => {
        Schema.init(testDb);
      });

      it('should create and retrieve a schema', async () => {
        const schema = {
          name: { type: 'string', notnull: true },
          age: { type: 'integer' }
        };
        await Schema.createSchema('users', schema, testDb);

        const result = await Schema.getSchema('users', testDb);
        expect(result).toEqual(schema);
      });

      it('should return null for non-existent schema', async () => {
        const result = await Schema.getSchema('nonexistent', testDb);
        expect(result).toBeNull();
      });

      it('should update an existing schema', async () => {
        const schema1 = { name: { type: 'string' } };
        const schema2 = { name: { type: 'string' }, age: { type: 'integer' } };

        await Schema.createSchema('users', schema1, testDb);
        await Schema.createSchema('users', schema2, testDb);

        const result = await Schema.getSchema('users', testDb);
        expect(result).toEqual(schema2);
      });
    });

    describe('getModels', () => {
      beforeEach(() => {
        Schema.init(testDb);
      });

      it('should return empty array when no models exist', async () => {
        const models = await Schema.getModels(testDb);
        expect(models).toEqual([]);
      });

      it('should return all registered models', async () => {
        await Schema.createSchema('users', { name: { type: 'string' } }, testDb);
        await Schema.createSchema('posts', { title: { type: 'string' } }, testDb);

        const models = await Schema.getModels(testDb);
        expect(models.length).toBe(2);
      });
    });

    describe('deleteSchema', () => {
      beforeEach(() => {
        Schema.init(testDb);
      });

      it('should delete a schema and its table', async () => {
        await Schema.createSchema('users', { name: { type: 'string' } }, testDb);
        await Schema.deleteSchema('users', testDb);

        const result = await Schema.getSchema('users', testDb);
        expect(result).toBeNull();
      });

      it('should not fail deleting non-existent schema', async () => {
        await Schema.deleteSchema('nonexistent', testDb); // Should not throw
      });
    });

    describe('createRecord / getRecord / updateRecord / deleteRecord', () => {
      beforeEach(() => {
        Schema.init(testDb);
      });

      it('should create and retrieve a record', async () => {
        await Schema.createSchema('users', {
          name: { type: 'string' },
          age: { type: 'integer' }
        }, testDb);

        const record = await Schema.createRecord('users', { name: 'John', age: 30 }, testDb);
        expect(record.name).toBe('John');
        expect(record.age).toBe(30);

        const results = await Schema.getRecord('users', { name: 'John' }, testDb);
        expect(results.length).toBe(1);
        expect(results[0].name).toBe('John');
      });

      it('should return empty array when no records match', async () => {
        await Schema.createSchema('users', {
          name: { type: 'string' },
          age: { type: 'integer' }
        }, testDb);

        const results = await Schema.getRecord('users', { name: 'Nobody' }, testDb);
        expect(results).toEqual([]);
      });

      it('should retrieve multiple matching records', async () => {
        await Schema.createSchema('users', {
          name: { type: 'string' },
          age: { type: 'integer' }
        }, testDb);

        await Schema.createRecord('users', { name: 'John', age: 30 }, testDb);
        await Schema.createRecord('users', { name: 'John', age: 25 }, testDb);

        const results = await Schema.getRecord('users', { name: 'John' }, testDb);
        expect(results.length).toBe(2);
      });

      it('should retrieve records using multiple field matches', async () => {
        await Schema.createSchema('users', {
          name: { type: 'string' },
          age: { type: 'integer' }
        }, testDb);

        await Schema.createRecord('users', { name: 'John', age: 30 }, testDb);
        await Schema.createRecord('users', { name: 'John', age: 25 }, testDb);

        const results = await Schema.getRecord('users', { name: 'John', age: 30 }, testDb);
        expect(results.length).toBe(1);
        expect(results[0].age).toBe(30);
      });

      it('should update a record matching field criteria', async () => {
        await Schema.createSchema('users', {
          name: { type: 'string' },
          age: { type: 'integer' }
        }, testDb);

        await Schema.createRecord('users', { name: 'John', age: 30 }, testDb);

        const result = await Schema.updateRecord('users', { name: 'John' }, { age: 35 }, testDb);
        expect(result.before.age).toBe(30);
        expect(result.after.age).toBe(35);

        const results = await Schema.getRecord('users', { name: 'John' }, testDb);
        expect(results[0].age).toBe(35);
      });

      it('should throw when update matches no record', async () => {
        await Schema.createSchema('users', {
          name: { type: 'string' },
          age: { type: 'integer' }
        }, testDb);

        await Schema.createRecord('users', { name: 'John', age: 30 }, testDb);

        expect(
          () => Schema.updateRecord('users', { name: 'Nobody' }, { age: 35 }, testDb)
        ).toThrow(/No record found/);
      });

      it('should throw when update matches multiple records', async () => {
        await Schema.createSchema('users', {
          name: { type: 'string' },
          age: { type: 'integer' }
        }, testDb);

        await Schema.createRecord('users', { name: 'John', age: 30 }, testDb);
        await Schema.createRecord('users', { name: 'John', age: 25 }, testDb);

        expect(
          () => Schema.updateRecord('users', { name: 'John' }, { age: 35 }, testDb)
        ).toThrow(/would affect 2 records/);
      });

      it('should delete records matching field criteria', async () => {
        await Schema.createSchema('users', {
          name: { type: 'string' },
          age: { type: 'integer' }
        }, testDb);

        await Schema.createRecord('users', { name: 'John', age: 30 }, testDb);
        await Schema.createRecord('users', { name: 'Jane', age: 25 }, testDb);

        await Schema.deleteRecord('users', { name: 'John' }, testDb);

        const results = await Schema.getRecord('users', { name: 'Jane' }, testDb);
        expect(results.length).toBe(1);
        expect(results[0].name).toBe('Jane');
      });

      it('should not fail deleting with no matches', async () => {
        await Schema.createSchema('users', {
          name: { type: 'string' }
        }, testDb);

        await Schema.deleteRecord('users', { name: 'Nobody' }, testDb); // Should not throw
      });

      it('should return the persisted row from createRecord', async () => {
        await Schema.createSchema('users', {
          name: { type: 'string' },
          age: { type: 'integer' }
        }, testDb);

        const record = await Schema.createRecord('users', { name: 'Jane', age: 25 }, testDb);
        expect(record.name).toBe('Jane');
        expect(record.age).toBe(25);
      });

      it('should return {before, after} from updateRecord', async () => {
        await Schema.createSchema('users', {
          name: { type: 'string' },
          age: { type: 'integer' }
        }, testDb);

        await Schema.createRecord('users', { name: 'Alice', age: 20 }, testDb);

        const result = await Schema.updateRecord('users', { name: 'Alice' }, { age: 21 }, testDb);
        expect(result.before).toBeDefined();
        expect(result.after).toBeDefined();
        expect(result.before.age).toBe(20);
        expect(result.after.age).toBe(21);
      });

      it('should reject reserved field names in CRUD operations', async () => {
        await Schema.createSchema('items', {
          label: { type: 'string' },
          value: { type: 'integer' }
        }, testDb);

        // createRecord with reserved field name should throw
        expect(
          () => Schema.createRecord('items', { model: 'bad' }, testDb)
        ).toThrow(/reserved/);

        // getRecord with reserved field name should throw
        expect(
          () => Schema.getRecord('items', { schema: 'bad' }, testDb)
        ).toThrow(/reserved/);
      });

      it('should delete schema by dropping table before deleting schema record', async () => {
        await Schema.createSchema('temp', {
          name: { type: 'string' }
        }, testDb);

        // Create a record
        await Schema.createRecord('temp', { name: 'test' }, testDb);

        // Delete the schema
        await Schema.deleteSchema('temp', testDb);

        // Verify schema is gone
        const result = await Schema.getSchema('temp', testDb);
        expect(result).toBeNull();

        // Verify table is gone
        const stmt = testDb.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name = 'temp'");
        const tables = stmt.all();
        expect(tables.length).toBe(0);
      });
    });
  });
});

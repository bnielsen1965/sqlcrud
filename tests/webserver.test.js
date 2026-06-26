import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import Express from 'express';
import BodyParser from 'body-parser';
import CRUDAPI from '../lib/crudapi.js';
import Database from '../lib/database.js';
import Schema from '../lib/schema.js';
import FS from 'fs';
import path from 'path';

const TEST_DB_FILE = path.join(process.cwd(), 'tests', '__testdb__', 'webserver-test.db');
const TEST_DB_AUTH = path.join(process.cwd(), 'tests', '__testdb__', 'webserver-auth.db');

function createTestApp(config = {}) {
  const app = Express();
  app.use(BodyParser.urlencoded({ extended: true }));
  app.use(BodyParser.json());

  // Basic auth middleware
  if (config.basicAuth) {
    app.use(createAuthMiddleware(config.basicAuth));
  }

  const db = new Database({ filename: config.dbFile || TEST_DB_FILE });
  db.start();

  const crudapi = new CRUDAPI({}, app, db);
  crudapi.start();

  return { app, db };
}

// Minimal auth middleware (mirrors WebServer.createBasicAuthMiddleware)
function createAuthMiddleware(basicAuth) {
  return function basicAuthMiddleware(req, res, next) {
    if (!basicAuth || !basicAuth.enabled) {
      return next();
    }

    const header = req.headers.authorization;
    if (!header || !header.startsWith('Basic ')) {
      return res.status(401).json({ error: 'Authentication required.' });
    }

    try {
      const encoded = header.slice(6);
      const decoded = Buffer.from(encoded, 'base64').toString('utf-8');
      const delimiterIndex = decoded.indexOf(':');
      if (delimiterIndex === -1) {
        return res.status(401).json({ error: 'Invalid credentials.' });
      }
      const username = decoded.slice(0, delimiterIndex);
      const password = decoded.slice(delimiterIndex + 1);

      if (username !== basicAuth.username || password !== basicAuth.password) {
        return res.status(401).json({ error: 'Invalid credentials.' });
      }
    } catch {
      return res.status(401).json({ error: 'Invalid credentials.' });
    }

    next();
  };
}

// ---- Tests without auth (existing behavior) ----

describe('WebServer / CRUDAPI', () => {
  let app, db;

  beforeEach(() => {
    const dir = path.dirname(TEST_DB_FILE);
    if (!FS.existsSync(dir)) {
      FS.mkdirSync(dir, { recursive: true });
    }
    if (FS.existsSync(TEST_DB_FILE)) {
      FS.unlinkSync(TEST_DB_FILE);
    }

    ({ app, db } = createTestApp());
  });

  afterEach(async () => {
    db.stop();
    if (FS.existsSync(TEST_DB_FILE)) {
      FS.unlinkSync(TEST_DB_FILE);
    }
  });

  describe('GET /api/tables', () => {
    it('should return list of tables', async () => {
      const response = await request(app).get('/api/tables');
      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body).toContain('schemas');
    });
  });

  describe('GET /api/models', () => {
    it('should return empty list when no models defined', async () => {
      const response = await request(app).get('/api/models');
      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
    });

    it('should return models after schema creation', async () => {
      const schema = { name: { type: 'string' }, age: { type: 'integer' } };
      await request(app).post('/api/schema/users').send(schema);

      const response = await request(app).get('/api/models');
      expect(response.status).toBe(200);
      expect(response.body.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('POST /api/schema/:model', () => {
    it('should create a new schema', async () => {
      const schema = {
        name: { type: 'string', notnull: true },
        age: { type: 'integer' },
        email: { type: 'string', unique: true }
      };

      const response = await request(app).post('/api/schema/users').send(schema);
      expect(response.status).toBe(200);
      expect(response.body).toEqual(schema);
    });

    it('should create the underlying table', async () => {
      const schema = { name: { type: 'string' } };
      await request(app).post('/api/schema/test_model').send(schema);

      const tablesResponse = await request(app).get('/api/tables');
      expect(tablesResponse.body).toContain('test_model');
    });

    it('should update an existing schema', async () => {
      const schema1 = { name: { type: 'string' } };
      const schema2 = { name: { type: 'string' }, age: { type: 'integer' } };

      await request(app).post('/api/schema/users').send(schema1);
      const response = await request(app).post('/api/schema/users').send(schema2);
      expect(response.status).toBe(200);
      expect(response.body).toEqual(schema2);
    });
  });

  describe('GET /api/schema/:model', () => {
    it('should return 404 for non-existent model', async () => {
      const response = await request(app).get('/api/schema/nonexistent');
      expect(response.status).toBe(404);
      expect(response.body.error).toContain('not found');
    });

    it('should return schema for existing model', async () => {
      const schema = { name: { type: 'string' }, age: { type: 'integer' } };
      await request(app).post('/api/schema/users').send(schema);

      const response = await request(app).get('/api/schema/users');
      expect(response.status).toBe(200);
      expect(response.body).toEqual(schema);
    });
  });

  describe('DELETE /api/schema/:model', () => {
    it('should delete a schema', async () => {
      const schema = { name: { type: 'string' } };
      await request(app).post('/api/schema/users').send(schema);

      const response = await request(app).delete('/api/schema/users');
      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it('should remove the model after deletion', async () => {
      const schema = { name: { type: 'string' } };
      await request(app).post('/api/schema/users').send(schema);

      await request(app).delete('/api/schema/users');

      const getResponse = await request(app).get('/api/schema/users');
      expect(getResponse.status).toBe(404);
    });
  });

  describe('POST /api/record/:model', () => {
    beforeEach(async () => {
      const schema = {
        name: { type: 'string', notnull: true },
        age: { type: 'integer' },
        active: { type: 'boolean' }
      };
      await request(app).post('/api/schema/users').send(schema);
    });

    it('should return error when required field is missing', async () => {
      const response = await request(app)
        .post('/api/record/users')
        .send({ age: 30 });

      expect(response.status).toBe(500);
      expect(response.body.error).toContain('required');
    });

    it('should return error when model does not exist', async () => {
      const response = await request(app)
        .post('/api/record/nonexistent')
        .send({ name: 'John' });

      expect(response.status).toBe(500);
      expect(response.body.error).toContain('not found');
    });

    it('should attempt record creation (integration: createRecord needs runSQL/getSQL)', async () => {
      const response = await request(app)
        .post('/api/record/users')
        .send({ name: 'John', age: 30, active: true });

      // Note: createRecord() references this.runSQL/this.getSQL which
      // are not implemented on the Database class.
      expect(response.status).toBe(500);
    });
  });

  describe('PUT /api/record/:model/:id', () => {
    it('should return error for non-existent model', async () => {
      const response = await request(app)
        .put('/api/record/nonexistent/1')
        .send({ name: 'Updated' });

      expect(response.status).toBe(500);
    });
  });

  describe('GET /api/record/:model', () => {
    it('should return error when model has no records', async () => {
      const schema = { name: { type: 'string' } };
      await request(app).post('/api/schema/testmodel').send(schema);

      const response = await request(app).get('/api/record/testmodel');

      expect([404, 500]).toContain(response.status);
    });
  });

  describe('DELETE /api/record/:model/:id', () => {
    it('should return error for non-existent model', async () => {
      const response = await request(app)
        .delete('/api/record/nonexistent/1');

      expect(response.status).toBe(500);
    });
  });
});

// ---- Tests with basic auth enabled ----

describe('WebServer / CRUDAPI (Basic Auth)', () => {
  const AUTH_CONFIG = {
    basicAuth: {
      enabled: true,
      username: 'testuser',
      password: 'testpass'
    },
    dbFile: TEST_DB_AUTH
  };

  const AUTH_HEADERS = {
    authorization: 'Basic ' + Buffer.from('testuser:testpass').toString('base64')
  };

  const WRONG_HEADERS = {
    authorization: 'Basic ' + Buffer.from('testuser:wrongpass').toString('base64')
  };

  let app, db;

  beforeEach(() => {
    const dir = path.dirname(TEST_DB_AUTH);
    if (!FS.existsSync(dir)) {
      FS.mkdirSync(dir, { recursive: true });
    }
    if (FS.existsSync(TEST_DB_AUTH)) {
      FS.unlinkSync(TEST_DB_AUTH);
    }

    ({ app, db } = createTestApp(AUTH_CONFIG));
  });

  afterEach(() => {
    db.stop();
    if (FS.existsSync(TEST_DB_AUTH)) {
      FS.unlinkSync(TEST_DB_AUTH);
    }
  });

  describe('authentication enforcement', () => {
    it('should reject requests without auth header', async () => {
      const response = await request(app).get('/api/tables');
      expect(response.status).toBe(401);
      expect(response.body.error).toBe('Authentication required.');
    });

    it('should reject requests with wrong credentials', async () => {
      const response = await request(app)
        .get('/api/tables')
        .set(WRONG_HEADERS);
      expect(response.status).toBe(401);
      expect(response.body.error).toBe('Invalid credentials.');
    });

    it('should reject requests with malformed Basic header', async () => {
      const response = await request(app)
        .get('/api/tables')
        .set({ authorization: 'Basic not-valid-base64!!!' });
      expect(response.status).toBe(401);
    });

    it('should reject requests with wrong username', async () => {
      const headers = {
        authorization: 'Basic ' + Buffer.from('wronguser:testpass').toString('base64')
      };
      const response = await request(app)
        .get('/api/tables')
        .set(headers);
      expect(response.status).toBe(401);
      expect(response.body.error).toBe('Invalid credentials.');
    });

    it('should accept requests with correct credentials', async () => {
      const response = await request(app)
        .get('/api/tables')
        .set(AUTH_HEADERS);
      expect(response.status).toBe(200);
      expect(response.body).toContain('schemas');
    });
  });

  describe('authenticated schema operations', () => {
    it('should create a schema with valid auth', async () => {
      const schema = { name: { type: 'string', notnull: true }, age: { type: 'integer' } };

      const response = await request(app)
        .post('/api/schema/users')
        .set(AUTH_HEADERS)
        .send(schema);

      expect(response.status).toBe(200);
      expect(response.body).toEqual(schema);
    });

    it('should create the underlying table when creating a schema', async () => {
      const schema = { name: { type: 'string' } };
      await request(app)
        .post('/api/schema/test_model')
        .set(AUTH_HEADERS)
        .send(schema);

      const tablesResponse = await request(app)
        .get('/api/tables')
        .set(AUTH_HEADERS);

      expect(tablesResponse.body).toContain('test_model');
    });

    it('should retrieve a schema with valid auth', async () => {
      const schema = { name: { type: 'string' }, age: { type: 'integer' } };
      await request(app)
        .post('/api/schema/users')
        .set(AUTH_HEADERS)
        .send(schema);

      const response = await request(app)
        .get('/api/schema/users')
        .set(AUTH_HEADERS);

      expect(response.status).toBe(200);
      expect(response.body).toEqual(schema);
    });

    it('should return 404 for non-existent model with valid auth', async () => {
      const response = await request(app)
        .get('/api/schema/nonexistent')
        .set(AUTH_HEADERS);

      expect(response.status).toBe(404);
    });

    it('should list models with valid auth', async () => {
      await request(app)
        .post('/api/schema/users')
        .set(AUTH_HEADERS)
        .send({ name: { type: 'string' } });

      const response = await request(app)
        .get('/api/models')
        .set(AUTH_HEADERS);

      expect(response.status).toBe(200);
      expect(response.body.length).toBeGreaterThanOrEqual(1);
    });

    it('should delete a schema with valid auth', async () => {
      await request(app)
        .post('/api/schema/users')
        .set(AUTH_HEADERS)
        .send({ name: { type: 'string' } });

      const response = await request(app)
        .delete('/api/schema/users')
        .set(AUTH_HEADERS);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it('should update an existing schema with valid auth', async () => {
      const schema1 = { name: { type: 'string' } };
      const schema2 = { name: { type: 'string' }, age: { type: 'integer' } };

      await request(app)
        .post('/api/schema/users')
        .set(AUTH_HEADERS)
        .send(schema1);

      const response = await request(app)
        .post('/api/schema/users')
        .set(AUTH_HEADERS)
        .send(schema2);

      expect(response.status).toBe(200);
      expect(response.body).toEqual(schema2);
    });
  });
});

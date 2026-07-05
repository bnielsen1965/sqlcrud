# sqlcrud

An SQLite database service with a RESTful CRUD interface and JSON schema management.

sqlcrud is a Node.js service that uses SQLite to store schema-based data in tables. A JSON schema defines the structure of each SQLite table and governs how data is stored and retrieved as JavaScript objects.


## Preface

Significant portions of the code and documentation was written by AI. I am experimenting 
with local AI assistance using an ASRock AMD Radeon AI Pro R9700 32GB in a DEG1 dock with 
Oculink connection to a linux workstation. Various agents and models were used to evaluate 
their effectiveness and value in the development process.


## Table of Contents

- [Features](#features)
- [Requirements](#requirements)
- [Installation](#installation)
- [Configuration](#configuration)
- [Basic Authentication](#basic-authentication)
- [Usage](#usage)
- [Schema Format](#schema-format)
- [API Reference](#api-reference)
- [Architecture](#architecture)
- [Security](#security)
- [Testing](#testing)
- [Web Interface](#web-interface)
- [Known Limitations](#known-limitations)

---

## Features

- **JSON Schema Definitions** — Define table structures with JSON, stored in the database.
- **RESTful CRUD API** — Full create, read, update, and delete operations over HTTP.
- **Dynamic Table Creation** — Tables are created automatically from schema definitions.
- **Field Validation** — Enforce `notnull`, `unique`, `primary`, and `length` constraints.
- **Basic Authentication** — Optional HTTP Basic Auth for the API and web interface.
- **SQLite Backend** — Lightweight, file-based database with no external dependencies.
- **Web UI** — Browser-based schema editor and record management interface.

---

## Requirements

- **Node.js** >= 24.0.0 (uses `node:sqlite` experimental module)

---

## Installation

```bash
npm install
```

---

## Configuration

Configuration is managed via `config.json` in the project root:

```json
{
  "debug": true,
  "Database": {
    "filename": "default.db"
  },
  "WebServer": {
    "port": 3123,
    "basicAuth": {
      "enabled": true,
      "username": "admin",
      "password": "password"
    }
  }
}
```

### Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `debug` | boolean | — | Enable debug logging to console |
| `Database.filename` | string | `"default.db"` | Path to the SQLite database file |
| `WebServer.port` | number | `80` (HTTP) / `443` (HTTPS) | Port the HTTP server listens on |
| `WebServer.address` | string | `"0.0.0.0"` | Bind address for the server |
| `WebServer.keyFile` | string | — | Path to TLS private key file |
| `WebServer.certFile` | string | — | Path to TLS certificate file |
| `WebServer.publicDirectory` | string | `"./public"` | Directory served for static files |
| `WebServer.basicAuth.enabled` | boolean | `false` | Enable HTTP Basic Authentication |
| `WebServer.basicAuth.username` | string | — | Username for authentication |
| `WebServer.basicAuth.password` | string | — | Password for authentication |
| `Application.shutdownTimeout` | number | `5` | Minutes before forced shutdown |
| `Application.terminationCountdown` | number | `3` | Countdown steps before force exit |

When both `keyFile` and `certFile` are provided, the server runs over HTTPS.

---

## Basic Authentication

Optional HTTP Basic Authentication can be enabled for both the REST API and the web interface. Configure it under `WebServer.basicAuth` in `config.json`:

```json
"basicAuth": {
  "enabled": true,
  "username": "admin",
  "password": "password"
}
```

When enabled, all endpoints require a valid `Authorization: Basic <credentials>` header. Requests without credentials receive a `401 Unauthorized` response.

### API Authentication

Include credentials with every API request. Using `curl`:

```bash
curl -u admin:password http://localhost:3123/api/tables
```

Using `fetch` or any HTTP client:

```
Authorization: Basic YWRtaW46cGFzc3dvcmQ=
```

### Web Interface Authentication

When authentication is enabled and you access the web interface in a browser, the UI will prompt for credentials. They are cached for the session, so you only need to enter them once per tab.

### Security Notes

- Basic Auth transmits credentials in base64 encoding, which is trivially decoded. **Always use HTTPS** (via `keyFile` and `certFile`) when deploying behind a network boundary.
- Only one user is supported. For multi-user authentication, use a reverse proxy (e.g., Nginx, Caddy) in front of the application.

---

## Usage

```bash
node index.js
```

The application will start the database connection, initialize the schema system, and begin listening on the configured port.

### Signal Handling

| Signal | Action |
|--------|--------|
| `SIGINT` | Begin shutdown countdown (repeated signals force exit after countdown) |
| `SIGTERM` | Begin graceful shutdown |
| `SIGHUP` | Begin graceful shutdown |
| `uncaughtException` | Log error and begin shutdown |
| `unhandledRejection` | Log error and begin shutdown |

---

## Schema Format

Schemas are plain JSON objects mapping field names to field definitions. Each field definition requires a `type` and may include optional constraint attributes.

### Example Schema

```json
{
  "name": {
    "type": "string",
    "length": 100,
    "primary": true
  },
  "email": {
    "type": "string",
    "unique": true
  },
  "age": {
    "type": "integer"
  },
  "score": {
    "type": "float"
  },
  "active": {
    "type": "boolean"
  },
  "metadata": {
    "type": "json"
  },
  "createdAt": {
    "type": "datetime"
  }
}
```

### Field Types

| Type | JavaScript | SQLite |
|------|------------|--------|
| `string` | string | TEXT |
| `integer` | number (integer) | INTEGER |
| `float` | number (float) | REAL |
| `boolean` | boolean | INTEGER |
| `json` | object or array | TEXT |
| `datetime` | Date | TEXT |
| `time` | string | TEXT |

### Field Attributes

| Attribute | Type | Description |
|-----------|------|-------------|
| `type` | string **(required)** | Data type of the field |
| `length` | number | Maximum string length (strings only; enforced via SQLite `CHECK`) |
| `unique` | boolean | Column values must be unique |
| `primary` | boolean | Column is a primary key |
| `notnull` | boolean | Column cannot be `NULL` |

### JSON Type Fields

The `json` field type lets you store arbitrary JavaScript objects and arrays in a SQLite `TEXT` column. The API handles serialization and deserialization automatically — you always work with native objects and arrays, never serialized strings.

**On write** (`POST` / `PUT` / `PATCH`), send the field as a plain object or array. The API serializes it with `JSON.stringify()` before storing it in SQLite.

**On read** (`GET`), the stored string is parsed with `JSON.parse()` and returned as a native object or array.

```
POST /api/record/users
{
  "name": "Alice",
  "settings": { "theme": "dark", "notifications": true },
  "tags": ["admin", "beta-tester"]
}
```

```json
// GET /api/record/users?name=Alice
{
  "name": "Alice",
  "settings": { "theme": "dark", "notifications": true },
  "tags": ["admin", "beta-tester"]
}
```

The same behavior applies when updating a record via `PUT` — send the object or array directly in the request body.

### Schema Inference

The `Schema.schemaFromObject()` utility can infer a schema definition from a JavaScript object, inferring types from the values:

```javascript
import Schema from './lib/schema.js';

const example = {
  name: "John Doe",
  age: 30,
  active: true,
  metadata: { role: "admin" }
};

const inferredSchema = Schema.schemaFromObject(example);
// {
//   name:     { type: "string", length: 8, notnull: true },
//   age:      { type: "integer" },
//   active:   { type: "boolean" },
//   metadata: { type: "json" }
// }
```

---

## API Reference

All endpoints return JSON. Base path is determined by the configured port.

### Tables

#### `GET /api/tables`

Return a list of all user-defined tables in the database (excluding internal `sqlite_` tables).

**Response:** `200 OK` — Array of table name strings.

```json
["schemas", "users", "posts"]
```

---

### Models

#### `GET /api/models`

Return all registered model schemas.

**Response:** `200 OK` — Array of model objects.

```json
[
  { "model": "users", "schema": "{...}" },
  { "model": "posts", "schema": "{...}" }
]
```

---

### Schemas

#### `GET /api/schema/:model`

Retrieve the schema definition for a model.

**Response:**
- `200 OK` — The schema JSON object.
- `404` — `{ "error": "Model '...' not found." }`

#### `POST /api/schema/:model`

Create or update a schema. Validates the schema before saving. Creates the underlying SQLite table if it does not exist. If a schema already exists for the model, it is updated in place (the table structure is not altered).

**Request Body:** Schema JSON object.

**Response:**
- `200 OK` — The saved schema object.
- `500` — `{ "error": "..." }` (validation failure, database error, etc.)

#### `DELETE /api/schema/:model`

Delete a schema and drop the corresponding table.

**Response:**
- `200 OK` — `{ "success": true }`
- `500` — `{ "error": "..." }`

---

### Records

Record endpoints use URL query parameters to specify field match criteria for the SQL `WHERE` clause. Multiple query parameters are combined with `AND`.

#### `GET /api/record/:model`

Retrieve records matching field criteria from the query string.

**Query Parameters:** Any field name(s) from the model schema.

| Parameter | Description |
|-----------|-------------|
| Any schema field | Field value to match (e.g., `?name=John&age=30`) |

**Response:**
- `200 OK` — Array of matching record objects.
- `404` — `{ "error": "No records found for model '...'." }`
- `500` — `{ "error": "..." }`

**Example:**

```
GET /api/record/users?name=John&age=30
```

#### `POST /api/record/:model`

Create a new record in the model table. Returns the actual persisted row, including any defaults, coercions, and the auto-generated `rowid`.

**Request Body:** Record data object.

**Response:**
- `200 OK` — The created record object (as stored in the database).
- `500` — `{ "error": "..." }` (model table does not exist, etc.)

**Example:**

```
POST /api/record/users
{ "name": "John", "age": 30 }
```

#### `PUT /api/record/:model`

Update a single existing record. Query parameters identify the target record. An error is thrown if the criteria match zero records or more than one record — provide enough fields to uniquely identify the record.

**Query Parameters:** Field name(s) from the model schema to locate the record.

**Request Body:** Updated field values.

**Response:**
- `200 OK` — Object containing `before` (the record as it was before the update) and `after` (the record as it is after the update).
- `500` — `{ "error": "No record found matching criteria..." }` if no match.
- `500` — `{ "error": "Update would affect N records..." }` if multiple matches.

**Example:**

```
PUT /api/record/users?name=John
{ "age": 31 }
```

#### `DELETE /api/record/:model`

Delete records matching field criteria from the query string. Deletes all records that match.

**Query Parameters:** Any field name(s) from the model schema.

**Response:**
- `200 OK` — `{ "success": true }`
- `500` — `{ "error": "..." }`

**Example:**

```
DELETE /api/record/users?name=John
```

---

## Architecture

### Project Structure

```
sqlcrud/
├── index.js              # Entry point — parses args, starts Application
├── config.json           # Runtime configuration
├── package.json          # Project metadata and dependencies
├── vitest.config.js      # Vitest test configuration (V8 coverage, 10s timeout)
├── lib/
│   ├── application.js    # Orchestrates Database and WebServer lifecycle
│   ├── constants.js      # Shared constants (table names, type mappings)
│   ├── crudapi.js        # Express route handlers for CRUD operations
│   ├── database.js       # SQLite database wrapper (connect, exec, prepare)
│   ├── jsonconfig.js     # JSON config file reader and deep merge utility
│   ├── schema.js         # Schema validation, SQL generation, table init
│   └── webserver.js      # Express/HTTP server, static file serving, TLS
├── public/               # Static web interface
│   ├── index.html        # Schema viewer and record management UI
│   ├── css/              # Stylesheets
│   └── js/               # Client-side JavaScript (ACE editor integration)
└── tests/                # Test suite (Vitest)
    ├── setup.js           # Test setup helpers
    ├── constants.test.js  # Constants module tests
    ├── jsonconfig.test.js # Config reader and merge tests
    ├── schema.test.js     # Schema validation and DB operation tests
    ├── database.test.js   # Database wrapper tests
    └── webserver.test.js  # HTTP API integration tests
```

### Component Flow

```
index.js
  └── Application
        ├── Database  (SQLite connection, exec, prepare)
        └── WebServer
              ├── Express app (routing, body parsing, basic auth, static files)
              ├── CRUDAPI     (route handlers → Database)
              └── Schema      (table creation, schema storage/retrieval)
```

1. **index.js** reads `config.json` and instantiates `Application` with the config.
2. **Application** merges config with defaults, sets up signal handlers, and initializes Database and WebServer.
3. **Database** opens a connection to the SQLite file via `node:sqlite` (`DatabaseSync`).
4. **WebServer** creates an Express app, registers body parsers, applies the basic auth middleware (if configured), and instantiates CRUDAPI.
5. **CRUDAPI** calls `Schema.init()` to ensure the `schemas` table exists, then registers HTTP route handlers.
6. **Schema** manages the `schemas` meta-table and creates/drops user tables from JSON definitions.

### Security

The Schema module employs several defenses against SQL injection and parameter-binding collisions:

- **Model name validation** — `validateModelName()` enforces that model names match `^[a-zA-Z_][a-zA-Z0-9_]*$`, preventing arbitrary SQL injection via table names (which cannot be parameterized).
- **Field name validation** — `validateFieldName()` applies the same pattern to column names, which are interpolated into SQL.
- **Parameter key prefixing** — `paramKey()` prepends `fld_` to every user-supplied field name before it becomes a SQLite named parameter, so user data never collides with internal parameter names like `$model` or `$schema`.
- **Reserved field names** — Field names `model` and `schema` are rejected (`RESERVED_FIELD_NAMES`) to prevent collisions with internal schema-table query parameters.

---

## Testing

The test suite uses **Vitest** with **Supertest** for HTTP integration tests. It covers 146 tests across 5 files:

```bash
# Run all tests once (includes coverage report)
npm test

# Run with file watcher
npm run test:watch
```

Tests are configured via `vitest.config.js` with a 10-second timeout, V8-based coverage reporting, and shared setup in `tests/setup.js`.

### Test Coverage

| File | Tests | Scope |
|------|-------|-------|
| `tests/constants.test.js` | 10 | Constants and SchemaTypes mappings |
| `tests/jsonconfig.test.js` | 12 | Config file reading, JSON parsing, error handling, deep merge |
| `tests/schema.test.js` | 81 | Type conversion, column SQL generation, schema validation, model/field name validation, object-to-schema inference, database schema CRUD, record CRUD operations, JSON field serialization/deserialization |
| `tests/database.test.js` | 12 | Connection lifecycle, table listing, SQL execution, prepared statements |
| `tests/webserver.test.js` | 32 | Full HTTP API — schema CRUD, model listing, table listing, record CRUD with query parameters, basic auth enforcement |

---

## Web Interface

The application serves a browser-based UI at `http://<host>:<port>/` featuring:

- **Schema Tab** — View and edit JSON schemas with the ACE code editor (syntax highlighting, validation). Load, save, and delete model schemas.
- **Create Record Tab** — Dynamically generated form based on the loaded schema for creating new records.
- **View Records Tab** — Browse records for any registered model in a table. Click any cell to edit the value inline with a Save/Cancel editor that adapts to the field type (text, number, checkbox, datetime).

The UI communicates with the backend entirely through the REST API endpoints described above. When Basic Authentication is enabled, the interface prompts for credentials on first use and caches them for the session.

---

## Known Limitations

- **`node:sqlite` is experimental** — Requires Node.js >= 24 and may emit runtime warnings.
- **No migration system** — Schema updates replace the stored definition but do not alter existing table columns.
- **Single database file** — No multi-database or connection pooling support.
- **Type coercion** — Boolean fields are stored as `0`/`1` in SQLite and coerced to `true`/`false` on read. JSON fields are serialized (`JSON.stringify`) on write and deserialized (`JSON.parse`) on read. Other conversions (e.g., string-to-integer) are not performed.

# sqlcrud

An SQLite database service with a RESTful CRUD interface and JSON schema management.

sqlcrud is a Node.js service that uses SQLite to store schema-based data in tables. A JSON schema defines the structure of each SQLite table and governs how data is stored and retrieved as JavaScript objects.

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
- [Testing](#testing)
- [Web Interface](#web-interface)

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
| `SIGINT` | Begin shutdown countdown |
| `SIGTERM` | Begin graceful shutdown |
| `SIGHUP` | Begin graceful shutdown |
| `uncaughtException` | Log error and begin shutdown |

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
| `json` | string (serialized) | TEXT |
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

Create or update a schema. Creates the underlying SQLite table if it does not exist. If a schema already exists for the model, it is updated in place.

**Request Body:** Schema JSON object.

**Response:**
- `200 OK` — The saved schema object.
- `500` — `{ "error": "..." }`

#### `DELETE /api/schema/:model`

Delete a schema and drop the corresponding table.

**Response:**
- `200 OK` — `{ "success": true }`
- `500` — `{ "error": "..." }`

---

### Records

#### `GET /api/record/:model`

Get a record by ID. Requires an `id` query parameter or path segment.

**Response:**
- `200 OK` — The record object.
- `404` — `{ "error": "Record '...' not found for model '...'." }`

#### `POST /api/record/:model`

Create a new record. Validates `notnull` constraints against the schema.

**Request Body:** Record data object.

**Response:**
- `200 OK` — `{ "id": <number>, "success": true }`
- `500` — `{ "error": "..." }` (missing required fields, model not found, etc.)

#### `PUT /api/record/:model/:id`

Update an existing record by ID.

**Request Body:** Updated record data.

**Response:**
- `200 OK` — `{ "success": true }`
- `500` — `{ "error": "..." }`

#### `DELETE /api/record/:model/:id`

Delete a record by ID.

**Response:**
- `200 OK` — `{ "success": true }`
- `500` — `{ "error": "..." }`

---

## Architecture

### Project Structure

```
sqlcrud/
├── index.js              # Entry point — parses args, starts Application
├── config.json           # Runtime configuration
├── package.json          # Project metadata and dependencies
├── lib/
│   ├── application.js    # Orchestrates Database and WebServer lifecycle
│   ├── constants.js      # Shared constants (table names, type mappings)
│   ├── crudapi.js        # Express route handlers for CRUD operations
│   ├── database.js       # SQLite database wrapper (connect, exec, prepare)
│   ├── jsonconfig.js     # JSON config file reader and deep merge utility
│   ├── schema.js         # Schema validation, SQL generation, table init
│   ├── webserver.js      # Express/HTTP server, static file serving, TLS
│   └── index.js          # Client-side module entry (empty)
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

1. **Application** reads `config.json` and initializes Database and WebServer.
2. **Database** opens a connection to the SQLite file via `node:sqlite`.
3. **WebServer** creates an Express app, registers body parsers, applies the basic auth middleware (if configured), and instantiates CRUDAPI.
4. **CRUDAPI** calls `Schema.init()` to ensure the `schemas` table exists, then registers HTTP route handlers.
5. **Schema** manages the `schemas` meta-table and creates/drops user tables from JSON definitions.

---

## Testing

The test suite uses **Vitest** with **Supertest** for HTTP integration tests. It covers 108 tests across 5 files:

```bash
# Run all tests once
npm test

# Run with file watcher
npm run test:watch
```

### Test Coverage

| File | Tests | Scope |
|------|-------|-------|
| `tests/constants.test.js` | 10 | Constants and SchemaTypes mappings |
| `tests/jsonconfig.test.js` | 9 | Config file reading, JSON parsing, error handling, deep merge |
| `tests/schema.test.js` | 48 | Type conversion, column SQL generation, schema validation, object-to-schema inference, database CRUD operations |
| `tests/database.test.js` | 13 | Connection lifecycle, table listing, SQL execution, prepared statements, record validation |
| `tests/webserver.test.js` | 28 | Full HTTP API — schema CRUD, model listing, table listing, record creation validation, basic auth enforcement |

---

## Web Interface

The application serves a browser-based UI at `http://<host>:<port>/` featuring:

- **Schema Tab** — View and edit JSON schemas with the ACE code editor (syntax highlighting, validation). Load, save, and delete model schemas.
- **Create Record Tab** — Dynamically generated form based on the loaded schema for creating new records.
- **View Records Tab** — Browse and manage records for any registered model.

The UI communicates with the backend entirely through the REST API endpoints described above. When Basic Authentication is enabled, the interface prompts for credentials on first use and caches them for the session.

---

## Known Limitations

- **`node:sqlite` is experimental** — Requires Node.js >= 24 and may emit runtime warnings.
- **Record creation/update** — The `createRecord` method in `lib/database.js` references `runSQL()` and `getSQL()` methods which are not yet implemented. Record CRUD endpoints return 500 until these are added.
- **No migration system** — Schema updates replace the stored definition but do not alter existing table columns.
- **Single database file** — No multi-database or connection pooling support.

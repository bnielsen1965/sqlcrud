
import Constants from './constants.js';

// schema that defines the schema table
const SchemaModel = Constants.SchemaTable;
const SchemaTableSchema = {
  // field to hold the name of the schema
  model: {
    type: 'string',
    notnull: true,
    primary: true
  },
  // field to hold the schema JSON
  schema: {
    type: 'string',
    notnull: true
  }
};

// schema static methods
export default class Schema {

  /**
   * Validate that a model name contains only safe identifier characters.
   * Table names cannot be parameterized with prepared statements, so
   * interpolation must be guarded by strict validation.
   */
  static validateModelName (model) {
    if (!model || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(model)) {
      throw new Error(`Invalid model name '${model}'. Model names must contain only letters, digits, and underscores, and must start with a letter or underscore.`);
    }
  }

  /**
   * Find a field that serves as an INTEGER PRIMARY KEY (rowid alias) in the
   * given schema. Returns the field name or undefined if none exists.
   * SQLite exposes such a column as the sole rowid accessor — selecting
   * "rowid" separately will not yield a distinct column.
   */
  static findIntegerPrimaryKey (schema) {
    if (!schema) return undefined;
    for (const field in schema) {
      if (schema[field].type === 'integer' && schema[field].primary) {
        return field;
      }
    }
    return undefined;
  }

  /**
   * Reserved parameter names used internally for schema-table operations.
   * Field names are rejected if they match one of these to avoid parameter
   * collisions when user-supplied field names become SQLite named parameters.
   */
  static RESERVED_FIELD_NAMES = new Set(['model', 'schema']);

  /**
   * Validate that a column (field) name contains only safe identifier
   * characters.  Column names are interpolated into SQL (they cannot be
   * bound as parameters themselves).
   */
  static validateFieldName (field) {
    if (!field || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(field)) {
      throw new Error(`Invalid field name '${field}'. Field names must contain only letters, digits, and underscores, and must start with a letter or underscore.`);
    }
  }

  /**
   * Validate a field name for use in CRUD operations.
   *
   * In addition to the basic identifier rules enforced by
   * {@link validateFieldName}, this method also rejects names that would
   * collide with internal parameter names used by the schema-table
   * operations.  Use this method when a field name will become part of a
   * named parameter binding in a query.
   */
  static validateFieldNameForParams (field) {
    Schema.validateFieldName(field);
    if (Schema.RESERVED_FIELD_NAMES.has(field)) {
      throw new Error(`Invalid field name '${field}'. This name is reserved and cannot be used as a field name.`);
    }
  }

  /**
   * Build a SQLite named parameter key from a user-supplied field name.
   *
   * Prepends a unique prefix (`fld_`) so that even if a field name matches
   * an internal parameter name, the resulting key is distinct.  This
   * eliminates any possibility of parameter-binding collisions between
   * user data and framework internals.
   */
  static paramKey (field) {
    return `$fld_${field}`;
  }

  /**
   * Initialize database for schema use.
   *
   * The database must be initialized before it can be used with schemas.
   *
   * @param {module:database} - The database module instance.
   */
  static init (database) {
    Schema.initTable(SchemaModel, SchemaTableSchema, database);
  }

  // get the current list of models
  static getModels (database) {
    let statement = database.prepare(`SELECT model, schema FROM ${Constants.SchemaTable} ORDER BY model`);
    let models = statement.all({});
    return models;
  }

  // get a model schema
  static getSchema (model, database) {
    Schema.validateModelName(model);
    let statement = database.prepare(`SELECT schema FROM ${Constants.SchemaTable} WHERE model = $model`);
    let result = statement.all({ '$model': model });
    return result && result.length ? JSON.parse(result[0].schema) : null;
  }

  // create a new schema
  static createSchema (model, schema, database) {
    Schema.validateModelName(model);
    const oldSchema = Schema.getSchema(model, database);
    if (oldSchema) {
      database.exec('BEGIN TRANSACTION');
      try {
        let statement = database.prepare(`UPDATE ${Constants.SchemaTable} SET schema = $schema WHERE model = $model`);
        statement.run({ '$model': model, '$schema': JSON.stringify(schema) });
        database.exec('COMMIT');
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
    }
    else {
      database.exec('BEGIN TRANSACTION');
      try {
        Schema.initTable(model, schema, database);
        let statement = database.prepare(`INSERT INTO ${Constants.SchemaTable} (model, schema) VALUES ($model, $schema)`);
        statement.run({ '$model': model, '$schema': JSON.stringify(schema) });
        database.exec('COMMIT');
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
    }
  }

  // delete a schema
  static deleteSchema (model, database) {
    Schema.validateModelName(model);

    // DROP TABLE cannot be rolled back in SQLite (DDL causes an implicit
    // commit).  Perform it first so that a failure leaves the schema record
    // intact — the consistent state.  If DROP succeeds and the subsequent
    // DELETE fails, the schema record is orphaned, which is preferable to
    // the reverse (record gone but table still exists).
    database.exec(`DROP TABLE IF EXISTS ${model}`);

    database.exec('BEGIN TRANSACTION');
    try {
      let statement = database.prepare(`DELETE FROM ${Constants.SchemaTable} WHERE model = $model`);
      statement.run({ '$model': model });
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  }

  // get records matching field criteria
  static getRecord (model, fields, database) {
    Schema.validateModelName(model);
    const schema = Schema.getSchema(model, database);
    let whereClauses = '';
    let params = {};

    for (const field in fields) {
      Schema.validateFieldNameForParams(field);
      const key = Schema.paramKey(field);
      whereClauses += `${whereClauses.length ? ' AND ' : ''}${field} = ${key}`;
      params[key] = Schema.serializeValue(field, fields[field], schema);
    }

    let statement = database.prepare(whereClauses
      ? `SELECT * FROM ${model} WHERE ${whereClauses}`
      : `SELECT * FROM ${model}`);
    let result = statement.all(params);

    // Coerce values back to their schema-defined types
    if (!schema || !result || result.length === 0) {
      return result || [];
    }

    return result.map(row => Schema.coerceRow(row, schema));
  }

  // create a new record
  static createRecord (model, record, database) {
    Schema.validateModelName(model);
    const schema = Schema.getSchema(model, database);
    let columns = '';
    let placeholders = '';
    let params = {};

    for (const field in record) {
      Schema.validateFieldNameForParams(field);
      const key = Schema.paramKey(field);
      columns += `${columns.length ? ', ' : ''}${field}`;
      placeholders += `${placeholders.length ? ', ' : ''}${key}`;
      params[key] = Schema.serializeValue(field, record[field], schema);
    }

    let statement = database.prepare(`INSERT INTO ${model} (${columns}) VALUES (${placeholders})`);
    const result = statement.run(params);

    // Fetch the actual persisted row so the caller sees defaults, coercions,
    // and the auto-generated rowid — not the input as originally passed in.
    let fetchStatement = database.prepare(`SELECT * FROM ${model} WHERE rowid = $rowid`);
    let persisted = fetchStatement.all({ '$rowid': result.lastInsertRowid });

    if (persisted && persisted.length) {
      return Schema.coerceRow(persisted[0], schema);
    }
    return record;
  }

  // update a record
  static updateRecord (model, fields, record, database) {
    Schema.validateModelName(model);
    const schema = Schema.getSchema(model, database);
    let whereClauses = '';
    let whereParams = {};

    for (const field in fields) {
      Schema.validateFieldNameForParams(field);
      const key = Schema.paramKey(field);
      whereClauses += `${whereClauses.length ? ' AND ' : ''}${field} = ${key}`;
      whereParams[key] = Schema.serializeValue(field, fields[field], schema);
    }

    let setClauses = '';
    let updateParams = {};
    for (const field in record) {
      Schema.validateFieldNameForParams(field);
      const key = `$set_${field}`;
      setClauses += `${setClauses.length ? ', ' : ''}${field} = ${key}`;
      updateParams[key] = Schema.serializeValue(field, record[field], schema);
    }

    // Fetch the row before the update so we can return { before, after }.
    // Explicitly select rowid so we can track the matched row through the
    // update — even if the WHERE fields were among those modified.
    let checkStatement = database.prepare(`SELECT *, rowid FROM ${model} WHERE ${whereClauses}`);
    let existing = checkStatement.all(whereParams);

    if (existing.length === 0) {
      throw new Error(`No record found matching criteria in model '${model}'.`);
    }

    if (existing.length > 1) {
      throw new Error(`Update would affect ${existing.length} records. Provide more specific field criteria to match exactly one record.`);
    }

    // Determine the row identifier to use for fetching the updated row.
    // For tables with INTEGER PRIMARY KEY, rowid is aliased to that column
    // and not available as a separate column, so fall back to the rowid
    // column name itself.
    const row = existing[0];
    const rowIdKey = row.rowid !== undefined ? 'rowid' : Schema.findIntegerPrimaryKey(schema);
    const matchedRowId = row[rowIdKey];
    const before = Schema.coerceRow(row, schema);

    let allParams = { ...whereParams, ...updateParams };
    let statement = database.prepare(`UPDATE ${model} SET ${setClauses} WHERE ${whereClauses}`);
    const result = statement.run(allParams);

    if (result.changes === 0) {
      throw new Error(`No record found matching criteria in model '${model}'.`);
    }
    if (result.changes > 1) {
      throw new Error(`Update would affect ${result.changes} records. Provide more specific field criteria to match exactly one record.`);
    }

    // Fetch the updated row by rowid/primary key so we still find it even
    // if the original WHERE fields were changed by the update.
    const fetchParamKey = rowIdKey === 'rowid' ? '$rowid' : `$pk_${rowIdKey}`;
    let fetchStatement = database.prepare(`SELECT * FROM ${model} WHERE ${rowIdKey} = ${fetchParamKey}`);
    let updated = fetchStatement.all({ [fetchParamKey]: matchedRowId });
    const after = updated && updated.length ? Schema.coerceRow(updated[0], schema) : before;

    return { before, after };
  }

  // delete records matching field criteria
  static deleteRecord (model, fields, database) {
    Schema.validateModelName(model);
    const schema = Schema.getSchema(model, database);
    let whereClauses = '';
    let params = {};

    for (const field in fields) {
      Schema.validateFieldName(field);
      const key = Schema.paramKey(field);
      whereClauses += `${whereClauses.length ? ' AND ' : ''}${field} = ${key}`;
      params[key] = Schema.serializeValue(field, fields[field], schema);
    }

    let statement = database.prepare(`DELETE FROM ${model} WHERE ${whereClauses}`);
    statement.run(params);
  }

  // convert javascript data type to sqlite data type
  static jsTypeToSQL (type) {
    if (!Constants.SchemaTypes[type.toLowerCase()]) throw new Error(`No schema type defined for ${type}.`);
    return Constants.SchemaTypes[type.toLowerCase()];
  }

  /**
   * Serialize a value for binding in a SQLite prepared statement based on the schema type.
   * - Boolean fields: converts truthy/falsy strings ("true", "false", "0", "1") and non-string
   *   values to integer 0/1 so they match the INTEGER column used by SQLite.
   * - JSON fields: stringifies objects and arrays.
   * - All other types: pass through unchanged.
   * This is the inverse of coerceValue, which deserializes on read.
   */
  static serializeValue (field, value, schema) {
    if (value === null || value === undefined) return value;
    const fieldDef = schema && schema[field];
    if (!fieldDef) return value;

    const type = fieldDef.type.toLowerCase();
    if (type === 'boolean') {
      if (typeof value === 'string') {
        if (value.toLowerCase() === 'true') return 1;
        return 0;
      }
      return value ? 1 : 0;
    }
    if (type === 'json' && typeof value === 'object') {
      return JSON.stringify(value);
    }
    return value;
  }

  /**
   * Coerce a raw SQLite value back to the JSON type declared in the schema.
   * SQLite has no native boolean type (stores 0/1), no native datetime,
   * and no native JSON — so values returned from the database need to be
   * converted to match the user-facing schema types.
   */
  static coerceValue (field, value, schema) {
    if (value === null || value === undefined) return value;
    const fieldDef = schema[field];
    if (!fieldDef) return value;

    const type = fieldDef.type.toLowerCase();
    switch (type) {
      case 'boolean':
        return value === 1 || value === '1' || value === true;
      case 'json':
        try {
          return JSON.parse(value);
        } catch {
          return value;
        }
      default:
        return value;
    }
  }

  /**
   * Coerce every value in a result row according to the model schema.
   * Returns a new object with coerced values.
   */
  static coerceRow (row, schema) {
    if (!schema || !row) return row;
    const coerced = {};
    for (const key in row) {
      coerced[key] = Schema.coerceValue(key, row[key], schema);
    }
    return coerced;
  }

  

  /**
   * Initialize a database table based on the provided schema.
   * 
   * Each schema requires an associated table in the database.
   * This function is used to initialize that table.
   * 
   * @param {string} model - The name of the schema.
   * @param {schema} schema - The schema javascript object.
   * @param {module:database} database - The database module instance.
   */
  static initTable (model, schema, database) {
    let columns = Schema.schemaToColumns(schema);
    database.exec(`CREATE TABLE IF NOT EXISTS ${model} (${columns})`);
  }

  /**
   * Create database column definitions based on schema.
   * 
   * The function will walk the schema object field definitions and generate a string with 
   * the SQL column definitions used to create a table.
   * 
   * @param {object} schema - The javascript object that defines the schema.
   * @returns {string} The SQL column definitions used to create the table for the schema.
   */
  static schemaToColumns (schema) {
    let columns = '';
    let primary_key = '';
    for (const field in schema) {
      Schema.validateFieldName(field);
      // validate schema field is a definition
      if (typeof schema[field] !== 'object' || schema[field] === null || Array.isArray(schema[field]) || !Object.keys(schema[field]).length || !schema[field].type) {
        throw new Error(`The schema field ${field} is not a valid schema field definition.`);
      }
      columns += `${columns.length ? ', ' : ''}${field}`;
      for (const prop in schema[field]) {
        switch (prop) {
          case 'type':
            columns += ` ${Schema.jsTypeToSQL(schema[field].type)}`;
            break;

          case 'length':
            if (schema[field].type !== 'string') {
              throw new Error(`Property "length" is not valid on schema field ${field}.`);
            }
            columns += ` CHECK(length(${field}) <= ${schema[field].length})`;
            break;

          case 'unique':
            columns += ` UNIQUE`;
            break;

          case 'primary':
            primary_key += `${primary_key.length ? ', ' : 'PRIMARY KEY ('}${field}`;
            break;

          case 'notnull':
            columns += ` NOT NULL`;
            break;

          default:
            throw new Error(`Invalid schema field property ${prop} for schema field ${field}.`);
        }
      }
    }
    primary_key = primary_key.length ? `, ${primary_key})` : '';
    return `${columns}${primary_key}`;
  }

  // validate a schema object
  static validateSchema (schema) {
    if (typeof schema !== 'object' || schema === null || Array.isArray(schema)) {
      throw new Error('Schema must be a JSON object.');
    }

    for (const field in schema) {
      const fieldDef = schema[field];

      // field definition must be an object
      if (typeof fieldDef !== 'object' || fieldDef === null || Array.isArray(fieldDef)) {
        throw new Error(`Field '${field}' must be an object.`);
      }

      // field must have a type
      if (!fieldDef.type) {
        throw new Error(`Field '${field}' must have a 'type' property.`);
      }

      // validate type
      const validTypes = ['string', 'integer', 'float', 'boolean', 'json', 'datetime', 'time'];
      if (!validTypes.includes(fieldDef.type.toLowerCase())) {
        throw new Error(`Invalid type '${fieldDef.type}' for field '${field}'. Valid types: ${validTypes.join(', ')}`);
      }

      // validate length (only for strings)
      if (fieldDef.type === 'string' && fieldDef.length !== undefined) {
        if (typeof fieldDef.length !== 'number' || fieldDef.length < 1) {
          throw new Error(`Field '${field}' length must be a positive number.`);
        }
      }

      // validate unique
      if (fieldDef.unique !== undefined && typeof fieldDef.unique !== 'boolean') {
        throw new Error(`Field '${field}' 'unique' must be a boolean.`);
      }

      // validate primary
      if (fieldDef.primary !== undefined && typeof fieldDef.primary !== 'boolean') {
        throw new Error(`Field '${field}' 'primary' must be a boolean.`);
      }

      // validate notnull
      if (fieldDef.notnull !== undefined && typeof fieldDef.notnull !== 'boolean') {
        throw new Error(`Field '${field}' 'notnull' must be a boolean.`);
      }

      // validate mutually exclusive constraints
      if (fieldDef.primary && fieldDef.unique) {
        // primary implies unique, but we allow it
      }

      if (fieldDef.primary && fieldDef.notnull) {
        // primary implies notnull, but we allow it
      }
    }

    return true;
  }

  // create a JSON schema based on the provided javascript object
  static schemaFromObject (obj) {
    const schema = {};
    for (const key in obj) {
      const value = obj[key];
      if (value === null || value === undefined) continue;

      let type = 'string';
      let constraints = {};

      if (typeof value === 'number' && !isNaN(value)) {
        type = Number.isInteger(value) ? 'integer' : 'float';
      } else if (typeof value === 'boolean') {
        type = 'boolean';
      } else if (typeof value === 'object' && value !== null) {
        type = 'json';
      }

      schema[key] = { type };

      if (typeof value === 'string' && value.length > 0) {
        constraints.length = value.length;
      }

      if (type === 'string' && value.trim() === value) {
        constraints.notnull = true;
      }

      if (type === 'string' && value.trim() === '') {
        // empty string is allowed
      }

      schema[key] = { ...schema[key], ...constraints };
    }
    return schema;
  }

}


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
   * Validate that a column (field) name contains only safe identifier characters.
   * Column names are interpolated into SQL and cannot be parameterized.
   */
  static validateFieldName (field) {
    if (!field || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(field)) {
      throw new Error(`Invalid field name '${field}'. Field names must contain only letters, digits, and underscores, and must start with a letter or underscore.`);
    }
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
    database.exec('BEGIN TRANSACTION');
    try {
      let statement = database.prepare(`DELETE FROM ${Constants.SchemaTable} WHERE model = $model`);
      statement.run({ '$model': model });

      statement = database.prepare(`DROP TABLE IF EXISTS ${model}`);
      statement.run({});
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  }

  // get records matching field criteria
  static getRecord (model, fields, database) {
    Schema.validateModelName(model);
    let whereClauses = '';
    let params = {};

    for (const field in fields) {
      Schema.validateFieldName(field);
      whereClauses += `${whereClauses.length ? ' AND ' : ''}${field} = $${field}`;
      params[`$${field}`] = fields[field];
    }

    let statement = database.prepare(whereClauses
      ? `SELECT * FROM ${model} WHERE ${whereClauses}`
      : `SELECT * FROM ${model}`);
    let result = statement.all(params);
    return result && result.length ? result : [];
  }

  // create a new record
  static createRecord (model, record, database) {
    Schema.validateModelName(model);
    let columns = '';
    let placeholders = '';
    let params = {};

    for (const field in record) {
      Schema.validateFieldName(field);
      columns += `${columns.length ? ', ' : ''}${field}`;
      placeholders += `${placeholders.length ? ', ' : ''}$${field}`;
      params[`$${field}`] = record[field];
    }

    let statement = database.prepare(`INSERT INTO ${model} (${columns}) VALUES (${placeholders})`);
    statement.run(params);

    // record.id = statement.lastInsertRowid;
    return record;
  }

  // update a record
  static updateRecord (model, fields, record, database) {
    Schema.validateModelName(model);
    let whereClauses = '';
    let whereParams = {};

    for (const field in fields) {
      Schema.validateFieldName(field);
      whereClauses += `${whereClauses.length ? ' AND ' : ''}${field} = $${field}`;
      whereParams[`$${field}`] = fields[field];
    }

    let setClauses = '';
    let updateParams = {};
    for (const field in record) {
      Schema.validateFieldName(field);
      setClauses += `${setClauses.length ? ', ' : ''}${field} = $${field}`;
      updateParams[`$${field}`] = record[field];
    }

    let checkStatement = database.prepare(`SELECT * FROM ${model} WHERE ${whereClauses}`);
    let existing = checkStatement.all(whereParams);

    if (existing.length === 0) {
      throw new Error(`No record found matching criteria in model '${model}'.`);
    }

    if (existing.length > 1) {
      throw new Error(`Update would affect ${existing.length} records. Provide more specific field criteria to match exactly one record.`);
    }

    let allParams = { ...whereParams, ...updateParams };
    let statement = database.prepare(`UPDATE ${model} SET ${setClauses} WHERE ${whereClauses}`);
    statement.run(allParams);

    return existing[0];
  }

  // delete records matching field criteria
  static deleteRecord (model, fields, database) {
    Schema.validateModelName(model);
    let whereClauses = '';
    let params = {};

    for (const field in fields) {
      Schema.validateFieldName(field);
      whereClauses += `${whereClauses.length ? ' AND ' : ''}${field} = $${field}`;
      params[`$${field}`] = fields[field];
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
            columns += ` PRIMARY KEY`;
            break;

          case 'notnull':
            columns += ` NOT NULL`;
            break;

          default:
            throw new Error(`Invalid schema field property ${prop} for schema field ${field}.`);
        }
      }
    }
    return columns;
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
      const validTypes = ['string', 'integer', 'float', 'boolean', 'json', 'datetime'];
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

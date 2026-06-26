
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
   * Initialize database for schema use.
   * 
   * The database must be initialized before it can be used with schemas.
   * 
   * @param {module:database} - The database module instance.
   */
  static async init (database) {
    Schema.initTable(SchemaModel, SchemaTableSchema, database);
  }

  // get the current list of models
  static async getModels (database) {
    let statement = database.prepare(`SELECT model, schema FROM ${Constants.SchemaTable} ORDER BY model`);
    let models = statement.all({});
    return models;
  }

  // get a model schema
  static async getSchema (model, database) {
    let statement = database.prepare(`SELECT schema FROM ${Constants.SchemaTable} WHERE model = $model`);
    let result = statement.all({ '$model': model });
    return result && result.length ? JSON.parse(result[0].schema) : null;
  }

  // create a new schema
  static async createSchema (model, schema, database) {
    let oldSchema;
    try {
      oldSchema = await Schema.getSchema(model, database);
    }
    catch (error) {
      throw error;
    }
    let sql;
    if (oldSchema) {
      let statement = database.prepare(`UPDATE ${Constants.SchemaTable} SET schema = $schema WHERE model = $model`);
      statement.run({ '$model': model, '$schema': JSON.stringify(schema) });
    }
    else {
      Schema.initTable(model, schema, database);
      let statement = database.prepare(`INSERT INTO ${Constants.SchemaTable} (model, schema) VALUES ($model, $schema)`);
      statement.run({ '$model': model, '$schema': JSON.stringify(schema) });
    }
  }

  // delete a schema
  static async deleteSchema (model, database) {
    let statement = database.prepare(`DELETE FROM ${Constants.SchemaTable} WHERE model = $model`);
    statement.run({ '$model': model });

    statement = database.prepare(`DROP TABLE IF EXISTS ${model}`);
    statement.run({});
  }

  // convert javascript data type to sqlite data type
  static jsTypeToSQL (type) {
    if (!Constants.SchemaTypes[type.toLowerCase()]) throw new Error(`No schema type defined for ${type}.`);
    return Constants.SchemaTypes[type.toLowerCase()];
  }

  // get table schema
  static getTableSchema (table, database) {

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
    console.log("INIT", model, columns)
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
      // validate schema field is a definition
      if (typeof schema[field] !== 'object' || schema[field] === null || Array.isArray(schema[field] || !Object.keys(schema[field]).length) || !schema[field].type) {
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

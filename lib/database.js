
import JSONConfig from './jsonconfig.js';
import { DatabaseSync } from 'node:sqlite';
import Schema from './schema.js';


const Defaults = {
  filename: 'default.db'
};

export default class Database {
  constructor (Config) {
    this.Config = JSONConfig.merge(Defaults, Config);
  }

  // start database
  start () {
    this.database = new DatabaseSync(this.Config.filename);
  }

  // stop database
  stop () {
    this.database.close();
  }

  // get list of tables in database
  getTableList () {
    let statement = this.prepare("SELECT name FROM sqlite_schema WHERE type = $type AND name NOT LIKE $like");
    let result = statement.all({ '$type': 'table', '$like': 'sqlite_%' });
    return result.map(row => row.name);
  }

  exec (sql) {
    return this.database.exec(sql);
  }
  
  prepare (sql, options) {
    return this.database.prepare(sql, options);
  }


  
  // create a record based on schema
  async createRecord(model, data) {
    const schema = await Schema.getSchema(model, this);
    if (!schema) {
      throw new Error(`Model ${model} not found`);
    }

    for (const field in schema) {
      if (schema[field].notnull && (data[field] === undefined || data[field] === null)) {
        throw new Error(`Field ${field} is required for model ${model}`);
      }
    }

    const keys = Object.keys(schema);
    const values = keys.map(key => data[key]);
    const sql = `INSERT INTO ${model} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`;

    await this.runSQL(sql, values);
    const result = await this.getSQL("SELECT last_insert_rowid() as id");
    return result ? result.id : null;
  }

}
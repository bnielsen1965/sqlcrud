
import JSONConfig from './jsonconfig.js';
import { DatabaseSync } from 'node:sqlite';


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
    if (this.database) {
      this.database.close();
      this.database = null;
    }
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

}
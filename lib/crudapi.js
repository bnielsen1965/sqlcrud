
import JSONConfig from './jsonconfig.js';
import Schema from './schema.js';
import Constants from './constants.js';

const Defaults = {};

export default class CRUDAPI {
  constructor (Config, app, database) {
    this.Config = JSONConfig.merge(Defaults, Config);
    this.app = app;
    this.database = database;
  }

  // start api
  async start () {
    await Schema.init(this.database);
    this.app.get('/api/tables', this.getTables.bind(this));
    this.app.get('/api/models', this.getModels.bind(this));
    this.app.get('/api/schema/:model', this.getSchema.bind(this));
    this.app.post('/api/schema/:model', this.postSchema.bind(this));
    this.app.delete('/api/schema/:model', this.deleteSchema.bind(this));
    this.app.get('/api/record/:model', this.getRecord.bind(this));
    this.app.post('/api/record/:model', this.postRecord.bind(this));
    this.app.put('/api/record/:model', this.putRecord.bind(this));
    this.app.delete('/api/record/:model', this.deleteRecord.bind(this));
  }

  // stop api
  stop () {

  }

  // get a list of the tables in the database
  getTables (req, res, next) {
    let tableList = this.database.getTableList();
    res.json(tableList);
  }

  // get a list of models defined in schemas
  getModels (req, res, next) {
    let models;
    try {
      models = Schema.getModels(this.database);
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
    res.json(models);
  }

  // get schema definition for a model
  getSchema (req, res, next) {
    const { model } = req.params;
    let result;
    try {
      result = Schema.getSchema(model, this.database);

      if (!result) {
        return res.status(404).json({ error: `Model '${model}' not found.` });
      }

      res.json(result);
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }

  // save a model schema
  postSchema (req, res, next) {
    let { model } = req.params;
    let result;
    try {
      Schema.validateSchema(req.body);
      Schema.createSchema(model, req.body, this.database);
    }
    catch (error) {
      return res.status(500).json({ error: error.message });
    }
    res.json(req.body);
  }

  // delete a model schema
  async deleteSchema (req, res, next) {
    let { model } = req.params;
    try {
      await Schema.deleteSchema(model, this.database);
    }
    catch (error) {
      return res.status(500).json({ error: error.message });
    }
    res.json({ success: true });
  }

  // get records by field matches from query parameters
  async getRecord (req, res, next) {
    const { model } = req.params;
    const fields = req.query;

    try {
      const records = await Schema.getRecord(model, fields, this.database);
      res.json(records);
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }

  // create a new record
  async postRecord (req, res, next) {
    const { model } = req.params;
    const recordData = req.body;

    try {
      const record = await Schema.createRecord(model, recordData, this.database);
      res.json(record);
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }

  // update a record
  async putRecord (req, res, next) {
    const { model } = req.params;
    const fields = req.query;
    const recordData = req.body;

    try {
      const record = await Schema.updateRecord(model, fields, recordData, this.database);
      res.json(record);
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }

  // delete records by field matches from query parameters
  async deleteRecord (req, res, next) {
    const { model } = req.params;
    const fields = req.query;

    try {
      await Schema.deleteRecord(model, fields, this.database);
      res.json({ success: true });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }
}
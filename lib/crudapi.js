
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
    this.app.put('/api/record/:model/:id', this.putRecord.bind(this));
    this.app.delete('/api/record/:model/:id', this.deleteRecord.bind(this));
  }

  // stop api
  stop () {

  }

  // get a list of the tables in the database
  async getTables (req, res, next) {
    let tableList = await this.database.getTableList();
    res.json(tableList);
  }

  // get a list of models defined in schemas
  async getModels (req, res, next) {
    let models;
    try {
      models = await Schema.getModels(this.database);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
    res.json(models);
  }

  // get schema definition for a model
  async getSchema (req, res, next) {
    const { model } = req.params;
    let result;
    try {
      result = await Schema.getSchema(model, this.database);

      if (!result) {
        return res.status(404).json({ error: `Model '${model}' not found.` });
      }

      // const schema = result[0].fields;
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  // save a model schema
  async postSchema (req, res, next) {
    let { model } = req.params;
    let result;
    try {
      await Schema.createSchema(model, req.body, this.database);
    }
    catch (error) {
      console.log(error)
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

  // get a record by id
  async getRecord (req, res, next) {
    const { model } = req.params;
    const { id } = req.params;

    try {
      const record = await this.database.getRecord(model, id);

      if (!record) {
        return res.status(404).json({ error: `Record '${id}' not found for model '${model}'.` });
      }

      res.json(record);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  // create a new record
  async postRecord (req, res, next) {
    const { model } = req.params;
    const recordData = req.body;

    try {
      const recordId = await this.database.createRecord(model, recordData);
      res.json({ id: recordId, success: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  // update a record
  async putRecord (req, res, next) {
    const { model } = req.params;
    const { id } = req.params;
    const recordData = req.body;

    try {
      await this.database.updateRecord(model, id, recordData);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  // delete a record
  async deleteRecord (req, res, next) {
    const { model } = req.params;
    const { id } = req.params;

    try {
      await this.database.deleteRecord(model, id);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
}
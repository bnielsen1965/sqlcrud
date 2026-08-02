
import JSONConfig from './jsonconfig.js';
import Schema from './schema.js';
import Constants from './constants.js';
import WebServer from './webserver.js';

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
    this.app.get('/api/status', this.getStatus.bind(this));
    this.app.get('/api/tables', this.getTables.bind(this));
    this.app.get('/api/models', this.getModels.bind(this));
    this.app.get('/api/schema/:model', this.getSchema.bind(this));
    this.app.post('/api/schema/:model', this.postSchema.bind(this));
    this.app.delete('/api/schema/:model', this.deleteSchema.bind(this));
    this.app.get('/api/record/:model', this.getRecord.bind(this));
    this.app.get('/api/record/:model/count', this.countRecord.bind(this));
    this.app.post('/api/record/:model', this.postRecord.bind(this));
    this.app.post('/api/search/:model', this.postSearch.bind(this));
    this.app.put('/api/record/:model', this.putRecord.bind(this));
    this.app.delete('/api/record/:model', this.deleteRecord.bind(this));
  }

  // stop api
  stop () {

  }

  // get current status/metrics
  getStatus (req, res, next) {
    const tracker = WebServer.statusTracker;

    // Get total TPM from the global tracker
    const totalTPM = tracker.total.getTPM();

    // Build table list from table trackers, sorted by TPM descending
    const tables = [];
    for (const [name, tableTracker] of tracker.tables.entries()) {
      const tpm = tableTracker.getTPM();
      if (tpm > 0) {
        tables.push({ name, tpm });
      }
    }
    tables.sort((a, b) => b.tpm - a.tpm);

    // Build IP list from IP trackers, sorted by TPM descending
    const ips = [];
    for (const [ip, ipTracker] of tracker.ips.entries()) {
      const tpm = ipTracker.getTPM();
      if (tpm > 0) {
        ips.push({ ip, tpm });
      }
    }
    ips.sort((a, b) => b.tpm - a.tpm);

    res.json({
      totalTransactionsPerMinute: totalTPM,
      tablesPerMinute: tables,
      ipsPerMinute: ips
    });
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

  // get count of records by field matches from query parameters
  async countRecord (req, res, next) {
    const { model } = req.params;
    const fields = req.query;

    try {
      const count = await Schema.countRecords(model, fields, this.database);
      res.json({ count });
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

  // search records with pagination via POST body
  async postSearch (req, res, next) {
    const { model } = req.params;
    const { filter, page, limit } = req.body || {};

    try {
      const results = await Schema.searchRecords(model, filter || {}, this.database, { page, limit });
      res.json(results);
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }
}

import JSONConfig from './jsonconfig.js';
import CRUDAPI from './crudapi.js';
import Express from 'express';
import BodyParser from 'body-parser';
import HTTP from 'http';
import HTTPS from 'https';
import FS from 'fs';
import Path from 'path';
import TransactionTracker from './transactiontracker.js';

const Defaults = {
  port: null,
  address: '0.0.0.0',
  keyFile: null,
  certFile: null,
  publicDirectory: './public',
  basicAuth: null
};

export default class WebServer {
  static connectionSockets = new Set();

  // Status tracking state using TransactionTracker instances
  static statusTracker = {
    // Global tracker for all API transactions (1-minute window)
    total: new TransactionTracker(60000),
    // Per-table trackers (persistent, never removed) - Map<tableName, TransactionTracker>
    tables: new Map(),
    // Per-IP trackers (removed after 5 min idle) - Map<ip, TransactionTracker>
    ips: new Map(),
    // Cleanup interval handle
    cleanupInterval: null,
    // TTL for IP entries (5 minutes in ms)
    IP_TTL_MS: 5 * 60 * 1000
  };

  constructor (Config, database) {
    this.Config = JSONConfig.merge(Defaults, Config);
    this.isSecure = false;
    this.database = database;
  }

  // Extract client IP from request
  static getClientIP (req) {
    // Check for forwarded headers first (behind proxy)
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) {
      return forwarded.split(',')[0].trim();
    }
    return req.socket.remoteAddress || req.ip || 'unknown';
  }

  // Extract table/model name from API routes
  static extractTableFromPath (path) {
    // Match routes like /api/record/:model, /api/search/:model, /api/schema/:model
    const match = path.match(/^\/api\/(?:record|search|schema)\/([^/?]+)/);
    return match ? match[1] : null;
  }

  // Get or create a tracker for a table (tables are persistent)
  static getTableTracker (tableName) {
    const trackers = WebServer.statusTracker.tables;
    if (!trackers.has(tableName)) {
      trackers.set(tableName, new TransactionTracker(60000));
    }
    return trackers.get(tableName);
  }

  // Get or create a tracker for an IP address
  static getIPTracker (ip) {
    const trackers = WebServer.statusTracker.ips;
    if (!trackers.has(ip)) {
      trackers.set(ip, new TransactionTracker(60000));
    }
    return trackers.get(ip);
  }

  // Create request tracking middleware
  createStatusTrackingMiddleware () {
    return function statusTrackingMiddleware (req, res, next) {
      // Only track API requests (exclude the status endpoint itself)
      if (!req.path.startsWith('/api/') || req.path === '/api/status') {
        return next();
      }

      const ip = WebServer.getClientIP(req);
      const table = WebServer.extractTableFromPath(req.path);

      // Record the transaction in the global tracker
      WebServer.statusTracker.total.add();

      // Record in the table-specific tracker if applicable
      if (table) {
        WebServer.getTableTracker(table).add();
      }

      // Record in the IP-specific tracker
      WebServer.getIPTracker(ip).add();

      next();
    };
  }

  // Start periodic cleanup of stale IP trackers
  startStatusCleanup () {
    const tracker = WebServer.statusTracker;

    // Run cleanup every minute
    tracker.cleanupInterval = setInterval(() => {
      const now = Date.now();

      // Remove IP trackers that have been idle for more than IP_TTL_MS
      for (const [ip, ipTracker] of tracker.ips.entries()) {
        const newest = ipTracker.getNewestTimestamp();
        if (newest && (now - newest > tracker.IP_TTL_MS)) {
          tracker.ips.delete(ip);
        }
      }
    }, 60000);
  }

  // Stop periodic cleanup
  stopStatusCleanup () {
    const tracker = WebServer.statusTracker;
    if (tracker.cleanupInterval) {
      clearInterval(tracker.cleanupInterval);
      tracker.cleanupInterval = null;
    }
  }

  // Decode Basic auth header and validate credentials
  createBasicAuthMiddleware () {
    const config = this.Config;
    return function basicAuthMiddleware (req, res, next) {
      // If no basicAuth configured, skip
      if (!config.basicAuth || !config.basicAuth.enabled) {
        return next();
      }

      const header = req.headers.authorization;
      if (!header || !header.startsWith('Basic ')) {
        res.setHeader('WWW-Authenticate', 'Basic');
        return res.status(401).json({ error: 'Authentication required.' });
      }

      try {
        const encoded = header.slice(6);
        const decoded = Buffer.from(encoded, 'base64').toString('utf-8');
        const delimiterIndex = decoded.indexOf(':');
        if (delimiterIndex === -1) {
          res.setHeader('WWW-Authenticate', 'Basic');
          return res.status(401).json({ error: 'Invalid credentials.' });
        }
        const username = decoded.slice(0, delimiterIndex);
        const password = decoded.slice(delimiterIndex + 1);

        if (username !== config.basicAuth.username || password !== config.basicAuth.password) {
          res.setHeader('WWW-Authenticate', 'Basic');
          return res.status(401).json({ error: 'Invalid credentials.' });
        }
      } catch {
        res.setHeader('WWW-Authenticate', 'Basic');
        return res.status(401).json({ error: 'Invalid credentials.' });
      }

      next();
    };
  }

  // start web server
  async start () {
    // create server
    this.app = Express();
    if (this.Config.keyFile && this.Config.certFile) this.server = this.createSecureServer();
    else this.server = this.createServer();
    this.server.on('error', error => console.error(`Server error. ${error.message}`));

    // track connections
    this.server.on('connection', socket => {
      WebServer.connectionSockets.add(socket);
      socket.on('close', () => WebServer.connectionSockets.delete(socket));
    });

    // parsers
    this.app.use(BodyParser.urlencoded({ extended: true }));
    this.app.use(BodyParser.json());

    // Basic auth middleware — applies to all routes
    this.app.use(this.createBasicAuthMiddleware());

    // Status tracking middleware (after auth so we only track authenticated requests)
    this.app.use(this.createStatusTrackingMiddleware());

    // CRUD operations
    this.crudapi = new CRUDAPI(this.Config, this.app, this.database);
    this.crudapi.start();

    // Start status cleanup interval
    this.startStatusCleanup();

    // static routes
    let staticPath = Path.resolve(this.Config.publicDirectory);
    this.app.use(Express.static(staticPath));

    // handle json parse errors
    this.app.use((error, req, res, next) => {
      if (error instanceof Error && error.status === 400 && "body" in error) {
        return res.status(400).json({ error: `Bad JSON request. ${error.message}` });
      }
      next(error);
    });

    // catch-all error handler — ensures all unhandled errors return JSON
    this.app.use((error, req, res, next) => {
      console.error(`Unhandled error: ${error.message || error}`);
      res.status(error.status || 500).json({ error: error.message || 'Internal server error.' });
    });

    // start listening
    return await this.listen();
  }

  // stop the web server
  stop () {
    this.server.close();
    // handle timeouts from socket close requests
    this.server.on('timeout', socket => {
      let res = socket._httpMessage;
      if (!res) {
        // has no response, destroy
        socket.destroy();
        return;
      }

      if (res.headersSent) {
        // response already sent, destroy
        socket.destroy();
        return;
      }

      // respond with close message
      res.writeHead(500, { Connection: 'close' });
      res.end();
    });
    // close connections
    WebServer.connectionSockets.forEach(socket => {
      let res = socket._httpMessage;
      if (!res) {
        socket.destroy();
        return;
      }
      if (!res.headersSent) res.setHeader('Connection', 'close');
      socket.setTimeout(3000);
    });
    WebServer.connectionSockets.clear();
  }

  // create https server
  createSecureServer () {
    let key, cert;
    try {
      key = FS.readFileSync(this.Config.keyFile);
      cert = FS.readFileSync(this.Config.certFile);
    }
    catch (error) {
      throw new Error(`Failed to get key and certificate files. ${error.message}`);
    }
    this.isSecure = true;
    return HTTPS.createServer({ key, cert }, this.app);
  }

  // create plain http server
  createServer () {
    return HTTP.createServer(this.app);
  }

  // start listening for connections
  listen () {
    return new Promise((resolve, reject) => {
      let port = (this.Config.port ? this.Config.port : (this.isSecure ? 443 : 80));
      let address = (this.Config.address ? this.Config.address : '127.0.0.1');
      this.server.listen(port, address, () => {
        resolve({ port, address: address });
      })
    });
  }
}
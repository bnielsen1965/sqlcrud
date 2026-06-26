
import JSONConfig from './jsonconfig.js';
import CRUDAPI from './crudapi.js';
import Express from 'express';
import BodyParser from 'body-parser';
import HTTP from 'http';
import HTTPS from 'https';
import FS from 'fs';
import Path from 'path';

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

  constructor (Config, database) {
    this.Config = JSONConfig.merge(Defaults, Config);
    this.isSecure = false;
    this.database = database;
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
        return res.status(401).json({ error: 'Authentication required.' });
      }

      try {
        const encoded = header.slice(6);
        const decoded = Buffer.from(encoded, 'base64').toString('utf-8');
        const delimiterIndex = decoded.indexOf(':');
        if (delimiterIndex === -1) {
          return res.status(401).json({ error: 'Invalid credentials.' });
        }
        const username = decoded.slice(0, delimiterIndex);
        const password = decoded.slice(delimiterIndex + 1);

        if (username !== config.basicAuth.username || password !== config.basicAuth.password) {
          return res.status(401).json({ error: 'Invalid credentials.' });
        }
      } catch {
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
      socket.on('close', () => WebServer.connectionSockets.delete(this));
    });

    // parsers
    this.app.use(BodyParser.urlencoded({ extended: true }));
    this.app.use(BodyParser.json());

    // Basic auth middleware — applies to all routes
    this.app.use(this.createBasicAuthMiddleware());

    // CRUD operations
    this.crudapi = new CRUDAPI(this.Config, this.app, this.database);
    this.crudapi.start();

    // handle json parse errors
    this.app.use((error, req, res, next) => {
      if (error instanceof Error && error.status === 400 && "body" in error) {
        return res.status(400).json({ error: `Bad JSON request. ${error.message}` });
      }
      next();
    });

    // static routes
    let staticPath = Path.resolve(this.Config.publicDirectory);
    this.app.use(Express.static(staticPath));
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
      if (!res.headersSent) res.setHeader('Connectxion', 'close');
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
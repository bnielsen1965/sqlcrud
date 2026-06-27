
import JSONConfig from './jsonconfig.js';
import WebServer from './webserver.js';
import Database from './database.js';

const Defaults = {
  shutdownTimeout: 5,
  terminationCountdown: 3
};

export default class Application {
  constructor (Config) {
    this.isShutdown = false;
    this.Config = JSONConfig.merge(Defaults, Config);
    if (this.Config.debug) console.log(`Application Config: ${JSON.stringify(this.Config, null, 2)}`);
    // setup termination and shutdown handlers
    this.terminationCountdown = this.Config.terminationCountdown;
    process
      .on('SIGHUP', this.shutdownHandler.bind(this))
      .on('SIGINT', this.terminationHandler.bind(this))
      .on('SIGTERM', this.shutdownHandler.bind(this))
      .on('uncaughtException', this.exceptionHandler.bind(this));
  }

  // start the application
  async start () {
    this.database = new Database(this.Config.Database);
    await this.database.start();

    this.webserver = new WebServer(this.Config.WebServer, this.database);
    let result = await this.webserver.start();
    console.log(`Server listening on ${result.address}:${result.port}`);
  }

  // stop the application
  async stop () {
    await this.webserver.stop();
    await this.database.stop();
  }

  // handle exceptions
  exceptionHandler (error) {
    console.log(error);
    this.shutdownHandler(`Exception: ${error.message}`);
  }

  // handle termination request
  terminationHandler () {
    if (!this.isShutdown) return this.shutdownHandler();
    // force exit
    if (this.isShutdown && !this.terminationCountdown) {
      console.log('Termination forcing exit...');
      process.exit(1);
    }
    console.log(`Termination countdown ${this.terminationCountdown--}`);
  }

  // handle shutdown
  async shutdownHandler (reason) {
    if (this.isShutdown) return;
    this.isShutdown = true;
    console.log(`Shutting down${reason ? ' (reason: ' + reason + ')' : ''}...`);
    const _this = this;
    let to = setTimeout(() => { _this.exit(1, "Shutdown timed out, forcing exit."); }, _this.Config.shutdownTimeout * 60 * 1000);
    to.unref();
    await this.stop();
  }
}
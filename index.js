
import JSONConfig from './lib/jsonconfig.js';
import Application from './lib/application.js';

const args = process.argv.slice(2);

// process command line arguments
try {
  switch (args[0]) {
    default:
      start();
      break;
  }
}
catch (error) {
  console.log(`Error running application. ${error.message}`);
  process.exit(1);
}

// start the application
async function start () {
  const Config = await JSONConfig.readConfig('./config.json');
  if (Config.debug) console.log(`Read Config: ${JSON.stringify(Config, null, 2)}`);
  const app = new Application(Config);
  console.log('Application starting...');
  await app.start();
}

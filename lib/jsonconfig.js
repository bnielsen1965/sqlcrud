
import FS from 'fs';
import Path from 'path';

export default class JSONConfig {
  // read json config file
  static readConfig (configPath) {
    let configJSON;
    // read file
    try {
      configJSON = FS.readFileSync(configPath).toString();
    }
    catch (error) {
      throw new Error(`Error reading configuration file ${configPath}. ${error.message}`);
    }
    // parse file
    let config;
    try {
      config = JSON.parse(configJSON);
    }
    catch (error) {
      let message = error.message;
      // create details syntax error message
      if (error instanceof SyntaxError) {
        // find position in json
        let match = /at position (\d+)/.exec(error.message);
        if (match) {
          // margin around syntax error
          let margin = 20;
          const position = parseInt(match[1], 10);
          const start = position - margin < 0 ? 0 : position - margin;
          const end = position + margin > configJSON.length ? configJSON.length : position + margin;
          message = `JSON syntax error at ${position}: \n...${configJSON.substring(start, end)}...\n`;
        }
      }
      throw new Error(`Error parsing JSON from file ${configPath}. ${message}`);
    }
    return config;
  }

  // merge config objects
  static merge (o1, o2) {
    const result = { ...o1 };
    for (let key in o2) {
      if (o2.hasOwnProperty(key)) {
        if (o2[key] instanceof Object && o1[key] instanceof Object) {
          result[key] = JSONConfig.merge(o1[key], o2[key]);
        } else {
          result[key] = o2[key];
        }
      }
    }
    return result;
  }
}

export default {
  // sqlite table where schemas are stored
  SchemaTable: "schemas",
  APIKeysTable: "apikeys",

  // conversion table for javascript types to sqlite types
  SchemaTypes: {
    "string":     "TEXT",
    "integer": "INTEGER",
    "float":      "REAL",
    "boolean": "INTEGER",
    "time":       "TEXT",
    "datetime":   "TEXT",
    "json":       "TEXT"
  }
};

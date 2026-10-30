'use strict';
const { createHash } = require('node:crypto');
/** Rows must be sorted by fingerprint; used identically for legacy rows and resolved input. */
exports.resolutionHash = function resolutionHash(rows) {
  const hash = createHash('sha256');
  for (const row of rows) hash.update(row.fingerprint).update('\0').update(String(row.confidence)).update('\0').update(row.metadata_json ?? '{}').update('\n');
  return hash.digest('hex');
};

// Loaded in the parser and its nested OCR worker during offline runtime tests.
const deny = () => { throw new Error('OCR attempted network access'); };
for (const protocol of ['node:http', 'node:https']) {
  const module = require(protocol);
  module.request = deny;
  module.get = deny;
}
globalThis.fetch = deny;

// Keep cold-start module phases observable without logging document contents.
// This preload runs only in the synthetic offline fixture, never in the app.
require('node:module').registerHooks({
  load(url, context, nextLoad) {
    const label = url.replace(/^.*\/node_modules\//, '').slice(-160);
    process.stderr.write(`ocr:load ${label}\n`);
    const loaded = nextLoad(url, context);
    process.stderr.write(`ocr:loaded ${label}\n`);
    return loaded;
  },
});

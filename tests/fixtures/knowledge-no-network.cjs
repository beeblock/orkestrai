// Loaded in the parser and its nested OCR worker during offline runtime tests.
const deny = () => { throw new Error('OCR attempted network access'); };
for (const protocol of ['node:http', 'node:https']) {
  const module = require(protocol);
  module.request = deny;
  module.get = deny;
}
globalThis.fetch = deny;

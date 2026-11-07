'use strict';

const catalog = require('../extension/i18n/vi.json');

function format(text, args) {
  return args ? text.replace(/\{(\w+)\}/g, (m, k) => (Object.prototype.hasOwnProperty.call(args, k) ? String(args[k]) : m)) : text;
}

// Throws on an unknown id: test/i18n.test.js checks every literal id statically, so a throw here is a bug
// that tests reach before a member would see a raw id.
function t(id, args) {
  const text = catalog[id];
  if (typeof text !== 'string') throw new Error(`i18n: no catalog entry "${id}"`);
  return format(text, args);
}

// The entries a webview needs, posted to it in its init message.
function catalogFor(prefix) {
  return Object.fromEntries(Object.entries(catalog).filter(([id]) => id.startsWith(prefix)));
}

module.exports = { t, catalogFor };

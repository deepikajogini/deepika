const test = require('node:test');
const assert = require('node:assert/strict');

const { buildApp } = require('./server');

test('buildApp exposes the HTTP app factory', () => {
  assert.equal(typeof buildApp, 'function');
});

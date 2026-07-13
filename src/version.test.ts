import assert from 'node:assert/strict'
import test from 'node:test'
import { SERVER_VERSION } from './version.js'

test('server version follows package metadata', () => {
  assert.equal(SERVER_VERSION, '0.1.0')
})

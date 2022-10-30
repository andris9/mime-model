'use strict';

const test = require('node:test');
const assert = require('node:assert').strict;

test('Basic tests', async t => {
    await t.test('shoud pass', async () => {
        assert.ok(1);
    });
});

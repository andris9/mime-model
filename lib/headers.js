'use strict';

const assert = require('node:assert/strict');
const { HeaderLine } = require('./header-line');

const DEFAULT_BR = Buffer.from('\r\n');

class Headers {
    static create(opts = {}) {
        return new Headers(opts);
    }

    constructor(opts = {}) {
        this.headers = [];
        this.options = opts;

        if (Buffer.isBuffer(opts.defaultBr)) {
            this._defaultLineBreak = opts.defaultBr;
        } else if (typeof opts.defaultBr === 'string') {
            this._defaultLineBreak = Buffer.from(opts.defaultBr);
        }
    }

    insert(header) {
        if (typeof header === 'string') {
            header = new HeaderLine({ stringValue: header });
        }

        assert.ok(header instanceof HeaderLine, 'Not a header object');

        // No default line break set, so use the first one we see
        if (header.br && !this._defaultLineBreak) {
            this._defaultLineBreak = header.br;
        }

        if (header.terminator) {
            this.terminator = header;
            return;
        }

        this.headers.unshift(header);
    }

    values() {
        return this.headers;
    }

    get(key) {
        let searchKey = (key || '').toString().toLowerCase().trim();
        let searchResults = [];
        for (let header of this.headers) {
            if (header.key === searchKey) {
                searchResults.push(header);
            }
        }
        return searchResults;
    }

    get buffer() {
        return Buffer.concat(this.headers.map(header => header.buffer).concat(this.terminator ? this.terminator.buffer : this._defaultLineBreak || DEFAULT_BR));
    }

    toJSON() {
        return this.headers
            .map(header => header.toJSON())
            .concat(this.terminator ? this.terminator.toJSON() : [(this._defaultLineBreak || DEFAULT_BR).toString()])
            .join('');
    }
}

module.exports = { Headers };

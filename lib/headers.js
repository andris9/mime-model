'use strict';

const assert = require('node:assert/strict');
const { HeaderLine } = require('./header-line');

const SYMBOLS = {
    OPTS: Symbol('Options'),
    HEADERS: Symbol('Headers'),
    TERMINATOR_LINE: Symbol('TerminatorLine'),
    DEFAULT_BR: Symbol('DefaultBr')
};

const DEFAULT_BR = Buffer.from('\r\n');

class Headers {
    static create(opts = {}) {
        return new Headers(opts);
    }

    constructor(opts = {}) {
        this[SYMBOLS.HEADERS] = [];
        this[SYMBOLS.OPTS] = opts;

        if (Buffer.isBuffer(opts.defaultBr)) {
            this[SYMBOLS.DEFAULT_BR] = opts.defaultBr;
        } else if (typeof opts.defaultBr === 'string') {
            this[SYMBOLS.DEFAULT_BR] = Buffer.from(opts.defaultBr);
        }
        console.log('DEFAULT BR', this[SYMBOLS.DEFAULT_BR]);
    }

    insert(header) {
        if (typeof header === 'string') {
            header = new HeaderLine({ stringValue: header });
        }

        assert.ok(header instanceof HeaderLine, 'Not a header object');

        // No default line break set, so use the first one we see
        if (header.br && !this[SYMBOLS.DEFAULT_BR]) {
            this[SYMBOLS.DEFAULT_BR] = header.br;
        }

        if (header.terminator) {
            this[SYMBOLS.TERMINATOR_LINE] = header;
            return;
        }

        this[SYMBOLS.HEADERS].unshift(header);
    }

    values() {
        return this[SYMBOLS.HEADERS];
    }

    get(key) {
        let searchKey = (key || '').toString().toLowerCase().trim();
        let searchResults = [];
        for (let header of this[SYMBOLS.HEADERS]) {
            if (header.key === searchKey) {
                searchResults.push(header);
            }
        }
        return searchResults;
    }

    get buffer() {
        return Buffer.concat(
            this[SYMBOLS.HEADERS]
                .map(header => header.buffer)
                .concat(this[SYMBOLS.TERMINATOR_LINE] ? this[SYMBOLS.TERMINATOR_LINE].buffer : this[SYMBOLS.DEFAULT_BR] || DEFAULT_BR)
        );
    }

    toJSON() {
        return this[SYMBOLS.HEADERS]
            .map(header => header.toJSON())
            .concat(this[SYMBOLS.TERMINATOR_LINE] ? this[SYMBOLS.TERMINATOR_LINE].toJSON() : [(this[SYMBOLS.DEFAULT_BR] || DEFAULT_BR).toString()])
            .join('');
    }
}

module.exports = { Headers };

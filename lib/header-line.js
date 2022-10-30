'use strict';

const libmime = require('libmime');

const SYMBOLS = {
    RAW_HEADER: Symbol('RawHeader'),
    HEADER_KEY: Symbol('HeaderKey'),
    HEADER_KEY_OC: Symbol('HeaderKeyOC'),
    HEADER_VALUE: Symbol('HeaderValue'),
    HEADER_VALUE_STR: Symbol('HeaderValueStr'),
    TERMINATOR_LINE: Symbol('TerminatorLine')
};

class HeaderLine {
    static create(opts = {}) {
        return new HeaderLine(opts);
    }

    constructor(opts = {}) {
        const { rawLines, isTerminator } = opts;

        if (isTerminator) {
            // this line is immutabel and can't be edited
            this[SYMBOLS.TERMINATOR_LINE] = true;
        }

        if (rawLines) {
            this[SYMBOLS.RAW_HEADER] = rawLines;

            let stringHeader = rawLines.map(row => (row.raw ? row.raw.toString() : '') + (row.br ? row.br.toString() : '')).join('');

            this[SYMBOLS.HEADER_VALUE_STR] = stringHeader;

            if (stringHeader) {
                let headerKey;
                let headerValue;

                let splitPos = stringHeader.indexOf(':');
                if (splitPos >= 0) {
                    headerKey = stringHeader.substring(0, splitPos).replace(/\r*\n/g, ' ').replace(/\s+/g, ' ').trim();
                    headerValue = stringHeader
                        .substring(splitPos + 1)
                        .replace(/\r*\n/g, ' ')
                        .replace(/\s+/g, ' ')
                        .trim();
                    this[SYMBOLS.HEADER_KEY_OC] = headerKey;
                    this[SYMBOLS.HEADER_KEY] = headerKey.toLowerCase();
                    this[SYMBOLS.HEADER_VALUE] = headerValue;
                } else {
                    headerKey = stringHeader.replace(/\r*\n/g, ' ').replace(/\s+/g, ' ').trim();
                    this[SYMBOLS.HEADER_KEY_OC] = headerKey;
                    this[SYMBOLS.HEADER_KEY] = headerKey.toLowerCase();
                }
            }
        }
    }

    toJSON() {
        return this[SYMBOLS.HEADER_VALUE_STR] || '';
    }

    get buffer() {
        if (!this[SYMBOLS.RAW_HEADER]) {
            return Buffer.alloc(0);
        }
        return Buffer.concat(this[SYMBOLS.RAW_HEADER].flatMap(row => [row.raw, row.br].filter(val => val)));
    }

    get key() {
        return this[SYMBOLS.HEADER_KEY];
    }

    get value() {
        return this[SYMBOLS.HEADER_VALUE];
    }

    get terminator() {
        return this[SYMBOLS.TERMINATOR_LINE];
    }

    get parsedValue() {
        return libmime.parseHeaderValue(this[SYMBOLS.HEADER_VALUE] || '');
    }
}

module.exports = { HeaderLine };

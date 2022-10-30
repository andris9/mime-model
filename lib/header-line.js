'use strict';

const libmime = require('libmime');

class HeaderLine {
    static create(opts = {}) {
        return new HeaderLine(opts);
    }

    constructor(opts = {}) {
        const { rawLines, isTerminator } = opts;

        if (isTerminator) {
            // this line is immutabel and can't be edited
            this.terminator = true;
        }

        if (rawLines) {
            this._rawHeader = rawLines;

            let stringHeader = rawLines.map(row => (row.raw ? row.raw.toString() : '') + (row.br ? row.br.toString() : '')).join('');

            this._headerValueString = stringHeader;

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
                    this._headerKeyOc = headerKey;

                    this.key = headerKey.toLowerCase();
                    this.value = headerValue;
                } else {
                    headerKey = stringHeader.replace(/\r*\n/g, ' ').replace(/\s+/g, ' ').trim();
                    this._headerKeyOc = headerKey;

                    this.key = headerKey.toLowerCase();
                }
            }
        }
    }

    get buffer() {
        if (!this._rawHeader) {
            return Buffer.alloc(0);
        }
        return Buffer.concat(this._rawHeader.flatMap(row => [row.raw, row.br].filter(val => val)));
    }

    get parsedValue() {
        return libmime.parseHeaderValue(this.value || '');
    }

    toJSON() {
        return this._headerValueString || '';
    }
}

module.exports = { HeaderLine };

'use strict';

const SYMBOLS = {
    PARENT_NODE: Symbol('ParentNode'),
    RAW_CONTENT: Symbol('RawContent')
};

class LeafNode {
    static create(type, raw, br) {
        return new LeafNode(type, raw, br);
    }

    constructor(type, raw, br) {
        this.type = type;

        this[SYMBOLS.RAW_CONTENT] = [{ raw, br }];

        this[SYMBOLS.PARENT_NODE] = null;
    }

    get parent() {
        return this[SYMBOLS.PARENT_NODE];
    }

    set parent(node) {
        this[SYMBOLS.PARENT_NODE] = node;
    }

    pushLine(raw, br) {
        this[SYMBOLS.RAW_CONTENT].push({ raw, br });
    }

    getBuffer(opts = {}) {
        // first leaf does not have a suffix linebreak
        if (opts.firstChild || !['BOUNDARY', 'BOUNDARY_FINAL'].includes(this.type)) {
            return Buffer.concat(this[SYMBOLS.RAW_CONTENT].flatMap(row => [row.raw, row.br].filter(val => val)));
        }

        // ensure newline before boundary lines
        let prefixEntry = [opts.defaultBr];

        return Buffer.concat(prefixEntry.concat(this[SYMBOLS.RAW_CONTENT].flatMap(row => [row.raw, row.br].filter(val => val))));
    }

    get buffer() {
        return Buffer.concat(this[SYMBOLS.RAW_CONTENT].flatMap(row => [row.raw, row.br].filter(val => val)));
    }

    isEmpty() {
        if (!this[SYMBOLS.RAW_CONTENT].length) {
            return true;
        }

        if (
            this[SYMBOLS.RAW_CONTENT].length === 1 &&
            (!this[SYMBOLS.RAW_CONTENT][0].raw || !this[SYMBOLS.RAW_CONTENT][0].raw.length) &&
            (!this[SYMBOLS.RAW_CONTENT][0].br || !this[SYMBOLS.RAW_CONTENT][0].br.length)
        ) {
            return true;
        }

        return false;
    }

    removeLastBr() {
        if (this[SYMBOLS.RAW_CONTENT].length) {
            let lastEntry = this[SYMBOLS.RAW_CONTENT][this[SYMBOLS.RAW_CONTENT].length - 1];
            if (lastEntry.br) {
                let lastBr = lastEntry.br;
                lastEntry.br = null;
                if (!lastEntry.raw || !lastEntry.raw.length) {
                    this[SYMBOLS.RAW_CONTENT].pop();
                }
                return lastBr;
            }
        }
        return null;
    }

    toJSON() {
        return {
            entity: 'LeafNode',
            type: this.type,
            value: this.buffer.toString()
        };
    }
}

module.exports = { LeafNode };

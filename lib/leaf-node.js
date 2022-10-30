'use strict';

const SYMBOLS = {
    PARENT_NODE: Symbol('ParentNode'),
    RAW: Symbol('RawLine'),
    TYPE: Symbol('Type')
};

class LeafNode {
    static create(type, raw, br) {
        return new LeafNode(type, raw, br);
    }

    constructor(type, raw, br) {
        this[SYMBOLS.TYPE] = type;
        this[SYMBOLS.RAW] = [{ raw, br }];

        this[SYMBOLS.PARENT_NODE] = null;

        this._type = this[SYMBOLS.TYPE];
        this._value = Buffer.concat(this[SYMBOLS.RAW].flatMap(row => [row.raw, row.br].filter(val => val))).toString();
    }

    setParent(node) {
        this[SYMBOLS.PARENT_NODE] = node;
    }

    pushLine(raw, br) {
        this[SYMBOLS.RAW].push({ raw, br });

        this._type = this[SYMBOLS.TYPE];
        this._value = Buffer.concat(this[SYMBOLS.RAW].flatMap(row => [row.raw, row.br].filter(val => val))).toString();
    }

    get type() {
        return this[SYMBOLS.TYPE];
    }

    get buffer() {
        return Buffer.concat(this[SYMBOLS.RAW].flatMap(row => [row.raw, row.br].filter(val => val)));
    }
}

module.exports = { LeafNode };

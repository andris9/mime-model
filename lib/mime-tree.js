'use strict';

const { MimeNode } = require('./mime-node');

const STATES = {
    HEADER: Symbol('Header'),
    BODY: Symbol('Body')
};

const CHARS = {
    HYPHEN: 0x2d
};

const SYMBOLS = {
    CURRENT_NODE: Symbol('CurrentNode'),
    CURRENT_STATE: Symbol('CurrentState')
};

class MimeTree {
    static create(opts = {}) {
        return new MimeTree(opts);
    }

    constructor(opts = {}) {
        this.options = opts;

        if (Buffer.isBuffer(opts.lineBr)) {
            this.lineBreak = opts.lineBr;
        } else if (typeof opts.lineBr === 'string') {
            this.lineBreak = Buffer.from(opts.lineBr);
        }

        this[SYMBOLS.CURRENT_STATE] = STATES.HEADER;
        this.rootNode = MimeNode.create(
            Object.assign(
                {
                    defaultBr: this.options.defaultBr || this.options.lineBr
                },
                this.options
            )
        );

        this[SYMBOLS.CURRENT_NODE] = this.rootNode;
    }

    async createNextNode() {
        let node = MimeNode.create(
            Object.assign(
                {
                    defaultBr: this.options.defaultBr || this.options.lineBr
                },
                this.options
            )
        );

        this[SYMBOLS.CURRENT_NODE].appendChild(node);
        this[SYMBOLS.CURRENT_NODE] = node;

        return node;
    }

    async parseLine(lineBuf, br, opts = {}) {
        if (br && this.lineBreak) {
            br = this.lineBreak;
        }

        // check MIME boundary
        if (
            (this[SYMBOLS.CURRENT_NODE] !== this.rootNode || this.rootNode.multipartType) &&
            lineBuf.length > 2 &&
            lineBuf[0] === CHARS.HYPHEN &&
            lineBuf[1] === CHARS.HYPHEN
        ) {
            // could be a boundary
            let boundary = this[SYMBOLS.CURRENT_NODE].matchBoundary(lineBuf.subarray(2));
            if (boundary) {
                // NB! Remove last line break,
                let lastBr = this[SYMBOLS.CURRENT_NODE].removeLastBr();

                switch (boundary.type) {
                    case 'BOUNDARY_SEPARATOR': {
                        this[SYMBOLS.CURRENT_NODE] = boundary.node;
                        let separatorLeaf = this[SYMBOLS.CURRENT_NODE].addLeaf('SEPARATOR', lineBuf, br || null);
                        if (lastBr) {
                            separatorLeaf.unshift(null, lastBr);
                        }

                        this.createNextNode();
                        this[SYMBOLS.CURRENT_STATE] = STATES.HEADER;

                        break;
                    }

                    case 'BOUNDARY_TERMINATOR': {
                        this[SYMBOLS.CURRENT_NODE] = boundary.node;
                        let separatorLeaf = this[SYMBOLS.CURRENT_NODE].addLeaf('SEPARATOR', lineBuf, br || null);
                        if (lastBr) {
                            separatorLeaf.unshift(null, lastBr);
                        }
                        // move up 1 step
                        if (this[SYMBOLS.CURRENT_NODE].parentNode) {
                            this[SYMBOLS.CURRENT_NODE].cleanup();
                            this[SYMBOLS.CURRENT_NODE] = this[SYMBOLS.CURRENT_NODE].parentNode;
                        }
                        this[SYMBOLS.CURRENT_STATE] = STATES.BODY;
                        break;
                    }
                }
                return;
            }
        }

        switch (this[SYMBOLS.CURRENT_STATE]) {
            case STATES.HEADER: {
                this[SYMBOLS.CURRENT_NODE].pushRawHeader(lineBuf, br || null);
                if (lineBuf.length === 0 || opts.final) {
                    this[SYMBOLS.CURRENT_NODE].commitHeaders();
                    this[SYMBOLS.CURRENT_STATE] = STATES.BODY;
                }
                break;
            }

            case STATES.BODY: {
                // content node, no need to check for boundaries
                if (this[SYMBOLS.CURRENT_NODE].multipartType) {
                    this[SYMBOLS.CURRENT_NODE].pushLeafData('BODY', lineBuf, br);
                    break;
                }
                this[SYMBOLS.CURRENT_NODE].pushRawContent(lineBuf, br);
                break;
            }
        }
    }

    async parse(eml) {
        if (typeof eml === 'string') {
            eml = Buffer.from(eml);
        }

        let lineStart = 0;

        for (let i = 0; i < eml.length; i++) {
            let c = eml[i];
            if (c === 0x0a) {
                let lineEnd = i;
                while (lineStart < lineEnd && eml[lineEnd - 1] === 0x0d) {
                    lineEnd--;
                }
                await this.parseLine(eml.subarray(lineStart, lineEnd), eml.subarray(lineEnd, i + 1));
                lineStart = i + 1;
            }
        }

        if (lineStart < eml.length) {
            await this.parseLine(eml.subarray(lineStart), null, { final: true });
        } else {
            // empty buffer
            await this.parseLine(Buffer.alloc(0), null, { final: true });
        }

        this.rootNode.cleanup();
    }

    async serialize() {
        let { chunks, len } = await this.rootNode.serialize();
        return Buffer.concat(chunks, len);
    }
}

module.exports = { MimeTree };

'use strict';

const STATES = {
    HEADER: Symbol('Header'),
    BODY: Symbol('Body')
};

const CHARS = {
    HYPHEN: 0x2d
};

class MimeParser {
    // use MimeNode as an argument to avoid circular referencing between source files
    static create(MimeNode, opts = {}) {
        return new MimeParser(MimeNode, opts);
    }

    constructor(MimeNode, opts = {}) {
        this.MimeNode = MimeNode;

        this.options = opts;

        if (Buffer.isBuffer(opts.lineBr)) {
            this.lineBreak = opts.lineBr;
        } else if (typeof opts.lineBr === 'string') {
            this.lineBreak = Buffer.from(opts.lineBr);
        }

        this.currentState = STATES.HEADER;
        this.rootNode = this.MimeNode.create(
            null,
            null,
            Object.assign(
                {
                    defaultBr: this.options.defaultBr || this.options.lineBr
                },
                this.options
            )
        );

        this.currentNode = this.rootNode;
    }

    async createNextNode() {
        let node = this.MimeNode.create(
            null,
            null,
            Object.assign(
                {
                    defaultBr: this.options.defaultBr || this.options.lineBr
                },
                this.options
            )
        );

        this.currentNode.addChildNodeToArray(node);
        this.currentNode = node;

        return node;
    }

    async parseLine(lineBuf, br, opts = {}) {
        if (br && this.lineBreak) {
            br = this.lineBreak;
        }

        // check MIME boundary
        if (
            (this.currentNode !== this.rootNode || this.rootNode.multipartType) &&
            lineBuf.length > 2 &&
            lineBuf[0] === CHARS.HYPHEN &&
            lineBuf[1] === CHARS.HYPHEN
        ) {
            // could be a boundary
            let boundary = this.currentNode.matchBoundary(lineBuf.subarray(2));
            if (boundary) {
                // NB! Remove last line break,
                let lastBr = this.currentNode.removeLastBr();

                switch (boundary.type) {
                    case 'BOUNDARY_SEPARATOR': {
                        this.currentNode = boundary.node;
                        let separatorLeaf = this.currentNode.addLeaf('BOUNDARY', lineBuf, br || null);

                        if (lastBr) {
                            separatorLeaf.setPrefixBr(lastBr);
                        }

                        this.createNextNode();
                        this.currentState = STATES.HEADER;

                        break;
                    }

                    case 'BOUNDARY_TERMINATOR': {
                        this.currentNode = boundary.node;
                        let separatorLeaf = this.currentNode.addLeaf('BOUNDARY_FINAL', lineBuf, br || null);

                        if (lastBr) {
                            separatorLeaf.setPrefixBr(lastBr);
                        }

                        // move up 1 step
                        if (this.currentNode.parent) {
                            this.currentNode.cleanup();
                            this.currentNode = this.currentNode.parent;
                        }
                        this.currentState = STATES.BODY;
                        break;
                    }
                }
                return;
            }
        }

        switch (this.currentState) {
            case STATES.HEADER: {
                this.currentNode.pushRawHeader(lineBuf, br || null);
                if (lineBuf.length === 0 || opts.final) {
                    this.currentNode.commitHeaders();
                    this.currentState = STATES.BODY;
                }
                break;
            }

            case STATES.BODY: {
                // content node, no need to check for boundaries
                if (this.currentNode.multipartType) {
                    this.currentNode.pushLeafData('BODY', lineBuf, br);
                    break;
                }
                this.currentNode.pushRawContent(lineBuf, br);
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
                this.parseLine(eml.subarray(lineStart, lineEnd), eml.subarray(lineEnd, i + 1));
                lineStart = i + 1;
            }
        }

        if (lineStart < eml.length) {
            this.parseLine(eml.subarray(lineStart), null, { final: true });
        } else {
            // empty buffer
            this.parseLine(Buffer.alloc(0), null, { final: true });
        }

        this.rootNode.cleanup();
    }
}

module.exports = { MimeParser };

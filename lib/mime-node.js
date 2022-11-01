'use strict';

const assert = require('node:assert/strict');
const { Headers } = require('./headers');
const { HeaderLine } = require('./header-line');
const { LeafNode } = require('./leaf-node');
const { MimeParser } = require('./mime-parser');

const DEFAULT_BR = Buffer.from('\r\n');

const CHARS = {
    TAB: 0x09,
    SPACE: 0x20,
    HYPHEN: 0x2d
};

const SYMBOLS = {
    PARENT_NODE: Symbol('ParentNode'),
    RAW_CONTENT: Symbol('RawContent'),
    RAW_HEADERS: Symbol('RawHeaders'),
    CHILD_NODES: Symbol('ChildNodes')
};

class MimeNode {
    static create(contentType, opts = {}) {
        return new MimeNode(contentType, opts);
    }

    static async from(source, opts = {}) {
        let parser = MimeParser.create(MimeNode, opts);
        await parser.parse(source);
        return parser.rootNode;
    }

    constructor(contentType, opts = {}) {
        this.options = opts;
        this[SYMBOLS.RAW_HEADERS] = [];
        this[SYMBOLS.PARENT_NODE] = null;

        this.contentType = contentType || null;

        let defaultBr = opts.defaultBr || DEFAULT_BR;
        if (typeof defaultBr === 'string') {
            defaultBr = Buffer.from(defaultBr);
        }
        this.defaultBr = defaultBr;

        this.headers = Headers.create(opts);

        this[SYMBOLS.RAW_CONTENT] = { chunks: [], len: 0 };

        if (this.contentType) {
            this.prepareContentType();
        }
    }

    prepareContentType() {}

    matchBoundary(lineBuf) {
        if (!this.multipartBoundary) {
            if (!this[SYMBOLS.PARENT_NODE]) {
                return false;
            }
            return this[SYMBOLS.PARENT_NODE].matchBoundary(lineBuf);
        }

        let line = lineBuf.toString();
        if (line.length === this.multipartBoundary.length && line === this.multipartBoundary) {
            return {
                type: 'BOUNDARY_SEPARATOR',
                node: this
            };
        }

        if (
            line.length - 2 === this.multipartBoundary.length &&
            line.substring(line.length - 2) === '--' &&
            line.substring(0, this.multipartBoundary.length) === this.multipartBoundary
        ) {
            return {
                type: 'BOUNDARY_TERMINATOR',
                node: this
            };
        }

        return false;
    }

    commitHeaders() {
        let lastLine = true; // in this case the first line is actually the last as we are looping backwards

        for (let i = this[SYMBOLS.RAW_HEADERS].length - 1; i >= 0; i--) {
            let entry = this[SYMBOLS.RAW_HEADERS][i];
            let firstByte = entry[0].raw.length ? entry[0].raw[0] : null;
            if ((i > 0 && firstByte === CHARS.SPACE) || firstByte === CHARS.TAB) {
                // push as a continuation line to the previous entry
                this[SYMBOLS.RAW_HEADERS][i - 1] = this[SYMBOLS.RAW_HEADERS][i - 1].concat(entry);
                this[SYMBOLS.RAW_HEADERS].splice(i, 1);
                continue;
            }

            // insert adds to the top
            this.headers.insert(
                HeaderLine.create({
                    rawLines: entry,
                    // terminator line is the last empty line
                    isTerminator: lastLine && entry.length === 1 && entry[0].br && (!entry[0].raw || entry[0].raw.length === 0)
                })
            );

            if (lastLine) {
                lastLine = false;
            }
        }

        this.updateContentType();
        this.updateContentTransferEncoding();
    }

    updateContentType() {
        let contentTypeHeaders = this.headers.get('Content-Type');
        if (!contentTypeHeaders || !contentTypeHeaders.length) {
            this.contentType = null;
            return;
        }

        let parsedContentType = contentTypeHeaders[0].parsedValue;

        if (parsedContentType) {
            this.contentType = parsedContentType.value.toLowerCase().trim();

            if (/^multipart\//i.test(this.contentType) && parsedContentType.params.boundary) {
                this.multipartType = this.contentType.substring(this.contentType.indexOf('/') + 1);
            }

            if (this.multipartType) {
                this[SYMBOLS.CHILD_NODES] = [];
                this.multipartBoundary = parsedContentType.params.boundary || null;
            }
        }
    }

    updateContentTransferEncoding() {
        let contentTransferEncodingHeaders = this.headers.get('Content-Transfer-Encoding');
        if (!contentTransferEncodingHeaders || !contentTransferEncodingHeaders.length) {
            this.contentTransferEncoding = null;
            return;
        }

        let parsedContentTransferEncoding = contentTransferEncodingHeaders[0].parsedValue;

        if (parsedContentTransferEncoding) {
            this.contentTransferEncoding = parsedContentTransferEncoding.value.toLowerCase().trim();
        }
    }

    appendChild(node) {
        assert.ok(this.multipartType, 'Not a multipart node');

        this[SYMBOLS.CHILD_NODES].push(node);
        node.setParent(this);
        return node;
    }

    addLeaf(type, raw, br) {
        let leafNode = LeafNode.create(type, raw, br);
        this[SYMBOLS.CHILD_NODES].push(leafNode);
        return leafNode;
    }

    removeLastBr() {
        // extract and return last linebreak of current node
        if (this[SYMBOLS.CHILD_NODES]) {
            // Multipart node.
            // Only interested in padding lines.
            let lastChild = this[SYMBOLS.CHILD_NODES].length > 0 ? this[SYMBOLS.CHILD_NODES][this[SYMBOLS.CHILD_NODES].length - 1] : null;
            if (lastChild && lastChild instanceof LeafNode && lastChild.type === 'BODY') {
                let lastBr = lastChild.removeLastBr();
                return lastBr;
            }
        } else if (this[SYMBOLS.RAW_CONTENT].chunks.length) {
            // Content node
            let lastChunk = this[SYMBOLS.RAW_CONTENT].chunks[this[SYMBOLS.RAW_CONTENT].chunks.length - 1];
            if (lastChunk && lastChunk.length) {
                let lastBr = this[SYMBOLS.RAW_CONTENT].chunks.pop();
                this[SYMBOLS.RAW_CONTENT].len -= lastBr.length;
                return lastBr;
            }
        }

        return null;
    }

    cleanup() {
        if (this[SYMBOLS.CHILD_NODES]) {
            // The loop does not include the first child
            // There can be an empty first child which indicates an extra newline for the following boundary
            for (let i = this[SYMBOLS.CHILD_NODES].length - 1; i > 0; i--) {
                let childNode = this[SYMBOLS.CHILD_NODES][i];
                if (childNode && childNode instanceof LeafNode && childNode.isEmpty()) {
                    // remove empty leaf
                    this[SYMBOLS.CHILD_NODES].splice(i, 1);
                }
            }
        }
    }

    get parent() {
        return this[SYMBOLS.PARENT_NODE];
    }

    setParent(node) {
        this[SYMBOLS.PARENT_NODE] = node;
    }

    pushRawHeader(raw, br) {
        this[SYMBOLS.RAW_HEADERS].push([{ raw, br }]);
    }

    // Mostly padding bytes between boundaries: extra newlines, "This is a multi-part message in MIME format." etc.
    pushLeafData(type, raw, br) {
        let lastNode = this[SYMBOLS.CHILD_NODES] && this[SYMBOLS.CHILD_NODES][this[SYMBOLS.CHILD_NODES].length - 1];
        if (lastNode instanceof LeafNode && lastNode.type === type) {
            lastNode.pushLine(raw, br);
        } else {
            this.addLeaf(type, raw, br);
        }
    }

    // text, attachments etc
    pushRawContent(raw, br) {
        let chunks = [raw, br].filter(val => val);

        this[SYMBOLS.RAW_CONTENT].chunks.push(...chunks);
        this[SYMBOLS.RAW_CONTENT].len += chunks.reduce((prev, cur) => prev + cur.length, 0);

        if (this[SYMBOLS.RAW_CONTENT].chunks.length > 250) {
            this[SYMBOLS.RAW_CONTENT].chunks = [Buffer.concat(this[SYMBOLS.RAW_CONTENT].chunks, this[SYMBOLS.RAW_CONTENT].len)];
            this[SYMBOLS.RAW_CONTENT].len = this[SYMBOLS.RAW_CONTENT].chunks[0].length;
        }
    }

    getChildNodes() {
        if (!this.multipartType) {
            return null;
        }

        return this[SYMBOLS.CHILD_NODES].filter(entry => !(entry instanceof LeafNode));
    }

    async build() {
        let headers = this.headers.buffer;
        let outputChunks = [headers];
        let outputLen = headers.length;

        if (this[SYMBOLS.CHILD_NODES]) {
            for (let i = 0; i < this[SYMBOLS.CHILD_NODES].length; i++) {
                let childNode = this[SYMBOLS.CHILD_NODES][i];
                if (!childNode) {
                    continue;
                }

                if (childNode instanceof LeafNode) {
                    let childBuffer = childNode.getBuffer({
                        firstChild: !i,
                        defaultBr: this.defaultBr
                    });
                    outputChunks.push(childBuffer);
                    outputLen += childBuffer.length;
                } else if (typeof childNode.serialize === 'function') {
                    let childContent = await childNode.build();
                    outputChunks.push(...childContent.chunks);
                    outputLen += childContent.len;
                }
            }
        } else {
            outputChunks.push(...this[SYMBOLS.RAW_CONTENT].chunks);
            outputLen += this[SYMBOLS.RAW_CONTENT].len;
        }

        return { chunks: outputChunks, len: outputLen };
    }

    async serialize() {
        let { chunks, len } = await this.build();
        return Buffer.concat(chunks, len);
    }
}

module.exports = { MimeNode };

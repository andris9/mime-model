'use strict';

const assert = require('node:assert/strict');
const { Headers } = require('./headers');
const { HeaderLine } = require('./header-line');
const { LeafNode } = require('./leaf-node');

const SYMBOLS = {
    PARENT_NODE: Symbol('ParentNode'),
    OPTS: Symbol('Options'),
    RAW_HEADERS: Symbol('RawHeaders'),
    HEADERS: Symbol('Headers'),
    RAW_HEADER: Symbol('RawHeader'),
    RAW_CONTENT: Symbol('RawContent'),
    MULTIPART: Symbol('Multipart'),
    BOUNDARY: Symbol('MultipartBoundary')
};

const CHARS = {
    TAB: 0x09,
    SPACE: 0x20,
    HYPHEN: 0x2d
};

class MimeNode {
    static create(opts = {}) {
        return new MimeNode(opts);
    }

    constructor(opts = {}) {
        this[SYMBOLS.OPTS] = opts;
        this[SYMBOLS.RAW_HEADERS] = [];
        this[SYMBOLS.PARENT_NODE] = null;
        this[SYMBOLS.HEADERS] = Headers.create(opts);
        this[SYMBOLS.RAW_CONTENT] = { chunks: [], len: 0 };
    }

    get parent() {
        return this[SYMBOLS.PARENT_NODE];
    }

    get multipart() {
        return this[SYMBOLS.MULTIPART] || false;
    }

    get multipartBoundary() {
        return this[SYMBOLS.BOUNDARY] || null;
    }

    matchBoundary(lineBuf) {
        if (!this[SYMBOLS.BOUNDARY]) {
            if (!this[SYMBOLS.PARENT_NODE]) {
                return false;
            }
            return this[SYMBOLS.PARENT_NODE].matchBoundary(lineBuf);
        }

        let line = lineBuf.toString();
        if (line.length === this[SYMBOLS.BOUNDARY].length && line === this[SYMBOLS.BOUNDARY]) {
            return {
                type: 'BOUNDARY_SEPARATOR',
                node: this
            };
        }

        if (
            line.length - 2 === this[SYMBOLS.BOUNDARY].length &&
            line.substring(line.length - 2) === '--' &&
            line.substring(0, this[SYMBOLS.BOUNDARY].length) === this[SYMBOLS.BOUNDARY]
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
            this[SYMBOLS.HEADERS].insert(
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
        let contentTypeHeaders = this[SYMBOLS.HEADERS].get('Content-Type');
        if (!contentTypeHeaders || !contentTypeHeaders.length) {
            this.contentType = null;
            return;
        }

        let parsedContentType = contentTypeHeaders[0].parsedValue;

        if (parsedContentType) {
            this.contentType = parsedContentType.value.toLowerCase().trim();

            if (/^multipart\//i.test(this.contentType) && parsedContentType.params.boundary) {
                this[SYMBOLS.MULTIPART] = this.contentType.substring(this.contentType.indexOf('/') + 1);
            }

            if (this[SYMBOLS.MULTIPART]) {
                this.childNodes = [];
                this[SYMBOLS.BOUNDARY] = parsedContentType.params.boundary || null;
            }
        }
    }

    updateContentTransferEncoding() {
        let contentTransferEncodingHeaders = this[SYMBOLS.HEADERS].get('Content-Transfer-Encoding');
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
        assert.ok(this.multipart, 'Not a multipart node');

        this.childNodes.push(node);
        node.setParent(this);
        return node;
    }

    addLeaf(type, raw, br) {
        this.childNodes.push(LeafNode.create(type, raw, br));
    }

    setParent(node) {
        this[SYMBOLS.PARENT_NODE] = node;
    }

    pushRawHeader(raw, br) {
        this[SYMBOLS.RAW_HEADERS].push([{ raw, br }]);
    }

    // Padding bytes: extra newlines, "This is a multi-part message in MIME format." etc.
    pushLeafData(type, raw, br) {
        let lastNode = this.childNodes && this.childNodes[this.childNodes.length - 1];
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

        this._value = Buffer.concat(this[SYMBOLS.RAW_CONTENT].chunks, this[SYMBOLS.RAW_CONTENT].len).toString();
    }
}

module.exports = { MimeNode };

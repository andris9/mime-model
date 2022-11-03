'use strict';

const assert = require('node:assert/strict');
const { Headers } = require('./headers');
const { HeaderLine } = require('./header-line');
const { LeafNode } = require('./leaf-node');
const { MimeParser } = require('./mime-parser');
const libmime = require('libmime');
const mimeFuncs = require('nodemailer/lib/mime-funcs');
const uuid = require('uuid');
const libqp = require('libqp');

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
    static create(contentType, contentData, opts = {}) {
        return new MimeNode(contentType, contentData, opts);
    }

    static async from(source, opts = {}) {
        let parser = MimeParser.create(MimeNode, opts);
        await parser.parse(source);
        return parser.rootNode;
    }

    constructor(contentType, contentData, opts = {}) {
        this.options = opts;
        this[SYMBOLS.RAW_HEADERS] = [];
        this[SYMBOLS.PARENT_NODE] = null;

        this.contentType = null;

        let defaultBr = opts.defaultBr || DEFAULT_BR;
        if (typeof defaultBr === 'string') {
            defaultBr = Buffer.from(defaultBr);
        }
        this.defaultBr = defaultBr;

        this.headers = Headers.create(opts);

        this[SYMBOLS.RAW_CONTENT] = { chunks: [], len: 0 };

        if (contentType) {
            this.setContentType(contentType, contentData);
        }

        if (contentData) {
            if (contentData.subject) {
                this.addHeader(`Subject: ${this.encodeWords(contentData.subject)}`, 'end');
            }

            if (contentData.encoding && !this.multipartType) {
                this.setContentTransferEncoding(contentData.encoding);
            }

            if (contentData.filename && !contentData.disposition) {
                this.setContentDisposition('attachment', contentData);
            } else if (contentData.disposition) {
                this.setContentDisposition(contentData.disposition, contentData);
            }
        }
    }

    /**
     * If needed, mime encodes the name part
     *
     * @param {String} name Name part of an address
     * @returns {String} Mime word encoded string if needed
     */
    encodeWords(value) {
        // set encodeAll parameter to true even though it is against the recommendation of RFC2047,
        // by default only words that include non-ascii should be converted into encoded words
        // but some clients (eg. Zimbra) do not handle it properly and remove surrounding whitespace
        return mimeFuncs.encodeWords(value, this.getTextEncoding(value), 52, true);
    }

    /**
     * Detects best mime encoding for a text value
     *
     * @param {String} value Value to check for
     * @return {String} either 'Q' or 'B'
     */
    getTextEncoding(value) {
        value = (value || '').toString();

        let encoding = this.textEncoding;
        let latinLen;
        let nonLatinLen;

        if (!encoding) {
            // count latin alphabet symbols and 8-bit range symbols + control symbols
            // if there are more latin characters, then use quoted-printable
            // encoding, otherwise use base64
            nonLatinLen = (value.match(/[\x00-\x08\x0B\x0C\x0E-\x1F\u0080-\uFFFF]/g) || []).length; // eslint-disable-line no-control-regex
            latinLen = (value.match(/[a-z]/gi) || []).length;
            // if there are more latin symbols than binary/unicode, then prefer Q, otherwise B
            encoding = nonLatinLen < latinLen ? 'Q' : 'B';
        }

        return encoding;
    }

    setContentType(contentType, contentData = {}) {
        let parsedContentType = libmime.parseHeaderValue((contentType || '').toString());
        if (!parsedContentType) {
            throw new Error('Invalid or missing Content-Type value');
        }

        this.contentType = parsedContentType.value.toLowerCase().trim();

        if (/^multipart\//i.test(this.contentType)) {
            this.multipartType = this.contentType.substring(this.contentType.indexOf('/') + 1);
        }

        if (this.multipartType) {
            if (!parsedContentType.params.boundary) {
                parsedContentType.params.boundary = `MiM-${uuid.v4().toUpperCase()}`;
            }

            this[SYMBOLS.CHILD_NODES] = [];

            this.multipartBoundary = parsedContentType.params.boundary || null;

            this.addLeaf('BOUNDARY_FINAL', Buffer.from(`--${this.multipartBoundary}--`), this.defaultBr, this.defaultBr);
        }

        let headerLine = `Content-Type: ${mimeFuncs.buildHeaderValue(parsedContentType)}`;

        if (!this.multipartType && contentData.filename) {
            // add support for non-compliant clients like QQ webmail
            // we can't build the value with buildHeaderValue as the value is non standard and
            // would be converted to parameter continuation encoding that we do not want
            let fnameParam = this.encodeWords(contentData.filename);

            if (fnameParam !== contentData.filename || /[\s'"\\;:/=(),<>@[\]?]|^-/.test(fnameParam)) {
                // include value in quotes if needed
                fnameParam = '"' + fnameParam + '"';
            }
            headerLine += '; name=' + fnameParam;
        }

        this.addHeader(headerLine, 'start');
    }

    setContentTransferEncoding(encoding) {
        let parsedContentTransferEncoding = libmime.parseHeaderValue((encoding || '').toString());
        if (parsedContentTransferEncoding) {
            this.contentTransferEncoding = parsedContentTransferEncoding.value.toLowerCase().trim();
            this.addHeader(`Content-Transfer-Encoding: ${mimeFuncs.buildHeaderValue(parsedContentTransferEncoding)}`, 'end');
        }
    }

    setContentDisposition(disposition, contentData) {
        let parsedContentDisposition = libmime.parseHeaderValue((disposition || '').toString());
        if (parsedContentDisposition) {
            this.contentDisposition = parsedContentDisposition.value.toLowerCase().trim();

            if (contentData.filename) {
                parsedContentDisposition.params.filename = contentData.filename;
            }

            this.addHeader(`Content-Disposition: ${mimeFuncs.buildHeaderValue(parsedContentDisposition)}`, 'end');
        }
    }

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

    addChildNodeToArray(node) {
        assert.ok(this.multipartType, 'Not a multipart node');
        assert.ok(node instanceof MimeNode, 'Not a Mime Node object');

        this[SYMBOLS.CHILD_NODES].push(node);
        node.setParent(this);

        return node;
    }

    addLeaf(type, raw, br, prefixBr) {
        let leafNode = LeafNode.create(type, raw, br);
        this[SYMBOLS.CHILD_NODES].push(leafNode);

        if (prefixBr) {
            leafNode.setPrefixBr(prefixBr);
        }

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

    get childNodes() {
        if (!this.multipartType) {
            return [];
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

    addHeader(line, pos) {
        let headerValue = libmime.foldLines((line || '').toString().trim());
        let headerEntry = headerValue
            .split(/\r*\n/)
            .filter(val => val)
            .map(val => ({ raw: Buffer.from(val), br: this.defaultBr }));

        let headerLine = HeaderLine.create({
            rawLines: headerEntry,
            isTerminator: false
        });

        this.headers.insert(headerLine, pos);
    }

    appendChild(node) {
        assert.ok(this.multipartType, 'Not a multipart node');
        assert.ok(node instanceof MimeNode, 'Not a Mime Node object');

        node.setParent(this);
        let boundaryLeafNode = LeafNode.create('BOUNDARY', Buffer.from(`--${this.multipartBoundary}`), this.defaultBr, this.defaultBr);

        // If boundary_final exists, insert before that node, otherwise push to the end
        for (let i = this[SYMBOLS.CHILD_NODES].length - 1; i >= 0; i--) {
            let childNode = this[SYMBOLS.CHILD_NODES][i];
            if (childNode instanceof LeafNode && childNode.type === 'BOUNDARY_FINAL') {
                this[SYMBOLS.CHILD_NODES].splice(i, 0, boundaryLeafNode, node);
                return;
            }
        }

        // no final boundary found?
        this[SYMBOLS.CHILD_NODES].push(boundaryLeafNode, node);
    }

    encodeB64Content(value, br) {
        br = (br || this.defaultBr).toString();

        if (typeof value === 'string') {
            return value;
        }

        let encodedChunks = [];

        let chunkSize = 299991; // specially crafted chunk size to generate nice 76 char folded lines
        let pos = 0;

        let lineLength = 76;
        let wrapRe = new RegExp('.{' + lineLength + '}', 'g');

        let encodedChunkLen = 0;

        while (pos < value.length) {
            let chunk;
            if (pos + chunkSize < value.length) {
                chunk = value.subarray(pos, pos + chunkSize);
            } else {
                chunk = value.subarray(pos);
            }
            pos += chunk.length;

            let wrappedLines = chunk.toString('base64').replace(wrapRe, `$&${br}`);
            let encodedChunk = Buffer.from(wrappedLines);
            encodedChunkLen += encodedChunk.length;

            encodedChunks.push(encodedChunk);
        }

        return Buffer.concat(encodedChunks, encodedChunkLen);
    }

    get content() {
        let contentBuffer = Buffer.concat(this[SYMBOLS.RAW_CONTENT].chunks, this[SYMBOLS.RAW_CONTENT].len);

        switch (this.contentTransferEncoding) {
            case 'base64':
                return Buffer.from(contentBuffer.toString(), 'base64');

            case 'quoted-printable':
                return libqp.decode(contentBuffer);

            default:
                return contentBuffer;
        }
    }

    set content(value) {
        switch (this.contentTransferEncoding) {
            case 'base64':
                {
                    let b64EncodedValue = this.encodeB64Content(value);
                    this[SYMBOLS.RAW_CONTENT] = {
                        chunks: [b64EncodedValue],
                        len: b64EncodedValue.length
                    };
                }
                break;

            case 'quoted-printable':
                {
                    let qpEncodedValue = Buffer.from(libqp.wrap(libqp.encode(value)).replace(/\r*\n/g, this.defaultBr.toString()));
                    this[SYMBOLS.RAW_CONTENT] = {
                        chunks: [qpEncodedValue],
                        len: qpEncodedValue.length
                    };
                }
                break;

            case '7bit':
            case '8bit':
            case 'binary':
            default: {
                let chunk;
                if (typeof value === 'string') {
                    chunk = Buffer.from(value.replace(/\r*\n/g, this.defaultBr.toString()));
                } else {
                    // just in case the input value is in some strange encoding, use the 'binary' string for conversion
                    chunk = Buffer.from(value.toString('binary').replace(/\r*\n/g, this.defaultBr.toString()), 'binary');
                }

                this[SYMBOLS.RAW_CONTENT] = {
                    chunks: [chunk],
                    len: chunk.length
                };
            }
        }
    }
}

module.exports = { MimeNode };

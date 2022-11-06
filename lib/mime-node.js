/* eslint no-control-regex: 0 */
'use strict';

const assert = require('node:assert/strict');
const { Headers } = require('./headers');
const { HeaderLine } = require('./header-line');
const { LeafNode } = require('./leaf-node');
const { MimeParser } = require('./mime-parser');
const libmime = require('libmime');
const mimeFuncs = require('nodemailer/lib/mime-funcs');
const addressparser = require('nodemailer/lib/addressparser');
const uuid = require('uuid');
const libqp = require('libqp');
const punycode = require('punycode/');
const encodingJapanese = require('encoding-japanese');
const iconv = require('iconv-lite');

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
    static create(contentType, contentData, opts) {
        return new MimeNode(contentType, contentData, opts);
    }

    static from(source, opts) {
        opts = opts || {};

        let parser = MimeParser.create(MimeNode, {}, Object.assign({}, opts));
        parser.parse(source);
        let mimeNode = parser.rootNode;

        return mimeNode;
    }

    constructor(contentType, contentData, opts) {
        contentData = contentData || {};
        opts = opts || {};

        this.options = opts;
        this[SYMBOLS.RAW_HEADERS] = [];
        this[SYMBOLS.PARENT_NODE] = null;

        this.contentTypeValue = null;

        // Prepare Date value
        this.contentData = {};

        this.contentData.date = this.getDateValue(contentData.date);
        this.prepareAddressValues(contentData);

        // Set default line break
        let defaultBr = opts.defaultBr || DEFAULT_BR;
        if (typeof defaultBr === 'string') {
            defaultBr = Buffer.from(defaultBr);
        }
        this.defaultBr = defaultBr;

        this.headerObject = Headers.create(opts);

        this[SYMBOLS.RAW_CONTENT] = { chunks: [], len: 0 };

        for (let addrKey of ['from', 'to', 'cc', 'bcc', 'sender', 'replyTo']) {
            if (this.contentData[addrKey]?.str) {
                this.addHeader(`${addrKey.replace(/[A-Z]/g, c => '-' + c).replace(/^./, c => c.toUpperCase())}: ${this.contentData[addrKey]?.str}`, 'end');
            }
        }

        // Prepare default message-id
        // must be called after addresses have been processed to get correct local part
        this.contentData.messageId = contentData.messageId || this.generateMessageId();

        if (contentData.subject) {
            this.contentData.subject = {
                value: contentData.subject,
                str: this.encodeWords(contentData.subject)
            };
            this.addHeader(`Subject: ${this.encodeWords(this.contentData.subject.str)}`, 'end');
        }

        if (contentType) {
            this.setContentType(contentType, contentData);
        }

        if (contentData.charset) {
            this.contentData.charset = contentData.charset.toLowerCase().trim();
        }

        if (contentData.encoding && !this.multipartType) {
            this.setContentTransferEncoding(contentData.encoding);
        }

        if (contentData.filename && !contentData.disposition) {
            this.setContentDisposition('attachment', contentData);
        } else if (contentData.disposition) {
            this.setContentDisposition(contentData.disposition, contentData);
        }

        if (contentData.defaultHeaders) {
            this.setDefaultHeaders();
        }

        if (contentData.contentId) {
            this.contentData.contentId = contentData.contentId.toString().trim();
            this.addHeader(`Content-ID: ${contentData.contentId}`, 'end', true);
        }

        if (contentData.content) {
            this.content = contentData.content;
        }
    }

    generateMessageId() {
        let fromDomain;

        // get a domain name from From, Sender or Reply-To headers
        let addresses = []
            .concat(this.contentData.from?.obj || [])
            .concat(this.contentData.sender?.obj || [])
            .concat(this.contentData.replyTo?.obj || []);
        for (let addr of addresses) {
            if (addr.address) {
                fromDomain = addr.address.split('@').pop().trim();
                break;
            }
        }

        return `<${uuid.v4()}@${fromDomain ? fromDomain : 'mim'}>`;
    }

    prepareAddressValues(contentData) {
        contentData = contentData || {};
        for (let addrKey of ['from', 'to', 'cc', 'bcc', 'sender', 'replyTo']) {
            // From address
            if (typeof contentData[addrKey] === 'string') {
                let addrValue = addressparser(contentData[addrKey]);
                if (addrValue && addrValue.length) {
                    this.contentData[addrKey] = {
                        obj: addrValue,
                        str: this.convertAddresses(addrValue),
                        original: contentData[addrKey].trim()
                    };
                }
            } else {
                let objVal = []
                    .concat(contentData[addrKey] || [])
                    .map(entry => {
                        if (typeof entry === 'string') {
                            return addressparser(entry);
                        }

                        return { name: entry.name || '', address: entry.address || '' };
                    })
                    .filter(entry => entry.name || entry.address);
                if (objVal.length) {
                    this.contentData[addrKey] = {
                        obj: objVal,
                        str: this.convertAddresses(objVal)
                    };
                }
            }
        }
    }

    getDateValue(defaultDate) {
        let date = defaultDate || Date.now();
        let dateStr = null;

        if (typeof date === 'string' || typeof date === 'number') {
            if (typeof date === 'string') {
                dateStr = date;
            }
            date = new Date(date);
        }

        if (date.toString() === 'Invalid Date' || typeof date.toISOString !== 'function') {
            date = new Date();
            dateStr = null;
        }

        dateStr = dateStr || date.toUTCString().replace(/GMT/, '+0000');

        return {
            obj: date,
            str: dateStr
        };
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
     * Normalizes an email address
     *
     * @param {Array} address An array of address objects
     * @return {String} address string
     */
    normalizeAddress(address) {
        address = (address || '')
            .toString()
            .replace(/[\x00-\x1F<>]+/g, ' ') // remove unallowed characters
            .trim();

        let lastAt = address.lastIndexOf('@');
        if (lastAt < 0) {
            // Bare username
            return address;
        }

        let user = address.substr(0, lastAt);
        let domain = address.substr(lastAt + 1);

        // Usernames are not touched and are kept as is even if these include unicode
        // Domains are punycoded by default
        // 'jõgeva.ee' will be converted to 'xn--jgeva-dua.ee'
        // non-unicode domains are left as is

        let encodedDomain;

        try {
            encodedDomain = punycode.toASCII(domain.toLowerCase());
        } catch (err) {
            // keep as is?
        }

        if (user.indexOf(' ') >= 0) {
            if (user.charAt(0) !== '"') {
                user = '"' + user;
            }
            if (user.substr(-1) !== '"') {
                user = user + '"';
            }
        }

        return `${user}@${encodedDomain}`;
    }

    /**
     * Rebuilds address object using punycode and other adjustments
     *
     * @param {Array} addresses An array of address objects
     * @param {Array} [uniqueList] An array to be populated with addresses
     * @return {String} address string
     */
    convertAddresses(addresses, uniqueList) {
        let values = [];

        uniqueList = uniqueList || [];

        [].concat(addresses || []).forEach(address => {
            if (address.address) {
                address.address = this.normalizeAddress(address.address);

                if (!address.name) {
                    values.push(address.address.indexOf(' ') >= 0 ? `<${address.address}>` : `${address.address}`);
                } else if (address.name) {
                    values.push(`${this.encodeAddressName(address.name)} <${address.address}>`);
                }

                if (address.address) {
                    if (!uniqueList.filter(a => a.address === address.address).length) {
                        uniqueList.push(address);
                    }
                }
            } else if (address.group) {
                let groupListAddresses = (address.group.length ? this.convertAddresses(address.group, uniqueList) : '').trim();
                values.push(`${this.encodeAddressName(address.name)}:${groupListAddresses};`);
            }
        });

        return values.join(', ');
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

    /**
     * If needed, mime encodes the name part
     *
     * @param {String} name Name part of an address
     * @returns {String} Mime word encoded string if needed
     */
    encodeAddressName(name) {
        if (!/^[\w ']*$/.test(name)) {
            if (/^[\x20-\x7e]*$/.test(name)) {
                return '"' + name.replace(/([\\"])/g, '\\$1') + '"';
            } else {
                return mimeFuncs.encodeWord(name, this.getTextEncoding(name), 52);
            }
        }
        return name;
    }

    setContentType(contentType, contentData = {}) {
        let parsedContentType = libmime.parseHeaderValue((contentType || '').toString());
        if (!parsedContentType) {
            throw new Error('Invalid or missing Content-Type value');
        }

        this.contentTypeValue = parsedContentType.value.toLowerCase().trim();

        if (/^multipart\//i.test(this.contentTypeValue)) {
            this.multipartType = this.contentTypeValue.substring(this.contentTypeValue.indexOf('/') + 1);
        }

        if (this.multipartType) {
            if (!parsedContentType.params.boundary) {
                parsedContentType.params.boundary = `MiM-${uuid.v4().toUpperCase()}`;
            }

            this[SYMBOLS.CHILD_NODES] = [];

            this.multipartBoundary = parsedContentType.params.boundary || null;

            // ensure terminating boundary
            this.addLeaf('BOUNDARY_FINAL', Buffer.from(`--${this.multipartBoundary}--`), this.defaultBr);
        }

        if (contentData.charset) {
            parsedContentType.params.charset = contentData.charset.toLowerCase().trim();
        } else if (parsedContentType.params.charset) {
            contentData.charset = parsedContentType.params.charset.toLowerCase().trim();
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

        this.addHeader(headerLine, 'end', true);
    }

    updateContentType() {
        let contentTypeHeaders = this.headerObject.get('Content-Type');

        if (!contentTypeHeaders || !contentTypeHeaders.length) {
            this.contentTypeValue = null;
            return;
        }

        let parsedContentType = contentTypeHeaders[0].parsedValue;
        delete parsedContentType.params.name;

        if (this.contentData.charset) {
            parsedContentType.params.charset = this.contentData.charset;
        }

        let headerLine = `Content-Type: ${mimeFuncs.buildHeaderValue(parsedContentType)}`;

        if (!this.multipartType && this.contentData.filename) {
            // add support for non-compliant clients like QQ webmail
            // we can't build the value with buildHeaderValue as the value is non standard and
            // would be converted to parameter continuation encoding that we do not want
            let fnameParam = this.encodeWords(this.contentData.filename);

            if (fnameParam !== this.contentData.filename || /[\s'"\\;:/=(),<>@[\]?]|^-/.test(fnameParam)) {
                // include value in quotes if needed
                fnameParam = '"' + fnameParam + '"';
            }
            headerLine += '; name=' + fnameParam;
        }

        this.addHeader(headerLine, 'end', true);
    }

    setContentTransferEncoding(encoding) {
        let parsedContentTransferEncoding = libmime.parseHeaderValue((encoding || '').toString());
        if (parsedContentTransferEncoding) {
            let contentTransferEncoding = parsedContentTransferEncoding.value.toLowerCase().trim();

            let prevContent = false;

            if (contentTransferEncoding !== this.contentTransferEncoding && this[SYMBOLS.RAW_CONTENT].len) {
                // we need to convert the content from previous encoding to the new one, so read it into a variable
                prevContent = this.content;
            }

            this.contentTransferEncoding = contentTransferEncoding;
            this.addHeader(`Content-Transfer-Encoding: ${mimeFuncs.buildHeaderValue(parsedContentTransferEncoding)}`, 'end', true);

            if (prevContent) {
                this.content = prevContent;
            }
        }
    }

    setContentDisposition(disposition, contentData) {
        let parsedContentDisposition = libmime.parseHeaderValue((disposition || '').toString());
        if (parsedContentDisposition) {
            this.contentData.disposition = parsedContentDisposition.value.toLowerCase().trim();

            if (contentData.filename) {
                parsedContentDisposition.params.filename = contentData.filename;
            }

            this.addHeader(`Content-Disposition: ${mimeFuncs.buildHeaderValue(parsedContentDisposition)}`, 'end');
        }
    }

    updateContentDisposition() {
        if (!this.contentData.disposition) {
            this.headerObject.remove('Content-Disposition');
            return;
        }

        let contentDispositionHeaders = this.headerObject.get('Content-Disposition');

        let parsedContentDisposition;
        if (contentDispositionHeaders && contentDispositionHeaders.length) {
            parsedContentDisposition = contentDispositionHeaders[0].parsedValue;
            parsedContentDisposition.value = this.contentData.disposition;
        } else {
            parsedContentDisposition = { value: this.contentData.disposition, params: {} };
        }

        if (this.contentData.filename) {
            parsedContentDisposition.params.filename = this.contentData.filename;
        } else {
            delete parsedContentDisposition.params.filename;
        }

        let headerLine = `Content-Disposition: ${mimeFuncs.buildHeaderValue(parsedContentDisposition)}`;

        this.addHeader(headerLine, 'end', true);
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
            this.headerObject.insert(
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

        this.parseContentType();
        this.parseContentTransferEncoding();
        this.parseContentDisposition();
        this.parseDate();
        this.parseMessageId();
        this.parseAddresses();
        this.parseHeaders();
    }

    parseHeaders() {
        // Subject
        let subjectHeaders = this.headerObject.get('Subject');
        if (subjectHeaders && subjectHeaders[0]) {
            let subject = subjectHeaders[0].value;
            let decodedSubject = subject;

            try {
                decodedSubject = libmime.decodeWords(subject);
            } catch (err) {
                // ignore
            }

            this.contentData.subject = {
                value: decodedSubject,
                str: subject
            };
        }

        // Content-Id
        let contentIdHeaders = this.headerObject.get('Content-Id');
        if (contentIdHeaders && contentIdHeaders[0]) {
            let contentId = contentIdHeaders[0].value;
            this.contentData.contentId = (contentId || '').toString().trim() || null;
        }
    }

    parseAddresses() {
        for (let addrKey of ['from', 'to', 'cc', 'bcc', 'sender', 'replyTo']) {
            let headerKey = addrKey.replace(/[A-Z]/g, c => '-' + c).replace(/^./, c => c.toUpperCase());
            let addrHeaders = this.headerObject.get(headerKey);
            if (!addrHeaders || !addrHeaders.length) {
                continue;
            }
            let list = [];
            let strList = [];
            for (let addrHeader of addrHeaders) {
                let value = addrHeader.value.trim();
                if (!value) {
                    continue;
                }
                let entries = addressparser(value);
                if (entries && entries.length) {
                    list.push(...entries);
                    strList.push(value.trim());
                }
            }
            let walk = entries => {
                for (let entry of entries) {
                    if (entry.name) {
                        try {
                            entry.name = libmime.decodeWords(entry.name);
                        } catch (err) {
                            // ignore
                        }
                    }
                    if (entry.group) {
                        walk(entry.group);
                    }
                }
            };
            walk(list);

            this.contentData[addrKey] = {
                obj: list,
                str: strList.join(' ')
            };
        }
    }

    // Update cached date value based on the existing Date header
    parseDate() {
        let dateHeaders = this.headerObject.get('Date');
        if (!dateHeaders || !dateHeaders.length) {
            return;
        }

        for (let dateHeader of dateHeaders) {
            if (dateHeader.value) {
                let date = new Date(dateHeader.value);
                if (date && date.toString() !== 'Invalid Date') {
                    this.contentData.date = {
                        obj: date,
                        str: dateHeader.value.trim()
                    };
                    return;
                }
            }
        }
    }

    parseMessageId() {
        let messageIdHeaders = this.headerObject.get('Message-ID');
        if (!messageIdHeaders || !messageIdHeaders.length) {
            return;
        }

        for (let messageIdHeader of messageIdHeaders) {
            if (messageIdHeader.value) {
                this.contentData.messageId = messageIdHeader.value;
                return;
            }
        }
    }

    parseContentType() {
        let contentTypeHeaders = this.headerObject.get('Content-Type');

        if (!contentTypeHeaders || !contentTypeHeaders.length) {
            this.contentTypeValue = null;
            return;
        }

        let parsedContentType = contentTypeHeaders[0].parsedValue;

        if (parsedContentType) {
            this.contentTypeValue = parsedContentType.value.toLowerCase().trim();

            if (/^multipart\//i.test(this.contentTypeValue) && parsedContentType.params.boundary) {
                this.multipartType = this.contentTypeValue.substring(this.contentTypeValue.indexOf('/') + 1);
            }

            if (this.multipartType) {
                this[SYMBOLS.CHILD_NODES] = [];
                this.multipartBoundary = parsedContentType.params.boundary || null;
            }

            if (parsedContentType.params.name) {
                let filename = parsedContentType.params.name;
                try {
                    filename = libmime.decodeWords(filename);
                } catch (err) {
                    // ignore
                }
                this.contentData.filename = filename;
            }

            if (parsedContentType.params.charset) {
                this.contentData.charset = parsedContentType.params.charset.trim().toLowerCase();
            }
        }
    }

    parseContentTransferEncoding() {
        let contentTransferEncodingHeaders = this.headerObject.get('Content-Transfer-Encoding');
        if (!contentTransferEncodingHeaders || !contentTransferEncodingHeaders.length) {
            this.contentTransferEncoding = null;
            return;
        }

        let parsedContentTransferEncoding = contentTransferEncodingHeaders[0].parsedValue;

        if (parsedContentTransferEncoding) {
            this.contentTransferEncoding = parsedContentTransferEncoding.value.toLowerCase().trim();
        }
    }

    parseContentDisposition() {
        let contentDispositionHeaders = this.headerObject.get('Content-Disposition');
        if (!contentDispositionHeaders || !contentDispositionHeaders.length) {
            this.contentData.disposition = null;
            return;
        }

        let parsedContentDisposition = contentDispositionHeaders[0].parsedValue;

        if (parsedContentDisposition) {
            this.contentData.disposition = parsedContentDisposition.value.toLowerCase().trim();
        }
    }

    addChildNodeToArray(node) {
        assert.ok(this.multipartType, 'Not a multipart node');
        assert.ok(node instanceof MimeNode, 'Not a Mime Node object');

        this[SYMBOLS.CHILD_NODES].push(node);
        node.parent = this;

        return node;
    }

    addLeaf(type, raw, br) {
        let leafNode = LeafNode.create(type, raw, br);
        this[SYMBOLS.CHILD_NODES].push(leafNode);

        return leafNode;
    }

    removeLastBr() {
        if (this[SYMBOLS.RAW_CONTENT].chunks.length) {
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

    /**
     *
     */
    get parent() {
        return this[SYMBOLS.PARENT_NODE];
    }

    set parent(node) {
        this[SYMBOLS.PARENT_NODE] = node;
    }

    decodeStr(input, sourceCharset) {
        let output;

        if (!sourceCharset || /^(utf[-_]8|us-ascii|ascii)$/gi.test(sourceCharset)) {
            output = input;
        } else if (/^s?jis|^iso-?2022-?jp|^EUCJP|^Shift[-_]?JIS/gi.test(sourceCharset)) {
            output = encodingJapanese.convert(input, {
                to: 'UNICODE', // to_encoding
                from: sourceCharset, // from_encoding
                type: 'string'
            });
        } else {
            output = iconv.decode(input, sourceCharset);
        }

        if (typeof output === 'string') {
            output = Buffer.from(output);
        }

        return output;
    }

    encodeStr(input, targetCharset) {
        let output;

        if (!targetCharset || /^(utf[-_]8|us-ascii|ascii)$/gi.test(targetCharset)) {
            output = input;
            if (typeof output === 'string') {
                output = Buffer.from(output);
            }
        } else if (/^s?jis|^iso-?2022-?jp|^EUCJP|^Shift[-_]?JIS/gi.test(targetCharset)) {
            output = encodingJapanese.convert(input, {
                to: targetCharset, // to_encoding
                from: 'UNICODE', // from_encoding
                type: 'array'
            });
            output = Buffer.from(output);
        } else {
            output = iconv.encode(input, targetCharset);
        }

        return output;
    }

    /**
     * Convert charset to UTF-8
     */
    convertCharset(targetCharset) {
        targetCharset = (targetCharset || 'utf-8').toString().trim().toLowerCase();
        let existingCharset = (this.contentData.charset || 'ascii').toString().trim().toLowerCase();

        if (targetCharset.replace(/[-_]/g, '') === existingCharset.replace(/[-_]/g, '')) {
            return;
        }

        let content = this.content;

        if (!/^(utf[-_]8|us-ascii|ascii)$/gi.test(existingCharset)) {
            // convert to utf-8 string
            content = this.decodeStr(this.content, existingCharset);
        }

        if (!/^(utf[-_]8|us-ascii|ascii)$/gi.test(targetCharset)) {
            // convert from utf-8 string
            content = this.encodeStr(this.content, targetCharset);
        }

        this.contentData.charset = targetCharset;
        this.updateContentType();

        this.content = content;
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

    setDefaultHeaders() {
        let messageIdHeaders = this.headerObject.get('Message-ID');
        if (!messageIdHeaders || !messageIdHeaders.length) {
            this.addHeader(`Message-ID: ${this.contentData.messageId}`, 'end');
        }

        let dateHeaders = this.headerObject.get('Date');
        if (!dateHeaders || !dateHeaders.length) {
            this.addHeader(`Date: ${this.contentData.date.str}`, 'end');
        }

        let mimeVersionHeaders = this.headerObject.get('MIME-Version');
        if (!mimeVersionHeaders || !mimeVersionHeaders.length) {
            this.addHeader(`MIME-Version: 1.0`, 'end');
        }
    }

    build(opts) {
        opts = opts || {};

        let outputChunks = [];
        let outputLen = 0;

        if (!opts.body) {
            let headers = this.headerObject.buffer;
            outputChunks.push(headers);
            outputLen += headers.length;
        }

        if (!opts.headerObject) {
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
                        let childContent = childNode.build();
                        outputChunks.push(...childContent.chunks);
                        outputLen += childContent.len;
                    }
                }
            } else {
                outputChunks.push(...this[SYMBOLS.RAW_CONTENT].chunks);
                outputLen += this[SYMBOLS.RAW_CONTENT].len;
            }

            // ensure that the output always ends with a line break
            let hasFinalBr = false;
            let lastChunk = outputChunks[outputChunks.length - 1];
            if (lastChunk && lastChunk.length && lastChunk[lastChunk.length - 1] === 0x0a) {
                hasFinalBr = true;
            }
            if (!hasFinalBr) {
                outputChunks.push(this.defaultBr);
                outputLen += this.defaultBr.length;
            }
        }

        return { chunks: outputChunks, len: outputLen };
    }

    addHeader(line, pos, replace = null) {
        let headerLine;

        if (!line) {
            return;
        }

        if (line instanceof HeaderLine) {
            headerLine = line;
        } else if (typeof line === 'string') {
            let headerValue = libmime.foldLines((line || '').toString().trim());
            let headerEntry = headerValue
                .split(/\r*\n/)
                .filter(val => val)
                .map(val => ({ raw: Buffer.from(val), br: this.defaultBr }));

            headerLine = HeaderLine.create({
                rawLines: headerEntry,
                isTerminator: false
            });
        } else {
            throw new Error('Unexpected header value');
        }

        if (
            replace === null &&
            ['message-id', 'content-type', 'content-disposition', 'content-id', 'subject', 'content-transfer-encoding'].includes(headerLine.key)
        ) {
            replace = true;
        }

        this.headerObject[replace ? 'replace' : 'insert'](headerLine, pos);
        return headerLine;
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

    // Public API methods

    /**
     * Sets new content-type value and clears node body
     * @param {String} contentType
     */
    resetContent(contentType) {
        if (!contentType) {
            let contentTypeHeaders = this.headerObject.get('Content-Type');
            if (contentTypeHeaders && contentTypeHeaders.length) {
                contentType = contentTypeHeaders[0].value;
            }
        }

        if (this[SYMBOLS.CHILD_NODES]) {
            this[SYMBOLS.CHILD_NODES] = [];
        }
        this[SYMBOLS.RAW_CONTENT] = { chunks: [], len: 0 };

        this.setContentType(contentType || 'text/plain');
    }

    /**
     * Removes all header entries with matching key and returns these as an array value
     * @param {String} key Header key to remove
     * @returns {Array} a list of header entry objects removed from the headers structure of the node
     */
    removeHeaders(key) {
        return this.headerObject.remove(key);
    }

    /**
     * Removed and returns body structure from a node. This value can be used to inject the body to another node.
     * @returns {Object} body structure
     */
    removeBody() {
        let result = {};

        if (this[SYMBOLS.CHILD_NODES]) {
            result[SYMBOLS.CHILD_NODES] = this[SYMBOLS.CHILD_NODES];
            this[SYMBOLS.CHILD_NODES] = [];
        }
        result[SYMBOLS.RAW_CONTENT] = this[SYMBOLS.RAW_CONTENT];
        this[SYMBOLS.RAW_CONTENT] = { chunks: [], len: 0 };

        return result;
    }

    /**
     * Sets body structure for a node
     * @param {Object} body Body structure from `removeBody` call
     */
    setBody(body) {
        if (body[SYMBOLS.CHILD_NODES]) {
            this[SYMBOLS.CHILD_NODES] = body[SYMBOLS.CHILD_NODES];
        }

        if (body[SYMBOLS.RAW_CONTENT]) {
            this[SYMBOLS.RAW_CONTENT] = body[SYMBOLS.RAW_CONTENT];
        }
    }

    /**
     * An getter that retrieves array of child nodes
     * @property {Array} childNodes Array of child nodes
     */
    get childNodes() {
        if (!this.multipartType) {
            return [];
        }

        return this[SYMBOLS.CHILD_NODES].filter(entry => !(entry instanceof LeafNode));
    }

    /**
     * Converts a mime node structure into a EML formatted buffer
     * @param {Object} [opts] Optional configuration
     * @returns {Buffer} EML file
     */
    serialize(opts) {
        let { chunks, len } = this.build(opts);
        return Buffer.concat(chunks, len);
    }

    setHeaders(headers, pos) {
        headers = [].concat(headers || []);
        for (let entry of headers) {
            let headerLine = this.addHeader(entry, pos);
            switch (headerLine.key) {
                case 'content-type':
                    this.setContentType(headerLine.value);
                    break;
                case 'content-transfer-encoding':
                    this.setContentTransferEncoding(headerLine.value);
                    break;
                case 'message-id':
                    this.parseMessageId();
                    break;
                default:
                    this.parseHeaders();
            }
        }
    }

    insertBefore(newNode, referenceNode) {
        assert.ok(this.multipartType, 'Not a multipart node');
        assert.ok(newNode instanceof MimeNode, 'Not a Mime Node object');

        newNode.parent = this;
        let boundaryLeafNode = LeafNode.create('BOUNDARY', Buffer.from(`--${this.multipartBoundary}`), this.defaultBr, this.defaultBr);

        // If boundary_final exists, insert before that node, otherwise push to the end
        for (let i = this[SYMBOLS.CHILD_NODES].length - 1; i >= 0; i--) {
            let childNode = this[SYMBOLS.CHILD_NODES][i];
            if (referenceNode) {
                if (referenceNode === childNode) {
                    this[SYMBOLS.CHILD_NODES].splice(i, 0, boundaryLeafNode, newNode);
                }
            } else if (childNode instanceof LeafNode && childNode.type === 'BOUNDARY_FINAL') {
                this[SYMBOLS.CHILD_NODES].splice(i, 0, boundaryLeafNode, newNode);
                return;
            }
        }

        // no final boundary found?
        this[SYMBOLS.CHILD_NODES].push(boundaryLeafNode, newNode);
    }

    appendChild(newNode) {
        return this.insertBefore(newNode, null);
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

    get contentText() {
        let content = this.content;
        return this.decodeStr(content, this.contentData.charset).toString();
    }

    set content(value) {
        if (typeof value === 'string' && this.contentData.charset) {
            value = this.encodeStr(value, this.contentData.charset);
        } else if (typeof value === 'string') {
            value = Buffer.from(value);
            this.contentData.charset = 'utf-8';
            this.updateContentType();
        }

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

                // convert newlines
                // just in case the input value is in some strange encoding, use the 'binary' string for conversion
                chunk = Buffer.from(value.toString('binary').replace(/\r*\n/g, this.defaultBr.toString()), 'binary');

                this[SYMBOLS.RAW_CONTENT] = {
                    chunks: [chunk],
                    len: chunk.length
                };
            }
        }
    }

    get multipart() {
        return this.multipartType || null;
    }

    get contentType() {
        return this.contentTypeValue || null;
    }

    get disposition() {
        return this.contentData.disposition || null;
    }

    set disposition(disposition) {
        this.contentData.disposition = (disposition && disposition.value.toLowerCase().trim()) || null;
        this.updateContentDisposition();
    }

    get filename() {
        return this.contentData.filename || null;
    }

    set filename(filename) {
        let existingFilename = this.contentData.filename;
        if (existingFilename === filename) {
            return;
        }

        this.contentData.filename = filename || null;
        this.updateContentType();
        this.updateContentDisposition();
    }

    get contentId() {
        return this.contentData.contentId || null;
    }

    set contentId(contentId) {
        this.contentData.contentId = contentId || null;
        if (!this.contentData.contentId) {
            this.headerObject.remove('Content-ID');
        } else {
            this.addHeader(`Content-ID: ${this.contentData.contentId}`, 'end', true);
        }
    }

    get headers() {
        return this.headerObject.headers.map(headerLine => [headerLine._headerKeyOc, headerLine.value]);
    }

    get charset() {
        return this.contentData.charset || null;
    }

    set charset(charset) {
        let existingCharset = this.contentData.charset;
        if (existingCharset === charset) {
            return;
        }

        this.convertCharset(charset);
    }

    get encoding() {
        return this.contentTransferEncoding || null;
    }

    set encoding(encoding) {
        this.setContentTransferEncoding(encoding);
    }

    get subject() {
        return this.contentData.subject?.value || null;
    }

    set subject(subject) {
        this.contentData.subject = {
            value: subject,
            str: this.encodeWords(subject)
        };

        this.addHeader(`Subject: ${this.encodeWords(this.contentData.subject.str)}`, 'end', true);
    }

    get date() {
        return this.contentData.date?.obj || null;
    }

    set date(date) {
        let dateVal = date;
        if (typeof dateVal === 'string' || typeof dateVal === 'number') {
            dateVal = new Date(dateVal);
        }

        if (dateVal && typeof dateVal.toISOString === 'function' && dateVal.toString() !== 'Invalid Date') {
            this.contentData.date = {
                obj: dateVal,
                str: typeof dateVal === 'string' ? date : dateVal.toUTCString().replace(/GMT/, '+0000')
            };
            this.addHeader(`Date: ${this.contentData.date.str}`, 'end', true);
        }
    }

    get from() {
        return this.contentData.from?.obj?.length ? this.contentData.from?.obj : null;
    }

    set from(value) {
        this.prepareAddressValues({ from: value });
    }

    get to() {
        return this.contentData.to?.obj?.length ? this.contentData.to?.obj : null;
    }

    set to(value) {
        this.prepareAddressValues({ to: value });
    }

    get cc() {
        return this.contentData.cc?.obj?.length ? this.contentData.cc?.obj : null;
    }

    set cc(value) {
        this.prepareAddressValues({ cc: value });
    }

    get bcc() {
        return this.contentData.bcc?.obj?.length ? this.contentData.bcc?.obj : null;
    }

    set bcc(value) {
        this.prepareAddressValues({ bcc: value });
    }

    get sender() {
        return this.contentData.sender?.obj?.length ? this.contentData.sender?.obj : null;
    }

    set sender(value) {
        this.prepareAddressValues({ sender: value });
    }

    get replyTo() {
        return this.contentData.replyTo?.obj?.length ? this.contentData.replyTo?.obj : null;
    }

    set replyTo(value) {
        this.prepareAddressValues({ replyTo: value });
    }

    get messageId() {
        return this.contentData.messageId || null;
    }

    set messageId(messageId) {
        this.contentData.messageId = messageId || null;
        if (!this.contentData.messageId) {
            this.headerObject.remove('Message-ID');
        } else {
            this.addHeader(`Message-ID: ${this.contentData.messageId}`, 'end', true);
        }
    }
}

module.exports = { MimeNode };

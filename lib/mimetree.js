'use strict';

const { MimeNode } = require('./mime-node');
const util = require('util');

const STATES = {
    HEADER: Symbol('Header'),
    BODY: Symbol('Body')
};

const SYMBOLS = {
    OPTS: Symbol('Options'),
    CUR_STATE: Symbol('CurrentState'),
    CUR_NODE: Symbol('CurrentNode'),
    LINE_BR: Symbol('LineBr')
};

const CHARS = {
    HYPHEN: 0x2d
};

class MimeParser {
    static create(opts = {}) {
        return new MimeParser(opts);
    }

    constructor(opts = {}) {
        this[SYMBOLS.OPTS] = opts;

        if (Buffer.isBuffer(opts.lineBr)) {
            this[SYMBOLS.LINE_BR] = opts.lineBr;
        } else if (typeof opts.lineBr === 'string') {
            this[SYMBOLS.LINE_BR] = Buffer.from(opts.lineBr);
        }

        this[SYMBOLS.CUR_STATE] = STATES.HEADER;
        this.rootNode = MimeNode.create(
            Object.assign(
                {
                    defaultBr: this[SYMBOLS.OPTS].defaultBr || this[SYMBOLS.OPTS].lineBr
                },
                this[SYMBOLS.OPTS]
            )
        );

        this[SYMBOLS.CUR_NODE] = this.rootNode;
    }

    async nextNode() {
        let node = MimeNode.create(
            Object.assign(
                {
                    defaultBr: this[SYMBOLS.OPTS].defaultBr || this[SYMBOLS.OPTS].lineBr
                },
                this[SYMBOLS.OPTS]
            )
        );
        this[SYMBOLS.CUR_NODE].appendChild(node);
        this[SYMBOLS.CUR_NODE] = node;
        return node;
    }

    async parseLine(lineBuf, opts = {}) {
        let br = opts.br;
        if (br && this[SYMBOLS.LINE_BR]) {
            br = this[SYMBOLS.LINE_BR];
        }

        // check MIME boundary
        if (
            (this[SYMBOLS.CUR_NODE] !== this.rootNode || this.rootNode.multipart) &&
            lineBuf.length > 2 &&
            lineBuf[0] === CHARS.HYPHEN &&
            lineBuf[1] === CHARS.HYPHEN
        ) {
            // could be a boundary
            let boundary = this[SYMBOLS.CUR_NODE].matchBoundary(lineBuf.subarray(2));
            if (boundary) {
                console.log('BOUNDARY DETECTED', lineBuf.toString(), boundary);
                switch (boundary.type) {
                    case 'BOUNDARY_SEPARATOR': {
                        this[SYMBOLS.CUR_NODE] = boundary.node;
                        this[SYMBOLS.CUR_NODE].addLeaf('SEPARATOR', lineBuf, br || null);
                        this.nextNode();
                        this[SYMBOLS.CUR_STATE] = STATES.HEADER;
                        return;
                    }

                    case 'BOUNDARY_TERMINATOR':
                        this[SYMBOLS.CUR_NODE] = boundary.node;
                        this[SYMBOLS.CUR_NODE].addLeaf('SEPARATOR', lineBuf, br || null);
                        // move up 1 step
                        if (this[SYMBOLS.CUR_NODE].parent) {
                            this[SYMBOLS.CUR_NODE] = this[SYMBOLS.CUR_NODE].parent;
                        }
                        this[SYMBOLS.CUR_STATE] = STATES.BODY;
                        return;
                }
            }
        }

        switch (this[SYMBOLS.CUR_STATE]) {
            case STATES.HEADER: {
                this[SYMBOLS.CUR_NODE].pushRawHeader(lineBuf, br || null);
                if (lineBuf.length === 0) {
                    this[SYMBOLS.CUR_NODE].commitHeaders();
                    this[SYMBOLS.CUR_STATE] = STATES.BODY;
                }
                break;
            }

            case STATES.BODY: {
                // content node, no need to check for boundaries
                if (this[SYMBOLS.CUR_NODE].multipart) {
                    this[SYMBOLS.CUR_NODE].pushLeafData('BODY', lineBuf, br);
                    break;
                }
                this[SYMBOLS.CUR_NODE].pushRawContent(lineBuf, br);
                break;
            }
        }
    }

    async parse(eml) {
        let lineStart = 0;

        for (let i = 0; i < eml.length; i++) {
            let c = eml[i];
            if (c === 0x0a) {
                let lineEnd = i;
                while (lineStart < lineEnd && eml[lineEnd - 1] === 0x0d) {
                    lineEnd--;
                }
                await this.parseLine(eml.subarray(lineStart, lineEnd), { br: eml.subarray(lineEnd, i + 1) });
                lineStart = i + 1;
            }
        }

        if (lineStart < eml.length) {
            await this.parseLine(eml.subarray(lineStart), { final: true });
        } else {
            // empty buffer
            await this.parseLine(Buffer.alloc(0), { final: true });
        }
    }
}

const fs = require('fs');
const { LeafNode } = require('./leaf-node');
let sourceEml;

if (process.argv[2]) {
    sourceEml = fs.readFileSync(process.argv[2]);
    //sourceEml = Buffer.from('Subject: Hello\r\n  World\r\n');
    let ysourceEml = Buffer.from(
        'Content-type: multipart/mixed; boundary=ABC\r\n' +
            '\r\n' +
            '--ABC\r\n' +
            'Content-type: multipart/related; boundary=DEF\r\n' +
            '\r\n' +
            '--DEF\r\n' +
            'Content-type: text/plain; charset=utf-8\r\n' +
            '\r\n' +
            'ÕÄÖÜ\r\n' +
            '--DEF--\r\n' +
            '--ABC--'
    );
} else {
    sourceEml = Buffer.from('Subject: Hello\r\n  World\r\n  Again\ndef\rghi\r\r\r\n\neeeee\n\n');
}

let mp = MimeParser.create({
    lineBr: '\r\n'
    //defaultBr: '\n'
});

mp.parse(sourceEml).then(() => {
    console.log(util.inspect(mp, false, 22, true));
    console.log(JSON.stringify(mp, false, 2));
    /*    
process.stdout.write('>>>');
    process.stdout.write(mp.rootNode.getRawHeaders());
    process.stdout.write('<<<\n');
*/
});

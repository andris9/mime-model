'use strict';

const iconv = require('iconv-lite');
const fs = require('fs');
const { MimeNode } = require('../lib/mime-model');

if (!process.argv[2]) {
    console.log('This example adds a signature text to all text parts');
    console.log('Usage:');
    console.log(`  node modify.js /path/to/email.eml "text to add"`);
    process.exit();
}

const eml = fs.readFileSync(process.argv[2]);
const text = process.argv[3] || '';

const rootNode = MimeNode.from(eml, {
    // enforce line break format
    lineBr: '\r\n'
});

function walkNodes(node) {
    if (node.multipart) {
        for (let childNode of node.childNodes) {
            walkNodes(childNode);
        }
    } else if (node.disposition !== 'attachment') {
        switch (node.contentType) {
            case 'text/plain':
            case 'text/html':
                {
                    let content = node.content;
                    let sourceCharset = node.charset;

                    if (sourceCharset && !/^utf[-_]8$/i.test(sourceCharset)) {
                        // update charset info in MIME headers
                        node.charset = 'utf-8';
                        // convert content to utf-8
                        content = iconv.decode(content, sourceCharset);
                    }

                    let extraText = node.contentType === 'text/html' ? `<div>${text}</div>` : text;

                    // The text content might use non-ascii letters, so force encoding to quoted-printable
                    node.encoding = 'quoted-printable';
                    node.content = Buffer.concat([Buffer.from(content), Buffer.from(`\n${extraText}`)]);
                }
                break;
        }
    }
}

walkNodes(rootNode);

process.stdout.write(rootNode.serialize());

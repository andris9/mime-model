'use strict';

const fs = require('fs');
const { MimeNode } = require('../lib/mime-model');

if (!process.argv[2]) {
    console.log('This example adds a signature text to all text parts');
    console.log('Usage:');
    console.log(`  node modify.js /path/to/email.eml "text to add"`);
    process.exit();
}

const eml = fs.readFileSync(process.argv[2]);
const text = process.argv[3] || 'Signature text';

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
                    // node.content returns a Buffer in the original charset, node.contentText returns a unicode string
                    let content = node.contentText;

                    // The text content might use non-ascii letters, so convert output encoding to quoted-printable
                    node.encoding = 'quoted-printable';

                    // Enforce MIME output to use Windows-1257 for this text node
                    node.charset = 'win-1257';

                    // String value is converted to correct charset, Buffer value is used as is
                    node.content = `${content}\n${node.contentType === 'text/html' ? `<div>${text}</div>` : text}`;
                }
                break;
        }
    }
}

walkNodes(rootNode);

// add the same text to the end of subject line as well
// (encoding is handled automatically)
rootNode.subject += ` ${text}`;

if (rootNode.date) {
    // Increment date header value by 1 day
    rootNode.date = rootNode.date.getTime() + 1 * 24 * 3600 * 1000;
}

process.stdout.write(rootNode.serialize());

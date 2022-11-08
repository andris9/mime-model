'use strict';

const fs = require('fs');
const { MimeNode } = require('../lib/mime-model');

if (!process.argv[2]) {
    console.log('This example converts a plaintext EML to a html and plaintext alternative');
    console.log('Usage:');
    console.log(`  node text-to-alternative.js /path/to/email.eml`);
    process.exit();
}

const eml = fs.readFileSync(process.argv[2]);
const rootNode = MimeNode.from(eml);

if (rootNode.contentType && rootNode.contentType !== 'text/plain') {
    console.log('EML is not a text/plain file');
    process.exit();
}

// extract contents and content headers from root node
const textContent = rootNode.contentText; // return a unicode string
// we won't be needing the following headers in the root node anymore (if set)
rootNode.removeHeaders('Content-Transfer-Encoding');
rootNode.removeHeaders('Content-Disposition');

// change root node into a multipart node
rootNode.resetContent('multipart/alternative');

const textNode = MimeNode.create('text/plain');
textNode.encoding = 'quoted-printable';
textNode.content = textContent || '';

const htmlNode = MimeNode.create('text/html');
htmlNode.encoding = 'quoted-printable';
// poor-man's text to html
htmlNode.content = (textContent || '').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br/>');

rootNode.appendChild(textNode);
rootNode.appendChild(htmlNode);

process.stdout.write(rootNode.serialize());

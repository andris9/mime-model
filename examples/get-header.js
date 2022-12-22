'use strict';

const fs = require('fs');
const { MimeNode } = require('../lib/mime-model');

if (!process.argv[2] || !process.argv[3]) {
    console.log('This example fetches a specific header from an eml file');
    console.log('Usage:');
    console.log(`  node get-header.js /path/to/email.eml "header-key"`);
    process.exit();
}

const eml = fs.readFileSync(process.argv[2]);
const headerKey = process.argv[3];

const rootNode = MimeNode.from(eml);

function walkNodes(node, level) {
    let value = JSON.stringify(node.getHeader(headerKey), false, 2);
    console.log(`${'-'.repeat(level)}` + value.replace(/\r?\n/g, `\n${' '.repeat(level)}`));

    if (node.multipart) {
        for (let childNode of node.childNodes) {
            walkNodes(childNode, level + 1);
        }
    }
}
console.log(headerKey);
walkNodes(rootNode, 0);

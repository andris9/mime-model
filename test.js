'use strict';

const util = require('util');
const { MimeNode } = require('./lib/mime-model');
console.log(MimeNode);

const fs = require('fs');
let sourceEml;

if (process.argv[2]) {
    sourceEml = fs.readFileSync(process.argv[2]);
    //sourceEml = Buffer.from('Subject: Hello\r\n  World\r\n');
} else {
    sourceEml = Buffer.from('Subject: Hello\r\n  World\r\n  Again\ndef\rghi\r\r\r\n\neeeee\n\n');
}

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
        '--ABC'
);

ysourceEml = Buffer.from(
    (
        'Content-type: multipart/mixed; boundary=ABC\r\n' +
        '\r\n' +
        '--ABC\r\n' +
        'Content-type: text/plain; charset=utf-8\r\n' +
        '\r\n' +
        'ÕÄÖÜ\r\n' +
        '--ABC\r\n' +
        'Content-type: text/plain; charset=utf-8\r\n' +
        '\r\n' +
        'ÕÄÖÜ\r\n\r\n' +
        '--ABC--\r\n'
    ).replace(/\r?\n/g, '\n')
);

async function main() {
    let mp = await MimeNode.from(sourceEml, {
        //lineBr: '\r\n'
        //defaultBr: '\n'
    });

    let walk = (node, level) => {
        let prefix = ' '.repeat(level * 2);
        console.log(`${prefix}${node.contentType}`);
        let childNodes = node.getChildNodes();
        if (childNodes) {
            for (let childNode of childNodes) {
                walk(childNode, level + 1);
            }
        }
    };

    walk(mp, 0);

    let output = await mp.serialize();

    process.stdout.write(output);

    console.log('Q1:');

    let n1 = MimeNode.create(
        'multipart/mixed',
        {},
        {
            lineBr: '\n'
        }
    );

    let n2 = MimeNode.create(
        'multipart/alternative',
        {},
        {
            lineBr: '\n'
        }
    );

    let n3 = MimeNode.create('text/plain');

    n1.appendChild(n2);
    n2.appendChild(n3);

    process.stdout.write(await n1.serialize());
}

main()
    .then(() => console.log('DONE'))
    .catch(err => {
        console.error(err);
        process.exit(1);
    });

'use strict';

const util = require('util');
const { MimeNode } = require('./lib/mime-tree');
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

MimeNode.from(sourceEml, {
    //lineBr: '\r\n'
    //defaultBr: '\n'
})
    .then(mp => {
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

        //console.log(mp.getChildNodes());
        //console.log(util.inspect(mp, false, 22, true));
        //console.log(JSON.stringify(mp, false, 2));
        /*    
process.stdout.write('>>>');
    process.stdout.write(mp.rootNode.getRawHeaders());
    process.stdout.write('<<<\n');
*/

        return mp.serialize();
    })
    .then(output => {
        process.stdout.write(output);
    });

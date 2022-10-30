'use strict';

const util = require('util');
const { MimeTree } = require('./lib/mime-tree');

const fs = require('fs');
let sourceEml;

if (process.argv[2]) {
    sourceEml = fs.readFileSync(process.argv[2]);
    //sourceEml = Buffer.from('Subject: Hello\r\n  World\r\n');
} else {
    sourceEml = Buffer.from('Subject: Hello\r\n  World\r\n  Again\ndef\rghi\r\r\r\n\neeeee\n\n');
}

let mp = MimeTree.create({
    //lineBr: '\r\n'
    //defaultBr: '\n'
});

sourceEml = Buffer.from(
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

sourceEml = Buffer.from(
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
        '--ABC\r\n'
);

mp.parse(sourceEml)
    .then(() => {
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

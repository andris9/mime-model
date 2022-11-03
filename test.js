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
    (
        'Content-type: multipart/mixed; boundary=ABC\r\n' +
        '\r\n' +
        '--ABC\r\n' +
        'Content-type: text/plain; charset=utf-8\r\n' +
        '\r\n' +
        'ÕÄÖÜ1\r\n' +
        '--ABC\r\n' +
        'Content-type: text/plain; charset=utf-8\r\n' +
        '\r\n' +
        'ÕÄÖÜ2\r\n\r\n' +
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

        if (node.multipartType) {
            for (let childNode of node.childNodes) {
                walk(childNode, level + 1);
            }
        } else {
            console.log('<<<<');
            process.stdout.write(node.content);
            console.log('\n>>>>');
        }
    };

    walk(mp, 0);

    console.log('WALKED');

    let output = await mp.serialize();

    process.stdout.write(output);

    console.log('Q1:');

    let n1 = MimeNode.create(
        'multipart/mixed',
        {
            subject: 'Mõnel pool elavad ka kalan kõrbenult 🤔'
        },
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

    let n3 = MimeNode.create('text/plain', { encoding: 'base64' });
    n3.content = Buffer.alloc(10 * 1024);

    let n4 = MimeNode.create('text/html', {
        filename: 'jõgeva kalasadama tee ristmiku kalde künka.txt',
        encoding: 'quoted-printable'
    });

    n4.content =
        'Οὐχὶ ταὐτὰ παρίσταταί μοι γιγνώσκειν, ὦ ἄνδρες ᾿Αθηναῖοι, ὅταν τ᾿ εἰς τὰ πράγματα ἀποβλέψω καὶ ὅταν πρὸς τοὺς λόγους οὓς ἀκούω· τοὺς μὲν γὰρ λόγους περὶ τοῦ τιμωρήσασθαι Φίλιππον ὁρῶ γιγνομένους, τὰ δὲ πράγματ᾿';

    n1.appendChild(n2);
    n2.appendChild(n3);
    n2.appendChild(n4);

    process.stdout.write(await n1.serialize());
}

main()
    .then(() => console.log('DONE'))
    .catch(err => {
        console.error(err);
        process.exit(1);
    });

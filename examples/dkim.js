'use strict';

/*
Generates an email, DKIM signs it and then verifies the signature
*/

const { MimeNode } = require('../lib/mime-model');
const { dkimSign } = require('mailauth/lib/dkim/sign');
const { dkimVerify } = require('mailauth/lib/dkim/verify');
const fs = require('fs');
const Path = require('path');

// load private key for signing
const privateKeyPem = fs.readFileSync(Path.join(__dirname, 'keys', 'dkim-private.pem'), 'utf-8');

// load stub DNS results, we can use these to verify signed message
const dnsStubResults = JSON.parse(fs.readFileSync(Path.join(__dirname, 'keys', 'dkim-dns-stub.json'), 'utf-8'));

// Step 1. Generate the same email as in "alternative-content.js"
const rootNode = MimeNode.create('multipart/mixed', {
    from: {
        name: '🤡',
        address: 'example@example.com'
    },
    to: '👻 <andris@ethereal.email>',
    subject: 'Hello world, 🔱!',
    // ensure Date, Message-ID, etc
    defaultHeaders: true
});

const alternativeNode = MimeNode.create('multipart/alternative');

const textNode = MimeNode.create('text/plain; charset=utf-8', {
    encoding: 'quoted-printable'
});
textNode.content = 'Hello, 👻!\n';

const htmlNode = MimeNode.create('text/html; charset=utf-8', {
    encoding: 'quoted-printable'
});

// Set content for the node after node has been initialized
htmlNode.content = '<p><b>Hello, 👻!</b></p>\n';

const attachmentNode = MimeNode.create('image/png', {
    encoding: 'base64',
    // disposition defaults to "attachment" if filename is provided
    //disposition: 'attachment',
    filename: '✅.png',
    contentId: '<tere@vana>',

    // Set content as part of the initialization
    content: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQAQMAAAAlPW0iAAAABlBMVEUAAAD/' +
            '//+l2Z/dAAAAM0lEQVR4nGP4/5/h/1+G/58ZDrAz3D/McH8yw83NDDeNGe4U' +
            'g9C9zwz3gVLMDA/A6P9/AFGGFyjOXZtQAAAAAElFTkSuQmCC',
        'base64'
    )
});

alternativeNode.appendChild(textNode);
alternativeNode.appendChild(htmlNode);

rootNode.appendChild(alternativeNode);
rootNode.appendChild(attachmentNode);

// Compile the RFC822 EML message
const unsignedMessage = rootNode.serialize();

// Step 2. DKIM sign an email

// dkimSign returns a Promise, so you can use either
// dkimSign(args).then(results=>...).catch(err=>...) or results = await dkimSign(args);
dkimSign(unsignedMessage, {
    // Optional canonicalization, default is "relaxed/relaxed"
    canonicalization: 'relaxed/relaxed', // c=

    // Optional signing and hashing algorithm, default is "rsa-sha256"
    algorithm: 'rsa-sha256', // a=

    // Keys for one or more signatures
    // Different signatures can use different algorithms (mostly useful when
    // you want to sign a message both with RSA and Ed25519)
    signatureData: [
        {
            signingDomain: 'example.com', // d=
            selector: 'test', // s=

            // supported key types: RSA, Ed25519
            privateKey: privateKeyPem
        }
    ]
})
    .then(signResult => {
        const signatureHeader = Buffer.from(signResult.signatures, 'utf-8');

        // concat signature headers and unsigned message to get a signed EML
        const signedMessage = Buffer.concat([signatureHeader, unsignedMessage]);

        // output the signed email
        process.stdout.write(signedMessage);

        // Step 3. verify DKIM signature by using DNS stub

        // dkimVerify returns a Promise
        return dkimVerify(signedMessage, {
            // fake DNS resolver that uses entries from the stub JSON file instead of running real DNS requests
            resolver: async (name, rr) => {
                let match = dnsStubResults?.[name]?.[rr];
                if (!match) {
                    let err = new Error('Error');
                    err.code = 'ENOTFOUND';
                    throw err;
                }
                return match;
            }
        });
    })
    .then(verifyResult => {
        // adds a footer with DKIM verification results, one line per each signature
        console.log('\n---------');
        for (let { info } of verifyResult.results) {
            console.log(info);
        }
    })
    .catch(err => {
        console.error(err);
        process.exit(1);
    });

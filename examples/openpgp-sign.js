'use strict';

const openpgp = require('openpgp');
const fs = require('fs');
const Path = require('path');
const { MimeNode } = require('../lib/mime-model');

if (!process.argv[2]) {
    console.log('This example signs an email with GPG');
    console.log('Usage:');
    console.log(`  node openpgp-sign.js /path/to/email.eml [/path/to/private.key]`);
    process.exit();
}

const eml = fs.readFileSync(process.argv[2]);
const privateKeyPem = fs.readFileSync(process.argv[3] || Path.join(__dirname, 'keys', 'private.pem'), 'utf-8');

async function main() {
    // Parse EML buffer into a Mime Node
    const rootNode = MimeNode.from(eml, {
        // enforce line break format
        lineBr: '\r\n'
    });

    // Extract data that will be signed from the original email
    const contentTypeHeaders = rootNode.headers.remove('Content-Type');
    const contentTransferEncodingHeaders = rootNode.headers.remove('Content-Transfer-Encoding');
    const mimeBody = rootNode.removeBody();

    // Create new empty mime node to transfer the content we want to sign to
    const bodyMimeNode = MimeNode.create(null);

    bodyMimeNode.setHeaders(contentTypeHeaders);
    bodyMimeNode.setHeaders(contentTransferEncodingHeaders);
    bodyMimeNode.setBody(mimeBody);

    // Raw message for signing
    const signedMessageSource = bodyMimeNode.serialize();

    const privKey = await openpgp.readPrivateKey({ armoredKey: privateKeyPem });
    const signature = await openpgp.sign({
        message: await openpgp.createMessage({ text: signedMessageSource.toString() }),
        signingKeys: privKey,
        detached: true
    });

    // Create signature node
    const signatureMimeNode = MimeNode.create('application/pgp-signature', {
        disposition: 'inline',
        filename: 'signature.asc'
    });

    signatureMimeNode.content = signature;

    // Clear existing body and set a new Content-Type
    rootNode.resetContent('multipart/signed; protocol="application/pgp-signature"; micalg=pgp-sha512;');

    // Add the node that contains original content
    rootNode.appendChild(bodyMimeNode);

    // Add signature node
    rootNode.appendChild(signatureMimeNode);

    process.stdout.write(rootNode.serialize());
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});

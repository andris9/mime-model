'use strict';

/*
Generates an email with the following structure:

multipart/mixed
  text/plain
  image/png
*/

const { MimeNode } = require('../lib/mime-model');

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

const textNode = MimeNode.create('text/plain; charset=utf-8', {
    encoding: 'quoted-printable'
});
textNode.content = 'Hello, 👻!\n';

const attachmentNode = MimeNode.create('image/png', {
    disposition: 'attachment',
    filename: '✅.png'
});

attachmentNode.encoding = 'base64';
// Set content as part of the initialization
attachmentNode.content = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQAQMAAAAlPW0iAAAABlBMVEUAAAD/' +
        '//+l2Z/dAAAAM0lEQVR4nGP4/5/h/1+G/58ZDrAz3D/McH8yw83NDDeNGe4U' +
        'g9C9zwz3gVLMDA/A6P9/AFGGFyjOXZtQAAAAAElFTkSuQmCC',
    'base64'
);

rootNode.appendChild(textNode);
rootNode.appendChild(attachmentNode);

process.stdout.write(rootNode.serialize());

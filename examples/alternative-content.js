'use strict';

/*
Generates an email with the following structure:

multipart/mixed
  multipart/alternative
    text/plain
    text/html
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

process.stdout.write(rootNode.serialize());

'use strict';

const { MimeNode } = require('../lib/mime-model');

const eml = Buffer.from(
    `Content-Disposition: inline
Content-Type: text/html;
        charset="windows-1252 name=filename.html"

<h1>Hello w\xf6rld</h1>`,
    // treat input string as a sequence of bytes, not characters
    // so that "w\xf6rld"will become "wörld" in win-1252
    'binary'
);

const node = MimeNode.from(eml);

// do not use `node.charset='windows-1252'` as this would trigger content conversion
// instead override charset label for the node
node.contentData.charset = 'windows-1252';
// and update Content-Type header value for the node
node.updateContentType();

// set filename
node.filename = 'filename.html';

process.stdout.write(node.serialize());

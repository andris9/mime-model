# mime-model

Create and parse MIME nodes.

See [examples/](examples/) folder for usage examples.

## Usage

```
$ npm install mime-model
```

```js
const { MimeNode } = require('mime-model');
```

### Parse from EML

```js
const eml = fs.readFileSync('path/to/email.eml');
const node = MimeNode.from(eml);
```

### Create from scratch

```js
const node = MimeNode.create(contentType, {
    // content options
});
```

See possible content options [below](#node-editing).

In addition to normal content options you can use the following special options:

-   `defaultHeaders` - if `true` then sets headers like `Date`, `Message-ID` and `MIME-Version`

### Access child nodes

```
node.childNodes -> Array
```

Additionally check if there's a value for `node.multipart` as only multipart nodes have child nodes.

### Add node to multipart node

```js
node.appendChild(newNode);
```

or

```js
node.insertBefore(newNode, referenceNode);
```

**Example**

```js
const node = MimeNode.create('multipart/mixed', {
    // set headers like Message-ID, Date, etc
    defaultHeaders: true
});

const textNode = MimeNode.create('text/plain', {
    encoding: 'quoted-printable',
    content: 'Hello world 🔆!'
});
node.appendChild(textNode);
```

### Check Content-Type

MIME-type of the node or `null` if not set.

```
node.contentType -> String
```

**Example**

```js
if (node.contentType === 'image/png') {
    console.log('Image attachment');
}
```

### Check multipart

Multipart type like _"mixed"_ or _"alternative"_ etc. `null` if this node is not a multipart node.

```
node.multipart -> String
```

**Example**

```js
if (node.multipart) {
    for (let childNode of node.childNodes) {
        // ...
    }
}
```

### Serialize

Convert node to EML buffer

```
node.serialize();
```

**Example**

```js
const node = MimeNode.create('text/plain', {
    encoding: 'quoted-printable',
    content: 'Hello world 🔆!',
    defaultHeaders: true
});
process.stdout.write(node.serialize());
```

Output

```
Content-Type: text/plain; charset=utf-8
Content-Transfer-Encoding: quoted-printable
Message-ID: <64300d0d-022d-4ad3-9212-ad84116ef922@mim>
Date: Sun, 06 Nov 2022 15:51:38 +0000
MIME-Version: 1.0

Hello world =F0=9F=94=86!
```

## Node editing

All the following properties can be used as content options when creating new nodes using `MimeNode.create()`.

### subject

Read or set subject line. Unicode strings are used, so need to encode or decode anything. Value is `null` if subject is not set.

```js
console.log(node.subject); // "Subject line 👀"
node.subject = 'Another subject ✅';
```

### date

Read or set date objects. Value is `null` if date is not set.

```js
console.log(node.date); // 2022-11-05T19:51:24.992Z (Date object)
node.date = node.date.getTime() + 1000; // number is coerced to a date object
```

### encoding

Read or set Content-Transfer-Encoding for a node.

```js
// change content trasnfer encoding of a node from base64 to quoted-printable
if (node.encoding === 'base64') {
    node.encoding = 'quoted-printable';
}
```

### charset

Read or set character set for a text content node.

```js
// enforce UTF-8 for ISO-2022-JP content
if (node.charset === 'iso-2022-jp') {
    node.charset = 'utf-8';
}
```

### content

Read or set data content. When reading, the value is a buffer in the character set of the node. Transfer encoding is handled silently, so the value is the actual content, not a base64 or quoted-printable string.

When writing a string, it is encoded to the charset of the node automatically. Buffer values are not modified.

If you need to read an unicode string, not a buffer value, use `node.contentText`.

```js
// content is binary buffer without encoding
let imageFile = imageNode.content;
fs.writeFileSync('image.png', imageFile);

// charsets for strings are handled silently in the background
textNode.content = textNode.contentText + ' suffix value';
```

### filename

Read or set file name for the node.

```js
imageNode.filename = 'Image ✅.png';
```

### disposition

Read or set Content-Disposition value.

NB! This is not full header, but only the disposition identifier like "attachment" or "inline" or `null` if not set.

```js
imageNode.disposition = 'inline';
```

### contentId

Read or set Content-Id value.

```js
imageNode.contentId = '<unique-id@example.com>';
```

### addresses

Read and set address field values. The returned value is a structured object with unicode strings. When setting, you can use structured objects or a full header string without encoding.

-   _node.from_
-   _node.to_
-   _node.cc_
-   _node.bcc_
-   _node.sender_
-   _node.replyTo_

**Example**

```
node.from = 'Juulius 📭 <example.com>';
console.log(node.from);

[ { address: 'example.com', name: 'Juulius 📭' } ]
```

### messageId

Read or set Message-Id value.

```js
console.log(rootNode.messageId);
// " <28b35c92-852a-4862-b654-72e25f091223@example.com>"
```

### headers

Read node headers. The value is a list of tuples with header keys and values.

```
node.headers -> Array
```

**Example**

```
console.log(node.headers);
[
  [
    'Subject', '=?UTF-8?Q?Nodemailer_is_unicode_friendly_=E2=9C=94?= =?UTF-8?Q?1656663957583?='
  ],
  [ 'Content-Type', 'text/plain; charset=utf-8' ],
  [ 'Content-Transfer-Encoding', 'quoted-printable' ],
  [ 'Content-Disposition', 'inline' ],
  [ 'Message-ID', '<3660bb9f-d645-4945-a492-2c291de3e6fb@mim>' ],
  [ 'Date', 'Sun, 06 Nov 2022 13:44:10 +0000' ],
  [ 'MIME-Version', '1.0' ]
]
```

### resetContent()

Clears node content and sets a new content type value. Mostly useful if you want to convert a content node to a multipart node.

```js
node.resetContent(contentType);
```

**Example**

```js
rootNode.resetContent('multipart/signed; protocol="application/pgp-signature"; micalg=pgp-sha512;');
```

> **NB** MIME boundary is generated automatically for multipart nodes

### removeHeaders()

Removes and returns headers with a specific key value. Useful when you want to move headers from one node to another.

```
node.removeHeaders(key) -> Array
```

**Example**

Move _Content-Type_ headers from one node to another

```js
const contentTypeHeaders = rootNode.removeHeaders('Content-Type');
bodyMimeNode.setHeaders(contentTypeHeaders);
```

### setHeaders()

Applies headers to a node. The input array either includes header entry objects returned by `removeHeaders()` or full header strings.

```js
node.setHeaders(headersArray);
```

**Example**

```js
node.setHeaders([`Subject: =?UTF-8?Q?Nodemailer_is_unicode_friendly_=E2=9C=94?= =?UTF-8?Q?1656663957583?=`]);
console.log(node.subject); // "Nodemailer is unicode friendly ✔1656663957583"
```

### removeBody()

Removes and returns body structure from a node. Useful when you want to body contents from one node to another.

```
node.removeBody() -> Object
```

This method works both for content nodes and multipart nodes.

### setBody()

Attach body object from one node to another. You can get this object from the `removeBody()` call.

```
node.setBody(bodyObj) -> Object
```

This method works both for content nodes and multipart nodes.

**Example**

Convert a regular mime node into a multipart node.

```js
// remove body and relevant headers from the root node
const mimeBody = rootNode.removeBody();
const contentTypeHeaders = rootNode.removeHeaders('Content-Type');
const contentTransferEncodingHeaders = rootNode.removeHeaders('Content-Transfer-Encoding');
const mimeBody = rootNode.removeBody();

// create a new empty node and attach headers and body
const childNode = MimeNode.create(null);
childNode.setHeaders(contentTypeHeaders);
childNode.setHeaders(contentTransferEncodingHeaders);
childNode.setBody(mimeBody);

// force root node into a multipart node and attach the child node to it
rootNode.resetContent('multipart/mixed');
rootNode.appendChild(childNode);
```

## License

**MIT**

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
Content-Type: text/plain
Content-Transfer-Encoding: quoted-printable
Content-Disposition: inline
Message-ID: <aee375a2-fc7d-4752-9646-ae7a71ac829c@mim>
Date: Fri, 04 Nov 2022 14:37:44 +0000
MIME-Version: 1.0

Hello world =F0=9F=94=86!
```

## Node editing

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

```js
imageNode.disposition = 'inline';
```

## License

**MIT**

```

```

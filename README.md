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

### Add node to multipart node

```
node.appendChild(newNode);
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

## License

**MIT**

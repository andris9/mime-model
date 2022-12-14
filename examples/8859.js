'use strict';

/*
Generates an email with the following structure:

text/plain
*/

const { MimeNode } = require('../lib/mime-model');

const rootNode = MimeNode.create('text/plain', {
    from: {
        name: '馃ぁ',
        address: 'example@example.com'
    },
    to: '馃懟 <andris@ethereal.email>',
    subject: 'This email containts iso-8859-8-i encoded content',
    // ensure Date, Message-ID, etc
    defaultHeaders: true
});

rootNode.encoding = 'base64';
rootNode.charset = 'iso-8859-8-i';
rootNode.content =
    '讻讗砖专 讛注讜诇诐 专讜爪讛 诇讚讘专, 讛讜讗 诪讚讘专 讘志Unicode. 讛讬专砖诪讜 讻注转 诇讻谞住 Unicode 讛讘讬谞诇讗讜诪讬 讛注砖讬专讬, 砖讬讬注专讱 讘讬谉 讛转讗专讬讻讬诐 12志10 讘诪专抓 1997, 讘职旨诪指讬职讬谞职抓 砖讘讙专诪谞讬讛. 讘讻谞住 讬砖转转驻讜 诪讜诪讞讬诐 诪讻诇 注谞驻讬 讛转注砖讬讬讛 讘谞讜砖讗 讛讗讬谞讟专谞讟 讛注讜诇诪讬 讜讛志Unicode, 讘讛转讗诪讛 诇砖讜拽 讛讘讬谞诇讗讜诪讬 讜讛诪拽讜诪讬, 讘讬讬砖讜诐 Unicode 讘诪注专讻讜转 讛驻注诇讛 讜讘讬讬砖讜诪讬诐, 讘讙讜驻谞讬诐, 讘驻专讬住转 讟拽住讟 讜讘诪讞砖讜讘 专讘志诇砖讜谞讬.';

process.stdout.write(rootNode.serialize());

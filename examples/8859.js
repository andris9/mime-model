'use strict';

/*
Generates an email with the following structure:

text/plain
*/

const { MimeNode } = require('../lib/mime-model');

const rootNode = MimeNode.create('text/plain', {
    from: {
        name: '🤡',
        address: 'example@example.com'
    },
    to: '👻 <andris@ethereal.email>',
    subject: 'This email containts iso-8859-8-i encoded content',
    // ensure Date, Message-ID, etc
    defaultHeaders: true
});

rootNode.encoding = 'base64';
rootNode.charset = 'iso-8859-8-i';
rootNode.content =
    'כאשר העולם רוצה לדבר, הוא מדבר ב־Unicode. הירשמו כעת לכנס Unicode הבינלאומי העשירי, שייערך בין התאריכים 12־10 במרץ 1997, בְּמָיְינְץ שבגרמניה. בכנס ישתתפו מומחים מכל ענפי התעשייה בנושא האינטרנט העולמי וה־Unicode, בהתאמה לשוק הבינלאומי והמקומי, ביישום Unicode במערכות הפעלה וביישומים, בגופנים, בפריסת טקסט ובמחשוב רב־לשוני.';

process.stdout.write(rootNode.serialize());

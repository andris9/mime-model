'use strict';

const fs = require('fs');
const Path = require('path');
const { MimeNode } = require('./lib/mime-model');
const basePath = process.argv[2] || '.';

const { createHash } = require('crypto');

async function run(list) {
    for (let fname of list) {
        if (!/\.eml$/.test(fname)) {
            continue;
        }

        let fPath = Path.join(basePath, fname);

        try {
            const fd = await fs.promises.open(fPath, 'r');
            let eml = await fd.readFile();
            await fd.close();

            let sourceHash = createHash('md5').update(eml).digest('hex');

            let mp = await MimeNode.from(eml, {});
            let compiled = await mp.serialize();

            let destHash = createHash('md5').update(compiled).digest('hex');
            if (sourceHash !== destHash) {
                console.log('Hashes do not match');
                console.log('-------------------');
                console.log(fPath);
                console.log(sourceHash);
                console.log(destHash);

                console.log(
                    JSON.stringify(
                        {
                            ins: eml.toString(),
                            out: compiled.toString()
                        },
                        false,
                        2
                    )
                );

                console.log('-------------------\n');
                throw new Error('No match');
            }
        } catch (err) {
            console.error('Failed processing %s', fPath);
            throw err;
        }
    }
}

fs.readdir(basePath, (err, list) => {
    if (err) {
        console.error(err);
        return process.exit(1);
    }

    run(list)
        .then(() => console.log('done'))
        .catch(err => {
            console.error(err);
            return process.exit(1);
        });
});

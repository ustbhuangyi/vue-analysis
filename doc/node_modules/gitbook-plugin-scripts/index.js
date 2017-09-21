var _ = require('lodash');
var path = require('path');
var tmp = require('tmp');
var fs = require('fs');
var crypto = require('crypto');

// Small hack for gitbook < 3.0.0
// where the function is called multiple times
var result;

function getAssets() {
    if (!result) {
        var book = this;
        var tmpobj = tmp.dirSync();
        var files = this.config.get('pluginsConfig.scripts.files', []);
        var jsfiles = [];

        files.forEach(function(file) {
            book.log.debug.ln('copying script', file);
            var origin = book.resolve(file);
            // Add a hash to avoid name collisions
            var filename = hash(origin) + '-' + path.basename(origin);
            var output = path.resolve(tmpobj.name, filename);

            var content = fs.readFileSync(origin);
            fs.writeFileSync(output, content);

            jsfiles.push(filename);
        });

        result = {
            assets: tmpobj.name,
            js: jsfiles
        };
    }

    return  _.cloneDeep(result);
}

function hash(str) {
    return crypto
        .createHash('md5')
        .update(str, 'utf8')
        .digest('hex');
}

module.exports = {
    website: getAssets
};

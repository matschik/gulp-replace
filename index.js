"use strict";

var Transform = require("readable-stream/transform");
var rs = require("replacestream");
var istextorbinary = require("istextorbinary");

async function replaceAsync(str, regex, asyncFn) {
  const promises = [];
  str.replace(regex, (match, ...args) => {
    const promise = asyncFn(match, ...args);
    promises.push(promise);
  });
  const data = await Promise.all(promises);
  return str.replace(regex, () => data.shift());
}

module.exports = function(search, _replacement, options) {
  if (!options) {
    options = {};
  }

  if (options.skipBinary === undefined) {
    options.skipBinary = true;
  }

  const replacementIsAsync = _replacement.constructor.name === "AsyncFunction";

  let transform;

  if (replacementIsAsync) {
    transform = async function(file, enc, callback) {
      if (file.isNull()) {
        return callback(null, file);
      }

      var replacement = _replacement;
      if (typeof _replacement === "function") {
        // Pass the vinyl file object as this.file
        replacement = _replacement.bind({ file: file });
      }

      async function doReplace() {
        if (file.isStream()) {
          file.contents = file.contents.pipe(rs(search, replacement));
          return callback(null, file);
        }

        if (file.isBuffer()) {
          if (search instanceof RegExp) {
            const content = await replaceAsync(
              String(file.contents),
              search,
              async match => {
                return await replacement(match);
              }
            );
            file.contents = Buffer.from(content);
          } else {
            var chunks = String(file.contents).split(search);

            var result;
            if (typeof replacement === "function") {
              // Start with the first chunk already in the result
              // Replacements will be added thereafter
              // This is done to avoid checking the value of i in the loop
              result = [chunks[0]];

              // The replacement function should be called once for each match
              for (var i = 1; i < chunks.length; i++) {
                // Add the replacement value
                result.push(await replacement(search));

                // Add the next chunk
                result.push(chunks[i]);
              }

              result = result.join("");
            } else {
              result = chunks.join(replacement);
            }

            file.contents = Buffer.from(result);
          }
          return callback(null, file);
        }

        callback(null, file);
      }

      if (options && options.skipBinary) {
        istextorbinary.isText(file.path, file.contents, async function(
          err,
          result
        ) {
          if (err) {
            return callback(err, file);
          }

          if (!result) {
            callback(null, file);
          } else {
            await doReplace();
          }
        });

        return;
      }

      await doReplace();
    };
  } else {
    transform = function(file, enc, callback) {
      if (file.isNull()) {
        return callback(null, file);
      }

      var replacement = _replacement;
      if (typeof _replacement === "function") {
        // Pass the vinyl file object as this.file
        replacement = _replacement.bind({ file: file });
      }

      function doReplace() {
        if (file.isStream()) {
          file.contents = file.contents.pipe(rs(search, replacement));
          return callback(null, file);
        }

        if (file.isBuffer()) {
          if (search instanceof RegExp) {
            file.contents = Buffer.from(
              String(file.contents).replace(search, replacement)
            );
          } else {
            var chunks = String(file.contents).split(search);

            var result;
            if (typeof replacement === "function") {
              // Start with the first chunk already in the result
              // Replacements will be added thereafter
              // This is done to avoid checking the value of i in the loop
              result = [chunks[0]];

              // The replacement function should be called once for each match
              for (var i = 1; i < chunks.length; i++) {
                // Add the replacement value
                result.push(replacement(search));

                // Add the next chunk
                result.push(chunks[i]);
              }

              result = result.join("");
            } else {
              result = chunks.join(replacement);
            }

            file.contents = Buffer.from(result);
          }
          return callback(null, file);
        }

        callback(null, file);
      }

      if (options && options.skipBinary) {
        istextorbinary.isText(file.path, file.contents, function(err, result) {
          if (err) {
            return callback(err, file);
          }

          if (!result) {
            callback(null, file);
          } else {
            doReplace();
          }
        });

        return;
      }

      doReplace();
    };
  }

  return new Transform({
    objectMode: true,
    transform
  });
};

const util = require('util');
if (typeof util.styleText !== 'function') {
  util.styleText = (format, text) => {
    return text;
  };
}

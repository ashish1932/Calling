const fs = require('fs');
const html = fs.readFileSync('index.html', 'utf8');
const css = fs.readFileSync('css/styles.css', 'utf8');
// Let's just output the css for main, header, and .screen-content
console.log(css.match(/main\s*{[^}]*}/)[0]);
console.log(css.match(/header\s*{[^}]*}/)[0]);
console.log(css.match(/\.screen-content\s*{[^}]*}/)[0]);

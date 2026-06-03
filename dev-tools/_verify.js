const fs = require('fs');
const html = fs.readFileSync('E:/Counseling/index.html', 'utf8');

// Use regex from _check_html.js that was showing correct counts
const openAtStart = (html.match(/^<div[\s>]/gm) || []).length;   // only at start of lines
const anyOpen = (html.match(/<div[\s>]/g) || []).length;          // anywhere on a line
const anyClose = (html.match(/<\/div>/g) || []).length;

console.log(`Opening divs at line start only: ${openAtStart}`);
console.log(`Opening divs anywhere on line:    ${anyOpen}`);
console.log(`Closing divs:                     ${anyClose}`);
console.log(`\nanyOpen === anyClose? ${anyOpen === anyClose}`);
console.log(`openAtStart === anyClose? ${openAtStart === anyClose}`);

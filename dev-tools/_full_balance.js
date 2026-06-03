const fs = require('fs');
const html = fs.readFileSync('./index.html', 'utf8');

const divOpenCount = (html.match(/<div[\s>]/g) || []).length;
const divCloseCount = (html.match(/<\/div>/g) || []).length;
console.log(`All <div count: ${divOpenCount}, All </div> count: ${divCloseCount}`);
console.log(divOpenCount === divCloseCount ? 'FULLY BALANCED' : 'STILL MISMATCHED');

// Identify the unmatched closing div
const openingDivs = [];
const allDivOpenRegex = /<div[\s>][^>]*>/g;
let m;
while ((m = allDivOpenRegex.exec(html)) !== null) {
  openingDivs.push({ pos: m.index, text: m[0, 50] });
}

const closingDivs = [];
const allDivCloseRegex = /<\/div>/g;
while ((m = allDivCloseRegex.exec(html)) !== null) {
  closingDivs.push({ pos: m.index, text: html.substring(m.index, m.index + 30) });
}

console.log(`\nTotal opening divs: ${openingDivs.length}`);
console.log(`Total closing divs: ${closingDivs.length}`);

if (openingDivs.length !== closingDivs.length) {
  // Find extra/closing div
  console.log('\nLast 5 closing divs:');
  closingDivs.slice(-5).forEach(d => {
    const lineNum = html.substring(0, d.pos).split('\n').length;
    console.log(`  pos ${d.pos} (line ~${lineNum}): ${d.text.trim()}`);
  });
}

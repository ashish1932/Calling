const fs = require('fs');
const html = fs.readFileSync('E:/Counseling/index.html', 'utf8');

const divOpen = (html.match(/<div[\s>]/g) || []).length;
const divClose = (html.match(/<\/div>/g) || []).length;
console.log(`div open count: ${divOpen}`);
console.log(`div close count: ${divClose}`);
console.log(divOpen === divClose ? 'BALANCED' : 'MISMATCHED by ' + Math.abs(divOpen - divClose));

// Find all </div> and show their lines
let lines = html.split('\n');
let closeLines = [];
lines.forEach((line, i) => {
  if (line.includes('</div>')) closeLines.push(i + 1);
});
console.log('\nAll </div> lines:', closeLines.join(', '));

// Show context around potential problem areas
console.log('\nContext around lines 488-502:');
lines.slice(487, 503).forEach((line, i) => {
  console.log(`  ${i+488}: ${line.substring(0, 100)}`);
});

console.log('\nContext around lines 592-607:');
lines.slice(591, 607).forEach((line, i) => {
  console.log(`  ${i+592}: ${line.substring(0, 100)}`);
});

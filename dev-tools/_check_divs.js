const fs = require('fs');
const html = fs.readFileSync('E:/Counseling/index.html', 'utf8');

// Count all <div and </div> tags
const divOpen = (html.match(/<div[\s>]/g) || []).length;
const divClose = (html.match(/<\/div>/g) || []).length;
console.log(`<div ...> count: ${divOpen}`);
console.log(`</div> count:    ${divClose}`);
console.log(divOpen === divClose ? 'BALANCED' : 'MISMATCHED');

// Show line numbers for each div tag
let lines = html.split('\n');
console.log('\n--- <div occurrences ---');
lines.forEach((line, i) => {
  if (line.includes('<div') && !line.includes('</div>')) {
    console.log(`  Line ${i+1}: ${line.trim().substring(0, 80)}`);
  }
});
console.log('\n--- </div> occurrences ---');
lines.forEach((line, i) => {
  if (line.includes('</div>')) {
    console.log(`  Line ${i+1}: ${line.trim().substring(0, 80)}`);
  }
});

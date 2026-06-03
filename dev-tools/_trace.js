const fs = require('fs');
const html = fs.readFileSync('E:/Counseling/index.html', 'utf8');
const lines = html.split('\n');

console.log('--- ALL <div OPENINGS with line numbers ---');
let openIdx = 0, totalOpen = 0, totalClose = 0;
lines.forEach((line, i) => {
  const opens = (line.match(/<div[\s>]/g) || []).length;
  const closes = (line.match(/<\/div>/g) || []).length;
  if (opens > 0) {
    console.log(`  Line ${i+1} [+${opens}]: ${line.trim().substring(0,65)}`);
    totalOpen += opens;
  }
  if (closes > 0) {
    console.log(`  Line ${i+1} [-${closes}]: ${line.trim().substring(0,65)}`);
    totalClose += closes;
  }
});
console.log(`\nTotal <div opens: ${totalOpen}`);
console.log(`Total </div> closes: ${totalClose}`);
console.log(totalOpen === totalClose ? 'BALANCED' : 'MISMATCHED');

// Now track the running stack count
console.log('\n--- Stack balance after each line ---');
let stack = [];
lines.forEach((line, i) => {
  opens = (line.match(/<div[\s>]/g) || []).length;
  closes = (line.match(/<\/div>/g) || []).length;
  for (let o = 0; o < opens; o++) stack.push(i+1);
  for (let c = 0; c < closes; c++) stack.pop();
  // Show when stack hits negative
  if (stack.length < 0) {
    console.log(`  NEGATIVE STACK at line ${i+1}: ${line.trim().substring(0,65)}`);
  }
});
console.log('Final stack depth:', stack.length);

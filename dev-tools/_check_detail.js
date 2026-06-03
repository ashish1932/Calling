const fs = require('fs');
// Show actual line 489 and surrounding context
const html = fs.readFileSync('E:/Counseling/index.html', 'utf8');
const lines = html.split('\n');
console.log('=== Full context around lines 483-507 ===');
lines.slice(482, 508).forEach((line, i) => {
  console.log(`  ${i+483}: ${line}`);
});

console.log('\n=== Full context around lines 589-606 ===');
lines.slice(588, 606).forEach((line, i) => {
  console.log(`  ${i+589}: ${line}`);
});

const fs = require('fs');
const html = fs.readFileSync('E:/Counseling/index.html', 'utf8');
const lines = html.split('\n');

let divStack = []; // track nesting level

lines.forEach((line, i) => {
  let trimmed = line.trim();
  
  // Count open divs on this line
  let opens = (trimmed.match(/<div[\s>]/g) || []).length;
  let closes = (trimmed.match(/<\/div>/g) || []).length;
  
  for (let o = 0; o < opens; o++) {
    divStack.push({ line: i+1, text: trimmed.substring(0,60) });
  }
  for (let c = 0; c < closes; c++) {
    let popped = divStack.pop();
    if (!popped) {
      console.log(`EXTRA </div> at line ${i+1}: ${trimmed.substring(0,60)}`);
    }
  }
});

if (divStack.length > 0) {
  console.log('\nUnclosed divs (missing matching </div>):');
  divStack.forEach(d => console.log(`  line ${d.line}: ${d.text}`));
} else {
  console.log('All divs are balanced!');
}

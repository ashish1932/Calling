const fs = require('fs');
const html = fs.readFileSync('E:/Counseling/index.html', 'utf8');
const lines = html.split('\n');

// Trace entire file systematically
console.log('=== Full trace of all <div changes ===\n');
let depth = 0;
for (let i = 0; i < lines.length; i++) {
  let opens = (lines[i].match(/<div[\s>]/g) || []).length;
  let closes = (lines[i].match(/<\/div>/g) || []).length;
  if (opens === 0 && closes === 0) continue;
  
  let prevDepth = depth;
  depth += opens - closes;
  
  if (depth < 0 || closes > 0) {
    let line = i + 1;
    let pct = Math.floor(i / 6.06);
    let dir = '';
    if (opens > closes) dir = '→ (+)';
    else if (closes > opens) dir = '← (-)';
    else dir = '=';
    
    if (depth < 0) {
      console.log(`  !! depth=${prevDepth}→${depth} [NEGATIVE] L${line}: ${lines[i].trim().substring(0,70)}`);
    } else {
      console.log(`  ${dir} depth=${prevDepth}→${depth} L${line}: ${lines[i].trim().substring(0,70)}`);
    }
  }
}

console.log('\nFinal stack depth:', depth);

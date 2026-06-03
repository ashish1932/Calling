const fs = require('fs');
const html = fs.readFileSync('E:/Counseling/index.html', 'utf8');
const lines = html.split('\n');

// Show just the key sections - all divs in the structure
console.log('=== Surgical strip: body/body structure ===\n');
let inBody = false;
let depth = 0;
let anomalies = [];

for (let i = 0; i < lines.length; i++) {
  const l = lines[i];
  // Track entering body
  if (l.includes('<body>')) { inBody = true; continue; }
  if (l.includes('</body>')) { inBody = false; continue; }
  
  if (!inBody) continue;
  
  let opens = (l.match(/<div[\s>]/g) || []).length;
  let closes = (l.match(/<\/div>/g) || []).length;
  if (opens === 0 && closes === 0) continue;
  
  let lineNum = i + 1;
  
  // What will depth be after this line?
  let prevDepth = depth;
  for (let o = 0; o < opens; o++) depth++;
  for (let c = 0; c < closes; c++) depth--;
  
  let indent = '';
  let prefix = '';
  if (prevDepth < depth) prefix = '    Open → ';
  else if (prevDepth > depth) prefix = '← Close   ';
  else prefix = '           ';
  
  console.log(`  ${prefix} depth=${prevDepth}→${depth} | L${lineNum}: ${l.trim().substring(0,80)}`);
  
  if (closes > 0 && prevDepth === 0) {
    anomalies.push(`EXTRA CLOSE div at L${lineNum} (depth was 0)`);
  }
}

console.log('\n=== DOM nesting anomalies ===');
anomalies.forEach(a => console.log('  WARNING:', a));

const fs = require('fs');
const html = fs.readFileSync('E:/Counseling/index.html', 'utf8');
const lines = html.split('\n');

// Verbose trace: show every line where a div is opened or closed
let depth = 0;
let prevLineWasDiv = false;
for (let i = 0; i < lines.length; i++) {
  let opens = (lines[i].match(/<div[\s>]/g) || []).length;
  let closes = (lines[i].match(/<\/div>/g) || []).length;
  
  if (opens > 0 || closes > 0) {
    let info = '';
    if (i === 19 || i === 20 || i === 21) {
      info = ' <-- logo area';
    } else if (i >= 13 && i <= 25) {
      info = ' <-- SIDEBAR BLOCK';
    }
    
    if (prevLineWasDiv) {}
    prevLineWasDiv = true;
    console.log(`L${i+1}: ${lines[i].trim().substring(0, 70)}${info}`);
  }
  depth += opens - closes;
}

console.log('\nFinal depth:', depth);

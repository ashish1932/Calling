const fs = require('fs');
const html = fs.readFileSync('E:/Counseling/index.html', 'utf8');
const tags = ['<html>', '<head>', '<body>', '<div id="app-container">', '<aside>', '<main', '<header>', '<section'];
for (const t of tags) {
  const open = (html.match(new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
  const base = t.replace(/<([a-z][a-z0-9-]*).*/, '$1');
  const closeTag = '</' + base + '>';
  const close = (html.match(new RegExp(closeTag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
  console.log(t + '  open=' + open + ' close=' + close + (open === close ? ' OK' : ' IMBALANCED!'));
}

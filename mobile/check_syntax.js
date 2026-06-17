const fs = require('fs');
const babel = require('@babel/core');

try {
  const code = fs.readFileSync('App.js', 'utf-8');
  babel.transformSync(code, {
    filename: 'App.js',
    presets: ['@babel/preset-react'],
    plugins: ['@babel/plugin-syntax-jsx']
  });
  console.log("Syntax is OK!");
} catch (error) {
  console.error("Syntax Error Details:");
  console.error(error.message);
  console.error(error.codeFrame);
}

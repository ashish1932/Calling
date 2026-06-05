// Tele-Counseling Platform Zero-Dependency Bundler Build Script
// Usage: node build.js

const fs = require('fs');
const path = require('path');

const srcDir = __dirname;
const distDir = path.join(srcDir, 'dist');
const distJsDir = path.join(distDir, 'js');
const distCssDir = path.join(distDir, 'css');

console.log("🚀 Starting build process...");

// 1. Create directory structures
if (!fs.existsSync(distDir)) fs.mkdirSync(distDir);
if (!fs.existsSync(distJsDir)) fs.mkdirSync(distJsDir);
if (!fs.existsSync(distCssDir)) fs.mkdirSync(distCssDir);

// Helpers to clean JavaScript files (remove comments)
function cleanJS(content) {
  return content
    .replace(/\/\*[\s\S]*?\*\//g, '') // strip block comments only to prevent corrupting URLs or strings
    .replace(/^\s*\n/gm, ''); // remove empty lines
}

// Helpers to clean CSS
function cleanCSS(content) {
  return content
    .replace(/\/\*[\s\S]*?\*\//g, '') // strip CSS comments
    .replace(/^\s*\n/gm, ''); // remove empty lines
}

// 2. Bundle JS files in dependency order
const jsFiles = [
  'js/data.js',
  'js/ai.js',
  'js/profiles.js',
  'js/calling.js',
  'js/charts.js',
  'js/app.js'
];

let jsBundle = "";
jsFiles.forEach(file => {
  const filePath = path.join(srcDir, file);
  if (fs.existsSync(filePath)) {
    console.log(`- Bundling JS asset: ${file}`);
    const raw = fs.readFileSync(filePath, 'utf8');
    jsBundle += `\n/* --- BUNDLED FROM: ${file} --- */\n` + cleanJS(raw) + "\n";
  } else {
    console.error(`Error: Source JS file not found: ${filePath}`);
  }
});

fs.writeFileSync(path.join(distJsDir, 'app.bundle.js'), jsBundle, 'utf8');
console.log("✅ JS assets successfully bundled to dist/js/app.bundle.js");

// 3. Bundle CSS
const cssFiles = [
  'css/styles.css'
];

let cssBundle = "";
cssFiles.forEach(file => {
  const filePath = path.join(srcDir, file);
  if (fs.existsSync(filePath)) {
    console.log(`- Bundling CSS asset: ${file}`);
    const raw = fs.readFileSync(filePath, 'utf8');
    cssBundle += `\n/* --- BUNDLED FROM: ${file} --- */\n` + cleanCSS(raw) + "\n";
  } else {
    console.error(`Error: Source CSS file not found: ${filePath}`);
  }
});

fs.writeFileSync(path.join(distCssDir, 'styles.bundle.css'), cssBundle, 'utf8');
console.log("✅ CSS assets successfully bundled to dist/css/styles.bundle.css");

// 4. Bundle index.html
const indexHtmlPath = path.join(srcDir, 'index.html');
if (fs.existsSync(indexHtmlPath)) {
  console.log("- Compiling index.html layout...");
  let html = fs.readFileSync(indexHtmlPath, 'utf8');
  
  // Remove individual bundled script tags
  html = html.replace(/<script src="js\/(data|ai|profiles|calling|charts|app)\.js"( defer)??><\/script>\s*/gi, '');
  
  // Inject the new bundle tag right before the closing body tag
  html = html.replace(/<\/body>/i, '  <script src="js/app.bundle.js" defer></script>\n</body>');

  // Replace CSS link tag
  html = html.replace(/<link rel="stylesheet" href="css\/styles\.css">/gi, '<link rel="stylesheet" href="css/styles.bundle.css">');
  
  fs.writeFileSync(path.join(distDir, 'index.html'), html, 'utf8');
  console.log("✅ Compiled production output to dist/index.html");
} else {
  console.error("Error: index.html not found.");
}

console.log("🎉 Production build complete! Deployable assets are stored inside the '/dist' directory.");

// Copy assets folder if it exists
if (fs.existsSync(path.join(__dirname, 'assets'))) {
  fs.cpSync(path.join(__dirname, 'assets'), path.join(distDir, 'assets'), { recursive: true });
  console.log('? Assets folder successfully copied to dist/assets');
}

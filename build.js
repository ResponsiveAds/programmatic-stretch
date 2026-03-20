const fs = require('fs');
const path = require('path');
const { minify } = require('terser');

const rootDir = __dirname;
const pkg = require(path.join(rootDir, 'package.json'));
const sourcePath = path.join(rootDir, 'programmaticStretch.js');
const outputDir = path.join(rootDir, 'dest');
const outputPath = path.join(outputDir, 'programmaticStretch.min.js');

async function build() {
  const source = fs.readFileSync(sourcePath, 'utf8');
  const replaced = source.replace("var VERSION = '__VERSION__';", "var VERSION = '" + pkg.version + "';");

  if (replaced === source) {
    throw new Error('Version placeholder was not found in source file.');
  }

  const result = await minify(replaced);
  if (!result || !result.code) {
    throw new Error('Minification failed without output.');
  }

  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(outputPath, result.code, 'utf8');

  console.log('Built version ' + pkg.version + ' -> ' + path.relative(rootDir, outputPath));
}

build().catch(function (err) {
  console.error(err && err.message ? err.message : err);
  process.exit(1);
});

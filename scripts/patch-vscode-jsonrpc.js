// Patches vscode-jsonrpc to support ESM subpath imports.
// The @github/copilot-sdk imports "vscode-jsonrpc/node" (no .js extension),
// which fails under Node's strict ESM resolution because vscode-jsonrpc
// has no "exports" map. This adds one.
const fs = require('fs');
const path = require('path');

const pkgPath = path.join(__dirname, '..', 'node_modules', 'vscode-jsonrpc', 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

if (!pkg.exports) {
  pkg.exports = {
    '.': {
      require: './lib/node/main.js',
      default: './lib/node/main.js',
    },
    './node': {
      require: './lib/node/main.js',
      default: './lib/node/main.js',
    },
    './node.js': {
      require: './lib/node/main.js',
      default: './lib/node/main.js',
    },
    './*': './*',
  };
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
  console.log('Patched vscode-jsonrpc package.json with exports map');
} else {
  console.log('vscode-jsonrpc already has exports map, skipping patch');
}

// Clean up any leftover node/ directory from previous patch attempts
const nodeDir = path.join(__dirname, '..', 'node_modules', 'vscode-jsonrpc', 'node');
if (fs.existsSync(nodeDir) && fs.statSync(nodeDir).isDirectory()) {
  fs.rmSync(nodeDir, { recursive: true });
}

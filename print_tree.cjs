const fs = require('fs');
const path = require('path');

const IGNORE_DIRS = new Set([
  'node_modules', '.git', '.bolt', '.cursor', 'dist', 'tmp', 'project'
]);

function printTree(dir, prefix = '') {
  let files;
  try {
    files = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    return;
  }

  // Sort directories first, then files, alphabetically
  files.sort((a, b) => {
    if (a.isDirectory() && !b.isDirectory()) return -1;
    if (!a.isDirectory() && b.isDirectory()) return 1;
    return a.name.localeCompare(b.name);
  });

  files.forEach((file, index) => {
    if (IGNORE_DIRS.has(file.name)) return;

    const isLast = index === files.length - 1;
    const connector = isLast ? '└── ' : '├── ';
    
    console.log(`${prefix}${connector}${file.name}`);

    if (file.isDirectory()) {
      const newPrefix = prefix + (isLast ? '    ' : '│   ');
      printTree(path.join(dir, file.name), newPrefix);
    }
  });
}

console.log('.');
printTree(process.cwd());

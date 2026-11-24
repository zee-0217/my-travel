import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

async function checkDirectory(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) await checkDirectory(path);
    else if (entry.name.endsWith('.js')) {
      const result = spawnSync(process.execPath, ['--check', path], { stdio: 'inherit' });
      if (result.error || result.status !== 0) process.exit(1);
    }
  }
}

for (const directory of ['src', 'public/js', 'scripts', 'tests']) await checkDirectory(directory);
console.log('JavaScript syntax checks passed.');

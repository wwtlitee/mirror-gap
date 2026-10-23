import { spawnSync } from 'node:child_process';
import { readdir } from 'node:fs/promises';
async function collect(folder) {
  const entries = await readdir(folder, { withFileTypes: true });
  return (await Promise.all(entries.map(entry => entry.isDirectory() ? collect(`${folder}/${entry.name}`) : entry.name.endsWith('.mjs') ? [`${folder}/${entry.name}`] : []))).flat();
}
const files = ['server.mjs', ...await collect('src'), ...await collect('public'), ...await collect('tests'), ...await collect('scripts')];
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { stdio:'inherit' });
  if (result.status) process.exit(result.status);
}
console.log(`Syntax checked ${files.length} modules.`);

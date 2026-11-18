/** Discover interface tests, including checks colocated with components. */
import { readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, relative } from 'node:path';
import { spawn } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const web = resolve(root, 'web');
const editor = resolve(root, 'tests/editor');
async function discover(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const groups = await Promise.all(entries.map(entry => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return discover(path);
    return /\.test\.tsx?$/.test(entry.name) ? [relative(web, path)] : [];
  }));
  return groups.flat();
}
const files = (await Promise.all(['tests', 'src'].map(name => discover(resolve(web, name))))).flat().sort();
if (!files.length) throw new Error('No interface tests discovered');
// These DOM tests share editor components but live beside the content contract.
// Run them from their own tsconfig root so TSX uses React's automatic JSX runtime.
const editorFiles = (await readdir(editor)).filter(name => /\.test\.tsx$/.test(name)).sort();
if (!editorFiles.length) throw new Error('No shared editor DOM tests discovered');
let child;
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child?.kill(signal));
async function run(cwd, tsconfig, tests) {
  return await new Promise((resolve, reject) => {
    child = spawn(process.execPath, ['--import', 'tsx', '--test', ...process.argv.slice(2), ...tests], {
      cwd,
      stdio: 'inherit',
      env: { ...process.env, TSX_TSCONFIG_PATH: tsconfig },
    });
    child.on('error', reject);
    child.on('exit', code => { child = undefined; resolve(code ?? 1); });
  });
}
const webCode = await run(web, resolve(web, 'tsconfig.json'), files);
const editorCode = await run(editor, resolve(editor, 'tsconfig.json'), editorFiles);
process.exitCode = webCode || editorCode ? 1 : 0;

import {build} from 'esbuild';
import path from 'node:path';

process.env.TZ = 'Asia/Taipei';

const [{text: bundledTests}] = (await build({
  absWorkingDir: process.cwd(),
  entryPoints: [path.resolve('tests/characterization/non-ai-contracts.test.mjs')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  write: false,
  logLevel: 'silent',
})).outputFiles;

await import(`data:text/javascript;base64,${Buffer.from(bundledTests).toString('base64')}`);

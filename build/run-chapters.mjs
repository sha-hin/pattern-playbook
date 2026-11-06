// Runs every chapter's demo script and saves its output next to it (chapters/<slug>/output.txt).
// The site shows these files, so run this after changing any chapter code.
//
//   node build/run-chapters.mjs            all chapters
//   node build/run-chapters.mjs 07 08      only chapters whose folder starts with 07 or 08

import { execSync } from 'node:child_process';
import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHAPTERS } from '../content/course.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'chapters');
const only = process.argv.slice(2);

for (const slug of readdirSync(ROOT).sort()) {
  if (only.length && !only.some(p => slug.startsWith(p))) continue;
  const dir = join(ROOT, slug);
  const script = CHAPTERS[slug]?.run?.script ?? (existsSync(join(dir, 'composer.json')) ? 'bin/evaluations.php' : 'evaluations.php');
  if (existsSync(join(dir, 'composer.json'))) execSync('composer dump-autoload --quiet', { cwd: dir, stdio: 'inherit' });
  // Each demo is run from its chapter folder, exactly as a reader would run it.
  const output = execSync(`php ${script}`, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
  writeFileSync(join(dir, 'output.txt'), output);
  console.log(`ran ${slug}: php ${script}`);
}

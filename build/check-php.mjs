// Syntax-checks every PHP code block in the lessons with `php -l`.
// Method-only snippets are wrapped in a class; snippets with no opening tag get one.
//   node build/check-php.mjs
import { readdirSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'content', 'lessons');
const dir = mkdtempSync(join(tmpdir(), 'php-'));
let checked = 0, failed = 0;

const collect = (lesson) => {
  const out = [];
  const add = (b, where) => { if (b && b.code && b.lang !== 'text' && !b.fragment) out.push({ ...b, where }); };
  if (lesson.pain) add({ code: lesson.pain.code, path: 'quick fix', fragment: lesson.pain.fragment }, 'pain');
  for (const s of lesson.sections || []) for (const b of s.blocks || []) add(b, s.title);
  for (const k of ['laravel', 'topics', 'tests']) for (const b of lesson[k]?.blocks || []) add(b, k);
  return out;
};

for (const file of readdirSync(ROOT).sort()) {
  const lesson = (await import(pathToFileURL(join(ROOT, file)).href)).default;
  for (const b of collect(lesson)) {
    let code = b.code.trim();
    const starts = /^(public|protected|private|#\[|\/\*\*|\/\/)/.test(code) && !/^\s*(final |abstract )?(readonly )?(class|interface|enum|trait) /m.test(code);
    if (!code.startsWith('<?php')) code = starts ? `<?php\nclass __Snippet {\n${code}\n}` : `<?php\n${code}`;
    const path = join(dir, `${checked}.php`);
    writeFileSync(path, code);
    checked++;
    try {
      execFileSync('php', ['-l', path], { stdio: 'pipe' });
    } catch (e) {
      failed++;
      console.log(`✗ ${file} · ${b.where} · ${b.path}\n  ${String(e.stdout).split('\n').find(l => l.includes('error')) || e.message}`);
    }
  }
}
console.log(`${checked} PHP blocks checked, ${failed} failed.`);

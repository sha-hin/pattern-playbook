// Syntax-checks every PHP code block in the scenes and the foundation with `php -l`.
// Method-only snippets are wrapped in a class; snippets with no opening tag get one.
//   node build/check-php.mjs
import { readdirSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const CONTENT = join(dirname(fileURLToPath(import.meta.url)), '..', 'content');
const FILES = [join(CONTENT, 'foundation', 'index.mjs'), ...readdirSync(join(CONTENT, 'scenes')).sort().map(f => join(CONTENT, 'scenes', f))];
const dir = mkdtempSync(join(tmpdir(), 'php-'));
let checked = 0, failed = 0;

const collect = (lesson) => {
  const out = [];
  const add = (b, where) => { if (b && b.code && (b.lang || 'php') === 'php' && !b.fragment) out.push({ ...b, where }); };
  for (const s of [...(lesson.sections || []), ...(lesson.afterReveal || [])]) for (const b of s.blocks || []) add(b, s.title);
  for (const k of ['laravel', 'reveal', 'tests']) for (const b of lesson[k]?.blocks || []) add(b, k);
  for (const part of lesson.parts || []) out.push(...collect(part));          // the end page: one part per pattern
  return out;
};

for (const file of FILES) {
  const lesson = (await import(pathToFileURL(file).href)).default;
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
// Imports: in a namespaced file, every class it extends, implements, creates or calls statically must be
// imported, declared in the same namespace (in any block), or written fully qualified.
const blocks = [];
for (const file of FILES) for (const b of collect((await import(pathToFileURL(file).href)).default)) blocks.push({ ...b, file });
const declared = new Set(['App\\Http\\Controllers\\Controller', 'Tests\\TestCase']);   // ship with every Laravel app
for (const b of blocks) {
  const ns = b.code.match(/^namespace ([^;]+);/m)?.[1];
  for (const m of b.code.matchAll(/^(?:final |abstract |readonly )*(?:class|interface|enum|trait) (\w+)/gm)) declared.add(`${ns}\\${m[1]}`);
}
let missing = 0;
const PHP_GLOBALS = new Set(['Exception', 'LogicException', 'InvalidArgumentException', 'RuntimeException', 'UnexpectedValueException', 'DomainException', 'Throwable', 'Closure', 'Generator', 'DateTimeImmutable', 'ReflectionClass', 'ReflectionProperty', 'ReflectionParameter', 'ValueError']);
for (const b of blocks) {
  const ns = b.code.match(/^namespace ([^;]+);/m)?.[1] ?? '';   // '' = a test file in the global namespace
  const imported = new Set([...b.code.matchAll(/^use ([^;]+);$/gm)].map(m => m[1].split(/\s+as\s+/).pop().split('\\').pop()));
  const local = new Set([...b.code.matchAll(/(?:class|interface|enum|trait) (\w+)/g)].map(m => m[1]));
  const used = new Set();
  // Comments and strings can mention classes (Route::post in a comment, "Foo::bar" in a message): ignore them.
  const code = b.code.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*|'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"/g, '""');
  for (const re of [/\b(?:extends|implements|new|instanceof|catch \() *([A-Z]\w*)/g, /(?<![\\\w$])([A-Z]\w*)::/g, /^\s+use ([A-Z]\w*(?:, [A-Z]\w*)*);/gm]) {
    for (const m of code.matchAll(re)) m[1].split(', ').forEach(n => used.add(n));
  }
  for (const name of used) {
    if (['self', 'static', 'parent'].includes(name) || (!ns && PHP_GLOBALS.has(name)) || imported.has(name) || local.has(name) || declared.has(`${ns}\\${name}`)) continue;
    missing++;
    console.log(`✗ ${b.file.split('/content/')[1]} · ${b.path}: ${name} is not imported`);
  }
}
console.log(`${checked} PHP blocks checked, ${failed} failed; ${missing} missing imports.`);
if (failed || missing) process.exitCode = 1;

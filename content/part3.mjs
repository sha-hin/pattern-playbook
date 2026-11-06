// Part 3: importing and big data (chapters 12–15).

export const PART3 = {

  // ════════════════════════════════════════════════════════════════════
  '12-template-method': {
    description: 'Answers arrive as Google Forms CSV and Microsoft Forms JSON, and each importer is a copy that drifts. Fix it with the Template Method pattern in PHP: one fixed recipe, with the steps that differ left to subclasses.',
    ticket: {
      from: 'Support desk',
      title: 'Answers from Microsoft Forms skipped validation and saved a score of 7',
      body: 'Some schools collect answers with Google Forms (CSV download), others with Microsoft Forms (JSON export). The two imports were written separately. The JSON one never checks that the teacher exists, and it saved a score of 7. Both must follow exactly the same rules.',
    },
    pain: {
      text: ['Two importers, written months apart:'],
      code: `final class GoogleFormsCsvImport
{
    public function import(string $path): void
    {
        // read CSV → map columns → validate with value objects → check teacher → save
    }
}

final class MicrosoftFormsJsonImport
{
    public function import(string $path): void
    {
        // read JSON → map fields → save            (validation forgotten)
    }
}`,
      after: [
        'The two classes share most of their steps (validate, check the teacher, save, report rejected rows) but each has its own copy. A rule added to one is missing from the other, and a third format next term means a third copy.',
        'Only two steps really differ between formats: **how to read the file** and **where each field is**. The order of the steps and the validation must be the same for everyone.',
      ],
    },
    pattern: {
      name: 'Template Method',
      rule: 'Several classes follow the same recipe with a few different steps → write the recipe once in a base class (a final method) and let subclasses fill in only the steps that differ.',
      explain: [
        '`AnswerImport::import()` is the **template method**: read → map → validate → save, always in that order. It is `final`, so no subclass can reorder it or skip validation.',
        'The steps that differ are **abstract methods**: `readRows()` and `mapRow()`. Each format implements those two and nothing else. A **hook** is a step with a default that subclasses *may* replace: `roleText()` tidies the role label, and Microsoft Forms overrides it because it labels roles as "Peer (colleague)".',
        'The base class calls the subclass, not the other way round. This is sometimes called the Hollywood principle: "don’t call us, we’ll call you".',
      ],
      drawing: {
        bad: [['b', 6, 14, 138, 138, '', 'x'], ['t', 16, 36, 'CsvImport', 'm'], ['t', 22, 62, 'read', 'm'], ['t', 22, 84, 'map', 'm'], ['t', 22, 106, 'validate', 'm'], ['t', 22, 128, 'save', 'm'], ['b', 156, 14, 138, 138, '', 'x'], ['t', 166, 36, 'JsonImport', 'm'], ['t', 172, 62, 'read', 'm'], ['t', 172, 84, 'map', 'm'], ['t', 172, 106, '(no validate)', 'kx'], ['t', 172, 128, 'save', 'm']],
        good: [['b', 64, 6, 172, 100, '', 'v2'], ['t', 76, 26, 'import()  final', 'kv'], ['t', 84, 48, '1 read   ← subclass', 'm'], ['t', 84, 68, '2 map    ← subclass', 'm'], ['t', 84, 88, '3 validate · 4 save', 'm'], ['a', 110, 106, 60, 128, '', 'k'], ['a', 190, 106, 240, 128, '', 'k'], ['b', 4, 130, 112, 30, 'GoogleForms', 'n'], ['b', 184, 130, 112, 30, 'MicrosoftForms', 'n']],
        badCaption: 'Each format has its own copy of the whole process, and the copies drift.',
        goodCaption: 'One fixed recipe. Each format fills in only the two steps that differ.',
      },
    },
    steps: [
      { title: 'The two files we receive', text: ['A Google Forms CSV download. Line 6 has a score of 7 and line 7 a teacher who doesn’t exist.'], file: 'data/google-forms.csv' },
      { title: 'A Microsoft Forms JSON export', text: ['Different structure, different names, and its own role labels. Submission 3 is from a parent, which this survey doesn’t accept.'], file: 'data/microsoft-forms.json' },
      { title: 'One answer before validation', text: ['Every format is mapped to the same four text fields first.'], file: 'src/Import/RawAnswer.php' },
      { title: 'What an import reports', text: [], file: 'src/Import/ImportResult.php' },
      {
        title: 'The base class and its template method',
        text: [
          '`import()` is `final` and runs the steps in order. `readRows()`, `mapRow()` and `sourceName()` are abstract: every subclass must write them. `roleText()` is a hook with a default.',
          'Validation and the teacher check are `private`: subclasses can’t see them, so they can’t skip them.',
        ],
        file: 'src/Import/AnswerImport.php',
      },
      {
        title: 'Google Forms: read CSV, map columns',
        text: ['`readRows()` is a generator: it yields one row at a time, keyed by its line number in the file.'],
        file: 'src/Import/GoogleFormsCsvImport.php',
      },
      {
        title: 'Microsoft Forms: read JSON, map fields, replace the hook',
        text: ['It overrides `roleText()` to translate its own labels, and calls `parent::roleText()` to keep the default tidying.'],
        file: 'src/Import/MicrosoftFormsJsonImport.php',
      },
      {
        title: 'Import both files',
        text: ['The container builds each importer with its repositories.'],
        file: 'bin/import.php',
      },
    ],
    run: {
      script: 'bin/import.php',
      cmd: 'composer dump-autoload\nphp bin/import.php',
      text: ['Both formats are checked by the same rules: the score of 7, the unknown teacher and the parent are rejected with their row, and everything else is saved.'],
    },
    laravel: {
      text: [
        'Form requests are a template method: Laravel always runs `prepareForValidation()`, then your `authorize()`, then validation with your `rules()`, then `passedValidation()`. You fill in `rules()` and `authorize()` and may override the two hooks.',
        'Packages like Laravel Excel use the same idea: you implement `model()` or `collection()`, and the package owns the reading, chunking and transactions.',
      ],
      code: `final class StoreAnswerRequest extends FormRequest
{
    public function authorize(): bool            // a step you must fill in
    {
        return $this->user()->can('answer', $this->route('survey'));
    }

    public function rules(): array               // another one
    {
        return ['score' => ['required', 'integer', 'between:1,5']];
    }

    protected function prepareForValidation(): void   // a hook you may override
    {
        $this->merge(['role' => strtolower(trim($this->input('role', '')))]);
    }
}`,
    },
    check: [
      { q: 'Why is `import()` declared `final`?', a: 'So no subclass can change the order of the steps or skip validation. The recipe is the one thing every format must share.' },
      { q: 'What is the difference between an abstract step and a hook?', a: 'An abstract step must be written by every subclass. A hook has a default implementation that a subclass may replace if it needs to.' },
      { q: 'A Typeform export arrives. What do you write?', a: 'One subclass with `readRows()`, `mapRow()` and `sourceName()`. Validation and saving come for free.' },
    ],
    next: 'Admins want to preview the first rows of a file before importing it, and an Excel export with semicolons arrives. The reading code is locked inside each importer.',
  },

  // ════════════════════════════════════════════════════════════════════
  '13-factory-method': {
    description: 'Admins need a preview of each file before importing, and a semicolon Excel format arrives. Fix it with the Factory Method pattern in PHP: the base class asks its subclasses which reader to create.',
    ticket: {
      from: 'Mona Saleh, Head of Quality',
      title: 'Let us preview a file before importing it, and accept Excel files',
      body: 'Last week we imported a file into the wrong term because nobody looked at it first. Please show the first rows before importing. Also, schools using Excel on Arabic Windows send "CSV" files separated by semicolons, which start with strange characters (﻿).',
    },
    pain: {
      text: ['The preview needs to read the files too. The quick fix writes a second reader:'],
      code: `public function preview(string $path, string $format): array
{
    if ($format === 'google') {
        // a copy of GoogleFormsCsvImport::readRows()
    } elseif ($format === 'microsoft') {
        // a copy of MicrosoftFormsJsonImport::readRows()
    } elseif ($format === 'excel') {
        // a third CSV reader, with ';'
    }
}`,
      after: [
        'Every format’s reading code now exists twice, and each new format needs an edit in two places. Worse, the two CSV readers already differ in how they handle Excel’s byte-order mark.',
        'Reading a file is a job of its own. It should live in **reader objects**, and each importer should only say **which reader it needs**.',
      ],
    },
    pattern: {
      name: 'Factory Method',
      rule: 'A base class needs an object but shouldn’t decide which class it is → it calls an abstract "create" method, and each subclass returns the object it needs.',
      explain: [
        'Reading moves into small `RowReader` classes: `CsvRowReader` (any delimiter, strips Excel’s byte-order mark) and `JsonRowReader`. They can be used anywhere.',
        '`AnswerImport` gets an abstract method `createReader(): RowReader`. This is the **factory method**. Both `import()` and the new `preview()` call it; neither knows which reader they get. Each subclass answers with one line: `return new CsvRowReader(\';\');`.',
        'Compare it with Simple Factory (chapter 4): there, one class decides with a `match`. Here, the decision is **spread over subclasses**, through inheritance. The Excel format is a new subclass; nothing existing changes.',
      ],
      drawing: {
        bad: [['b', 30, 14, 240, 142, '', 'x'], ['t', 46, 40, 'preview($path, $format)', 'm'], ['t', 56, 64, "if google: fgetcsv(… ',')", 'm'], ['t', 56, 86, 'elseif microsoft: json…', 'm'], ['t', 56, 108, "elseif excel: fgetcsv(… ';')", 'm'], ['t', 46, 140, 'a copy of every reader', 'kx']],
        good: [['b', 70, 6, 160, 38, 'AnswerImport', 'v2'], ['t', 150, 60, 'createReader(): RowReader', 'm', 'middle'], ['a', 110, 68, 46, 96, '', 'k'], ['a', 150, 68, 150, 96, '', 'k'], ['a', 190, 68, 254, 96, '', 'k'], ['b', 4, 98, 84, 30, 'Google', 'n'], ['b', 108, 98, 84, 30, 'Microsoft', 'n'], ['b', 212, 98, 84, 30, 'Excel', 'n'], ['t', 46, 146, "CSV ','", 's', 'middle'], ['t', 150, 146, 'JSON', 's', 'middle'], ['t', 254, 146, "CSV ';'", 's', 'middle']],
        badCaption: 'The preview copies every format’s reading code behind an if/elseif.',
        goodCaption: 'The base class asks createReader(). Each subclass answers with the reader it needs.',
      },
    },
    steps: [
      { title: 'The reader interface', text: [], file: 'src/Import/RowReader.php' },
      {
        title: 'One CSV reader for every delimiter',
        text: ['The code that used to live inside `GoogleFormsCsvImport`, now reusable. It also skips the three-byte UTF-8 byte-order mark (the "﻿" Mona saw) that Excel writes at the start of the file.'],
        file: 'src/Import/CsvRowReader.php',
      },
      { title: 'The JSON reader', text: ['The code from `MicrosoftFormsJsonImport`, with the field names as parameters.'], file: 'src/Import/JsonRowReader.php' },
      {
        title: 'The factory method in the base class',
        text: ['`readRows()` is replaced by `createReader()`. `import()` and the new `preview()` both call it. `preview()` only reads and maps; it never validates or saves.'],
        file: 'src/Import/AnswerImport.php', diff: 'src/Import/AnswerImport.php',
      },
      { title: 'Google Forms answers: a comma CSV reader', text: [], file: 'src/Import/GoogleFormsCsvImport.php', diff: 'src/Import/GoogleFormsCsvImport.php' },
      { title: 'Microsoft Forms answers: a JSON reader', text: [], file: 'src/Import/MicrosoftFormsJsonImport.php', diff: 'src/Import/MicrosoftFormsJsonImport.php' },
      { title: 'The new format: one small subclass', text: ['A semicolon reader and its own column names. That is the whole format.'], file: 'src/Import/ExcelCsvImport.php' },
      { title: 'The Excel file', text: ['It starts with a byte-order mark and uses `;`. Row 4 has the score "two".'], file: 'data/excel-export.csv' },
      { title: 'Preview, then import', text: [], file: 'bin/import.php', diff: 'bin/import.php' },
    ],
    run: {
      script: 'bin/import.php',
      cmd: 'composer dump-autoload\nphp bin/import.php',
      text: ['Each file is previewed, then imported, through the reader its importer created. The Excel file’s first column is read as `Teacher`, not `﻿Teacher`, because the reader removed the byte-order mark.'],
    },
    laravel: {
      text: [
        'Laravel’s `Manager` classes (chapter 8) use factory methods: `SessionManager` has `createFileDriver()`, `createDatabaseDriver()`, `createRedisDriver()`, and the base class calls the right one by name.',
        'In tests, Eloquent model factories follow the same idea: `UserFactory::definition()` is a method each factory overrides to say what to create.',
      ],
      code: `final class TeacherFactory extends Factory
{
    // The base Factory class calls this to know what to build.
    public function definition(): array
    {
        return ['name' => fake()->name(), 'email' => fake()->safeEmail(), 'school' => 'Smouha'];
    }
}`,
    },
    check: [
      { q: 'How is Factory Method different from Simple Factory?', a: 'A Simple Factory is one class that decides with a `match`. A Factory Method is an abstract method in a base class; each subclass decides by overriding it.' },
      { q: 'Why can `preview()` support every format without an `if`?', a: 'It calls `createReader()`, and each subclass already returns the right reader.' },
      { q: 'The Google CSV starts using semicolons. What changes?', a: 'One line in `GoogleFormsCsvImport::createReader()`: `new CsvRowReader(\';\')`.' },
    ],
    next: 'The Ministry now wants every raw answer of the term, about 100,000 rows. The export crashes with "Allowed memory size exhausted".',
  },

  // ════════════════════════════════════════════════════════════════════
  '14-iterator': {
    description: 'Exporting 100,000 answers runs out of memory. Fix it with the Iterator pattern and PHP generators: stream rows in batches with yield, and loop over them like an array.',
    ticket: {
      from: 'Ministry of Education, data office',
      title: 'Send us every raw answer for 2026-T1',
      body: 'From this term we need the raw, anonymous answers (term, teacher, role, score), not only the averages. Nationally that is several hundred thousand rows. Our first test file failed on your side with "Allowed memory size of 134217728 bytes exhausted".',
    },
    pain: {
      text: ['The first version loaded every answer, then wrote the file:'],
      code: `$all = $db->query("SELECT * FROM responses WHERE term = '2026-T1'")->fetchAll();   // every row, at once
foreach ($all as $row) {
    fputcsv($file, [/* ... */]);
}`,
      after: [
        'Memory grows with the number of answers: twice the answers, twice the memory, until PHP’s limit stops the export half-way. Raising `memory_limit` only moves the wall.',
        'The export never needs more than **one answer at a time**. It needs something it can loop over that fetches rows as the loop goes.',
      ],
    },
    pattern: {
      name: 'Iterator (with Generators)',
      rule: 'Code needs to go through a collection without caring how it is stored or fetched → give it something to loop over. In PHP, a generator (yield) is the easiest way to write one.',
      explain: [
        'The **Iterator** pattern separates "going through the items" from "how the items are stored". In PHP it is built into the language: anything that implements `Iterator` or `IteratorAggregate` works in `foreach`, exactly like an array.',
        'A **generator** is a function that contains `yield`. Calling it doesn’t run it; it returns a `Generator` object, which is an `Iterator`. Each time the loop asks for the next item, the function runs until the next `yield`, hands over one value, and pauses. Our `inTerm()` fetches 1,000 rows, yields them one by one, then fetches the next 1,000.',
        'A generator can be looped over only once. `TermResponses` implements `IteratorAggregate`: every `foreach` calls its `getIterator()` and gets a fresh generator, so it behaves like a reusable collection.',
        'Iterator is in the Gang of Four book. Generators are PHP’s built-in way to write iterators without the five methods of the `Iterator` interface.',
      ],
      drawing: {
        bad: [['b', 4, 62, 66, 40, 'Database', 'n'], ['a', 70, 82, 96, 82, '', 'x'], ['b', 98, 40, 104, 84, 'array of 100,000', 'x'], ['a', 202, 82, 226, 82, '', 'x'], ['b', 228, 62, 68, 40, 'Export', 'n'], ['t', 150, 146, 'everything in memory at once', 'kx', 'middle']],
        good: [['b', 4, 62, 66, 40, 'Database', 'n'], ['a', 70, 82, 96, 82], ['b', 98, 58, 104, 48, 'generator', 'v'], ['a', 202, 82, 226, 82, '', 'k'], ['b', 228, 62, 68, 40, 'Export', 'n'], ['t', 150, 124, '1,000 rows per query', 'kv', 'middle'], ['t', 150, 144, 'yield one answer, pause, repeat', 's', 'middle']],
        badCaption: 'Every answer is loaded before the first line is written.',
        goodCaption: 'The export loops over a generator that fetches one batch at a time.',
      },
    },
    steps: [
      {
        title: 'A streaming method on the repository',
        text: ['The interface only promises an `iterable`: callers loop over it and don’t care how rows arrive.'],
        file: 'src/Domain/ResponseRepository.php', diff: 'src/Domain/ResponseRepository.php',
      },
      {
        title: 'The generator',
        text: [
          '`inTerm()` contains `yield`, so PHP turns it into an iterator. It uses **keyset pagination** (`WHERE id > last id ORDER BY id LIMIT 1000`) rather than `OFFSET`, which gets slower page by page and can skip or repeat rows if data changes during the export.',
        ],
        file: 'src/Infrastructure/Sqlite/SqliteResponseRepository.php', diff: 'src/Infrastructure/Sqlite/SqliteResponseRepository.php',
      },
      {
        title: 'A collection you can loop over twice',
        text: ['`yield from` passes every item of the repository’s generator through. Each `foreach` gets a new one.'],
        file: 'src/Reporting/TermResponses.php',
      },
      {
        title: 'The export accepts any iterable',
        text: ['Typed as `iterable`, it works with an array or a stream. It never holds more than one answer.'],
        file: 'src/Reporting/RawAnswersExport.php',
      },
      {
        title: 'Demo data: a big term',
        text: ['100,000 answers, inserted in one transaction so the demo starts in under a second.'],
        file: 'src/Demo/SampleData.php', diff: 'src/Demo/SampleData.php',
      },
      {
        title: 'Measure both ways',
        text: ['`memory_reset_peak_usage()` (PHP 8.2) starts a fresh measurement before each approach, so the setup isn’t counted.'],
        file: 'bin/export-raw.php',
      },
    ],
    run: {
      script: 'bin/export-raw.php',
      cmd: 'composer dump-autoload\nphp bin/export-raw.php',
      text: ['Loading everything first needs tens of megabytes, and the number grows with the term. Streaming stays under about one megabyte however many answers there are. The last lines show why `TermResponses` exists: a bare generator can’t be looped over twice.'],
    },
    laravel: {
      text: [
        'Eloquent has the same tool built in: `lazyById()` returns a `LazyCollection` backed by a generator, querying in chunks with keyset pagination. `cursor()` streams too, but keeps one database cursor open.',
        'Every Laravel `Collection` implements `IteratorAggregate`, which is why `foreach` works on it.',
      ],
      code: `// Streams the whole term in chunks of 1,000, using WHERE id > ? (keyset), not OFFSET:
$file = fopen($path, 'w');
Response::where('term', '2026-T1')
    ->lazyById(1000)
    ->each(fn (Response $r) => fputcsv($file, [$r->term, $r->teacher_id, $r->role, $r->score], escape: ''));`,
    },
    check: [
      { q: 'What happens when a function containing `yield` is called?', a: 'It doesn’t run yet. It returns a `Generator` object; the body runs step by step as a loop asks for the next value.' },
      { q: 'Why keyset pagination (`id > ?`) instead of `LIMIT 1000 OFFSET 50000`?', a: 'OFFSET makes the database skip all earlier rows on every page, so it gets slower, and rows added during the export can shift pages. Keyset jumps straight to the next id.' },
      { q: 'Why does `TermResponses` implement `IteratorAggregate` instead of being a generator itself?', a: 'A generator can only be looped over once. `getIterator()` creates a fresh generator for every `foreach`.' },
    ],
    next: 'The statistics screen really does need a whole term in memory at once. 100,000 answers mean 100,000 Score objects, but there are only five possible scores.',
  },

  // ════════════════════════════════════════════════════════════════════
  '15-flyweight': {
    description: '100,000 answers hold 100,000 Score objects, but only five scores exist. Share them with the Flyweight pattern in PHP and cut memory by about 40%.',
    ticket: {
      from: 'Omar Hassan, DevOps',
      title: 'The statistics screen uses 27 MB per term',
      body: 'The distribution charts load a whole term into memory. When four schools open the screen at the same time, the PHP workers hit their memory limit. Most of the memory looks like the same few small objects repeated.',
    },
    pain: {
      text: ['Look at what the repository creates for each row:'],
      code: `return new Response(
    (int) $row['teacher_id'],
    (string) $row['term'],                // a new copy of "2026-T1", 100,000 times
    RespondentRole::from($row['role']),
    new Score((int) $row['score']),       // a new Score object, 100,000 times
    (string) $row['comment'],
);`,
      after: [
        'There are only five possible scores, yet the term holds 100,000 `Score` objects: 20,000 identical copies of `Score(4)`. The same goes for the term name, copied into every row.',
        'Streaming (chapter 14) doesn’t help here: this screen genuinely needs every answer at once. What we can change is **how many objects** those answers point to.',
      ],
    },
    pattern: {
      name: 'Flyweight',
      rule: 'Huge numbers of objects repeat the same small values → share one immutable object per value, handed out by a factory, instead of creating a copy each time.',
      explain: [
        'A **flyweight** is a shared object. `Score::of(4)` always returns the same `Score` object for 4, created on first use. 100,000 answers now point to **five** `Score` objects.',
        'The book splits state in two: **intrinsic** state lives inside the shared object (the number 4), and **extrinsic** state stays with whoever uses it (which teacher, which term, which comment live in `Response`).',
        'Sharing is only safe because `Score` is **immutable**: its value is `readonly`. If any code could change a shared Score, it would change 20,000 answers at once. Never share mutable objects.',
        'You already used a flyweight: each PHP enum case (`RespondentRole::Student`) is a single shared object.',
      ],
      drawing: {
        bad: [['b', 4, 10, 78, 28, 'Answer 1', 'n'], ['b', 4, 50, 78, 28, 'Answer 2', 'n'], ['b', 4, 90, 78, 28, 'Answer 3', 'n'], ['b', 4, 130, 78, 28, 'Answer 4', 'n'], ['a', 82, 24, 210, 24, '', 'x'], ['a', 82, 64, 210, 64, '', 'x'], ['a', 82, 104, 210, 104, '', 'x'], ['a', 82, 144, 210, 144, '', 'x'], ['b', 212, 10, 84, 28, 'Score(4)', 'x'], ['b', 212, 50, 84, 28, 'Score(4)', 'x'], ['b', 212, 90, 84, 28, 'Score(5)', 'x'], ['b', 212, 130, 84, 28, 'Score(4)', 'x']],
        good: [['b', 4, 10, 78, 28, 'Answer 1', 'n'], ['b', 4, 50, 78, 28, 'Answer 2', 'n'], ['b', 4, 90, 78, 28, 'Answer 3', 'n'], ['b', 4, 130, 78, 28, 'Answer 4', 'n'], ['a', 82, 24, 210, 52, '', 'k'], ['a', 82, 64, 210, 58, '', 'k'], ['a', 82, 104, 210, 110, '', 'k'], ['a', 82, 144, 210, 64, '', 'k'], ['b', 212, 38, 84, 36, 'Score 4', 'v'], ['b', 212, 96, 84, 36, 'Score 5', 'v'], ['t', 254, 150, 'shared, read-only', 's', 'middle']],
        badCaption: 'Every answer gets its own copy of the same tiny value.',
        goodCaption: 'Answers point to one shared, immutable Score per value.',
      },
    },
    steps: [
      {
        title: 'Score becomes a flyweight',
        text: [
          '`Score::of()` is the **flyweight factory**: it keeps a static array of the instances it has made and returns the existing one if there is one. The constructor still validates, so `Score::of(140)` still fails.',
          'A `readonly` class can’t have static properties, so the class keeps `readonly` on its value instead. `fromInput()` now goes through `of()` too.',
        ],
        file: 'src/Domain/Score.php', diff: 'src/Domain/Score.php',
      },
      {
        title: 'The repository uses the shared objects',
        text: ['`Score::of()` replaces `new Score()`, and the term name is pooled the same way: one shared string per term instead of a copy per row. The class is no longer `readonly` because the pool changes as rows are read.'],
        file: 'src/Infrastructure/Sqlite/SqliteResponseRepository.php', diff: 'src/Infrastructure/Sqlite/SqliteResponseRepository.php',
      },
      { title: 'The demo data uses them too', text: [], file: 'src/Demo/SampleData.php', diff: 'src/Demo/SampleData.php' },
      {
        title: 'The statistics screen',
        text: ['It loads the term twice: once rebuilding every answer the old way (a new `Score` and a new term string each), once as the repository now returns it, and measures both. Then it counts the distinct `Score` objects.'],
        file: 'bin/statistics.php',
      },
    ],
    run: {
      script: 'bin/statistics.php',
      cmd: 'composer dump-autoload\nphp bin/statistics.php',
      text: ['The same 100,000 answers take about 40% less memory, and there are exactly five `Score` objects behind them.'],
    },
    laravel: {
      text: [
        'Laravel doesn’t ship a flyweight API, but PHP gives you two for free: enum cases are single shared instances, and identical string literals are interned. When Eloquent hydrates many models with a repeated small value object, a cast that returns a shared instance has the same effect:',
      ],
      code: `final class ScoreCast implements CastsAttributes
{
    public function get(Model $model, string $key, mixed $value, array $attributes): Score
    {
        return Score::of((int) $value);      // shared instance, not new Score()
    }

    public function set(Model $model, string $key, mixed $value, array $attributes): int
    {
        return $value->value;
    }
}`,
    },
    check: [
      { q: 'What is the intrinsic state of a `Score`, and what is extrinsic?', a: 'Intrinsic: the number (1 to 5), stored inside the shared object. Extrinsic: the teacher, term and comment, stored in each `Response`.' },
      { q: 'Why must a flyweight be immutable?', a: 'It is shared. Changing it would change every answer that points to it.' },
      { q: 'Should you use Flyweight for teachers?', a: 'No. Each teacher is a different object with its own data; there is nothing repeated to share. Flyweight pays off only for many copies of few values.' },
    ],
    next: 'Part 4 starts: surveys are no longer one score. The new survey has sections inside sections, and the score must be calculated for the whole tree.',
  },
};

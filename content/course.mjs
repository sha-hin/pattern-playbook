// The course: one app (Evalu8), one problem per chapter, one pattern to fix it.
//
// Each chapter's code lives in chapters/<slug>/ as a complete, runnable snapshot.
// Steps point at real files there, so the site can never drift from the code:
//   { file }               show the whole file from this chapter
//   { file, diff: path }   show what changed compared with <path> in the previous chapter
//   { code }               a short snippet that is not part of the project (e.g. a rejected idea)

export const PARTS = {
  1: 'Foundations',
  2: 'Talking to the outside world',
  3: 'Importing and big data',
  4: 'Survey structure',
  5: 'Workflows and reliability',
  6: 'Infrastructure and the editor',
};

// The whole plan. Chapters with `ready: true` have a page.
export const PLAN = [
  { n: 0, part: 1, slug: '00-the-mess', title: 'The code we inherited', patterns: [], ready: true },
  { n: 1, part: 1, slug: '01-value-object', title: 'Scores of 140 got into the database', patterns: ['Value Object'], ready: true },
  { n: 2, part: 1, slug: '02-repository', title: 'Only this term’s answers must count', patterns: ['Repository', 'Data Mapper vs Active Record'], ready: true },
  { n: 3, part: 1, slug: '03-strategy', title: 'Each school scores teachers its own way', patterns: ['Strategy'], ready: true },
  { n: 4, part: 1, title: 'The scoring method must come from school settings', patterns: ['Simple Factory'] },
  { n: 5, part: 1, title: 'Schools without AI analysis crash the report', patterns: ['Null Object'] },
  { n: 6, part: 1, title: 'Classes create their own database and mailer', patterns: ['Singleton', 'Dependency Injection Container'] },
  { n: 7, part: 2, title: 'Move from the OpenAI SDK to a local LLM', patterns: ['Adapter'] },
  { n: 8, part: 2, title: 'Local model in development, hosted model in production', patterns: ['Manager / Driver'] },
  { n: 9, part: 2, title: 'AI calls are slow and expensive', patterns: ['Decorator'] },
  { n: 10, part: 2, title: 'Load the 50 MB results only when opened, only for allowed users', patterns: ['Proxy'] },
  { n: 11, part: 2, title: 'Closing a survey takes six steps, and callers forget some', patterns: ['Facade'] },
  { n: 12, part: 3, title: 'Import answers from Google Forms CSV, Excel and JSON', patterns: ['Template Method'] },
  { n: 13, part: 3, title: 'Each importer needs its own reader', patterns: ['Factory Method'] },
  { n: 14, part: 3, title: 'Exporting 100,000 responses runs out of memory', patterns: ['Iterator', 'Generators'] },
  { n: 15, part: 3, title: '100,000 response objects repeat the same question data', patterns: ['Flyweight'] },
  { n: 16, part: 4, title: 'Sections inside sections: score the whole tree', patterns: ['Composite'] },
  { n: 17, part: 4, title: 'Export, validate and count the tree without editing it', patterns: ['Visitor'] },
  { n: 18, part: 4, title: '“Show Q5 only if Q3 ≥ 4 and the role is teacher”', patterns: ['Interpreter'] },
  { n: 19, part: 4, title: 'Start next term from last term’s survey', patterns: ['Prototype'] },
  { n: 20, part: 4, title: 'Build complex report searches and documents', patterns: ['Builder'] },
  { n: 21, part: 5, title: 'Survey lifecycle: draft, open, closed, archived', patterns: ['State'] },
  { n: 22, part: 5, title: 'When a survey closes, five things must happen', patterns: ['Observer', 'Event Dispatcher'] },
  { n: 23, part: 5, title: 'The 40-second AI analysis times out the request', patterns: ['Command', 'Command Bus'] },
  { n: 24, part: 5, title: 'The Ministry sync was lost when the server died', patterns: ['Unit of Work', 'Transactional Outbox'] },
  { n: 25, part: 5, title: 'Submitting an answer needs six checks', patterns: ['Chain of Responsibility', 'Pipeline'] },
  { n: 26, part: 5, title: '“Teachers with 3+ evaluations this term, not on leave”', patterns: ['Specification'] },
  { n: 27, part: 6, title: 'Local vs cloud: storage and queue must always match', patterns: ['Abstract Factory'] },
  { n: 28, part: 6, title: 'Three notification types × four channels', patterns: ['Bridge'] },
  { n: 29, part: 6, title: 'Survey editor parts keep changing each other', patterns: ['Mediator'] },
  { n: 30, part: 6, title: '“Undo” in the survey editor', patterns: ['Memento'] },
];

// Patterns from the Gang of Four book (1994). Everything else is marked "not in the book".
export const GOF = new Set([
  'Abstract Factory', 'Builder', 'Factory Method', 'Prototype', 'Singleton',
  'Adapter', 'Bridge', 'Composite', 'Decorator', 'Facade', 'Flyweight', 'Proxy',
  'Chain of Responsibility', 'Command', 'Interpreter', 'Iterator', 'Mediator', 'Memento',
  'Observer', 'State', 'Strategy', 'Template Method', 'Visitor',
]);

export const CHAPTERS = {

  // ════════════════════════════════════════════════════════════════════
  '00-the-mess': {
    description: 'Meet Evalu8, a school evaluation app written as one PHP script. Run it, read the output, and list every problem the next chapters will fix with a design pattern.',
    intro: [
      'You just joined the team behind **Evalu8**. Schools use it to evaluate their teachers: students, colleagues (peers) and the principal answer a short survey, each answer is a score from 1 to 5, and at the end of the term the app produces a report, emails every teacher their result and sends a CSV to the Ministry of Education.',
      'Everything lives in one PHP file. It runs, it has been "working" for two years, and nobody wants to touch it. In this course we will touch it: one real problem per chapter, fixed with the design pattern that fits it. By the last chapter, the same app will use every pattern from the Gang of Four book plus the modern ones every PHP framework relies on.',
      'Before changing anything, we read the code and run it.',
    ],
    steps: [
      {
        title: 'The whole app, as we found it',
        text: ['Read it from top to bottom once. Don’t try to fix anything yet.'],
        file: 'evaluations.php',
      },
    ],
    run: {
      cmd: 'php evaluations.php',
      text: ['PHP 8.2 or newer with the SQLite extension is all you need. The database lives in memory, so every run starts clean.'],
    },
    findings: [
      { title: 'Impossible numbers', text: 'Hany’s average is **49.67** on a 1–5 scale, because a principal typed `140`. Nadia’s is **1.50** although her student gave her 3: the peer’s answer `five` was stored as text and counted as 0. A role spelled `studnet` was stored too. The script accepts whatever arrives.', fix: 1 },
      { title: 'An email to nobody', text: 'Nadia has no email address, so the script "sent" her result to `<>`. Nothing failed, so nobody noticed.', fix: 1 },
      { title: 'The same SQL, three times', text: 'The report, the emails and the CSV each run their own `SELECT ... WHERE teacher_id = ...`. Any new rule (for example, "only this term") must be added to every copy. The INSERT is also built by joining strings, so a comment like `Didn’t use the lab` breaks it.', fix: 2 },
      { title: 'The scoring rule is copied, and the copies already disagree', text: 'The average is calculated three times. The report and the emails use `(float)`, the CSV uses `(int)` and rounds. Schools are also starting to ask for their own scoring methods, and there is no place to put them.', fix: 3 },
    ],
    takeaway: 'None of these problems needs a framework to fix. Each one needs one idea: a pattern. We start with the most dangerous one: wrong numbers that look real.',
  },

  // ════════════════════════════════════════════════════════════════════
  '01-value-object': {
    description: 'A score of 140 on a 1–5 scale reached the Ministry report. Fix it with Value Objects in PHP: Score, EmailAddress and an enum, each checking itself once, on creation.',
    ticket: {
      from: 'Mona Saleh, Head of Quality, Smouha Language School',
      title: 'Hany’s average is 49.67 and the Ministry already has the CSV',
      body: 'Our scale is 1 to 5. Hany shows 49.67, and Nadia shows 1.50 although her students rated her 3. We also found an evaluation from a "studnet". Please make sure this can never happen again, whichever screen the answers come from.',
    },
    pain: {
      text: [
        'The quick fix is an `if` before the INSERT:',
      ],
      code: `if ($answer['score'] < 1 || $answer['score'] > 5) {
    continue;   // skip it
}`,
      after: [
        'This has three problems. Answers will soon arrive from more places (a CSV import, an API, an admin screen), and each one needs the same `if`; the first place that forgets it lets 140 in again. `continue` drops the answer silently, so nobody knows it was lost. And the rest of the code still receives a plain string or int, so it can never be sure the value was checked.',
        'We need the check to live in **one place** that every answer must pass through, and we need the result of that check to travel with the value.',
      ],
    },
    pattern: {
      name: 'Value Object',
      rule: 'A small object that wraps one value, checks it once when it is created, and can never change afterwards. If you hold one, it is valid.',
      explain: [
        'Instead of passing the integer `4` around, we pass a `Score` object that contains 4. The only way to create a `Score` is its constructor, and the constructor refuses anything outside 1–5. So any function that receives a `Score` knows it is valid, without checking again.',
        'Three rules make it work: **it checks itself** in the constructor, **it can’t change** (all properties are `readonly`), and **two value objects with the same value are equal** (we compare them with `equals()`, not by identity).',
        'Value Object is not in the Gang of Four book. It comes from Domain-Driven Design (Eric Evans, 2003) and is one of the most used patterns in modern PHP.',
      ],
      drawing: {
        bad: [['b', 6, 62, 56, 40, 'Form', 'n'], ['a', 62, 82, 230, 82, '', 'x'], ['b', 232, 62, 62, 40, 'Database', 'x'], ['t', 150, 70, '"140"  "five"  "studnet"', 'kx', 'middle'], ['t', 150, 112, 'stored exactly as typed', 'kx', 'middle'], ['t', 150, 134, 'report: 49.67 on a 1–5 scale', 'kx', 'middle']],
        good: [['b', 4, 62, 56, 40, 'Form', 'n'], ['a', 60, 82, 94, 82], ['b', 96, 56, 108, 52, 'Score · Role', 'v'], ['a', 204, 82, 238, 82, '', 'k'], ['b', 240, 62, 56, 40, 'Database', 'n'], ['a', 150, 108, 150, 134, '', 'x'], ['t', 150, 152, 'rejected, with a reason', 'kx', 'middle'], ['t', 221, 74, 'valid', 's', 'middle']],
        badCaption: 'Every value is stored as typed. Nothing stands between the form and the database.',
        goodCaption: 'Every value must become a Score or a RespondentRole first. Bad ones are rejected loudly.',
      },
    },
    steps: [
      {
        title: 'Set up the project',
        text: ['From this chapter on, Evalu8 is a Composer project: classes live in `src/` under the `Evalu8\\` namespace (PSR-4), and the script moves to `bin/`. There are no packages to download; Composer only generates the autoloader.'],
        file: 'composer.json',
      },
      {
        title: 'One exception for "this value is not allowed"',
        text: ['Every value object throws the same exception type, so the code that reads user input can catch validation problems, and only those.'],
        file: 'src/Domain/InvalidValue.php',
      },
      {
        title: 'The Score value object',
        text: [
          'The constructor is the gate: it accepts an `int` and refuses anything outside 1–5. `final readonly class` means nobody can extend it and nothing can change `$value` after creation.',
          'Form input is always a string, so `fromInput()` is a second, named way to build a Score: it accepts `"4"` and rejects `"five"` or `"4.5"` with a clear message, then hands over to the constructor.',
        ],
        file: 'src/Domain/Score.php',
      },
      {
        title: 'The role: an enum',
        text: ['A role is one of a fixed list. PHP’s backed enum is exactly that: `RespondentRole::from(\'student\')` works, and there is no way to create a `studnet`. Enums are value objects built into the language.'],
        file: 'src/Domain/RespondentRole.php',
      },
      {
        title: 'The EmailAddress value object',
        text: ['Same idea for emails. It also stores the address in lower case, so `Hany@Smouha.edu.eg` and `hany@smouha.edu.eg` are equal.'],
        file: 'src/Domain/EmailAddress.php',
      },
      {
        title: 'Use them where data enters the app',
        text: [
          'Each answer is turned into value objects **before** it is stored. A bad answer is reported with its row number and the reason, and is not saved. Before an email is sent, the address must become an `EmailAddress`.',
          'While touching the INSERT, we also switch it to a prepared statement, so a comment containing `\'` can no longer break the SQL, and the `score` column becomes `INTEGER`, so the copied loops read it with `(int)`. The three copied SELECTs are still there; they are the next chapter’s problem.',
        ],
        file: 'bin/evaluations.php', diff: 'evaluations.php',
      },
    ],
    run: {
      cmd: 'composer dump-autoload\nphp bin/evaluations.php',
      text: ['The three bad answers are rejected with a reason, the averages are back on the 1–5 scale, and Nadia is not emailed. The script says so instead of pretending.'],
    },
    laravel: {
      text: [
        'Laravel validates the request first (`\'score\' => [\'required\', \'integer\', \'between:1,5\']`), which gives the user a friendly error. A value object is the second line of defence inside the app: it protects every path, including imports, jobs and tinker.',
        'Eloquent can turn a column into a value object automatically. Enums need nothing but a cast; for your own classes you write a small cast class:',
      ],
      code: `final class ScoreCast implements CastsAttributes
{
    public function get(Model $model, string $key, mixed $value, array $attributes): Score
    {
        return new Score((int) $value);
    }

    /** @param Score $value */
    public function set(Model $model, string $key, mixed $value, array $attributes): int
    {
        return $value->value;
    }
}

// In the Response model:
protected function casts(): array
{
    return [
        'score' => ScoreCast::class,
        'role' => RespondentRole::class,
    ];
}`,
    },
    check: [
      { q: 'Why does `Score` check the range in the constructor and not in the code that saves answers?', a: 'Because the constructor is the only way to create a Score. Every path that creates one, now and in the future, goes through the check, and code that receives a Score never has to check again.' },
      { q: 'What does `readonly` protect against?', a: 'Changing the value after it was checked. Without it, `$score->value = 140` would make a valid object invalid.' },
      { q: 'Why is the result printed as "Row 2: …" instead of skipping the row?', a: 'A skipped row is lost data that nobody knows about. Rejecting loudly lets someone fix the source.' },
    ],
    next: 'The report, the emails and the CSV still run the same SQL three times. The next ticket adds a rule to that SQL.',
  },

  // ════════════════════════════════════════════════════════════════════
  '02-repository': {
    description: 'A new rule must be added to SQL that is copied in three places. Fix it with the Repository pattern in PHP, and learn the difference between Data Mapper and Active Record (Eloquent).',
    ticket: {
      from: 'Ahmed Nabil, Product Owner',
      title: 'Only this term’s answers must count',
      body: 'From now on every answer belongs to a term, for example 2026-T1. The term report, the emails and the Ministry CSV must only count the current term. Last term’s answers are still in the database and must stay there.',
    },
    pain: {
      text: ['The SELECT exists three times in the script, once per output:'],
      code: `$rows = $db->query('SELECT * FROM responses WHERE teacher_id = ' . $teacher['id'])->fetchAll();   // report
$rows = $db->query('SELECT * FROM responses WHERE teacher_id = ' . $teacher['id'])->fetchAll();   // emails
$rows = $db->query('SELECT score FROM responses WHERE teacher_id = ' . $teacher['id'])->fetchAll(); // CSV`,
      after: [
        'Adding `AND term = ...` three times works today. Next month someone writes a fourth query for a dashboard, forgets the term, and the dashboard shows two terms mixed together. Nothing fails; the numbers are just wrong.',
        'The deeper problem: every part of the app knows the table names, the column names and how a row is turned into data. The question "this teacher’s answers for this term" has no name and no home.',
      ],
    },
    pattern: {
      name: 'Repository',
      rule: 'One class per kind of data that works like a collection: "add this", "give me these". All the SQL lives inside it, and the rest of the app only knows its interface.',
      explain: [
        'The rest of the app asks `$responses->forTeacherInTerm($teacherId, $term)` and gets back a list of `Response` objects. How they are stored (SQLite today, MySQL tomorrow, an API one day) is the repository’s business only.',
        'We first define the repository as an **interface** in the domain (`ResponseRepository`), then write one implementation for SQLite. Code that uses it depends on the interface, so it never sees SQL.',
        'Repository is not in the Gang of Four book. It comes from Martin Fowler’s *Patterns of Enterprise Application Architecture* (2002) and Domain-Driven Design.',
      ],
      drawing: {
        bad: [['b', 6, 14, 72, 28, 'Report', 'n'], ['b', 6, 68, 72, 28, 'Emails', 'n'], ['b', 6, 122, 72, 28, 'CSV', 'n'], ['a', 78, 28, 218, 74, '', 'x'], ['a', 78, 82, 218, 82, '', 'x'], ['a', 78, 136, 218, 90, '', 'x'], ['b', 220, 60, 74, 44, 'Database', 'n'], ['t', 150, 44, 'SQL', 'kx', 'middle'], ['t', 150, 77, 'SQL', 'kx', 'middle'], ['t', 150, 128, 'SQL', 'kx', 'middle'], ['t', 257, 128, '3 copies', 'kx', 'middle']],
        good: [['b', 4, 14, 60, 28, 'Report', 'n'], ['b', 4, 68, 60, 28, 'Emails', 'n'], ['b', 4, 122, 60, 28, 'CSV', 'n'], ['a', 64, 28, 92, 74], ['a', 64, 82, 92, 82], ['a', 64, 136, 92, 90], ['b', 94, 59, 84, 46, 'Repository', 'i'], ['a', 178, 82, 196, 82, '', 'k'], ['b', 198, 59, 98, 46, 'SQLite repo', 'v'], ['t', 136, 124, 'interface', 's', 'middle'], ['t', 247, 124, 'all SQL here', 'kv', 'middle']],
        badCaption: 'Every output writes its own SQL. A new rule must be added to every copy.',
        goodCaption: 'Every output asks the repository. The rule is written once, inside it.',
      },
      extra: {
        title: 'Data Mapper vs Active Record',
        text: [
          'There are two ways to connect objects to database rows, and you will meet both.',
          'In **Active Record**, the object *is* a row: it knows its table and saves itself (`$response->save()`). Laravel’s Eloquent works this way. It is quick to write, but every model depends on the database.',
          'In **Data Mapper**, the object is plain PHP and knows nothing about storage; a separate class copies data between rows and objects. Our `Response` has no `save()` method, and `SqliteResponseRepository` does the mapping in `add()` (object → row) and `toResponse()` (row → object). Doctrine ORM works this way.',
        ],
        rows: [
          ['', 'Active Record (Eloquent)', 'Data Mapper (this chapter, Doctrine)'],
          ['Who saves?', '$response->save()', '$repository->add($response)'],
          ['Object knows the table?', 'Yes', 'No'],
          ['Good for', 'CRUD-heavy apps, fast development', 'Rich business rules, swappable storage'],
        ],
      },
    },
    steps: [
      {
        title: 'Plain objects for the data',
        text: ['A `Teacher` and a `Response` are plain readonly objects built from value objects. Neither has a `save()` method, and neither mentions SQL. A teacher without an email has `null` instead of an empty string, so "no email" is impossible to miss.'],
        file: 'src/Domain/Teacher.php',
      },
      {
        title: 'The Response, with its term',
        text: ['The new `term` field is part of every answer.'],
        file: 'src/Domain/Response.php',
      },
      {
        title: 'The repository interfaces',
        text: ['Method names describe what the app needs, not how SQL works: `forTeacherInTerm()`, not `selectWhere()`. The term rule now has a name.'],
        file: 'src/Domain/ResponseRepository.php',
      },
      {
        title: 'The teacher repository interface',
        text: [],
        file: 'src/Domain/TeacherRepository.php',
      },
      {
        title: 'The schema',
        text: ['The table gets the `term` column, an index for the query we run most, and a `CHECK` that refuses scores outside 1–5. The value object is the first line of defence; the database is the last.'],
        file: 'src/Infrastructure/Sqlite/Schema.php',
      },
      {
        title: 'The SQLite repositories: all SQL lives here',
        text: [
          'Every query uses a prepared statement. `add()` turns an object into a row, and `toResponse()` turns a row back into an object **through the value objects**, so a bad value that is already in the database fails loudly when it is read.',
        ],
        file: 'src/Infrastructure/Sqlite/SqliteResponseRepository.php',
      },
      {
        title: 'The teacher repository',
        text: ['It maps an empty email column to `null`.'],
        file: 'src/Infrastructure/Sqlite/SqliteTeacherRepository.php',
      },
      {
        title: 'The script asks; it never writes SQL',
        text: [
          'The three copied queries become one call each to `forTeacherInTerm()`, and the term rule is applied in exactly one place. The repeated average loop also moved into one `averageOf()` function; the next chapter shows why that is still not enough.',
        ],
        file: 'bin/evaluations.php', diff: 'bin/evaluations.php',
      },
    ],
    run: {
      cmd: 'composer dump-autoload\nphp bin/evaluations.php',
      text: ['Hany’s answer from last term (`2025-T2`, score 1) is stored but not counted: his average stays 4.50. The comment `Didn’t use the lab` is saved without breaking anything.'],
    },
    laravel: {
      text: [
        'Eloquent is Active Record, so most Laravel apps don’t add a repository: they give the repeated query a name with a **local scope** on the model. That already solves this ticket: the rule is written once.',
        'Add a repository interface on top of Eloquent only when you need to: to keep business code free of Eloquent, to swap the storage, or to fake it in a test. Wrapping every model "just because" adds files without adding value.',
      ],
      code: `// The rule, written once, as a scope on the Response model:
public function scopeForTeacherInTerm(Builder $query, int $teacherId, string $term): void
{
    $query->where('teacher_id', $teacherId)->where('term', $term);
}

// Everywhere else:
$answers = Response::forTeacherInTerm($teacher->id, $term)->get();

// When you do need a repository, it implements the same interface with Eloquent inside:
final class EloquentResponseRepository implements ResponseRepository
{
    public function forTeacherInTerm(int $teacherId, string $term): array
    {
        return ResponseModel::forTeacherInTerm($teacherId, $term)
            ->get()
            ->map(fn (ResponseModel $row): Response => $row->toDomain())
            ->all();
    }

    // add() ...
}`,
    },
    check: [
      { q: 'A new dashboard needs this term’s answers for one teacher. What does its code look like now?', a: 'One call: `$responses->forTeacherInTerm($teacherId, $term)`. It cannot forget the term rule, because the rule is inside the repository.' },
      { q: 'Why is `ResponseRepository` an interface and not just the SQLite class?', a: 'So the code that uses it depends on "something that stores responses", not on SQLite. Another implementation (MySQL, Eloquent, an in-memory fake) can replace it without changing that code.' },
      { q: 'Is Eloquent a Data Mapper or an Active Record?', a: 'Active Record: each model knows its table and saves itself with `save()`.' },
    ],
    next: 'Two schools have just asked to calculate the score differently. Right now there is one `averageOf()` function for everybody.',
  },

  // ════════════════════════════════════════════════════════════════════
  '03-strategy': {
    description: 'Two schools want different scoring methods (weighted and median). Fix it with the Strategy pattern in PHP: one class per scoring method behind one interface.',
    ticket: {
      from: 'Ahmed Nabil, Product Owner',
      title: 'Smouha wants weighted scores, Miami wants the median',
      body: 'Smouha: students count 50%, peers 20%, the principal 30%. Miami: use the median, so one angry student can’t sink a teacher. Every other school keeps the plain average. Two more schools are already asking for their own rules.',
    },
    pain: {
      text: ['The quick fix is to teach `averageOf()` about schools:'],
      code: `function scoreFor(array $answers, string $school): float
{
    if ($school === 'Smouha') {
        // 15 lines of weighted maths
    } elseif ($school === 'Miami') {
        // 12 lines of median maths
    } else {
        // the average
    }
}`,
      after: [
        'Every new school opens this function and adds a branch, risking the branches that already work. One function now knows every school’s private rules, and the only way to check the Miami maths is to run the whole thing with a Miami teacher.',
        'Each branch is the **same job** (turn answers into one number) done **a different way**. That is the exact situation one pattern was made for.',
      ],
    },
    pattern: {
      name: 'Strategy',
      rule: 'The same job can be done in several ways → put each way in its own class, behind one interface. The code that uses it gets one and never asks which.',
      explain: [
        'We define one interface, `ScoringMethod`, with one method: `score(array $responses): ?float`. Then one class per way of scoring: `AverageScoring`, `MedianScoring`, `WeightedScoring`. These are the **strategies**.',
        'The class that uses them, `TermReport`, is the **context**. It receives a scoring method and calls `score()`. It has no `if` about schools and doesn’t know which class it was given.',
        'A new school with a new rule is now one new class. Nothing that already works is opened.',
      ],
      drawing: {
        bad: [['b', 30, 14, 240, 142, '', 'x'], ['t', 46, 40, 'scoreFor($answers, $school)', 'm'], ['t', 56, 66, 'if Smouha: weighted …', 'm'], ['t', 56, 88, 'elseif Miami: median …', 'm'], ['t', 56, 110, 'else: average …', 'm'], ['t', 56, 138, 'elseif Victoria: ← edit again', 'kx']],
        good: [['b', 4, 64, 72, 38, 'TermReport', 'n'], ['a', 76, 83, 92, 83], ['b', 94, 61, 92, 44, 'ScoringMethod', 'i'], ['a', 186, 83, 204, 34, '', 'k'], ['a', 186, 83, 204, 83, '', 'k'], ['a', 186, 83, 204, 132, '', 'k'], ['b', 206, 14, 88, 36, 'Average', 'v'], ['b', 206, 65, 88, 36, 'Median', 'v'], ['b', 206, 116, 88, 36, 'Weighted', 'v'], ['t', 140, 124, 'interface', 's', 'middle'], ['t', 140, 150, 'new rule = 1 new class', 's', 'middle']],
        badCaption: 'One function holds every school’s rules. Each new school edits it again.',
        goodCaption: 'TermReport talks to the interface. Each rule is its own class.',
      },
    },
    steps: [
      {
        title: 'The strategy interface',
        text: [
          'One method, one job. It returns `?float`: `null` means "no answers to score". Until now a teacher with no answers got `0.00`, which looks like a real (terrible) score. `null` makes that case impossible to miss.',
        ],
        file: 'src/Scoring/ScoringMethod.php',
      },
      {
        title: 'Strategy 1: the average',
        text: ['The old `averageOf()` function, moved into its own class.'],
        file: 'src/Scoring/AverageScoring.php',
      },
      {
        title: 'Strategy 2: the median',
        text: ['Sort the scores and take the middle one; with an even count, average the two middle ones.'],
        file: 'src/Scoring/MedianScoring.php',
      },
      {
        title: 'Strategy 3: weighted by role',
        text: [
          'The weights are checked once, in the constructor: every key must be a real role, and they must add up to 1.0. A wrong setup fails when the app starts, not halfway through a report.',
          'If a group gave no answers (no principal yet, for example), its share is spread over the groups that did, so the result stays on the 1–5 scale instead of silently dropping.',
        ],
        file: 'src/Scoring/WeightedScoring.php',
      },
      {
        title: 'One result per teacher',
        text: ['The report, the emails and the CSV used to calculate the score three times. Now it is calculated once into a `TeacherResult`, and all three outputs read from it.'],
        file: 'src/Reporting/TeacherResult.php',
      },
      {
        title: 'The context: TermReport',
        text: ['It looks up the scoring method for the teacher’s school, falls back to the default, and calls `score()`. Notice what is missing: any `if` about how scoring works.'],
        file: 'src/Reporting/TermReport.php',
      },
      {
        title: 'Choose the strategies, then use the results',
        text: [
          'The script decides which school uses which strategy, in one visible place, and hands them to `TermReport`. The three output blocks shrink to reading results.',
          'The sample answers also changed: each teacher now has enough answers for the three methods to give visibly different results, written as short `[teacher, role, score, comment]` rows.',
          'The list of schools is still written in the code. Moving it into each school’s settings is the next chapter.',
        ],
        file: 'bin/evaluations.php', diff: 'bin/evaluations.php',
      },
    ],
    run: {
      cmd: 'composer dump-autoload\nphp bin/evaluations.php',
      text: [
        'Karim (Miami) got 1, 4, 4 and 5. The average would be 3.50; the median is **4.00**, so the one angry student no longer sinks him. Hany (Smouha) is weighted: students 4.67 × 50% + peer 3 × 20% + principal 4 × 30% = **4.13**.',
      ],
    },
    laravel: {
      text: [
        'Laravel’s password hashing is a Strategy. The `Hasher` contract is the interface; `BcryptHasher` and `ArgonHasher` are the strategies. Your code only calls `Hash::make()` and never knows which one runs.',
        'In your own app, type-hint the interface and let the container give you the right strategy:',
      ],
      code: `// AppServiceProvider::register()
$this->app->bind(ScoringMethod::class, AverageScoring::class);   // the default

// Any class that needs one just asks for the interface:
final class TermReport
{
    public function __construct(
        private ScoringMethod $defaultScoring,
        // ...
    ) {}
}`,
    },
    check: [
      { q: 'Victoria College wants "drop the highest and lowest score, then average". What do you change?', a: 'Add one class, for example `TrimmedAverageScoring implements ScoringMethod`, and give it to Victoria. `TermReport` and the other strategies don’t change.' },
      { q: 'How is Strategy different from the `if/elseif` version, if both produce the same numbers?', a: 'Each way of scoring is its own class: it can be read, changed and checked alone, and adding one doesn’t touch the others. The code that uses them has no branches.' },
      { q: 'Why does `score()` return `?float` instead of `float`?', a: 'No answers is not a score of 0. Returning `null` forces the report to show "no answers" instead of a fake 0.00.' },
    ],
    next: 'Which school uses which method is written in the script. Next ticket: each school picks its method in its own settings.',
  },
};

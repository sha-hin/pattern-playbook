// Part 1 (continued): chapters 4–6.

export const PART1 = {

  // ════════════════════════════════════════════════════════════════════
  '04-simple-factory': {
    description: 'Schools must choose their scoring method in their own settings. Fix it with a Simple Factory in PHP: one class reads the settings and builds the right Strategy.',
    ticket: {
      from: 'Ahmed Nabil, Product Owner',
      title: 'Schools must choose their scoring method in Settings',
      body: 'Every time a school changes its scoring method we deploy code. Victoria wants to try the median next week, and new schools join every month. Put the choice in each school’s settings, and if a setting is wrong, tell us which school and what is wrong.',
    },
    pain: {
      text: ['Chapter 3 left the choice in the script as a list of schools. The quick fix moves it into `TermReport` as a `match` on the setting:'],
      code: `$method = match ($school->scoringMethod) {
    'median' => new MedianScoring(),
    'weighted' => new WeightedScoring($school->scoringWeights),
    default => new AverageScoring(),
};`,
      after: [
        'It works, until the email preview screen and the Ministry export need the same decision and copy the same `match`. The first copy that forgets `\'trimmed\'` (or quietly falls back to the average for a typo like `medain`) produces a different score for the same teacher, and nobody notices because `default` hides the mistake.',
        'The decision "which scoring class does this school get?" needs **one home**, and a wrong setting must fail loudly instead of falling back silently.',
      ],
    },
    pattern: {
      name: 'Simple Factory',
      rule: 'Deciding which class to create, from some input, happens in one place → put that decision in one class with one method. Everyone else just asks it.',
      explain: [
        '`ScoringMethodFactory::forSchool($school)` reads the school’s settings and returns the right `ScoringMethod`. `TermReport`, a preview screen or an export all call the same method, so they always agree.',
        'Notice how it fits with the previous chapter: the **factory picks** which strategy to use, and the **strategy does** the work. Inside the factory each branch is only `new SomeClass()`; inside a strategy is the real logic. If you find yourself writing scoring maths inside the `match`, you have mixed the two.',
        'Simple Factory is not in the Gang of Four book; *Head First Design Patterns* calls it "more of a programming idiom". The book’s two factory patterns, Factory Method and Abstract Factory, come in chapters 13 and 27.',
      ],
      drawing: {
        bad: [['b', 6, 14, 136, 30, 'TermReport: match…', 'x'], ['b', 6, 68, 136, 30, 'Preview: match…', 'x'], ['b', 6, 122, 136, 30, 'Export: match…', 'x'], ['t', 226, 72, '3 copies of', 'kx', 'middle'], ['t', 226, 92, 'the same decision', 'kx', 'middle']],
        good: [['b', 4, 62, 70, 40, 'Settings', 'n'], ['a', 74, 82, 96, 82], ['b', 98, 58, 96, 48, 'Factory', 'v'], ['a', 194, 82, 212, 32, '', 'k'], ['a', 194, 82, 212, 82, '', 'k'], ['a', 194, 82, 212, 132, '', 'k'], ['b', 214, 16, 82, 32, 'Average', 'n'], ['b', 214, 66, 82, 32, 'Median', 'n'], ['b', 214, 116, 82, 32, 'Weighted', 'n'], ['t', 146, 126, 'the one place', 'kv', 'middle'], ['t', 146, 142, 'that decides', 'kv', 'middle']],
        badCaption: 'Every screen decides for itself. The copies drift, and a typo silently becomes "average".',
        goodCaption: 'Settings go into one factory. It returns the strategy, or fails with the reason.',
      },
    },
    steps: [
      {
        title: 'A school and its settings',
        text: ['`School` holds the settings exactly as stored: the method name and, for the weighted method, the weights. It doesn’t build anything itself.'],
        file: 'src/Domain/School.php',
      },
      {
        title: 'A "not found" error, and the school repository interface',
        text: ['Asking for a school that doesn’t exist is an error with a message, never a `null` that crashes three lines later.'],
        file: 'src/Domain/NotFound.php',
      },
      {
        title: 'The repository interface',
        text: [],
        file: 'src/Domain/SchoolRepository.php',
      },
      {
        title: 'A schools table',
        text: ['Teachers now point at a real school row.'],
        file: 'src/Infrastructure/Sqlite/Schema.php', diff: 'src/Infrastructure/Sqlite/Schema.php',
      },
      {
        title: 'The SQLite school repository',
        text: ['The weights are stored as JSON. `JSON_THROW_ON_ERROR` makes broken JSON an exception instead of a silent `null`.'],
        file: 'src/Infrastructure/Sqlite/SqliteSchoolRepository.php',
      },
      {
        title: 'An error type for a wrong setting',
        text: [],
        file: 'src/Scoring/UnknownScoringMethod.php',
      },
      {
        title: 'The factory',
        text: [
          'One `match`, one place. Each branch only creates an object. There is deliberately **no fallback to the average**: an unknown name throws, with the school and the valid options in the message.',
        ],
        file: 'src/Scoring/ScoringMethodFactory.php',
      },
      {
        title: 'TermReport asks the factory',
        text: ['The list of schools disappears from `TermReport`. It looks up the teacher’s school and asks the factory for its method.'],
        file: 'src/Reporting/TermReport.php', diff: 'src/Reporting/TermReport.php',
      },
      {
        title: 'The script: settings in the database, not in the code',
        text: ['The schools and their settings are now data. At the end, the script shows what happens when a setting has a typo.'],
        file: 'bin/evaluations.php', diff: 'bin/evaluations.php',
      },
    ],
    run: {
      cmd: 'composer dump-autoload\nphp bin/evaluations.php',
      text: ['The results are the same as in chapter 3, but no school name appears in the code any more. The last lines show the factory refusing `medain` instead of quietly using the average.'],
    },
    laravel: {
      text: [
        'Laravel’s database layer picks its connector the same way: `ConnectionFactory` reads the `driver` from `config/database.php` and a `match` builds a `MySqlConnector`, `PostgresConnector` or `SQLiteConnector`. An unknown driver throws "Unsupported driver".',
        'In your app, register the factory and inject it; its `forSchool()` stays exactly as in this chapter:',
      ],
      code: `// Anywhere that needs a school's scoring method:
public function __construct(private ScoringMethodFactory $scoringMethods) {}

$method = $this->scoringMethods->forSchool($school);

// The setting itself is usually validated when the school saves it:
'scoring_method' => ['required', Rule::in(['average', 'median', 'weighted'])],`,
    },
    check: [
      { q: 'A new method, "trimmed average", is added. Which files change?', a: 'One new class (`TrimmedAverageScoring`) and one new line in the factory’s `match`. `TermReport` doesn’t change.' },
      { q: 'Why doesn’t the factory fall back to `AverageScoring` for an unknown name?', a: 'A typo would silently give a school the wrong scores. Throwing with the school name and the valid options makes the mistake visible immediately.' },
      { q: 'What is the difference between the factory and the strategy?', a: 'The factory decides which object to create (each branch is just `new X()`). The strategy does the work (the scoring maths).' },
    ],
    next: 'Some schools also pay for comment analysis, and some don’t. The first attempt to support both crashes the report.',
  },

  // ════════════════════════════════════════════════════════════════════
  '05-null-object': {
    description: 'Schools without comment analysis crash the report with "call to a member function on null". Fix it with the Null Object pattern in PHP.',
    ticket: {
      from: 'Support desk',
      title: 'Miami’s term report crashes: "Call to a member function summarize() on null"',
      body: 'We released comment analysis for schools on the paid plan. Smouha and Victoria are fine. Miami is not on the plan, and its report now stops with a fatal error. Miami’s principal needs the report today.',
    },
    pain: {
      text: ['The first version picked the analyzer like this:'],
      code: `$analyzer = $school->commentAnalysis ? new KeywordCommentAnalyzer() : null;

// ...and later, in the report:
$summary = $analyzer->summarize($comments);   // Miami: fatal error`,
      after: [
        'The quick fix is `if ($analyzer !== null)` before every call. There are already three calls (report, email, export), and every future screen must remember the check. The first one that forgets brings the crash back.',
        'For Miami, "no analysis" is not an error. It is a **normal, expected case**. So instead of representing it with `null`, we can represent it with an object.',
      ],
    },
    pattern: {
      name: 'Null Object',
      rule: '"Nothing" is a normal case → represent it with an object that has the same interface and safely does nothing, so callers never check for null.',
      explain: [
        '`CommentAnalyzer` gets a second implementation, `NoCommentAnalysis`. It has the same `summarize()` method, and it returns a neutral text instead of analysing anything. Every school gets a real `CommentAnalyzer` object, so `->summarize()` always works.',
        'The decision ("does this school get analysis?") is made **once**, in a small factory, and nowhere else.',
        '**When not to use it:** only when "nothing" really is fine. A teacher with no email address is *not* a case for a "null mailer" that pretends to send: that would hide a real problem. The report still says "Not sent to Nadia" loudly.',
        'Null Object is not in the Gang of Four book. It was described by Bobby Woolf in *Pattern Languages of Program Design 3* (1997).',
      ],
      drawing: {
        bad: [['b', 6, 62, 80, 40, 'TermReport', 'n'], ['a', 86, 82, 150, 82, '', 'x'], ['b', 152, 62, 60, 40, 'null', 'x'], ['t', 150, 126, '->summarize() on null', 'kx', 'middle'], ['t', 150, 146, 'fatal error: report stops', 'kx', 'middle']],
        good: [['b', 4, 62, 72, 40, 'TermReport', 'n'], ['a', 76, 82, 96, 82], ['b', 98, 58, 102, 48, 'Analyzer', 'i'], ['a', 200, 82, 212, 40, '', 'k'], ['a', 200, 82, 212, 124, '', 'k'], ['b', 214, 20, 82, 36, 'Keyword', 'v'], ['b', 214, 106, 82, 36, 'NoAnalysis', 'v'], ['t', 255, 72, 'paid plan', 's', 'middle'], ['t', 255, 158, 'safe "nothing"', 's', 'middle']],
        badCaption: 'A school without the feature gets null, and the first call on it crashes.',
        goodCaption: 'Every school gets a real analyzer. One of them simply does nothing.',
      },
    },
    steps: [
      {
        title: 'The interface',
        text: ['One method: comments in, a short summary out.'],
        file: 'src/Analysis/CommentAnalyzer.php',
      },
      {
        title: 'The real analyzer',
        text: ['Evalu8’s built-in analysis counts recurring themes by keyword. It is simple on purpose; chapter 7 replaces it with a language model behind the same interface.'],
        file: 'src/Analysis/KeywordCommentAnalyzer.php',
      },
      {
        title: 'The Null Object',
        text: ['Same interface, no work, no crash. It returns a neutral sentence the report can print as is.'],
        file: 'src/Analysis/NoCommentAnalysis.php',
      },
      {
        title: 'Decide once',
        text: ['The factory receives the real analyzer from outside (so it can be swapped later) and returns the Null Object for schools without the feature.'],
        file: 'src/Analysis/CommentAnalyzerFactory.php',
      },
      {
        title: 'The setting',
        text: ['Schools get a `comment_analysis` flag.'],
        file: 'src/Domain/School.php', diff: 'src/Domain/School.php',
      },
      {
        title: 'Read the flag from the database',
        text: [],
        file: 'src/Infrastructure/Sqlite/SqliteSchoolRepository.php', diff: 'src/Infrastructure/Sqlite/SqliteSchoolRepository.php',
      },
      {
        title: 'The result carries the summary',
        text: [],
        file: 'src/Reporting/TeacherResult.php', diff: 'src/Reporting/TeacherResult.php',
      },
      {
        title: 'TermReport calls summarize() without checking',
        text: ['There is no `if` around `summarize()`: the analyzer is never null.'],
        file: 'src/Reporting/TermReport.php', diff: 'src/Reporting/TermReport.php',
      },
      {
        title: 'The script',
        text: ['Miami is not on the plan; Smouha and Victoria are. The report prints the summary for everyone.'],
        file: 'bin/evaluations.php', diff: 'bin/evaluations.php',
      },
    ],
    run: {
      cmd: 'composer dump-autoload\nphp bin/evaluations.php',
      text: ['Miami’s line reads "not included in this school’s plan" and the report runs to the end. Nadia’s missing email is still reported loudly: a Null Object is only for cases where "nothing" is fine.'],
    },
    laravel: {
      text: [
        'Laravel ships several Null Objects you can choose in config: the `null` cache store (`NullStore`), the `null` broadcaster, the `null` queue connection and the `null` log channel (`NullHandler`). Choosing one turns a feature off without a single `if` in your code.',
        'In your app, the binding decides once:',
      ],
      code: `// AppServiceProvider::register()
$this->app->bind(CommentAnalyzer::class, function (Application $app) {
    return config('features.comment_analysis')
        ? $app->make(KeywordCommentAnalyzer::class)
        : new NoCommentAnalysis();
});`,
    },
    check: [
      { q: 'Why is `NoCommentAnalysis` better than `if ($analyzer !== null)`?', a: 'The decision is made once. Every caller just calls `summarize()`, and a new screen can’t forget a check that doesn’t exist.' },
      { q: 'Should a missing teacher email use a "null mailer" that does nothing?', a: 'No. A missing email is a problem someone must fix. A Null Object would hide it. Use Null Object only when "nothing" is a correct result.' },
      { q: 'Where is the decision "analysis or not" made?', a: 'In `CommentAnalyzerFactory::forSchool()`, from the school’s setting. Nowhere else.' },
    ],
    next: 'Look at the top of the script: 30 lines of `new` that grow every chapter, and a teammate wants to "fix" it with a Singleton.',
  },

  // ════════════════════════════════════════════════════════════════════
  '06-container': {
    description: 'Wiring code grows every chapter and a teammate proposes a Singleton database. Learn the Singleton pattern, why it hurts, and replace it with a dependency injection container in PHP.',
    ticket: {
      from: 'Code review, pull request #212',
      title: '"Make Database a Singleton so we stop passing PDO around"',
      body: '`TermReport` now needs five objects, each repository needs the connection, and the top of every script is 30 lines of `new`. This PR adds `Database::connection()` so any class can grab the connection itself. Approve?',
    },
    pain: {
      text: ['The pull request uses the classic **Singleton** from the Gang of Four book: a private constructor and a static method that always returns the same instance.'],
      code: `final class Database
{
    private static ?PDO $connection = null;

    private function __construct() {}           // nobody else can create one

    public static function connection(): PDO
    {
        return self::$connection ??= new PDO('sqlite:/var/lib/evalu8.db');
    }
}

// ...inside SqliteResponseRepository:
$select = Database::connection()->prepare('SELECT ...');`,
      after: [
        'It does remove the wiring, and that is why Singletons are tempting. But it costs a lot:',
        '**Hidden dependency.** Reading `SqliteResponseRepository`’s constructor no longer tells you it needs a database. You find out by reading every line.',
        '**One connection, forever.** The nightly Ministry export should read from a replica database. With `Database::connection()` hard-coded inside every repository, there is no way to give one script a different connection.',
        '**Global state.** Anything any class does to the shared connection (a transaction left open, a changed setting) leaks into every other class.',
        'The real need is: "build each object **once**, and hand it to the classes that need it". That is a job for one object that knows how to build everything: a container.',
      ],
    },
    pattern: {
      name: 'Dependency Injection Container',
      rule: 'Classes ask for what they need in their constructor and never build it themselves → one container knows how to build everything, and keeps one shared instance where you ask it to.',
      explain: [
        'Our classes already follow **dependency injection**: `TermReport` receives its repositories in its constructor instead of creating them. The container only automates the wiring: `$app->make(TermReport::class)` reads the constructor, sees it needs a `TeacherRepository`, a `ResponseRepository` and so on, and builds each of those the same way.',
        'Interfaces can’t be built, so we tell the container once which class to use for each (`TeacherRepository` → `SqliteTeacherRepository`). Everything else is automatic.',
        '`singleton()` gives us what the Singleton pattern promised (one shared PDO) **without** the static global: the classes still receive the connection in their constructor, and a different script can bind a different connection.',
        'Singleton is in the Gang of Four book; the DI container is not (the term was popularised by Martin Fowler in 2004). Most modern PHP code uses the container’s singleton instead of the Singleton pattern.',
      ],
      drawing: {
        bad: [['b', 66, 8, 168, 34, 'Database::connection()', 'x'], ['b', 6, 96, 80, 30, 'TermReport', 'n'], ['b', 110, 96, 80, 30, 'Repos', 'n'], ['b', 214, 96, 80, 30, 'Export', 'n'], ['a', 46, 96, 120, 44, '', 'x'], ['a', 150, 96, 150, 44, '', 'x'], ['a', 254, 96, 180, 44, '', 'x'], ['t', 150, 152, 'hidden, global, one forever', 'kx', 'middle']],
        good: [['b', 100, 8, 100, 36, 'Container', 'v'], ['a', 150, 44, 50, 88, '', 'k'], ['a', 150, 44, 150, 88, '', 'k'], ['a', 150, 44, 250, 88, '', 'k'], ['b', 6, 90, 88, 30, 'TermReport', 'n'], ['b', 106, 90, 88, 30, 'Repos', 'n'], ['b', 206, 90, 88, 30, 'PDO (once)', 'n'], ['t', 150, 146, 'everything arrives through the constructor', 's', 'middle']],
        badCaption: 'Every class reaches into a global. Its needs are invisible, and there can only ever be one database.',
        goodCaption: 'The container builds each object and passes in what it needs. One PDO is shared, but nothing is global.',
      },
    },
    steps: [
      {
        title: 'An exception that always says why',
        text: [],
        file: 'src/Container/ContainerException.php',
      },
      {
        title: 'The container',
        text: [
          '`bind()` and `singleton()` register a function that builds something. `make()` uses that function if there is one; otherwise it **autowires**: it reads the class’s constructor with PHP’s Reflection API and builds each typed parameter by calling `make()` again.',
          'It refuses loudly instead of guessing: an interface with no binding, a parameter like `string $dsn` with no default, a binding that returns the wrong type, or two classes that need each other (a circular dependency) all throw a `ContainerException` with the reason.',
        ],
        file: 'src/Container/Container.php',
      },
      {
        title: 'Demo data in its own class',
        text: ['The schools and teachers used to be inserted at the top of the script. They move into one class, so every entry script gets the same demo database.'],
        file: 'src/Demo/SampleData.php',
      },
      {
        title: 'The one place that wires the app',
        text: [
          'The database connection is a `singleton`: built the first time something needs it, then shared. Its DSN comes from the `EVALU8_DSN` environment variable, so a nightly export can point at a replica without changing any class.',
          'Then four lines map interfaces to implementations. That is all the configuration this app needs; everything else is autowired.',
        ],
        file: 'bootstrap/app.php',
      },
      {
        title: 'The script asks the container',
        text: ['The 30 lines of `new` become `$app->make(TermReport::class)`. The end of the script shows the shared connection and the error you get when wiring is missing.'],
        file: 'bin/evaluations.php', diff: 'bin/evaluations.php',
      },
    ],
    run: {
      cmd: 'composer dump-autoload\nphp bin/evaluations.php',
      text: ['The results are identical to chapter 5: the container changed how objects are built, not what they do.'],
    },
    laravel: {
      text: [
        'This is Laravel’s service container in miniature. `$this->app->singleton()` and `bind()` work like ours, and `make()` autowires with Reflection the same way. That is why you can type-hint a class in a controller’s constructor and it just arrives.',
        'Laravel apps rarely need hand-written Singletons: `singleton()` in a service provider gives one shared instance without a global.',
      ],
      code: `// app/Providers/AppServiceProvider.php
public function register(): void
{
    $this->app->singleton(TeacherRepository::class, SqliteTeacherRepository::class);
    $this->app->singleton(ResponseRepository::class, SqliteResponseRepository::class);
    $this->app->bind(CommentAnalyzer::class, KeywordCommentAnalyzer::class);
}

// Any controller, job or command:
public function __construct(private TermReport $report) {}   // built by the container`,
    },
    check: [
      { q: 'What does the Singleton pattern hide that dependency injection shows?', a: 'What a class depends on. With injection, the constructor lists every dependency; with `Database::connection()` it is buried inside the methods.' },
      { q: 'How does the container know how to build `TermReport`?', a: 'It reads the constructor with Reflection and builds each typed parameter with `make()`, using a binding when there is one (for interfaces) and autowiring otherwise.' },
      { q: 'The nightly export must use a read replica. What changes?', a: 'Nothing in the classes. The export script sets `EVALU8_DSN` (or binds a different `PDO`), and every repository receives that connection.' },
    ],
    next: 'Part 2 starts: the keyword analyzer is too simple, and the comments must go through a real language model. But each AI provider’s SDK looks completely different.',
  },
};

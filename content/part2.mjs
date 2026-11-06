// Part 2: talking to the outside world (chapters 7–11).

export const PART2 = {

  // ════════════════════════════════════════════════════════════════════
  '07-adapter': {
    description: 'Comments must be analysed by a language model, and the OpenAI SDK and a self-hosted Ollama server have completely different APIs. Fix it with the Adapter pattern in PHP.',
    ticket: {
      from: 'Ahmed Nabil, Product Owner, and the legal team',
      title: 'Use a real language model for comment analysis, on our own server',
      body: 'Keyword matching misses too much. Use a language model. We prototyped with OpenAI, but legal says comments about named teachers must stay on our servers, so production will use our self-hosted Ollama server. We may need OpenAI again for schools that allow it.',
    },
    pain: {
      text: ['The two SDKs could not be more different. Calling them directly from `TermReport` looks like this:'],
      code: `if ($provider === 'openai') {
    $response = $openai->chat()->create([
        'model' => 'gpt-4o-mini',
        'messages' => [['role' => 'user', 'content' => $prompt]],
    ]);
    $summary = $response->choices[0]->message->content;
} else {
    $result = $ollama->generate(['model' => 'llama3.2', 'prompt' => $prompt]);
    if (isset($result['error'])) { /* ...Ollama doesn't throw, it returns an error... */ }
    $summary = $result['response'];
}`,
      after: [
        'Now `TermReport` knows two vendors’ method names, two result shapes and two ways of failing (OpenAI throws `ErrorException`; Ollama returns `[\'error\' => ...]`). Every other place that needs a summary copies this block, and a third provider adds a third branch everywhere.',
        'We already have the interface we *want*: `CommentAnalyzer::summarize(array $comments): string`. The SDKs just don’t have that shape, and we can’t edit them: they are someone else’s code.',
      ],
    },
    pattern: {
      name: 'Adapter',
      rule: 'A class you can’t change has the wrong interface → wrap it in a small class that implements YOUR interface and translates every call, result and error.',
      explain: [
        'An adapter is a travel plug: your charger (our code) stays the same, the wall socket (the SDK) stays the same, and the plug in between makes them fit.',
        '`OpenAiCommentAnalyzer` and `OllamaCommentAnalyzer` both implement `CommentAnalyzer`. Each one holds the vendor’s client object and translates three things: **our call into their call**, **their result into our string**, and **their failure into our exception** (`AnalysisFailed`). The rest of the app never sees a vendor class.',
        'Compare it with the Decorator (chapter 9): a decorator wraps something that already has *our* interface and adds behaviour. An adapter wraps something with the *wrong* interface and adds nothing: it only translates.',
      ],
      drawing: {
        bad: [['b', 6, 62, 80, 40, 'TermReport', 'x'], ['a', 86, 72, 206, 32, '', 'x'], ['a', 86, 92, 206, 132, '', 'x'], ['b', 208, 14, 88, 36, 'OpenAI SDK', 'n'], ['b', 208, 116, 88, 36, 'Ollama API', 'n'], ['t', 128, 34, '->chat()->create()', 'm', 'middle'], ['t', 128, 140, '->generate([...])', 'm', 'middle'], ['t', 146, 88, 'if provider…', 'kx', 'middle']],
        good: [['b', 2, 64, 62, 36, 'Report', 'n'], ['a', 64, 82, 76, 82], ['b', 78, 62, 64, 40, 'Analyzer', 'i'], ['a', 142, 82, 154, 40, '', 'k'], ['a', 142, 82, 154, 124, '', 'k'], ['b', 156, 20, 62, 36, 'Adapter', 'v'], ['a', 218, 38, 230, 38], ['b', 232, 20, 64, 36, 'OpenAI', 'n'], ['b', 156, 106, 62, 36, 'Adapter', 'v'], ['a', 218, 124, 230, 124], ['b', 232, 106, 64, 36, 'Ollama', 'n'], ['t', 264, 82, 'can’t edit', 's', 'middle'], ['t', 187, 160, 'translate', 'kv', 'middle']],
        badCaption: 'The report speaks two vendor dialects and handles two kinds of failure.',
        goodCaption: 'The report speaks only CommentAnalyzer. Each adapter translates for one vendor.',
      },
    },
    steps: [
      {
        title: 'The SDKs we have to use',
        text: [
          'So the project runs offline, `fakes/` contains small stand-ins with the **same call shapes** as the real packages (see `fakes/README.md`). This is the OpenAI one: `chat()->create([...])` returns an object, and errors are exceptions.',
        ],
        file: 'fakes/OpenAI/Resources/Chat.php',
      },
      {
        title: 'Ollama: a different shape',
        text: ['Ollama’s API takes and returns arrays, and reports errors as an `error` key instead of throwing.'],
        file: 'fakes/Ollama/Client.php',
      },
      {
        title: 'Register the stand-ins with Composer',
        text: [],
        file: 'composer.json', diff: 'composer.json',
      },
      {
        title: 'One error type for the whole app',
        text: ['Whichever vendor fails, and however it fails, the app only ever catches `AnalysisFailed`.'],
        file: 'src/Analysis/AnalysisFailed.php',
      },
      {
        title: 'The same question for every model',
        text: ['Both adapters send the same instruction, so switching provider doesn’t change what is asked.'],
        file: 'src/Analysis/CommentPrompt.php',
      },
      {
        title: 'The OpenAI adapter',
        text: ['It implements our interface, holds the SDK client, and translates in three places: the request, the result and the exception.'],
        file: 'src/Analysis/OpenAiCommentAnalyzer.php',
      },
      {
        title: 'The Ollama adapter',
        text: ['Same interface, completely different inside. The `error` array becomes an exception here, so it can never be mistaken for a summary.'],
        file: 'src/Analysis/OllamaCommentAnalyzer.php',
      },
      {
        title: 'Choose the adapter in one place',
        text: ['The container binding decides which adapter the app gets. `TermReport` and the null-object factory from chapter 5 don’t change at all.'],
        file: 'bootstrap/app.php', diff: 'bootstrap/app.php',
      },
      {
        title: 'The script: both adapters, side by side',
        text: ['The end of the script sends the same comments through both adapters, then shows a wrong API key and a missing model both arriving as `AnalysisFailed`.'],
        file: 'bin/evaluations.php', diff: 'bin/evaluations.php',
      },
    ],
    run: {
      cmd: 'composer dump-autoload\nphp bin/evaluations.php',
      text: ['The report now shows the model’s summaries. In the last block, two different vendors answer the same question, and two different kinds of failure arrive as the same exception type.'],
    },
    laravel: {
      text: [
        '`Storage::put()` works on a local disk, S3 or FTP because of adapters: Laravel’s `FilesystemAdapter` translates its own methods into the Flysystem library’s, and each Flysystem adapter translates those into one storage SDK.',
        'For your own vendors, bind your interface to the adapter in a service provider, with the SDK’s settings in `config/services.php`:',
      ],
      code: `// app/Providers/AppServiceProvider.php
$this->app->singleton(CommentAnalyzer::class, fn () => new OllamaCommentAnalyzer(
    new \\Ollama\\Client(config('services.ollama.host')),
    config('services.ollama.model'),
));`,
    },
    check: [
      { q: 'Google Gemini is added next year. What changes?', a: 'One new class, `GeminiCommentAnalyzer implements CommentAnalyzer`, and the binding. Nothing that uses `CommentAnalyzer` changes.' },
      { q: 'Why does the Ollama adapter turn the `error` array into an exception?', a: 'Otherwise the error could flow on as if it were a summary. Translating failures is part of the adapter’s job, just like translating calls and results.' },
      { q: 'How is an Adapter different from a Decorator?', a: 'An adapter wraps something with the wrong interface and only translates. A decorator wraps something that already has your interface and adds behaviour.' },
    ],
    next: 'The adapter is chosen by editing `bootstrap/app.php`. Developers want Ollama on their laptops and production wants OpenAI for some schools, without code changes.',
  },

  // ════════════════════════════════════════════════════════════════════
  '08-manager': {
    description: 'Development uses a local model, production uses another, chosen by config. Build a Manager (driver) class in PHP, the pattern behind Laravel’s Cache, Mail and Storage.',
    ticket: {
      from: 'Omar Hassan, DevOps',
      title: 'Pick the AI provider from config, not from code',
      body: 'Laptops run Ollama; production may use OpenAI for schools that allow it; the quality team wants a script that compares two providers on the same comments. Today every switch is a code change in bootstrap/app.php, and the OpenAI client is created even when it isn’t used (so every laptop needs an API key).',
    },
    pain: {
      text: ['The quick fix is an `if` on the environment:'],
      code: `if (getenv('APP_ENV') === 'production') {
    $analyzer = new OpenAiCommentAnalyzer(new OpenAI\\Client(getenv('OPENAI_API_KEY')));
} else {
    $analyzer = new OllamaCommentAnalyzer(new Ollama\\Client('http://localhost:11434'));
}

// ...and the compare script builds both, with its own copy of the same code.`,
      after: [
        'Environment names leak into code, the compare script copies the construction logic, and a missing setting is discovered deep inside a request instead of with a clear message.',
        'What we want: ask for a provider **by name** (`ollama`, `openai`), get the default from config, build each one **only when it is first needed**, and **reuse** it after that.',
      ],
    },
    pattern: {
      name: 'Manager / Driver',
      rule: 'Several interchangeable backends chosen by name → one manager builds a driver by name on first use, caches it, and takes the default from config.',
      explain: [
        '`AnalyzerManager::driver()` returns the default driver from `config/ai.php`; `driver(\'openai\')` returns a named one. The first call builds it; later calls return the same object.',
        'A missing setting fails with a message naming the driver and the key. `extend()` adds new drivers from outside, without editing the manager.',
        'This is not a Gang of Four pattern: it is how Laravel organises every swappable service (cache stores, mailers, filesystems, queues, hashing). Inside, it combines a factory (build by name) with a cache of built instances.',
      ],
      drawing: {
        bad: [['b', 30, 14, 240, 142, '', 'x'], ['t', 46, 40, "if (APP_ENV === 'production')", 'm'], ['t', 56, 64, 'new OpenAiClient($key) …', 'm'], ['t', 46, 88, 'else', 'm'], ['t', 56, 112, 'new OllamaClient($host) …', 'm'], ['t', 46, 140, 'copied in the compare tool', 'kx']],
        good: [['b', 4, 62, 62, 40, 'config', 'n'], ['a', 66, 82, 86, 82], ['b', 88, 58, 92, 48, 'Manager', 'v'], ['a', 180, 82, 200, 40, '', 'k'], ['a', 180, 82, 200, 124, '', 'k'], ['b', 202, 20, 94, 36, 'ollama', 'n'], ['b', 202, 106, 94, 36, 'openai', 'n'], ['t', 249, 82, 'driver(name)', 's', 'middle'], ['t', 134, 126, 'built on first use,', 's', 'middle'], ['t', 134, 142, 'then reused', 's', 'middle']],
        badCaption: 'Environment checks in code, construction copied, every client built eagerly.',
        goodCaption: 'Config names the default. The manager builds each driver once, when it is first asked for.',
      },
    },
    steps: [
      {
        title: 'The config file',
        text: ['The default driver and each driver’s settings, read from environment variables.'],
        file: 'config/ai.php',
      },
      {
        title: 'An error for unknown or misconfigured drivers',
        text: [],
        file: 'src/Analysis/UnknownDriver.php',
      },
      {
        title: 'The manager',
        text: [
          '`driver()` uses `??=` to build a driver only if it isn’t in `$drivers` yet. `create()` checks drivers added with `extend()` first, then the built-in ones. `required()` turns a missing setting into a precise message.',
        ],
        file: 'src/Analysis/AnalyzerManager.php',
      },
      {
        title: 'Wire it',
        text: ['The app’s `CommentAnalyzer` is now "whatever the default driver is". The null object from chapter 5 still wraps it for schools without the feature.'],
        file: 'bootstrap/app.php', diff: 'bootstrap/app.php',
      },
      {
        title: 'The script',
        text: ['The last block shows the default driver, reuse, a driver added with `extend()`, a misconfigured driver and an unknown one.'],
        file: 'bin/evaluations.php', diff: 'bin/evaluations.php',
      },
    ],
    run: {
      cmd: 'composer dump-autoload\nphp bin/evaluations.php\n\n# the same code, a different provider:\nAI_DRIVER=openai OPENAI_API_KEY=sk-demo php bin/evaluations.php',
      text: ['Without `OPENAI_API_KEY`, asking for the `openai` driver fails with a message that names the missing setting; it never fails half-way through a report.'],
    },
    laravel: {
      text: [
        'This is Laravel’s `Illuminate\\Support\\Manager` in miniature. `Cache::store(\'redis\')`, `Mail::mailer(\'ses\')` and `Storage::disk(\'s3\')` are all managers: a default from config, drivers by name, built once, and `extend()` for custom drivers.',
      ],
      code: `// Laravel's managers work exactly like AnalyzerManager:
Cache::store();             // the default store from config/cache.php
Cache::store('redis');      // a named one, built once

// Adding your own driver, e.g. in AppServiceProvider::boot():
Cache::extend('mongo', fn (Application $app) => Cache::repository(new MongoStore(/* ... */)));`,
    },
    check: [
      { q: 'Why is the OpenAI client no longer created on developers’ laptops?', a: 'Drivers are built on first use. If nothing asks for `driver(\'openai\')`, its client is never created and no key is needed.' },
      { q: 'How do you add an Anthropic or Gemini driver without editing `AnalyzerManager`?', a: 'Call `$manager->extend(\'gemini\', fn (array $config) => new GeminiCommentAnalyzer(...))` during bootstrap.' },
      { q: 'What does the manager add on top of a Simple Factory?', a: 'A default from config, lookup by name, and caching: each driver is built once and reused.' },
    ],
    next: 'The model takes seconds per teacher, the report runs twice a day with the same comments, and the server sometimes times out.',
  },

  // ════════════════════════════════════════════════════════════════════
  '09-decorator': {
    description: 'AI calls are slow, expensive and sometimes time out. Add caching, retries and logging around any analyzer with the Decorator pattern in PHP, without editing the adapters.',
    ticket: {
      from: 'Omar Hassan, DevOps',
      title: 'The term report takes 30 minutes and sometimes dies on a timeout',
      body: 'With 600 teachers, the model takes about 3 seconds each, and the report runs twice a day on the same comments. The Ollama server is busy in the morning and times out now and then, which kills the whole run. We also have no record of which calls were made or how long they took.',
    },
    pain: {
      text: ['The quick fix puts everything inside the adapter:'],
      code: `final class OllamaCommentAnalyzer implements CommentAnalyzer
{
    public function summarize(array $comments): string
    {
        // 1. look in the cache...
        // 2. call Ollama, retrying 3 times on timeouts...
        // 3. log the duration...
        // 4. save to the cache...
    }
}
// ...and the same four steps copied into OpenAiCommentAnalyzer.`,
      after: [
        'The adapter’s one job was translating Ollama. Now it does four jobs, the OpenAI adapter needs a copy of the same code, and a test of the translation also runs the cache and the retry loop. Turning off the cache for one script means editing both adapters.',
        'Caching, retrying and logging are not about Ollama at all. They are **extra behaviour around any analyzer**.',
      ],
    },
    pattern: {
      name: 'Decorator',
      rule: 'You need extra behaviour around an object without changing it → wrap it in a class with the same interface that adds the behaviour and passes the call on. Wrappers stack.',
      explain: [
        'Each decorator implements `CommentAnalyzer` and holds another `CommentAnalyzer` inside. `CachingCommentAnalyzer` checks the cache and only calls the inner analyzer on a miss. `RetryingCommentAnalyzer` calls the inner one again on temporary failures. `LoggingCommentAnalyzer` records each call that gets through.',
        'Because every layer has the same interface, they stack in any order, like a phone in a case in a pouch: `Caching( Logging( Retrying( Ollama ) ) )`. Remove a layer by not wrapping it. The adapters don’t change.',
      ],
      drawing: {
        bad: [['b', 30, 14, 240, 142, '', 'x'], ['t', 46, 40, 'OllamaCommentAnalyzer', 'm'], ['t', 56, 64, '+ cache lookup', 'm'], ['t', 56, 86, '+ retry loop', 'm'], ['t', 56, 108, '+ timing logs', 'm'], ['t', 46, 140, '…copied into the OpenAI adapter', 'kx']],
        good: [['b', 4, 8, 292, 150, '', 'v2'], ['t', 16, 26, 'Caching', 'kv'], ['b', 20, 34, 260, 116, '', 'v2'], ['t', 32, 52, 'Logging', 'kv'], ['b', 36, 60, 228, 82, '', 'v2'], ['t', 48, 78, 'Retrying', 'kv'], ['b', 52, 88, 196, 44, 'Ollama adapter', 'n']],
        badCaption: 'One class does four jobs, and the other adapter needs a copy.',
        goodCaption: 'Each layer is one job with the same interface. They wrap any analyzer, in any order.',
      },
      extra: {
        title: 'Adapter vs Decorator',
        text: ['Both wrap an object, so they are easy to confuse. Ask what the wrapped object looks like.'],
        rows: [
          ['', 'Adapter (chapter 7)', 'Decorator (this chapter)'],
          ['The object inside', 'Has the wrong interface (a vendor SDK)', 'Already has our interface'],
          ['Why wrap it', 'To make it fit', 'To add behaviour'],
          ['Method names', 'Change: `create()` becomes `summarize()`', 'Stay the same: `summarize()` in, `summarize()` out'],
          ['Stacking', 'One adapter per SDK', 'Layers stack: cache → log → retry → adapter'],
        ],
      },
    },
    steps: [
      { title: 'A cache interface', text: ['Production would use Redis; the demo uses memory.'], file: 'src/Cache/Cache.php' },
      { title: 'An in-memory cache', text: [], file: 'src/Cache/ArrayCache.php' },
      { title: 'A logger interface', text: ['Two levels are enough here. A real project would use PSR-3’s `LoggerInterface`.'], file: 'src/Logging/Logger.php' },
      { title: 'A logger that writes lines to a stream', text: [], file: 'src/Logging/StreamLogger.php' },
      {
        title: 'Temporary vs permanent failures',
        text: ['A retry only makes sense for temporary problems. `AnalysisFailed` now says which kind it is.'],
        file: 'src/Analysis/AnalysisFailed.php', diff: 'src/Analysis/AnalysisFailed.php',
      },
      {
        title: 'The Ollama stand-in can now time out',
        text: ['The fake HTTP client can simulate a busy server: its first N calls throw a timeout, like a real HTTP client would.'],
        file: 'fakes/Ollama/Client.php', diff: 'fakes/Ollama/Client.php',
      },
      {
        title: 'The adapter marks timeouts as temporary',
        text: ['Translating failures is still the adapter’s job. It only labels them; it doesn’t retry.'],
        file: 'src/Analysis/OllamaCommentAnalyzer.php', diff: 'src/Analysis/OllamaCommentAnalyzer.php',
      },
      {
        title: 'Decorator 1: caching',
        text: ['The key is a hash of the comments, so the same comments always hit the same entry. A failure throws before `set()`, so failures are never cached.'],
        file: 'src/Analysis/CachingCommentAnalyzer.php',
      },
      {
        title: 'Decorator 2: retrying',
        text: ['Only temporary failures are retried, with a delay that doubles each time. The last failure, or any permanent one, is rethrown unchanged. The `sleep` function can be replaced, so the demo doesn’t wait.'],
        file: 'src/Analysis/RetryingCommentAnalyzer.php',
      },
      {
        title: 'Decorator 3: logging',
        text: ['Logs every call that reaches the provider and every failure, then lets the failure continue.'],
        file: 'src/Analysis/LoggingCommentAnalyzer.php',
      },
      {
        title: 'Stack the layers in one place',
        text: ['Read the stack from the inside out: the driver from the manager, retried, logged, cached. Removing a layer is deleting one line.'],
        file: 'bootstrap/app.php', diff: 'bootstrap/app.php',
      },
      {
        title: 'The script',
        text: ['It runs the report twice, then shows a busy server and a permanent error going through the retry layer.'],
        file: 'bin/evaluations.php', diff: 'bin/evaluations.php',
      },
    ],
    run: {
      cmd: 'composer dump-autoload\nphp bin/evaluations.php',
      text: [
        'The first run logs three calls to the model; the second run logs none, because every summary comes from the cache. The busy server times out twice and answers on the third attempt. The missing model fails once and is not retried.',
      ],
    },
    laravel: {
      text: [
        'The container can decorate a binding for you: `$this->app->extend()` receives the object that was going to be returned and lets you wrap it. Each `extend()` adds one layer.',
        'Laravel also has the behaviours themselves: `Cache::remember()` and the `retry()` helper.',
      ],
      code: `// AppServiceProvider::register(): each extend() wraps what the container would return
$this->app->extend(CommentAnalyzer::class, fn (CommentAnalyzer $inner, Application $app) =>
    new RetryingCommentAnalyzer($inner)
);
$this->app->extend(CommentAnalyzer::class, fn (CommentAnalyzer $inner, Application $app) =>
    new CachingCommentAnalyzer($inner, $app->make(Cache::class))
);`,
    },
    check: [
      { q: 'A school wants analysis without caching, for privacy. What changes?', a: 'Only the wiring for that case: don’t wrap with `CachingCommentAnalyzer`. No analyzer class changes.' },
      { q: 'Why is the cache the outermost layer?', a: 'A cache hit should skip everything inside it: no log line, no retries, no call to the model.' },
      { q: 'Why doesn’t the retry layer retry "model not found"?', a: 'It is a permanent failure: retrying wastes time and gives the same error. The adapter marks only timeouts as temporary.' },
    ],
    next: 'Teachers get a dashboard. It loads every raw comment from the slow archive on each page view, and a teacher just opened a colleague’s comments.',
  },

  // ════════════════════════════════════════════════════════════════════
  '10-proxy': {
    description: 'The dashboard opens a slow archive connection on every page and lets a teacher read a colleague’s comments. Fix both with the Proxy pattern in PHP: a virtual proxy and a protection proxy.',
    ticket: {
      from: 'Mona Saleh, Head of Quality, and the support desk',
      title: 'Teachers can read each other’s comments, and the dashboard is slow',
      body: 'Hany changed the teacher id in the URL and read Nadia’s comments, including which ones came from the principal. Teachers may read their own comments, without knowing who wrote them; principals and the quality team may read everything. Separately: every dashboard page opens a connection to the comments archive, even when the comments panel is never opened.',
    },
    pain: {
      text: ['The quick fix adds both checks to the reader itself:'],
      code: `final class SqliteCommentReader implements CommentReader
{
    public function __construct(private Viewer $viewer)
    {
        $this->archive = new PDO(ARCHIVE_DSN);      // still opened on every page
    }

    public function forTeacher(int $teacherId, string $term): array
    {
        if ($this->viewer->role === ViewerRole::Teacher && $this->viewer->teacherId !== $teacherId) {
            throw new AccessDenied('...');
        }
        // ...the query, plus hiding roles for teachers...
    }
}`,
      after: [
        'The reader now mixes three concerns: reading the archive, permissions and when to connect. The nightly report (which runs as the system, with no viewer) can no longer use it, and the connection is still opened eagerly.',
        'Both problems are about **controlling access to the real reader**: *who* may reach it, and *when* it is created.',
      ],
    },
    pattern: {
      name: 'Proxy',
      rule: 'You need to control access to an object (who may use it, or when it is created) → put a stand-in with the same interface in front of it.',
      explain: [
        'A proxy implements the same interface as the real object and holds (or will create) the real one. The caller can’t tell the difference.',
        'A **protection proxy** (`AccessControlledCommentReader`) checks the viewer before passing the call on, and hides the respondent’s role from teachers. A **virtual proxy** (`LazyCommentReader`) delays creating the expensive real object until the first call.',
        'The real `SqliteCommentReader` goes back to doing one thing: reading the archive. The nightly report can still use it directly.',
      ],
      drawing: {
        bad: [['b', 6, 62, 80, 40, 'Dashboard', 'n'], ['a', 86, 82, 206, 82, '', 'x'], ['b', 208, 62, 88, 40, 'Archive', 'x'], ['t', 146, 72, 'every page view', 'kx', 'middle'], ['t', 150, 124, 'connection opened every time', 'kx', 'middle'], ['t', 150, 144, 'any teacher reads any comment', 'kx', 'middle']],
        good: [['b', 2, 64, 58, 36, 'Page', 'n'], ['a', 60, 82, 74, 82], ['b', 76, 60, 70, 44, 'Access', 'v'], ['a', 146, 82, 158, 82, '', 'k'], ['b', 160, 60, 62, 44, 'Lazy', 'v'], ['a', 222, 82, 234, 82, '', 'k'], ['b', 236, 60, 62, 44, 'Real', 'n'], ['t', 111, 122, 'who may read?', 's', 'middle'], ['t', 191, 122, 'connect later', 's', 'middle'], ['t', 267, 122, 'archive', 's', 'middle']],
        badCaption: 'The page reaches the archive directly: always connected, never checked.',
        goodCaption: 'Two stand-ins with the same interface: one checks who may read, one connects only when needed.',
      },
      extra: {
        title: 'Proxy vs Decorator',
        text: ['They are built the same way (same interface, holds another object), so the difference is the intent.'],
        rows: [
          ['', 'Proxy (this chapter)', 'Decorator (chapter 9)'],
          ['Intent', 'Control access to the real object', 'Add behaviour to the object'],
          ['May skip the real object?', 'Yes: it may refuse, or not create it yet', 'Rarely (a cache hit is the exception)'],
          ['Who creates the real object', 'Often the proxy itself (virtual proxy)', 'Always given from outside'],
        ],
      },
    },
    steps: [
      { title: 'Who is looking', text: ['A viewer has a name, a role and, for teachers, their teacher id.'], file: 'src/Auth/Viewer.php' },
      { title: 'The roles', text: [], file: 'src/Auth/ViewerRole.php' },
      { title: 'A refusal', text: [], file: 'src/Auth/AccessDenied.php' },
      { title: 'A comment', text: ['`withoutRole()` returns a copy with the role removed, so answers stay anonymous for teachers.'], file: 'src/Comments/Comment.php' },
      { title: 'The interface all three share', text: [], file: 'src/Comments/CommentReader.php' },
      { title: 'The real subject', text: ['Only reads. No permissions, no laziness.'], file: 'src/Comments/SqliteCommentReader.php' },
      {
        title: 'The virtual proxy',
        text: ['It holds a function that creates the real reader, and calls it on the first `forTeacher()`. After that it reuses the same reader.'],
        file: 'src/Comments/LazyCommentReader.php',
      },
      {
        title: 'The protection proxy',
        text: ['It decides before the real reader is touched. A teacher asking about another teacher never reaches the archive at all.'],
        file: 'src/Comments/AccessControlledCommentReader.php',
      },
      {
        title: 'Demo answers for scripts that only need data',
        text: ['The dashboard is a new entry script, so the demo answers get a method other scripts can reuse.'],
        file: 'src/Demo/SampleData.php', diff: 'src/Demo/SampleData.php',
      },
      {
        title: 'The dashboard',
        text: ['Each viewer gets the protection proxy in front of the same lazy proxy. Building the pages doesn’t connect to the archive; the first read does.'],
        file: 'bin/dashboard.php',
      },
    ],
    run: {
      script: 'bin/dashboard.php',
      cmd: 'composer dump-autoload\nphp bin/dashboard.php',
      text: ['The archive connection opens once, on the first read, and is reused. Hany sees his own comments without roles, and his request for Nadia’s comments is refused before any query runs.'],
    },
    laravel: {
      text: [
        'For permissions, Laravel’s usual tools are **Policies and Gates** (`$this->authorize(\'view\', $teacher)`): the same protection-proxy idea, applied at the controller. A proxy class like ours is useful when the rule must hold wherever the object is used.',
        'Virtual proxies are everywhere in Laravel: Eloquent relations load lazily on first access, `LazyCollection` loads rows only when iterated, and PHP 8.4 adds native lazy objects (`ReflectionClass::newLazyProxy()`).',
        'Laravel’s "facades" (`Cache::get()`) are also a kind of proxy: a static stand-in that forwards each call to the real object in the container.',
      ],
      code: `// A policy: the protection rule, checked before the controller reads anything
final class TeacherCommentsPolicy
{
    public function view(User $user, Teacher $teacher): bool
    {
        return $user->isPrincipal() || $user->isQuality() || $user->teacher_id === $teacher->id;
    }
}

// In the controller:
$this->authorize('view', $teacher);`,
    },
    check: [
      { q: 'Why does Hany’s request for Nadia’s comments not open the archive connection?', a: 'The protection proxy refuses before calling the inner reader, so the lazy proxy never creates the real one for that request.' },
      { q: 'The nightly report runs with no viewer. Which reader does it use?', a: 'The real `SqliteCommentReader` directly (or the lazy proxy). The permission rule lives in a separate class, so it doesn’t get in the way.' },
      { q: 'What is the difference between a virtual proxy and a protection proxy?', a: 'A virtual proxy controls *when* the real object is created. A protection proxy controls *who* may use it.' },
    ],
    next: 'Closing a term now involves the report, a results snapshot, emails and the Ministry file, and three different places do it three different ways.',
  },

  // ════════════════════════════════════════════════════════════════════
  '11-facade': {
    description: 'Closing a term takes five steps and three callers each do it differently. Hide the subsystems behind one simple call with the Facade pattern in PHP.',
    ticket: {
      from: 'Mona Saleh, Head of Quality',
      title: 'Hany’s result changed after the term was closed',
      body: 'Terms are closed from the admin panel, from a CLI command, and by the scheduler on the last day. Last week the scheduler forgot to save the results snapshot, a late answer arrived, and Hany’s score changed after he had been emailed. Also, the admin panel emails teachers before saving, so a failed save leaves emails with results that don’t exist.',
    },
    pain: {
      text: ['Each caller runs its own version of the process:'],
      code: `// AdminController::closeTerm()
$results = $report->results($term);
foreach ($results as $r) { $mailer->send(/* ... */); }      // emails first...
$store->saveAndClose($term, $results);                     // ...save second
$export->write($results, $path);

// bin/close-term (CLI): the same steps in another order
// Scheduler: forgot saveAndClose() entirely`,
      after: [
        'Five subsystems (report, results store, mailer, Ministry export, logger) and a correct order that only lives in people’s heads. Every caller must know all of it, and each one is a chance to get it wrong.',
        'The callers don’t want five subsystems. They want one thing: **close this term**.',
      ],
    },
    pattern: {
      name: 'Facade',
      rule: 'A job needs several subsystems in the right order → give it one simple front door that runs the whole job. Callers use the door; the subsystems stay available.',
      explain: [
        '`TermClosing::close($term)` runs the steps in the only safe order: refuse if already closed → calculate → save the snapshot and mark the term closed in **one transaction** → email teachers → write the Ministry file. It returns a `ClosingSummary` every caller can display.',
        'The admin panel, the CLI and the scheduler become one line each. The subsystems are not hidden away: other code can still use `TermReport` or `MinistryExport` directly.',
        'Laravel developers: this is the Gang of Four Facade, which is **not** what Laravel calls a "facade" (`Cache::get()` is a static proxy; see chapter 10).',
      ],
      drawing: {
        bad: [['b', 4, 14, 60, 28, 'Admin', 'n'], ['b', 4, 68, 60, 28, 'CLI', 'n'], ['b', 2, 122, 66, 28, 'Scheduler', 'n'], ['b', 214, 4, 82, 26, 'Report', 'n'], ['b', 214, 36, 82, 26, 'Snapshot', 'n'], ['b', 214, 68, 82, 26, 'Mailer', 'n'], ['b', 214, 100, 82, 26, 'Export', 'n'], ['b', 214, 132, 82, 26, 'Logger', 'n'], ['a', 64, 28, 212, 17, '', 'x'], ['a', 64, 28, 212, 81, '', 'x'], ['a', 64, 82, 212, 49, '', 'x'], ['a', 64, 82, 212, 113, '', 'x'], ['a', 64, 136, 212, 17, '', 'x'], ['a', 64, 136, 212, 81, '', 'x'], ['a', 64, 136, 212, 145, '', 'x']],
        good: [['b', 4, 14, 60, 28, 'Admin', 'n'], ['b', 4, 68, 60, 28, 'CLI', 'n'], ['b', 2, 122, 66, 28, 'Scheduler', 'n'], ['a', 64, 28, 94, 70], ['a', 64, 82, 94, 82], ['a', 64, 136, 94, 94], ['b', 96, 58, 92, 48, 'TermClosing', 'v'], ['a', 188, 82, 212, 17, '', 'k'], ['a', 188, 82, 212, 49, '', 'k'], ['a', 188, 82, 212, 81, '', 'k'], ['a', 188, 82, 212, 113, '', 'k'], ['a', 188, 82, 212, 145, '', 'k'], ['b', 214, 4, 82, 26, 'Report', 'n'], ['b', 214, 36, 82, 26, 'Snapshot', 'n'], ['b', 214, 68, 82, 26, 'Mailer', 'n'], ['b', 214, 100, 82, 26, 'Export', 'n'], ['b', 214, 132, 82, 26, 'Logger', 'n']],
        badCaption: 'Every caller drives every subsystem, each in its own order.',
        goodCaption: 'Every caller makes one call. The facade owns the order.',
      },
    },
    steps: [
      { title: 'A mailer interface', text: [], file: 'src/Mail/Mailer.php' },
      { title: 'A mailer for development', text: ['Prints instead of sending. Production binds a real mailer to the same interface.'], file: 'src/Mail/ConsoleMailer.php' },
      { title: 'Where closed results live', text: [], file: 'src/Reporting/TermResultStore.php' },
      { title: 'Two new tables', text: ['`closed_terms` marks a term as closed; `term_results` freezes each teacher’s result.'], file: 'src/Infrastructure/Sqlite/Schema.php', diff: 'src/Infrastructure/Sqlite/Schema.php' },
      {
        title: 'Save and close in one transaction',
        text: ['The snapshot and the "closed" mark are saved together or not at all.'],
        file: 'src/Infrastructure/Sqlite/SqliteTermResultStore.php',
      },
      {
        title: 'The Ministry file, written properly',
        text: ['The CSV used to be built with string concatenation; `fputcsv()` quotes names correctly. The explicit `escape: \'\'` avoids a deprecation in PHP 8.4.'],
        file: 'src/Reporting/MinistryExport.php',
      },
      { title: 'Refusing to close twice', text: [], file: 'src/Closing/TermAlreadyClosed.php' },
      { title: 'What closing did', text: [], file: 'src/Closing/ClosingSummary.php' },
      {
        title: 'The facade',
        text: ['The five steps, in the only safe order, with a comment on each. Teachers are emailed only after the results are frozen. A teacher without an email is logged as a warning and listed in the summary.'],
        file: 'src/Closing/TermClosing.php',
      },
      {
        title: 'Wire it',
        text: ['`TermClosing` needs one plain value (the export folder), so it gets a small factory in the container.'],
        file: 'bootstrap/app.php', diff: 'bootstrap/app.php',
      },
      {
        title: 'The CLI command, in one call',
        text: ['The admin controller and the scheduler would contain exactly the same line.'],
        file: 'bin/close-term.php',
      },
    ],
    run: {
      script: 'bin/close-term.php',
      cmd: 'composer dump-autoload\nphp bin/close-term.php',
      text: ['The term closes in one call; Nadia is reported as not emailed; the export file is written; and the second attempt is refused, so results can’t change after closing.'],
    },
    laravel: {
      text: [
        'Laravel’s HTTP kernel is a facade over the whole framework: `handle($request)` boots config and providers, runs middleware, routes and reports errors. In applications, classes like `TermClosing` are often called **actions** or **services**.',
      ],
      code: `// A console command and a controller, both one line:
final class CloseTermCommand extends Command
{
    protected $signature = 'terms:close {term}';

    public function handle(TermClosing $closing): int
    {
        $summary = $closing->close($this->argument('term'));
        $this->info("Closed {$summary->term}: {$summary->emailed} teachers emailed.");

        return self::SUCCESS;
    }
}

// routes/console.php: the scheduler uses the same command
Schedule::command('terms:close 2026-T1')->yearlyOn(1, 31, '23:00');`,
    },
    check: [
      { q: 'A fourth caller (an API endpoint) needs to close terms. What does it contain?', a: 'One call: `$closing->close($term)`. The order of the steps is already inside the facade.' },
      { q: 'Can other code still use `MinistryExport` directly?', a: 'Yes. A facade simplifies a common job; it doesn’t lock the subsystems away.' },
      { q: 'Why are teachers emailed after `saveAndClose()`?', a: 'If saving fails, no teacher receives a result that was never stored.' },
    ],
    next: 'Part 3 starts: schools send their answers as Google Forms CSV files and Microsoft Forms JSON exports, and each one is imported by a different copy of the same code.',
  },
};

// Part 5: workflows and reliability (chapters 21–26).

export const PART5 = {

  // ════════════════════════════════════════════════════════════════════
  '21-state': {
    description: 'A survey moves through draft, open, closed and archived, and every action checks the status with a ladder of ifs. Replace the ladder with the State pattern in PHP.',
    ticket: {
      from: 'Support desk',
      title: 'A school reopened an archived survey, and answers arrived in a draft',
      body: 'Survey runs have a lifecycle: draft (being designed), open (collecting answers), closed (no more answers, can be reopened for a week if a school closed it too early) and archived (read-only forever). Last week an archived survey was reopened, and a draft received answers through an old link.',
    },
    pain: {
      text: ['Every action checks the status itself:'],
      code: `public function reopen(DateTimeImmutable $at): void
{
    if ($this->status === 'draft')    { throw new LogicException('Open it first.'); }
    if ($this->status === 'open')     { throw new LogicException('Already open.'); }
    if ($this->status === 'archived') { /* forgotten: archived surveys were reopened */ }
    if ($this->status === 'closed' && $this->closedAt->diff($at)->days > 7) { throw ... }
    $this->status = 'open';
}
// ...and the same ladder in open(), submitAnswer(), close(), archive()`,
      after: [
        'Four statuses × five actions = twenty decisions, spread across five methods. Each method must remember every status, and the bug came from the one combination nobody wrote. Adding a status ("paused") means editing every method.',
        'Look at it the other way: each **status** knows exactly which actions it allows. If each status were a class, the rules for "closed" would all be in one place.',
      ],
    },
    pattern: {
      name: 'State',
      rule: 'An object behaves differently depending on its status, and every method checks the status → make each status a class that allows only its own actions; the object delegates to its current status.',
      explain: [
        '`RunStatus` is the base **state**: every action throws by default. `Draft`, `Open`, `Closed` and `Archived` override only the actions they allow, and an allowed action **returns the next status**. `Archived` overrides nothing, so everything is refused, which is exactly the bug fix.',
        '`SurveyRun` is the **context**: each method asks the current status and switches to whatever it returns, through one private method. Nothing outside can set the status directly, so the rules can’t be skipped.',
        'Data that belongs to one status lives in that status: only `Closed` knows when it was closed, so the seven-day reopen rule sits next to the date it needs.',
      ],
      drawing: {
        bad: [['b', 10, 14, 135, 64, '', 'x'], ['t', 20, 36, 'submitAnswer()', 'm'], ['t', 20, 58, ' if status == …', 'kx'], ['b', 155, 14, 135, 64, '', 'x'], ['t', 165, 36, 'close()', 'm'], ['t', 165, 58, ' if status == …', 'kx'], ['b', 10, 90, 135, 64, '', 'x'], ['t', 20, 112, 'reopen()', 'm'], ['t', 20, 134, ' if status == …', 'kx'], ['b', 155, 90, 135, 64, '', 'x'], ['t', 165, 112, 'archive()', 'm'], ['t', 165, 134, ' if status == …', 'kx']],
        good: [['b', 2, 20, 56, 30, 'Draft', 'v2'], ['a', 58, 35, 74, 35, '', 'k'], ['b', 76, 20, 56, 30, 'Open', 'v'], ['a', 132, 30, 150, 30, '', 'k'], ['a', 150, 42, 132, 42, '', 'k'], ['b', 152, 20, 62, 30, 'Closed', 'v2'], ['a', 214, 35, 230, 35, '', 'k'], ['b', 232, 20, 66, 30, 'Archived', 'v2'], ['t', 66, 12, 'open', 's', 'middle'], ['t', 141, 12, 'close / reopen', 's', 'middle'], ['t', 223, 12, 'archive', 's', 'middle'], ['b', 100, 110, 100, 34, 'SurveyRun', 'n'], ['a', 130, 110, 108, 54], ['t', 150, 160, 'asks its current status', 's', 'middle']],
        badCaption: 'Every action checks every status. One forgotten combination is a bug.',
        goodCaption: 'Each status is a class that allows only its own moves.',
      },
    },
    steps: [
      { title: 'The refusal', text: [], file: 'src/Lifecycle/TransitionNotAllowed.php' },
      {
        title: 'The base state: everything is refused',
        text: ['Each action returns the next status. The defaults all throw, so a status only has to write the actions it allows.'],
        file: 'src/Lifecycle/RunStatus.php',
      },
      { title: 'Draft: can only be opened', text: [], file: 'src/Lifecycle/Draft.php' },
      { title: 'Open: accepts answers, can be closed', text: [], file: 'src/Lifecycle/Open.php' },
      { title: 'Closed: reopen within a week, or archive', text: ['The closing date is stored in this status, because only this status needs it.'], file: 'src/Lifecycle/Closed.php' },
      { title: 'Archived: nothing', text: ['An empty class is enough: every action falls back to the base class and is refused.'], file: 'src/Lifecycle/Archived.php' },
      {
        title: 'The context: SurveyRun',
        text: ['No `if` about statuses. `switchTo()` is private, so only an allowed move can change the status. Dates are passed in, so the rules are easy to check with any date.'],
        file: 'src/Lifecycle/SurveyRun.php',
      },
      { title: 'A survey’s life, step by step', text: [], file: 'bin/lifecycle.php' },
    ],
    run: {
      script: 'bin/lifecycle.php',
      cmd: 'composer dump-autoload\nphp bin/lifecycle.php',
      text: ['Every action either succeeds and moves to the next status, or is refused by the current one with a reason. The archived survey can’t be reopened, and the draft never accepts an answer.'],
    },
    laravel: {
      text: [
        'Laravel’s core has no State class: a status is usually a string or enum column. When each status needs its own behaviour, the `spatie/laravel-model-states` package adds exactly this structure: each state is a class, the column stores which one, and only the transitions you register are allowed.',
      ],
      code: `// With spatie/laravel-model-states
abstract class RunStatus extends State
{
    public static function config(): StateConfig
    {
        return parent::config()
            ->default(Draft::class)
            ->allowTransition(Draft::class, Open::class)
            ->allowTransition(Open::class, Closed::class)
            ->allowTransition(Closed::class, Open::class, ReopenWithinAWeek::class)
            ->allowTransition(Closed::class, Archived::class);
    }
}

$run->status->transitionTo(Archived::class);   // throws for a transition that isn't allowed`,
    },
    check: [
      { q: 'A new status "paused" (no answers, can resume) is added. What changes?', a: 'One new class, `Paused`, and the transitions that lead to it (for example `Open::pause()`). The other statuses don’t change.' },
      { q: 'Why does each action return the next status instead of setting it?', a: 'So only the context can change its status, through its private `switchTo()`. No code can jump to "archived" without going through the rules.' },
      { q: 'Why does `Closed` store `$closedAt`, and not `SurveyRun`?', a: 'Only the closed status needs it (for the seven-day rule). Data that belongs to one status lives in that status.' },
    ],
    next: 'When a survey closes, five different things must happen, and `close()` is turning into a list of calls to services it shouldn’t know about.',
  },

  // ════════════════════════════════════════════════════════════════════
  '22-observer': {
    description: 'When a survey closes, the principal is emailed, analysis starts and an audit log is written. Decouple the reactions with the Observer pattern and an event dispatcher in PHP.',
    ticket: {
      from: 'Ahmed Nabil, Product Owner',
      title: 'When a survey closes, more things must happen',
      body: 'When a survey closes: email the principal, start the comment analysis, notify the Ministry and write an audit log entry. Next month: clear the dashboard cache and send a summary to the school’s parents committee. And if the Ministry is down, the rest must still happen.',
    },
    pain: {
      text: ['The quick fix puts every reaction inside `close()`:'],
      code: `public function close(DateTimeImmutable $at): void
{
    $this->switchTo($this->status->close($at));

    $this->mailer->send($this->principal, /* ... */);
    $this->analysis->start($this->school);
    $this->ministry->notify($this->title);        // throws when the Ministry is down...
    $this->audit->write('survey closed', /* ... */);   // ...so this never runs
}`,
      after: [
        '`SurveyRun` now depends on a mailer, an analysis service, the Ministry client and an audit log, none of which have anything to do with a survey’s lifecycle. Every new reaction edits it, and one failing reaction stops all the ones after it.',
        'The survey only needs to **announce** what happened. Who reacts, and how, is somebody else’s business.',
      ],
    },
    pattern: {
      name: 'Observer and Event Dispatcher',
      rule: 'Something happens and several unrelated parts must react → the subject announces it; observers subscribe and react, without the subject knowing them.',
      explain: [
        'In the book’s **Observer**, a subject keeps a list of observers and notifies each one when something changes. An **event dispatcher** is a shared subject for the whole app: listeners subscribe to an **event class** (`SurveyClosed`), and anyone can dispatch an event without knowing who listens.',
        '`SurveyRun::close()` now only records a `SurveyClosed` event (a small read-only object with the facts). The caller releases the recorded events and dispatches them. Each reaction is one small listener class, and the list of listeners lives in one place: `bootstrap/app.php`.',
        'The dispatcher runs every listener even when one fails, and it never hides a failure: it logs it and returns it to the caller. Here the Ministry listener fails and the audit log is still written.',
      ],
      drawing: {
        bad: [['b', 4, 62, 80, 40, 'close()', 'x'], ['a', 84, 82, 212, 17, '', 'x'], ['a', 84, 82, 212, 49, '', 'x'], ['a', 84, 82, 212, 81, '', 'x'], ['a', 84, 82, 212, 113, '', 'x'], ['a', 84, 82, 212, 145, '', 'x'], ['b', 214, 4, 82, 26, 'Mailer', 'n'], ['b', 214, 36, 82, 26, 'Analysis', 'n'], ['b', 214, 68, 82, 26, 'Ministry', 'n'], ['b', 214, 100, 82, 26, 'Cache', 'n'], ['b', 214, 132, 82, 26, 'Audit', 'n']],
        good: [['b', 2, 62, 74, 40, 'SurveyRun', 'n'], ['a', 76, 82, 92, 82], ['t', 40, 120, 'records events', 's', 'middle'], ['b', 94, 58, 94, 48, 'Dispatcher', 'v'], ['a', 188, 82, 212, 17, '', 'k'], ['a', 188, 82, 212, 59, '', 'k'], ['a', 188, 82, 212, 103, '', 'k'], ['a', 188, 82, 212, 145, '', 'k'], ['b', 214, 4, 82, 26, 'Email', 'n'], ['b', 214, 46, 82, 26, 'Analysis', 'n'], ['b', 214, 90, 82, 26, 'Audit', 'n'], ['b', 214, 132, 82, 26, '+ new one', 'n']],
        badCaption: 'close() calls every reaction itself. One failure stops the rest.',
        goodCaption: 'close() announces an event. Listeners subscribe and react independently.',
      },
    },
    steps: [
      {
        title: 'The dispatcher',
        text: [
          'Listeners are registered per event class, as a class name (built by the container only when the event happens) or a closure. Each listener runs inside its own `try`: a failure is logged, collected and returned, and the next listener still runs.',
        ],
        file: 'src/Events/EventDispatcher.php',
      },
      { title: 'The event: a record of what happened', text: ['Read-only data. No methods, no services.'], file: 'src/Lifecycle/SurveyClosed.php' },
      {
        title: 'The survey records events instead of calling services',
        text: ['`close()` adds a `SurveyClosed` to a list. `releaseEvents()` hands the list over once and empties it, so an event can’t be dispatched twice.'],
        file: 'src/Lifecycle/SurveyRun.php', diff: 'src/Lifecycle/SurveyRun.php',
      },
      { title: 'Listener: email the principal', text: ['Each listener is an invokable class: one `__invoke()` method that receives the event.'], file: 'src/Lifecycle/Listeners/EmailThePrincipal.php' },
      { title: 'Listener: start the analysis', text: ['For now it only logs the request. Chapter 23 turns it into a real background job.'], file: 'src/Lifecycle/Listeners/QueueCommentAnalysis.php' },
      { title: 'Listener: notify the Ministry', text: ['Its API is down today, so it throws. Chapter 24 makes this delivery reliable.'], file: 'src/Lifecycle/Listeners/NotifyMinistry.php' },
      { title: 'Listener: the audit log', text: [], file: 'src/Lifecycle/Listeners/WriteAuditLog.php' },
      { title: 'Who listens to what, in one place', text: ['A new reaction is a new class and one `listen()` line. `SurveyRun` doesn’t change.'], file: 'bootstrap/app.php', diff: 'bootstrap/app.php' },
      { title: 'Close a survey and dispatch what happened', text: [], file: 'bin/lifecycle.php', diff: 'bin/lifecycle.php' },
    ],
    run: {
      script: 'bin/lifecycle.php',
      cmd: 'composer dump-autoload\nphp bin/lifecycle.php',
      text: ['The principal is emailed, the analysis is requested, the Ministry listener fails (and is logged and reported), and the audit log is still written.'],
    },
    laravel: {
      text: [
        'This is Laravel’s event system: `Event::listen()` (or listener discovery) subscribes listener classes to an event class, `event(new SurveyClosed(...))` dispatches it, and listeners are built by the container. Listeners that implement `ShouldQueue` run in the background. Eloquent **observers** (`Model::observe()`) are the same idea for model events like `created` and `updated`.',
      ],
      code: `// A listener: Laravel finds it by the event type in __invoke() / handle()
final class EmailThePrincipal
{
    public function __construct(private Mailer $mailer) {}

    public function handle(SurveyClosed $event): void
    {
        Mail::to($event->principal)->send(new SurveyClosedMail($event));
    }
}

// Anywhere:
SurveyClosed::dispatch($title, $term, $school, $principal, $answers, now());`,
    },
    check: [
      { q: 'The parents committee must get a summary when a survey closes. What changes?', a: 'One new listener class and one `listen()` line in the bootstrap. `SurveyRun` doesn’t change.' },
      { q: 'Why does `SurveyRun` record events instead of dispatching them itself?', a: 'So it doesn’t depend on the dispatcher, and the caller can dispatch after everything is saved.' },
      { q: 'One listener throws. What happens to the others?', a: 'They still run. The failure is logged and returned, never hidden.' },
    ],
    next: 'The analysis listener only logs. Doing the real analysis inside the request takes 40 seconds per school and times out.',
  },

  // ════════════════════════════════════════════════════════════════════
  '23-command': {
    description: 'Comment analysis takes 40 seconds and times out the request. Turn it into a command object, route it through a command bus, and run it in the background with retries.',
    ticket: {
      from: 'Mona Saleh, Head of Quality',
      title: '"Close survey" spins for a minute, then shows an error',
      body: 'When I close a survey, the page loads for about a minute and then says "504 Gateway Timeout". The survey is closed, but the comment summaries are missing for half the teachers. Support also needs a way to re-run the analysis for one teacher.',
    },
    pain: {
      text: ['The listener runs the analysis directly, inside the web request:'],
      code: `public function __invoke(SurveyClosed $event): void
{
    foreach ($this->teachersOf($event->school) as $teacher) {
        $summary = $this->analyzer->summarize(/* comments */);   // 3–40 seconds each
        $this->save($teacher, $summary);
    }
}   // the web server gives up after 60 seconds; whatever is left is lost`,
      after: [
        'The principal waits for work she doesn’t need to wait for, the request dies half-way, and there is no record of what was left undone, so nothing retries it.',
        'The request should only **write down what needs to be done**, answer at once, and let a background process do the work, retrying when it fails.',
      ],
    },
    pattern: {
      name: 'Command and Command Bus',
      rule: 'An action must be queued, retried, logged or run elsewhere → turn the request into a plain data object (a command); a bus finds its handler and runs it now or queues it.',
      explain: [
        '**Command** (from the book): `AnalyzeTeacherComments` is the request "analyse teacher 1 for 2026-T1" as an object. It holds only data, so it can be stored as JSON in the `jobs` table and rebuilt later by another process.',
        'The **handler** holds the logic and receives its services from the container. Splitting them keeps the command serializable: a live database connection can’t be stored in a queue.',
        'The **command bus** (not in the book) is the single door: `dispatch($command)` looks up the handler, and queues the command if it implements `ShouldQueue`. The **worker** takes jobs from the queue, runs them through the bus, retries failures and raises an alert when a job fails for good.',
      ],
      drawing: {
        bad: [['b', 4, 62, 90, 40, 'Web request', 'x'], ['a', 94, 82, 206, 82, '', 'x'], ['b', 208, 62, 88, 40, 'AI: 40 s', 'x'], ['t', 150, 124, 'the user waits…', 'kx', 'middle'], ['t', 150, 144, '504 Gateway Timeout', 'kx', 'middle']],
        good: [['b', 2, 20, 62, 30, 'Request', 'n'], ['a', 64, 35, 80, 35], ['b', 82, 20, 52, 30, 'Bus', 'v'], ['a', 134, 35, 150, 35, '', 'k'], ['b', 152, 20, 60, 30, 'Queue', 'n'], ['t', 33, 66, '202 at once', 's', 'middle'], ['a', 182, 50, 182, 92, '', 'k'], ['b', 152, 94, 60, 30, 'Worker', 'v2'], ['a', 212, 109, 228, 109, '', 'k'], ['b', 230, 94, 66, 30, 'Handler', 'n'], ['t', 182, 150, 'later, with retries', 's', 'middle']],
        badCaption: 'The slow work runs inside the request. The request dies first.',
        goodCaption: 'The request queues a command and answers. A worker runs it later.',
      },
    },
    steps: [
      { title: 'Marking commands that run in the background', text: [], file: 'src/Bus/ShouldQueue.php' },
      { title: 'The command: only data', text: ['Two public values. No services, no logic.'], file: 'src/Analysis/AnalyzeTeacherComments.php' },
      {
        title: 'The handler: the logic',
        text: ['It looks the teacher up (an unknown teacher throws), collects the comments, analyses them and saves the summary.'],
        file: 'src/Analysis/AnalyzeTeacherCommentsHandler.php',
      },
      { title: 'A teacher lookup that fails loudly', text: [], file: 'src/Domain/TeacherRepository.php', diff: 'src/Domain/TeacherRepository.php' },
      { title: 'Its SQLite implementation', text: [], file: 'src/Infrastructure/Sqlite/SqliteTeacherRepository.php', diff: 'src/Infrastructure/Sqlite/SqliteTeacherRepository.php' },
      { title: 'Tables for jobs and summaries', text: [], file: 'src/Infrastructure/Sqlite/Schema.php', diff: 'src/Infrastructure/Sqlite/Schema.php' },
      { title: 'The queue interface', text: [], file: 'src/Bus/Queue.php' },
      { title: 'A queued job', text: [], file: 'src/Bus/Job.php' },
      {
        title: 'A queue in the database',
        text: ['A command is stored as its class name and its public values in JSON, and rebuilt with named arguments. `rebuild()` refuses any class that isn’t a queueable command, so the table can’t be used to create arbitrary objects.'],
        file: 'src/Bus/DatabaseQueue.php',
      },
      { title: 'The command bus', text: ['`dispatch()` queues or runs; `dispatchNow()` always runs. Handlers are found by the command’s class.'], file: 'src/Bus/CommandBus.php' },
      {
        title: 'The worker',
        text: ['It runs jobs until the queue is empty, retrying failures up to `maxAttempts`, then marks the job failed and logs an ALERT. A production worker would also skip retries for errors that can’t succeed (like an unknown teacher); Laravel does this with `$this->fail()`.'],
        file: 'src/Bus/Worker.php',
      },
      { title: 'The listener now only queues', text: ['One command per teacher of the school. It returns in milliseconds.'], file: 'src/Lifecycle/Listeners/QueueCommentAnalysis.php', diff: 'src/Lifecycle/Listeners/QueueCommentAnalysis.php' },
      { title: 'Register the handler', text: [], file: 'bootstrap/app.php', diff: 'bootstrap/app.php' },
      { title: 'The request, then the worker', text: [], file: 'bin/lifecycle.php', diff: 'bin/lifecycle.php' },
    ],
    run: {
      script: 'bin/lifecycle.php',
      cmd: 'composer dump-autoload\nphp bin/lifecycle.php',
      text: ['The request queues three jobs and answers at once. Later, the worker completes the two real ones and stores their summaries; the job for teacher 99 fails three times and ends with an ALERT, visible in the jobs table.'],
    },
    laravel: {
      text: [
        'Laravel jobs are commands: a job class holds data, `dispatch()` serializes it to the queue, and `php artisan queue:work` runs it with `$tries`, `$backoff` and `failed()` for the end of the road. Since Laravel 11, a job’s `handle()` method receives its services by injection, the same split as our command and handler.',
      ],
      code: `final class AnalyzeTeacherComments implements ShouldQueue
{
    use Queueable;

    public int $tries = 3;
    public array $backoff = [10, 60];

    public function __construct(public int $teacherId, public string $term) {}

    public function handle(CommentAnalyzer $analyzer, ResponseRepository $responses): void
    {
        // ...the same logic as our handler
    }

    public function failed(Throwable $e): void
    {
        Log::critical('Comment analysis failed for good', ['teacher' => $this->teacherId, 'error' => $e->getMessage()]);
    }
}

AnalyzeTeacherComments::dispatch($teacher->id, '2026-T1');`,
    },
    check: [
      { q: 'Why can’t the command hold the `CommentAnalyzer` object?', a: 'It is stored as JSON in the queue. A service with connections and state can’t be stored; the handler receives services when it runs.' },
      { q: 'What does the bus add on top of calling the handler directly?', a: 'One door for every command: it finds the handler, decides between running now and queuing, and is the place to add logging or transactions for all commands.' },
      { q: 'What happens to a job that keeps failing?', a: 'The worker retries it up to `maxAttempts`, then marks it failed and logs an ALERT. It is never silently dropped.' },
    ],
    next: 'The Ministry must receive the final results of every closed term. Last week the server restarted between saving the results and calling the Ministry, and the Ministry never got them.',
  },

  // ════════════════════════════════════════════════════════════════════
  '24-outbox': {
    description: 'Results were saved but the Ministry never received them when the server restarted. Save data and messages in one transaction with a Unit of Work, and deliver them with the Transactional Outbox pattern.',
    ticket: {
      from: 'Ministry of Education, data office',
      title: 'We never received Smouha’s results for 2026-T1',
      body: 'Your system shows the term as closed, but our API has no record of the results. Your logs show a deployment restart at the same minute. We need a guarantee: if the term is closed on your side, we receive the results, even if our API is down for a while.',
    },
    pain: {
      text: ['Closing a term saved the results, then called the Ministry:'],
      code: `$this->store->saveAndClose($term, $results);       // committed to our database
// ← a restart here, and the Ministry is never told
$this->ministry->publishResults($term, $results);   // or: the Ministry is down, and this throws`,
      after: [
        'Two systems, two separate steps, and no way to make them succeed or fail together. Swapping the order is no better: the Ministry could receive results that our database then fails to save.',
        'The fix has two parts. First, save **everything** this operation changes, including a record of the message the Ministry must receive, in **one** database transaction. Second, let a separate process deliver that message, and keep trying until it succeeds.',
      ],
    },
    pattern: {
      name: 'Unit of Work and Transactional Outbox',
      rule: 'An operation changes several things and must tell another system → collect every change in a unit of work, commit them in one transaction together with an outbox message, and let a relay deliver the message.',
      explain: [
        '**Unit of Work** (Fowler, *Patterns of Enterprise Application Architecture*): `TermClosing` registers the closed term, each frozen result and the outbox message; `commit()` writes them all in one transaction. If any write fails, nothing is saved.',
        '**Transactional Outbox**: the message to the Ministry is just another row, in the `outbox` table, saved in that same transaction. If the term is closed, the message exists. The request never calls the Ministry.',
        'The **relay** runs every minute: it sends pending messages, marks them sent, retries failures and raises an alert when it gives up. Delivery is **at least once**: a crash after sending but before marking can send a message twice, so each message carries an idempotency key and the receiver ignores repeats.',
        'Neither pattern is in the Gang of Four book.',
      ],
      drawing: {
        bad: [['b', 4, 62, 72, 40, 'Save results', 'n'], ['a', 76, 82, 128, 82, '', 'x'], ['t', 152, 76, 'server', 'kx', 'middle'], ['t', 152, 92, 'restarts', 'kx', 'middle'], ['a', 176, 82, 222, 82, '', 'x'], ['b', 224, 62, 72, 40, 'Ministry', 'x'], ['t', 150, 140, 'saved here, never told there', 'kx', 'middle']],
        good: [['b', 4, 40, 150, 84, '', 'v2'], ['t', 14, 58, 'one transaction', 'kv'], ['b', 14, 66, 130, 22, 'term_results', 'n'], ['b', 14, 94, 130, 22, 'outbox', 'v'], ['a', 154, 105, 176, 105, '', 'k'], ['b', 178, 90, 48, 30, 'Relay', 'n'], ['a', 226, 105, 236, 105, '', 'k'], ['b', 238, 90, 60, 30, 'Ministry', 'n'], ['t', 240, 144, 'retries until sent', 's', 'middle']],
        badCaption: 'Two steps in two systems. A restart in between loses the message.',
        goodCaption: 'The message is saved with the data. A relay delivers it, retrying until it arrives.',
      },
    },
    steps: [
      { title: 'A mapper writes one kind of object', text: [], file: 'src/Persistence/Mapper.php' },
      {
        title: 'The Unit of Work',
        text: ['`registerNew()` refuses a class it has no mapper for immediately, not at commit time. `commit()` writes everything in one transaction and rolls back on any failure.'],
        file: 'src/Persistence/UnitOfWork.php',
      },
      { title: 'What the operation produces', text: ['A closed term, one frozen result per teacher…'], file: 'src/Closing/ClosedTerm.php' },
      { title: 'A frozen result', text: [], file: 'src/Closing/FrozenResult.php' },
      { title: '…and the outbox message', text: ['Its `key` is unique per message, and travels with it as the idempotency key.'], file: 'src/Outbox/OutboxMessage.php' },
      { title: 'The mappers', text: ['One small class per table.'], file: 'src/Infrastructure/Sqlite/OutboxMessageMapper.php' },
      { title: 'The closed-term mapper', text: [], file: 'src/Infrastructure/Sqlite/ClosedTermMapper.php' },
      { title: 'The frozen-result mapper', text: [], file: 'src/Infrastructure/Sqlite/FrozenResultMapper.php' },
      { title: 'The outbox table', text: ['A `UNIQUE` message key, a status (pending, sent, failed) and an attempt counter.'], file: 'src/Infrastructure/Sqlite/Schema.php', diff: 'src/Infrastructure/Sqlite/Schema.php' },
      {
        title: 'The facade now uses the unit of work',
        text: ['Step 3 of chapter 11’s facade registers the term, the results and the message, then commits once. Emails still go out only after the commit.'],
        file: 'src/Closing/TermClosing.php', diff: 'src/Closing/TermClosing.php',
      },
      { title: 'The store no longer saves on its own', text: ['Saving moved into the unit of work, so the store only answers whether a term is closed.'], file: 'src/Reporting/TermResultStore.php', diff: 'src/Reporting/TermResultStore.php' },
      { title: 'The Ministry API stand-in', text: ['Down for its first call, and idempotent: it ignores a key it has already received.'], file: 'fakes/Ministry/Client.php' },
      {
        title: 'The relay',
        text: ['Pending messages are sent in order. A failure counts an attempt; after `maxAttempts` the message is marked failed with an ALERT. Nothing is dropped silently.'],
        file: 'src/Outbox/OutboxRelay.php',
      },
      {
        title: 'Wire it, and retire the old listener',
        text: ['The unit of work gets one mapper per class. The `NotifyMinistry` listener from chapter 22 is removed: the outbox replaces it.'],
        file: 'bootstrap/app.php', diff: 'bootstrap/app.php',
      },
      { title: 'Close, relay, relay again, and an all-or-nothing failure', text: [], file: 'bin/close-term.php', diff: 'bin/close-term.php' },
    ],
    run: {
      script: 'bin/close-term.php',
      cmd: 'composer dump-autoload\nphp bin/close-term.php',
      text: [
        'The request saves the results and the message together, and never calls the Ministry. The relay fails once (503), succeeds a minute later, and a repeated send is ignored by the receiver. In the last block, a write fails half-way through a unit of work, and the message registered in it is rolled back too.',
      ],
    },
    laravel: {
      text: [
        'With the `database` queue driver, a queued job is a row in the `jobs` table. Dispatch a job **inside** `DB::transaction()` on the same connection and the job row is saved in the same transaction as your data: the jobs table becomes your outbox and `queue:work` is the relay. `DB::afterCommit()` and `ShouldQueueAfterCommit` cover the opposite case: never queue for data that was rolled back.',
        'Eloquent has no Unit of Work (Doctrine’s `EntityManager::flush()` is one); `DB::transaction()` around your writes plays that role.',
      ],
      code: `DB::transaction(function () use ($term, $results): void {
    ClosedTerm::create(['term' => $term, 'closed_at' => now()]);
    foreach ($results as $result) {
        TermResult::create(/* ... */);
    }

    // database queue on the same connection: this row commits with the data above
    PublishResultsToMinistry::dispatch($term, idempotencyKey: "ministry-results:{$term}");
});`,
    },
    check: [
      { q: 'The server restarts right after the commit. Is the Ministry message lost?', a: 'No. It is a row in the outbox, committed with the results. The relay sends it on its next run.' },
      { q: 'Why must the Ministry ignore a message key it has already seen?', a: 'Delivery is at least once: the relay can crash after sending and before marking the row as sent, and then sends it again.' },
      { q: 'What does the Unit of Work guarantee?', a: 'Every change registered in one operation is saved in one transaction: all of them, or none.' },
    ],
    next: 'Answers now arrive online, through invitation links. Each submission needs a series of checks, and harsh comments must go to the right person for review.',
  },

  // ════════════════════════════════════════════════════════════════════
  '25-pipeline': {
    description: 'Online answers need a series of checks, and flagged comments need the right reviewer. Build a Pipeline of stages for submissions and a Chain of Responsibility for moderation in PHP.',
    ticket: {
      from: 'Mona Saleh, Head of Quality, and Omar Hassan, DevOps',
      title: 'Online answers: checks, abuse and a script guessing links',
      body: 'Answers now come through personal invitation links. Every answer must be refused if the survey isn’t open, the link isn’t valid for that teacher, or the link was already used. A script tried hundreds of links from one machine last night. And harsh comments must be reviewed: obvious abuse rejected automatically, otherwise the school’s own moderator if it has one, otherwise our quality team.',
    },
    pain: {
      text: ['Everything inside one controller method:'],
      code: `public function submit(Submission $s): Receipt
{
    if ($this->tooMany($s->ip))            { return refuse('Too many'); }
    if (!$this->run->isOpen())             { return refuse('Closed'); }
    if (!$this->validToken($s))            { return refuse('Bad link'); }
    $this->markTokenUsed($s);              // ...even if saving fails below
    if ($this->isHarsh($s->comment)) {
        if ($this->isAbusive($s->comment)) { /* reject */ }
        elseif ($this->hasModerator($school)) { /* send to school */ }
        else { /* send to quality team */ }
    }
    // validate and save...
}`,
      after: [
        'Every rule lives in one method, in one fixed order. A new check (say, "one answer per student per teacher") means editing it, and the token is marked as used before the answer is saved, so a typo in the score burns the respondent’s only link.',
        'There are really two different problems here. The checks form a **sequence** that every submission passes through. The moderation is a **choice**: hand the comment along until someone can deal with it.',
      ],
    },
    pattern: {
      name: 'Pipeline and Chain of Responsibility',
      rule: 'A request goes through a sequence of steps that may stop it → a pipeline of stages, each calling the next. A request must be handled by one of several handlers → a chain where each one handles it or passes it on.',
      explain: [
        '**Pipeline** (not in the book; it is how middleware works): each stage receives the submission and a `$next` function. It can refuse and stop, or call `$next`, and it can act **after** `$next` returns. `RequireValidInvitation` uses that: it marks the link as used only when the rest of the pipeline accepted the answer, so a rejected answer can be corrected and resent.',
        '**Chain of Responsibility** (from the book): `AutoFilter`, `SchoolModerator` and `QualityTeam` are linked with `then()`. Each asks "can I handle this?", and either decides or passes the comment to the next. The sender only knows the first link. The last link handles everything, and a chain that nobody handles throws instead of dropping the comment.',
        'They look alike (objects passing something along), but a pipeline expects **every** stage to run, while a chain stops at the **first** handler that takes the request.',
      ],
      drawing: {
        bad: [['b', 30, 14, 240, 142, '', 'x'], ['t', 46, 40, 'submit()', 'm'], ['t', 56, 62, 'if (too many) …', 'm'], ['t', 56, 82, 'if (closed) …', 'm'], ['t', 56, 102, 'if (bad link) …', 'm'], ['t', 56, 122, 'if (harsh) { if school …', 'm'], ['t', 46, 146, 'one method, every rule', 'kx']],
        good: [['b', 2, 14, 52, 28, 'Rate', 'v2'], ['a', 54, 28, 62, 28, '', 'k'], ['b', 64, 14, 52, 28, 'Open', 'v2'], ['a', 116, 28, 124, 28, '', 'k'], ['b', 126, 14, 56, 28, 'Invite', 'v2'], ['a', 182, 28, 190, 28, '', 'k'], ['b', 192, 14, 56, 28, 'Screen', 'v2'], ['a', 248, 28, 256, 28, '', 'k'], ['b', 258, 14, 40, 28, 'Save', 'n'], ['t', 4, 60, 'pipeline: every stage may stop it', 's'], ['a', 220, 42, 246, 88, '', 'k'], ['b', 200, 90, 96, 28, 'AutoFilter', 'v'], ['a', 200, 104, 190, 104], ['b', 102, 90, 88, 28, 'School', 'v'], ['a', 102, 104, 92, 104], ['b', 2, 90, 90, 28, 'Quality', 'v'], ['t', 150, 140, 'chain: the first one that can', 's', 'middle'], ['t', 150, 154, 'handle it does', 's', 'middle']],
        badCaption: 'Every rule in one method, in one order, with nested decisions.',
        goodCaption: 'Checks run as a pipeline. Flagged comments go down a chain until someone handles them.',
      },
    },
    steps: [
      { title: 'A submission from the form', text: [], file: 'src/Submission/Submission.php' },
      { title: 'What the respondent is told', text: [], file: 'src/Submission/Receipt.php' },
      { title: 'A pipeline stage', text: ['`$next` is "the rest of the pipeline". Not calling it stops the submission.'], file: 'src/Submission/SubmissionStage.php' },
      {
        title: 'The pipeline',
        text: ['It wraps the stages around each other from the inside out: the last stage wraps the destination, the first stage wraps everything. Calling the result runs the first stage.'],
        file: 'src/Submission/Pipeline.php',
      },
      { title: 'Stage: limit submissions per device', text: ['It runs first: it is cheap, and it stops a script before any lookup.'], file: 'src/Submission/Stages/LimitRate.php' },
      { title: 'A check that doesn’t count an answer', text: ['`ensureAcceptsAnswers()` lets a stage ask the State from chapter 21 without recording an answer.'], file: 'src/Lifecycle/SurveyRun.php', diff: 'src/Lifecycle/SurveyRun.php' },
      { title: 'Stage: the survey must be open', text: [], file: 'src/Submission/Stages/RequireOpenSurvey.php' },
      { title: 'Stage: a valid, unused invitation', text: ['Code after `$next()` runs on the way back: the link is used up only if the answer was accepted.'], file: 'src/Submission/Stages/RequireValidInvitation.php' },
      { title: 'The chain: a flagged comment', text: [], file: 'src/Moderation/FlaggedComment.php' },
      {
        title: 'The chain: the base handler',
        text: ['`review()` handles the comment if this moderator can, otherwise passes it on. `then()` returns the next moderator, so a chain reads left to right.'],
        file: 'src/Moderation/Moderator.php',
      },
      { title: 'Link 1: the automatic filter', text: [], file: 'src/Moderation/AutoFilter.php' },
      { title: 'Link 2: the school’s moderator', text: [], file: 'src/Moderation/SchoolModerator.php' },
      { title: 'Link 3: the quality team', text: ['The end of the chain handles everything that reaches it.'], file: 'src/Moderation/QualityTeam.php' },
      {
        title: 'Stage: screen the comment',
        text: ['The pipeline stage that uses the chain. The score is still saved; the comment is held and the respondent is told what happened to it.'],
        file: 'src/Submission/Stages/ScreenComment.php',
      },
      { title: 'Eleven submissions through the pipeline', text: [], file: 'bin/submit.php' },
    ],
    run: {
      script: 'bin/submit.php',
      cmd: 'composer dump-autoload\nphp bin/submit.php',
      text: ['Each submission is stopped by the first stage that refuses it, with a clear reason. The score typo doesn’t burn the invitation: the corrected answer goes through. Each harsh comment ends with a different moderator, and the script is cut off by the rate limit on its fourth try.'],
    },
    laravel: {
      text: [
        'HTTP middleware is a pipeline: each middleware gets the request and `$next`, may return early, and may work on the response after `$next($request)`. Laravel exposes the same engine as `Illuminate\\Pipeline\\Pipeline` for your own objects.',
      ],
      code: `$receipt = app(Pipeline::class)
    ->send($submission)
    ->through([LimitRate::class, RequireOpenSurvey::class, RequireValidInvitation::class, ScreenComment::class])
    ->via('handle')
    ->then(fn (Submission $s) => $this->save($s));

// The rate limit, the Laravel way:
RateLimiter::for('answers', fn (Request $request) => Limit::perMinute(3)->by($request->ip()));`,
    },
    check: [
      { q: 'A new rule: "one answer per student per teacher". What changes?', a: 'One new stage class, added to the list. The other stages don’t change.' },
      { q: 'Why is the invitation marked as used after `$next()` returns?', a: 'So it is used up only when the answer was really accepted. A refused answer can be corrected and resent with the same link.' },
      { q: 'What is the main difference between the pipeline and the chain?', a: 'In the pipeline every stage runs unless one stops it. In the chain, the first handler that can take the request handles it and the rest never see it.' },
    ],
    next: 'The quality team wants lists: who enters the support program, who gets the excellence award. Each list has its own rules, and the rules overlap.',
  },

  // ════════════════════════════════════════════════════════════════════
  '26-specification': {
    description: 'Program rules like "score below 3, at least 3 answers, not on leave" are copied and drift. Write each rule once and combine them with the Specification pattern in PHP.',
    ticket: {
      from: 'Mona Saleh, Head of Quality',
      title: 'Lists for the support program and the excellence award',
      body: 'Support program: score below 3.0, at least 3 answers (otherwise the score means nothing), not on leave. Excellence award: score of at least 4.0 and at least 4 answers. HR says nobody on leave can be in any program. Last term Karim got the award letter while he was on leave.',
    },
    pain: {
      text: ['Each list is a function with its own conditions:'],
      code: `function supportList(array $results): array
{
    return array_filter($results, fn ($r) => $r->score < 3 && $r->responseCount >= 3 && !$r->teacher->onLeave);
}

function awardList(array $results): array
{
    return array_filter($results, fn ($r) => $r->score >= 4 && $r->responseCount >= 4);   // forgot "on leave"
}`,
      after: [
        'The same rules ("enough answers", "not on leave") are written again in every list, and one copy forgot one of them. The rules have no names, so a screen can’t show which ones a teacher failed, and the next program ("mentors") will copy them a third time.',
        'Each rule is a small yes/no question about a teacher. We want each one written **once**, with a name, and programs built by **combining** them.',
      ],
    },
    pattern: {
      name: 'Specification',
      rule: 'Business rules decide whether something qualifies, and the rules combine and repeat → make each rule an object with isSatisfiedBy(), and combine rules with and, or and not.',
      explain: [
        'Each small rule is a class: `ScoreBelow`, `ScoreAtLeast`, `HasAtLeastAnswers`, `OnLeave`. Each answers one question with `isSatisfiedBy($result)` and can describe itself in words.',
        '`and()`, `or()` and `not()` combine rules into new rules (`AllOf`, `AnyOf`, `NotSatisfied`), so a program reads like its definition: `(new ScoreBelow(3.0))->and(new HasAtLeastAnswers(3))->and((new OnLeave())->not())`.',
        'It is a close cousin of the Interpreter from chapter 18 (small objects combined into a tree that evaluates itself), applied to business rules written by developers. Specification was described by Eric Evans and Martin Fowler; it is not in the Gang of Four book.',
      ],
      drawing: {
        bad: [['b', 6, 14, 138, 138, '', 'x'], ['t', 16, 36, 'supportList()', 'm'], ['t', 22, 60, 'score < 3', 'm'], ['t', 22, 82, 'answers >= 3', 'm'], ['t', 22, 104, '!onLeave', 'm'], ['b', 156, 14, 138, 138, '', 'x'], ['t', 166, 36, 'awardList()', 'm'], ['t', 172, 60, 'score >= 4', 'm'], ['t', 172, 82, 'answers >= 4', 'm'], ['t', 172, 104, '(forgot leave)', 'kx']],
        good: [['b', 4, 14, 96, 28, 'score < 3.0', 'v2'], ['b', 4, 62, 96, 28, '≥ 3 answers', 'v2'], ['b', 4, 110, 96, 28, 'not on leave', 'v2'], ['a', 100, 28, 180, 70, '', 'k'], ['a', 100, 76, 180, 76, '', 'k'], ['a', 100, 124, 180, 82, '', 'k'], ['b', 182, 56, 114, 40, 'Support rule', 'v'], ['t', 160, 112, 'and', 'kv', 'middle'], ['t', 239, 118, 'each rule written once', 's', 'middle']],
        badCaption: 'Each list repeats the rules, and one copy forgot one.',
        goodCaption: 'Small named rules, combined with and / or / not into programs.',
      },
    },
    steps: [
      { title: 'Teachers can be on leave', text: [], file: 'src/Domain/Teacher.php', diff: 'src/Domain/Teacher.php' },
      { title: 'Stored in the teachers table', text: [], file: 'src/Infrastructure/Sqlite/Schema.php', diff: 'src/Infrastructure/Sqlite/Schema.php' },
      { title: 'Read by the repository', text: [], file: 'src/Infrastructure/Sqlite/SqliteTeacherRepository.php', diff: 'src/Infrastructure/Sqlite/SqliteTeacherRepository.php' },
      { title: 'Karim is on leave in the demo data', text: [], file: 'src/Demo/SampleData.php', diff: 'src/Demo/SampleData.php' },
      { title: 'The specification interface', text: ['A rule answers yes or no, describes itself, and combines with others.'], file: 'src/Selection/Specification.php' },
      { title: 'The combinators, written once', text: ['Every rule extends this class and gets `and()`, `or()` and `not()`.'], file: 'src/Selection/BaseSpecification.php' },
      { title: 'and', text: [], file: 'src/Selection/AllOf.php' },
      { title: 'or', text: [], file: 'src/Selection/AnyOf.php' },
      { title: 'not', text: [], file: 'src/Selection/NotSatisfied.php' },
      { title: 'Rule: enough answers', text: [], file: 'src/Selection/HasAtLeastAnswers.php' },
      { title: 'Rule: score below a limit', text: ['A teacher with no answers has no score, which is not a low score: `null` never matches.'], file: 'src/Selection/ScoreBelow.php' },
      { title: 'Rule: score of at least', text: [], file: 'src/Selection/ScoreAtLeast.php' },
      { title: 'Rule: on leave', text: [], file: 'src/Selection/OnLeave.php' },
      { title: 'The programs, as combinations', text: ['Each program is a sentence made of named rules. "Not on leave" is written once and used by both.'], file: 'src/Selection/Programs.php' },
      { title: 'Who qualifies', text: [], file: 'bin/programs.php' },
    ],
    run: {
      script: 'bin/programs.php',
      cmd: 'composer dump-autoload\nphp bin/programs.php',
      text: ['Each program prints its rule in words, then who qualifies. Nadia enters the support program; Hany gets the award; Karim (4.00, four answers) is excluded because he is on leave.'],
    },
    laravel: {
      text: [
        'In Eloquent, the closest tool is **query scopes**: named, reusable conditions that combine by chaining (`->onLeave(false)->scoreBelow(3)`). The difference is where they run: scopes become SQL, specifications run on objects in PHP. Large lists should filter in SQL; Doctrine’s `Criteria` can do both.',
      ],
      code: `// Named, combinable rules that run in the database:
final class TermResult extends Model
{
    public function scopeScoreBelow(Builder $query, float $limit): void
    {
        $query->where('score', '<', $limit);
    }

    public function scopeWithAtLeastAnswers(Builder $query, int $minimum): void
    {
        $query->where('responses', '>=', $minimum);
    }
}

$support = TermResult::scoreBelow(3.0)->withAtLeastAnswers(3)->whereRelation('teacher', 'on_leave', false)->get();`,
    },
    check: [
      { q: 'HR adds "must have taught at least one full term". What changes?', a: 'One new rule class, added to each program with `and()`. The existing rules don’t change.' },
      { q: 'Why does `ScoreBelow` return false for a teacher with no answers?', a: 'No answers means no score, not a low one. Putting that teacher in the support program would be wrong.' },
      { q: 'How is Specification related to the Interpreter from chapter 18?', a: 'Both build a tree of small objects that evaluate themselves. Interpreter parses a user-typed language; Specification is built in code from named business rules.' },
    ],
    next: 'Part 6 starts: Evalu8 runs locally and in the cloud, and last week production uploaded files to a local folder while sending jobs to the cloud queue.',
  },
};


const BASE = [
{
id:'strategy', name:'Strategy', fam:'beh', famName:'Behaviour',
hook:'Google Maps: same trip, you pick Car, Walk or Bike.',
rule:'Same job, several ways to do it → one class per way, all behind one interface.',
pain:'One method with a growing switch. Adding JSON means editing (and risking) the CSV, Excel and PDF code.',
fix:'Each format is its own class behind one interface. The code that uses it gets one and never asks which. Adding JSON is one new class.',
smells:['A switch on a "type" or "format" where each branch contains the actual WORK (many lines)','Every branch does the same job in a different way','You fear touching one branch because it could break another'],
job:'Users download a report as CSV, Excel or PDF from a dropdown. Next month: JSON.',
seen:['Laravel hashing drivers (bcrypt, argon)','Cache stores','Socialite providers','Payment methods at checkout'],
test:'A report can be downloaded as CSV, Excel or PDF. The export() method is a 200-line switch, and JSON is coming next.',
vs:{id:'simple-factory', name:'Simple Factory', rows:[
  ['Answers','How is the job done?','Which object do I build from this input?'],
  ['Looks like','Several classes behind one interface','One class with one match'],
  ['Add an option','One new class, no edits','One new line in the match'],
  ['Inside the switch','Each branch does the work','Each branch only says new X()'],
  ['Together','The strategy does the work…','…the factory picks which one'],
]},
diagram:{bad:[['b',30,14,240,142,'','x'],['t',48,40,'export($rows, $format)','m'],['t',58,66,'case "csv":   …30 lines','m'],['t',58,88,'case "excel": …40 lines','m'],['t',58,110,'case "pdf":   …50 lines','m'],['t',58,134,'case "json":  ← edit again','kx']],
good:[['b',6,66,74,38,'Controller','n'],['a',80,85,104,85],['b',106,62,84,46,'Exporter','i'],['a',190,74,214,32,'','k'],['a',190,85,214,85,'','k'],['a',190,96,214,138],['b',216,16,78,32,'CSV','v'],['b',216,69,78,32,'Excel','v'],['b',216,122,78,32,'PDF','v'],['t',148,128,'+ JSON = 1 class','s','middle']]},
before:String.raw`public function export(array $rows, string $format): string
{
    switch ($format) {
        case 'csv':   /* 30 lines */ break;
        case 'excel': /* 40 lines */ break;
        case 'pdf':   /* 50 lines */ break;   // JSON next month = edit this again
    }
}`,
after:String.raw`interface Exporter
{
    public function export(iterable $rows): string;   // returns the file path
    public function extension(): string;
}

final class CsvExporter implements Exporter
{
    public function export(iterable $rows): string
    {
        $path = tempnam(sys_get_temp_dir(), 'report');
        $out = fopen($path, 'w') ?: throw new RuntimeException("Cannot write {$path}");
        foreach ($rows as $row) {
            fputcsv($out, $row);
        }
        fclose($out);
        return $path;
    }

    public function extension(): string { return 'csv'; }
}

final class PdfExporter implements Exporter { /* same two methods, uses Dompdf */ }

final class ReportService
{
    public function __construct(private ReportRepository $reports) {}

    public function export(Exporter $exporter): string     // ★ receives ANY strategy
    {
        return $exporter->export($this->reports->rows());   // ★ never asks which one it got
    }
}

// The strategies are swappable: ReportService never changes.
$service->export(new CsvExporter());
$service->export(new PdfExporter());
$service->export(new JsonExporter());   // next month: one new class, zero edits

// In a test: no real files at all
$service->export(new InMemoryExporter());

// Note what is NOT here: deciding which exporter matches the user's "pdf" string.
// That is a different job, with its own pattern: see Simple Factory.`},
{
id:'adapter', name:'Adapter', fam:'str', famName:'Structure',
hook:'A travel plug: your charger, their wall socket.',
rule:"A third-party class has the wrong shape and you can't edit it → wrap it in a class that speaks YOUR interface.",
pain:'The SMS provider SDK is called directly in 12 places. Switching provider means editing 12 files.',
fix:'Your app only knows SmsSender. One adapter class talks to the SDK. Switching = one new adapter.',
smells:['A vendor SDK is called directly all over your code','"We might switch provider" is said in a meeting','The SDK returns false / status arrays instead of throwing'],
job:'You send SMS through Twilio today. Management wants to try Vonage next quarter.',
seen:['Laravel Storage over Flysystem adapters (S3, local, FTP)','Mail transports','Your own payment / SMS gateways'],
test:'Your code calls the Twilio SDK directly in 12 controllers. Next quarter you may switch to another SMS provider.',
diagram:{bad:[['b',6,14,80,26,'Controller','n'],['b',6,72,80,26,'Job','n'],['b',6,130,80,26,'Command','n'],['a',86,27,200,78,'','x'],['a',86,85,200,85,'','x'],['a',86,143,200,92,'','x'],['b',202,62,92,46,'Twilio SDK','x'],['t',150,160,'switch = edit everywhere','kx','middle']],
good:[['b',6,64,62,40,'Your code','n'],['a',68,84,84,84],['b',86,62,70,44,'SmsSender','i'],['a',156,84,170,84,'','k'],['b',172,60,64,48,'Adapter','v'],['a',236,84,248,84],['b',250,62,46,44,'SDK','n'],['t',204,128,'translates','kv','middle'],['t',273,128,"can't edit",'s','middle']]},
before:String.raw`// in 12 different controllers and jobs:
$twilio = new \Twilio\Rest\Client(config('services.twilio.sid'), config('services.twilio.token'));
$twilio->messages->create($phone, ['from' => '+1555...', 'body' => $text]);`,
after:String.raw`interface SmsSender                                  // YOUR shape
{
    public function send(string $to, string $text): void;
}

final class TwilioSmsSender implements SmsSender      // ★ the adapter
{
    public function __construct(
        private \Twilio\Rest\Client $twilio,
        private string $from,
    ) {}

    public function send(string $to, string $text): void
    {
        $message = $this->twilio->messages->create($to, [   // ★ translate the call
            'from' => $this->from,
            'body' => $text,
        ]);

        if ($message->status === 'failed') {               // ★ translate failure into an exception
            throw new SmsFailed("SMS to {$to} failed: {$message->errorMessage}");
        }
    }
}

// AppServiceProvider: switching provider later = change this one binding
$this->app->bind(SmsSender::class, fn () => new TwilioSmsSender(
    new \Twilio\Rest\Client(config('services.twilio.sid'), config('services.twilio.token')),
    config('services.twilio.from'),
));

// Everywhere else:
public function __construct(private SmsSender $sms) {}
$this->sms->send($user->phone, 'Your report is ready.');`},
{
id:'decorator', name:'Decorator', fam:'str', famName:'Structure',
hook:"A phone case: it's still a phone, now it's also shockproof.",
rule:'Add behaviour (cache, log, retry) around a class without editing it → wrap it in a class with the SAME interface.',
pain:'To add caching you open a working, tested class and mix cache code into its SQL.',
fix:'A wrapper with the same interface adds caching, then passes the call inside. The original is untouched.',
smells:['You need caching / logging / retry around something that works','Constructor flags like $withCache, $withLogging','Different environments need different extras'],
job:"School statistics take 3 seconds of SQL. You want a 10-minute cache, but not in local dev.",
seen:['Laravel container $app->extend()','Cached repositories','HTTP client middleware (retry, log)'],
test:'A statistics query takes 3 seconds. You want caching around it, without editing the class, and no cache in local dev.',
diagram:{bad:[['b',40,16,220,140,'','x'],['t',58,42,'class DbSchoolStats','m'],['t',58,68,'  heavy SQL …','m'],['t',58,94,'  + if ($cache…) ← edited','kx'],['t',58,120,'  + log …          ← edited','kx']],
good:[['b',6,74,58,30,'Caller','n'],['a',64,89,86,89,'','k'],['b',88,18,206,138,'','v'],['t',100,40,'CachedSchoolStats','kv'],['t',100,58,'same interface','s'],['b',112,72,158,56,'DbSchoolStats','n'],['t',191,146,'untouched inside','s','middle']]},
before:String.raw`final class DbSchoolStats
{
    public function forSchool(int $schoolId): array
    {
        if (config('stats.cache') && Cache::has("stats:{$schoolId}")) {   // cache code mixed in
            return Cache::get("stats:{$schoolId}");
        }
        // ...heavy SQL...
    }
}`,
after:String.raw`interface SchoolStats
{
    public function forSchool(int $schoolId): array;
}

final class DbSchoolStats implements SchoolStats { /* heavy SQL only, never edited */ }

final class CachedSchoolStats implements SchoolStats          // ★ same interface...
{
    public function __construct(
        private SchoolStats $inner,                             // ★ ...holds one inside
        private \Illuminate\Contracts\Cache\Repository $cache,
    ) {}

    public function forSchool(int $schoolId): array
    {
        return $this->cache->remember(
            "school-stats:{$schoolId}",
            600,
            fn () => $this->inner->forSchool($schoolId),         // ★ add caching, pass the call in
        );
    }
}

// AppServiceProvider
$this->app->bind(SchoolStats::class, DbSchoolStats::class);

if (! $this->app->isLocal()) {
    $this->app->extend(SchoolStats::class, fn (SchoolStats $stats, $app) =>
        new CachedSchoolStats($stats, $app['cache.store']));
}`},
{
id:'observer', name:'Observer', fam:'beh', famName:'Behaviour',
hook:'YouTube subscribe: the channel uploads once, every subscriber gets notified.',
rule:'When one thing happens and many things must react → fire an event; each reaction is its own listener.',
pain:'register() calls the mailer, billing, CRM and analytics. Every new reaction means editing register().',
fix:'register() fires UserRegistered and knows nobody. A new reaction = a new listener.',
smells:['One method calls 4+ unrelated services after the main work','"Also, when X happens, we should…" keeps coming','The core action fails because a side-effect (email) failed'],
job:'After sign-up: welcome email, start trial, sync CRM, track analytics. More coming.',
seen:['Laravel events + listeners','Eloquent model observers (created, updated)','Webhooks'],
test:'After a user signs up you send a welcome email, start a trial and sync the CRM. Marketing wants two more reactions.',
diagram:{bad:[['b',10,62,96,44,'register()','x'],['a',106,74,196,24,'','x'],['a',106,80,196,64,'','x'],['a',106,88,196,104,'','x'],['a',106,96,196,144,'','x'],['b',198,10,96,26,'Mailer','n'],['b',198,51,96,26,'Billing','n'],['b',198,91,96,26,'CRM','n'],['b',198,131,96,26,'Analytics','n'],['t',58,130,'knows everyone','kx','middle']],
good:[['b',4,66,70,36,'register()','n'],['a',74,84,92,84],['b',94,62,90,44,'UserRegistered','v'],['a',184,76,206,28,'','k'],['a',184,84,206,84,'','k'],['a',184,92,206,140,'','d'],['b',208,14,88,28,'SendWelcome','n'],['b',208,70,88,28,'StartTrial','n'],['b',208,126,88,28,'+ new one','i'],['t',39,124,'knows nobody','s','middle']]},
before:String.raw`public function register(array $data): User
{
    $user = User::create($data);
    Mail::to($user)->send(new WelcomeMail());     // if the mail server is down,
    $this->billing->startTrial($user);            // registration fails too
    $this->crm->sync($user);
    $this->analytics->track('signup', $user->id); // + 2 more next month
    return $user;
}`,
after:String.raw`final class UserRegistered                                 // the event: just data
{
    public function __construct(public readonly int $userId) {}
}

public function register(array $data): User
{
    return DB::transaction(function () use ($data) {
        $user = User::create($data);
        event(new UserRegistered($user->id));             // ★ ring the bell, know nobody
        return $user;
    });
}

final class SendWelcomeEmail implements ShouldQueue      // ★ one reaction = one listener
{
    public bool $afterCommit = true;                     // never email a user that was rolled back
    public int $tries = 5;

    public function handle(UserRegistered $event): void
    {
        Mail::to(User::findOrFail($event->userId))->send(new WelcomeMail());
    }
}

// AppServiceProvider::boot() — a new reaction is one new line here
Event::listen(UserRegistered::class, SendWelcomeEmail::class);
Event::listen(UserRegistered::class, StartFreeTrial::class);
Event::listen(UserRegistered::class, SyncToCrm::class);`},
{
id:'facade', name:'Facade', fam:'str', famName:'Structure',
hook:'Hotel reception: you talk to one desk, they call housekeeping, the kitchen and the taxi.',
rule:'A multi-step job that touches many services, needed from many places → one class with one method that runs it all.',
pain:'Web, API and CSV import each repeat the same 4 steps. The import forgot step 3.',
fix:'One EnrollStudent class owns the steps. Every caller is one line, and can’t forget a step.',
smells:['The same 3–5 service calls are copied in several controllers/jobs','A bug where one copy forgot a step','New developers ask "what do I call to do X?"'],
job:'Enrolling a student: create user, assign class, open billing, send welcome. From web, API and CSV import.',
seen:['Laravel "action" / service classes','Application::handle() in frameworks','Not Laravel’s Cache:: (that’s a Proxy)'],
test:'Creating a user, assigning a class, opening billing and sending a welcome email is copied in 3 places, and one copy forgot billing.',
diagram:{bad:[['b',6,14,64,26,'Web','n'],['b',6,72,64,26,'API','n'],['b',6,130,64,26,'Import','n'],['a',70,27,218,22,'','x'],['a',70,27,218,62,'','x'],['a',70,85,218,62,'','x'],['a',70,85,218,102,'','x'],['a',70,143,218,102,'','x'],['a',70,143,218,142,'','x'],['b',220,10,74,24,'Users','n'],['b',220,50,74,24,'Classes','n'],['b',220,90,74,24,'Billing','n'],['b',220,130,74,24,'Mail','n']],
good:[['b',4,14,56,24,'Web','n'],['b',4,72,56,24,'API','n'],['b',4,130,56,24,'Import','n'],['a',60,26,104,74],['a',60,84,104,84],['a',60,142,104,94],['b',106,62,90,44,'EnrollStudent','v'],['a',196,72,220,22,'','k'],['a',196,80,220,62,'','k'],['a',196,88,220,102,'','k'],['a',196,96,220,142,'','k'],['b',222,10,72,24,'1 Users','n'],['b',222,50,72,24,'2 Classes','n'],['b',222,90,72,24,'3 Billing','n'],['b',222,130,72,24,'4 Mail','n']]},
before:String.raw`// WebController, ApiController and ImportStudentsJob each contain:
$user = $users->createStudent($name, $email);
$classes->assign($user, $classId);
$billing->openAccount($user, $plan);    // ← the import job forgot this line
$mailer->welcome($user);`,
after:String.raw`final class EnrollStudent                             // ★ the one front door
{
    public function __construct(
        private Users $users,
        private Classes $classes,
        private Billing $billing,
        private Mailer $mailer,
    ) {}

    public function handle(EnrollmentData $data): Student
    {
        return DB::transaction(function () use ($data) {
            $student = $this->users->createStudent($data->name, $data->email);
            $this->classes->assign($student, $data->classId);
            $this->billing->openAccount($student, $data->plan);

            DB::afterCommit(fn () => $this->mailer->welcome($student));  // only if all of it saved

            return $student;
        });
    }
}

// WebController, ApiController, ImportStudentsJob — all the same single line:
$student = $enrollStudent->handle($data);               // ★ can't forget a step`},
{
id:'template', name:'Template Method', fam:'beh', famName:'Behaviour',
hook:'A recipe card with blanks: the steps are printed, you fill in "filling".',
rule:'Several classes run the same steps in the same order, only some steps differ → parent locks the order, children fill the gaps.',
pain:'3 importers copy the same 5 steps. A fix to validation is made in one and forgotten in the others.',
fix:'One parent with a final import(). Each importer only writes the 2 steps that differ.',
smells:['Several classes with near-identical methods, small differences inside','A bug fix that had to be copied to 3 classes','Someone skipped a step (validation, logging) in one copy'],
job:'Grades arrive from 3 school systems: different file format and column names, same import process.',
seen:['Laravel FormRequest (you fill rules(), authorize())','Base Command / Job classes','PHPUnit setUp() / tearDown()'],
test:'Grades come from 3 school systems. All imports read → map → validate → save → log; only "read" and "map" differ.',
diagram:{bad:[['b',10,14,280,40,'','x'],['t',22,38,'SystemA: read map validate save log','m'],['b',10,64,280,40,'','x'],['t',22,88,'SystemB: read map validate save log','m'],['b',10,114,280,40,'','x'],['t',22,138,'SystemC: read map valid… (forgot log)','kx']],
good:[['b',4,14,292,62,'','i'],['t',14,30,'final import()','kv'],['b',12,40,52,28,'read','v'],['b',70,40,52,28,'map','v'],['b',128,40,52,28,'validate','n'],['b',186,40,48,28,'save','n'],['b',240,40,48,28,'log','n'],['b',20,120,110,30,'SystemAImport','n'],['b',150,120,110,30,'SystemBImport','n'],['a',60,120,40,72,'','k'],['a',100,120,96,72,'','k'],['t',220,108,'fill only 2 steps','s','middle']]},
before:String.raw`final class SystemAImport { public function import($file) { /* read, map, validate, save, log */ } }
final class SystemBImport { public function import($file) { /* read, map, validate, save, log */ } }
final class SystemCImport { public function import($file) { /* read, map, validate, save */ } }  // forgot log`,
after:String.raw`abstract class GradeImport
{
    final public function import(string $path): int           // ★ the locked recipe
    {
        $raw  = $this->read($path);                            // differs
        $rows = array_map(fn (array $r) => $this->map($r), $raw);  // differs
        $this->validate($rows);                                // same for all
        DB::transaction(fn () => Grade::insert($rows));        // same for all
        Log::info('grades.imported', ['source' => static::class, 'rows' => count($rows)]);
        return count($rows);
    }

    abstract protected function read(string $path): array;     // ★ must fill in
    abstract protected function map(array $row): array;        // ★ must fill in

    private function validate(array $rows): void
    {
        foreach ($rows as $i => $row) {
            if (! is_numeric($row['score']) || $row['score'] < 0 || $row['score'] > 100) {
                throw new InvalidImport("Row {$i}: score must be 0–100.");
            }
        }
    }
}

final class SystemAImport extends GradeImport
{
    protected function read(string $path): array { return array_map('str_getcsv', file($path)); }
    protected function map(array $row): array    { return ['student_id' => $row[0], 'score' => $row[2]]; }
}`},
{
id:'builder', name:'Builder', fam:'cre', famName:'Creation',
hook:'Ordering at Subway: bread, then fillings, then sauce; the cashier checks it at the end.',
rule:'An object with many optional parts and rules that involve several parts → set parts step by step, check everything once in build().',
pain:'A constructor with 7 arguments, half of them null. Nobody knows what the 4th one is.',
fix:'Named steps in any order. build() checks the rules that need several fields, then creates a locked object.',
smells:['Constructor with 5+ parameters, many nullable','Rules like "if A is set, B must be…"','The object is filled in over several screens or steps'],
job:'A search API with optional filters: school, subjects, date range, page size. "from" must be before "to".',
seen:['Laravel Query Builder (->where()->get())','MailMessage (->line()->action())','Http::withToken()->timeout()->post()'],
test:'A search has 8 optional filters set from different screens, and "date from" must be before "date to".',
diagram:{bad:[['b',14,50,272,70,'','x'],['t',28,78,'new Search(12, null, null,','m'],['t',28,100,"  'math', null, 25, true)",'m'],['t',150,146,'what is the 4th argument?','kx','middle']],
good:[['b',6,12,96,24,'school(12)','n'],['b',6,44,96,24,'subjects(…)','n'],['b',6,76,96,24,'between(…)','n'],['b',6,108,96,24,'perPage(25)','n'],['t',54,150,'any order','s','middle'],['a',102,72,128,72],['b',130,48,72,48,'build()','v'],['t',166,112,'checks all','s','middle'],['a',202,62,224,34],['a',202,82,224,112,'','k'],['b',226,18,70,30,'error','x'],['b',226,96,70,34,'Search','v']]},
before:String.raw`$search = new EvaluationSearch(12, null, null, ['math'], null, 25, true);
// which argument is "from"? which is "to"? is from < to? nobody checks`,
after:String.raw`final class EvaluationSearchBuilder
{
    private ?int $schoolId = null;
    private array $subjects = [];
    private ?string $from = null;
    private ?string $to = null;
    private int $perPage = 25;

    public function school(int $id): self              { $this->schoolId = $id; return $this; }
    public function subjects(string ...$s): self       { $this->subjects = $s; return $this; }
    public function between(string $from, string $to): self { $this->from = $from; $this->to = $to; return $this; }
    public function perPage(int $n): self              { $this->perPage = $n; return $this; }

    public function build(): EvaluationSearch           // ★ every rule checked here, once
    {
        if ($this->from !== null && $this->from > $this->to) {
            throw new InvalidArgumentException('"from" must be before "to".');
        }
        if ($this->perPage < 1 || $this->perPage > 100) {
            throw new InvalidArgumentException('perPage must be between 1 and 100.');
        }

        return new EvaluationSearch(                    // readonly: can't become invalid later
            $this->schoolId, $this->subjects, $this->from, $this->to, $this->perPage,
        );
    }
}

$search = (new EvaluationSearchBuilder())               // ★ readable, any order
    ->school(12)
    ->subjects('math', 'science')
    ->between('2026-09-01', '2026-10-31')
    ->build();`},
{
id:'state', name:'State', fam:'beh', famName:'Behaviour',
hook:'A traffic light: what you may do depends on the colour, and the light changes itself.',
rule:'What an object is allowed to do depends on its status → one class per status; each knows its allowed moves.',
pain:'submit(), approve(), reject(), publish() each start with the same if ($status === …) ladder.',
fix:'Draft, Submitted, Approved are classes. The report asks its current state; no ifs anywhere.',
smells:['if ($this->status === …) repeated in many methods','Bugs like "approved a draft" or "edited a published report"','A status flow diagram exists on a whiteboard'],
job:'A report goes Draft → Submitted → Approved, or back to Draft when rejected with a reason.',
seen:['spatie/laravel-model-states','Order / payment / subscription lifecycles','Approval workflows'],
test:'Reports go draft → submitted → approved, or back to draft when rejected. Every method starts with an if on $status.',
diagram:{bad:[['b',10,14,135,64,'','x'],['t',20,36,'submit()','m'],['t',20,58,' if status ==…','kx'],['b',155,14,135,64,'','x'],['t',165,36,'approve()','m'],['t',165,58,' if status ==…','kx'],['b',10,90,135,64,'','x'],['t',20,112,'reject()','m'],['t',20,134,' if status ==…','kx'],['b',155,90,135,64,'','x'],['t',165,112,'publish()','m'],['t',165,134,' if status ==…','kx']],
good:[['b',4,16,82,30,'Draft','v'],['b',109,16,82,30,'Submitted','v2'],['b',214,16,82,30,'Approved','v'],['a',86,31,107,31,'','k'],['a',191,31,212,31,'','k'],['t',96,60,'submit','s','middle'],['t',202,60,'approve','s','middle'],['b',109,104,82,36,'Report','n'],['a',150,104,150,50],['t',158,82,'current','s'],['p','M150 46 C 110 92, 60 92, 45 50','d'],['t',60,98,'reject','s','middle']]},
before:String.raw`public function approve(): void
{
    if ($this->status === 'draft')     { throw new LogicException('Submit it first.'); }
    if ($this->status === 'approved')  { throw new LogicException('Already approved.'); }
    if ($this->status === 'submitted') { $this->status = 'approved'; }
    // ...and the same ladder in submit(), reject(), publish()
}`,
after:String.raw`abstract class ReportState                          // default: everything forbidden
{
    abstract public function name(): string;
    public function submit(Report $r): void              { $this->deny('submit'); }
    public function approve(Report $r): void             { $this->deny('approve'); }
    public function reject(Report $r, string $why): void { $this->deny('reject'); }

    private function deny(string $action): never
    {
        throw new IllegalTransition("Cannot {$action} a {$this->name()} report.");
    }
}

final class Draft extends ReportState
{
    public function name(): string { return 'draft'; }
    public function submit(Report $r): void { $r->moveTo(new Submitted()); }    // ★ allowed here
}

final class Submitted extends ReportState
{
    public function name(): string { return 'submitted'; }
    public function approve(Report $r): void { $r->moveTo(new Approved()); }
    public function reject(Report $r, string $why): void
    {
        $r->rejectionReason = $why;
        $r->moveTo(new Draft());
    }
}

final class Approved extends ReportState { public function name(): string { return 'approved'; } }

final class Report
{
    public ?string $rejectionReason = null;
    public function __construct(private ReportState $state = new Draft()) {}

    public function submit(): void  { $this->state->submit($this); }        // ★ no if anywhere
    public function approve(): void { $this->state->approve($this); }
    public function reject(string $why): void { $this->state->reject($this, $why); }
    public function moveTo(ReportState $s): void { $this->state = $s; }
}`},
{
id:'command', name:'Command', fam:'beh', famName:'Behaviour',
hook:'A restaurant ticket: the order is written down, so it can wait in line, be retried, or be torn up.',
rule:'An action you want to run later, queue, retry, log or undo → turn the action into an object.',
pain:'The controller runs a 40-second AI analysis. The user waits, the request times out, the work is lost.',
fix:'The action becomes a job object. The controller queues it and answers instantly; a worker runs and retries it.',
smells:['Slow work inside an HTTP request','"Retry it if the API fails" requirements','Undo / redo, or an audit trail of actions'],
job:'After a survey closes, send all responses to an AI service for analysis (slow, can fail).',
seen:['Laravel Jobs (dispatch(), queues)','Artisan commands','Editor undo / redo'],
test:'After a survey closes, an AI analysis takes 40 seconds and sometimes fails. Right now it runs inside the HTTP request.',
diagram:{bad:[['b',8,62,76,44,'Controller','n'],['a',84,84,116,84],['b',118,58,90,52,'AI: 40 sec','x'],['a',208,84,226,84,'','x'],['b',228,62,66,44,'timeout','x'],['t',150,140,'user waits, work is lost','kx','middle']],
good:[['b',4,62,68,40,'Controller','n'],['a',72,82,96,82,'','k'],['b',98,62,72,40,'AnalyzeJob','v'],['a',170,82,192,82],['b',194,62,46,40,'Queue','n'],['a',240,82,252,82],['b',254,62,42,40,'Worker','n'],['t',38,124,'202 at once','s','middle'],['t',230,124,'retries x3','s','middle']]},
before:String.raw`public function close(Survey $survey, AiAnalyzer $ai)
{
    $survey->close();
    $analysis = $ai->analyze($survey->responses);   // 40 seconds; timeout = lost
    $survey->saveAnalysis($analysis);
    return back();
}`,
after:String.raw`final class AnalyzeSurveyResponses implements ShouldQueue   // ★ the action as an object
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 3;
    public array $backoff = [30, 120, 600];                     // wait longer after each failure

    public function __construct(public readonly int $surveyId) {}  // ★ only data, so it can travel

    public function handle(AiAnalyzer $ai, SurveyRepository $surveys): void   // dependencies at run time
    {
        $survey = $surveys->findOrFail($this->surveyId);
        $surveys->saveAnalysis($survey, $ai->analyze($survey->responses()));
    }

    public function failed(Throwable $e): void                  // after the last retry: never silent
    {
        Log::error('survey.analysis.failed', ['survey' => $this->surveyId, 'error' => $e->getMessage()]);
    }
}

public function close(Survey $survey)
{
    DB::transaction(function () use ($survey) {
        $survey->close();
        AnalyzeSurveyResponses::dispatch($survey->id)->afterCommit();   // ★ queue it, answer now
    });

    return back()->with('status', 'Analysis started.');
}`},
{
id:'iterator', name:'Iterator', fam:'beh', famName:'Behaviour',
hook:"A playlist's Next button: you don't care if songs are on disk, in the cloud or on a CD.",
rule:'Callers need to loop over data, but how it’s stored or fetched may change → give them items one at a time, hide the rest.',
pain:'Every caller of the CRM API writes its own page=1, page=2, has_more loop, and loads everything into memory.',
fix:'One iterable class hides the pagination and yields one customer at a time. Callers just foreach.',
smells:['The same pagination / chunking loop copied in many places','Loading 100K rows into an array before processing','Callers know the internal shape of your collection'],
job:'A CRM API returns 100 customers per page. You sync 80,000 customers every night.',
seen:['Laravel Collection, LazyCollection','Model::lazyById(), cursor()','Stripe SDK autoPagingIterator()'],
test:'An external API returns 100 records per page. Three jobs each write their own page loop and load all records into memory.',
diagram:{bad:[['b',20,14,260,142,'','x'],['t',36,40,'$page = 1;','m'],['t',36,62,'do { $r = get(page) …','m'],['t',36,84,'  $all[] = …  ← memory','kx'],['t',36,106,'} while (has_more)','m'],['t',36,134,'copied in 3 jobs','kx']],
good:[['b',4,34,84,100,'','i'],['t',46,52,'pages, hidden','s','middle'],['b',14,62,64,16,'','n'],['b',14,84,64,16,'','n'],['b',14,106,64,16,'','n'],['a',88,84,106,84],['b',108,70,30,30,'1','v'],['b',142,70,30,30,'2','i'],['b',176,70,30,30,'3','i'],['a',206,84,222,84],['b',224,64,72,40,'foreach','n'],['t',157,124,'yield, one at a time','s','middle']]},
before:String.raw`// copied in 3 jobs:
$page = 1; $all = [];
do {
    $response = Http::get($crm.'/customers', ['page' => $page++]);
    $all = array_merge($all, $response->json('data'));   // 80,000 rows in memory
} while ($response->json('meta.has_more'));`,
after:String.raw`final class CrmCustomers implements IteratorAggregate        // ★ hides HOW they're fetched
{
    public function __construct(private \Illuminate\Http\Client\PendingRequest $http) {}

    public function getIterator(): Generator
    {
        $page = 1;

        do {
            $response = $this->http
                ->get('/customers', ['page' => $page++, 'per_page' => 100])
                ->throw();                                     // 4xx/5xx = exception, not empty data

            foreach ($response->json('data') as $customer) {
                yield $customer;                               // ★ one at a time, flat memory
            }
        } while ($response->json('meta.has_more') === true);
    }
}

$customers = new CrmCustomers(
    Http::baseUrl(config('services.crm.url'))->withToken(config('services.crm.token'))->retry(3, 500),
);

foreach ($customers as $customer) {                            // ★ pagination is invisible here
    Customer::updateOrCreate(['crm_id' => $customer['id']], ['email' => $customer['email']]);
}`},
{
id:'composite', name:'Composite', fam:'str', famName:'Structure',
hook:"Folders and files: a folder's size is the sum of what's inside, and folders can hold folders.",
rule:'Your data is a tree (parts inside wholes, any depth) → items and groups share one interface; a group asks its children.',
pain:'Every function over the survey checks "is this a section or a question?" and recurses by hand.',
fix:'Section and Question both answer maxScore(). A section just asks its children. Depth stops mattering.',
smells:['instanceof checks to tell a group from an item','Recursive functions copied for every calculation','"Groups can contain groups" in the requirements'],
job:'A survey has sections, sub-sections and questions. You need the max score, the question count, the rendering.',
seen:['Nested Blade components','Menus and category trees','Permission groups inside groups'],
test:'A survey has sections that contain questions and also other sections. Every calculation checks instanceof and recurses by hand.',
diagram:{bad:[['b',14,20,272,130,'','x'],['t',28,44,'foreach ($nodes as $n)','m'],['t',28,66,'  if ($n instanceof Section)','kx'],['t',28,88,'    foreach … if instanceof…','kx'],['t',28,110,'  else $total += $n->points','m'],['t',28,134,'copied for every calculation','kx']],
good:[['b',105,8,90,28,'Survey','v'],['a',130,36,70,60],['a',170,36,230,60],['b',20,62,100,28,'Section','v'],['b',180,62,100,28,'Q: Overall 10','n'],['a',50,90,40,114],['a',90,90,110,114],['b',4,116,72,28,'Q: 5','n'],['b',82,116,72,28,'Q: 5','n'],['t',230,130,'all answer','s','middle'],['t',230,144,'maxScore()','s','middle']]},
before:String.raw`function maxScore(array $nodes): int {
    $total = 0;
    foreach ($nodes as $node) {
        if ($node instanceof Section) { $total += maxScore($node->children); }   // and again in
        else { $total += $node->points; }                                        // countQuestions(),
    }                                                                            // render(), export()...
    return $total;
}`,
after:String.raw`interface SurveyNode                                   // ★ one shape for items and groups
{
    public function maxScore(): int;
}

final class Question implements SurveyNode                // a leaf
{
    public function __construct(public readonly string $text, private int $points) {}
    public function maxScore(): int { return $this->points; }
}

final class Section implements SurveyNode                 // a group of nodes
{
    /** @var list<SurveyNode> */
    private array $children = [];

    public function __construct(public readonly string $title) {}

    public function add(SurveyNode $node): self { $this->children[] = $node; return $this; }

    public function maxScore(): int
    {
        return array_sum(array_map(
            fn (SurveyNode $child) => $child->maxScore(),   // ★ no instanceof: just ask
            $this->children,
        ));
    }
}

$survey = (new Section('Teacher evaluation'))
    ->add((new Section('Classroom'))
        ->add(new Question('Explains clearly', 5))
        ->add(new Question('Manages time', 5)))
    ->add(new Question('Overall', 10));

$survey->maxScore();   // 20, at any depth`},
{
id:'container', name:'DI Container', fam:'cre', famName:'Creation',
hook:"A wall socket: your laptop doesn't build a power plant, it just plugs in.",
rule:"A class needs services → ask for them in the constructor; one place (the container) decides what you get.",
pain:"The class builds its own mailer with new and env(). You can't test it without sending real emails.",
fix:'The class lists what it needs. The container passes them in; a test passes fakes.',
smells:['new SomeService() or Something::instance() inside methods','Tests that send real emails / hit real APIs','"Only one" handled by a static Singleton'],
job:'An InvoiceSender needs a mailer and a logger. In tests you want a fake mailer.',
seen:['Laravel service container, constructor injection','$this->app->singleton()','Every modern framework'],
test:"A class creates its own mailer with new and env() inside its method. You can't test it without sending a real email.",
diagram:{bad:[['b',40,24,220,122,'','x'],['t',56,48,'InvoiceSender','m'],['t',56,74,'  new SmtpMailer(env(…))','kx'],['t',56,98,'  new FileLogger(…)','kx'],['t',56,128,'builds its own: untestable','kx']],
good:[['b',96,8,108,40,'Container','v'],['a',130,48,90,90,'','k'],['t',100,72,'passes in','s','end'],['b',30,92,120,34,'InvoiceSender','n'],['b',190,92,104,34,'FakeMailer','i'],['a',190,109,152,109,'','d'],['t',242,146,'in tests','s','middle']]},
before:String.raw`final class InvoiceSender
{
    public function send(Invoice $invoice): void
    {
        $mailer = new SmtpMailer(env('MAIL_HOST'));   // hidden dependency, real email in tests
        $mailer->send($invoice->email, new InvoiceMail($invoice));
    }
}`,
after:String.raw`final class InvoiceSender
{
    public function __construct(                               // ★ ask, don't build
        private Mailer $mailer,
        private \Psr\Log\LoggerInterface $log,
    ) {}

    public function send(Invoice $invoice): void
    {
        $this->mailer->send($invoice->email, new InvoiceMail($invoice));
        $this->log->info('invoice.sent', ['invoice' => $invoice->id]);
    }
}

// AppServiceProvider: the ONE place that decides what Mailer means
$this->app->singleton(Mailer::class, fn () => new SmtpMailer(config('mail.host')));   // ★ "only one", visibly

// Controller: Laravel builds InvoiceSender and fills its constructor
public function store(Invoice $invoice, InvoiceSender $sender) { $sender->send($invoice); }

// Test: no container needed, no real email
$mailer = new FakeMailer();
(new InvoiceSender($mailer, new \Psr\Log\NullLogger()))->send($invoice);
$this->assertCount(1, $mailer->sent);`},
{
id:'factory-method', name:'Factory Method', fam:'cre', famName:'Creation',
hook:'A franchise: HQ owns the process, each branch decides its local product.',
rule:'A parent class runs a process that needs an object, but each child needs a different one → leave a create…() method for the child.',
pain:'The base import has a switch on file extension to build the reader. A new format means editing the base class.',
fix:'The base calls createReader(). CsvImport and XlsxImport each return their own reader.',
smells:['A base class with a switch to decide which object to new','Subclasses that differ mainly in "which helper object"','"Add a new type" means editing the parent'],
job:'Students can be imported from CSV or Excel. The import process is the same; only the file reader differs.',
seen:['Laravel Manager: createRedisDriver(), createFileDriver()','Notification::toMail() returns your MailMessage','Test factories'],
test:'An import base class has a switch on file extension to decide which reader to create. Every new format edits the base class.',
diagram:{bad:[['b',24,20,252,130,'','x'],['t',40,44,'abstract class Import','m'],['t',40,70,'  match ($extension)','kx'],['t',40,92,"    'csv'  => new CsvReader","m"],['t',40,114,"    'xlsx' => new XlsxReader","m"],['t',40,138,'  + new format = edit parent','kx']],
good:[['b',10,10,280,56,'','n'],['t',22,30,'Import::run()','m'],['b',22,38,96,20,'createReader()','i'],['t',128,52,'→ foreach row → save','s'],['b',22,110,110,34,'CsvImport','v'],['b',168,110,110,34,'XlsxImport','v'],['a',77,110,70,62,'','k'],['a',223,110,100,62,'','k'],['t',150,94,'each child fills it','s','middle']]},
before:String.raw`abstract class StudentImport
{
    public function run(string $path): void
    {
        $reader = match (pathinfo($path, PATHINFO_EXTENSION)) {   // the parent decides... badly
            'csv'  => new CsvReader($path),
            'xlsx' => new XlsxReader($path),
        };
        foreach ($reader as $row) { /* save */ }
    }
}`,
after:String.raw`abstract class StudentImport
{
    final public function run(string $path): int             // the process: same for every format
    {
        $count = 0;
        foreach ($this->createReader($path) as $row) {       // ★ "give me a reader", don't care which
            Student::updateOrCreate(['code' => $row['code']], ['name' => $row['name']]);
            $count++;
        }
        return $count;
    }

    abstract protected function createReader(string $path): iterable;   // ★ the factory method
}

final class CsvStudentImport extends StudentImport
{
    protected function createReader(string $path): iterable
    {
        return new CsvRowReader($path);                       // ★ the child decides
    }
}

final class XlsxStudentImport extends StudentImport
{
    protected function createReader(string $path): iterable
    {
        return new XlsxRowReader($path);
    }
}`},
{
id:'manager', name:'Manager / Driver', fam:'cre', famName:'Creation',
hook:'Phone settings: pick Wi-Fi calling once, and every call uses it.',
rule:'One service with interchangeable backends chosen by config → a manager builds the configured driver once and reuses it.',
pain:'if (app()->isLocal()) new Ollama… else new Anthropic… is copied in every place that needs AI.',
fix:"config('ai.default') names the driver. The manager builds it once. Code just asks for driver().",
smells:['if ($env === …) new X else new Y in several places','A service with a "provider" setting in .env','Different backends in local, staging and production'],
job:'Local development uses a local LLM (Ollama). Production uses a hosted API. Same code everywhere.',
seen:['Cache::driver(), Mail::mailer(), Storage::disk()','Queue connections','Laravel\'s Illuminate\\Support\\Manager'],
test:'Local dev uses a local LLM, production uses a hosted API. The if/else that picks one is copied in 6 places.',
diagram:{bad:[['b',14,20,272,130,'','x'],['t',30,46,'if (app()->isLocal())','m'],['t',30,68,'  new OllamaClient(…)','m'],['t',30,90,'else','m'],['t',30,112,'  new AnthropicClient(…)','m'],['t',30,138,'copied in 6 places','kx']],
good:[['b',4,62,70,40,"config",'n'],['t',39,118,"'ollama'",'s','middle'],['a',74,82,96,82],['b',98,58,82,48,'AiManager','v'],['a',180,82,212,82,'','k'],['b',214,66,82,32,'Ollama','v'],['b',214,18,82,28,'Anthropic','i'],['b',214,118,82,28,'OpenAI','i'],['t',139,128,'built once','s','middle']]},
before:String.raw`// in 6 different services:
$ai = app()->isLocal()
    ? new OllamaClient('http://localhost:11434')
    : new AnthropicClient(config('services.anthropic.key'));`,
after:String.raw`final class AiManager extends \Illuminate\Support\Manager   // Laravel's own base class
{
    public function getDefaultDriver(): string
    {
        return $this->config->get('ai.default');           // ★ .env: AI_DRIVER=ollama
    }

    protected function createOllamaDriver(): AiClient        // ★ one method per driver
    {
        return new OllamaClient($this->config->get('ai.ollama.url'));
    }

    protected function createAnthropicDriver(): AiClient
    {
        return new AnthropicClient($this->config->get('ai.anthropic.key'));
    }
}

// AppServiceProvider
$this->app->singleton(AiManager::class, fn ($app) => new AiManager($app));

// Anywhere:
$summary = app(AiManager::class)->driver()->summarize($text);   // ★ config decides, built once
$check   = app(AiManager::class)->driver('anthropic')->summarize($text);   // or by name`},
{
id:'prototype', name:'Prototype', fam:'cre', famName:'Creation',
hook:'"Make a copy" of a Google Doc: start from a full copy, then change the title.',
rule:'You need "the same as this one, with small changes" → copy an existing object, deep-copy what it owns, share what it only points to.',
pain:'Rebuilding a 40-question survey by hand, or a copy that shares questions so editing the copy changes the original.',
fix:'Copy the survey row, deep-copy its questions and options, keep pointing to the same school and author.',
smells:['"Duplicate", "copy from last term", "use as template" buttons','Copies that accidentally change the original','Rebuilding big objects field by field'],
job:'Schools duplicate last term’s survey (40 questions, 160 options) and change the dates.',
seen:['Eloquent $model->replicate()','PHP clone + __clone()','"Duplicate" buttons in any admin panel'],
test:'Schools want a "Duplicate survey" button. Editing a question in the copy must never change the original.',
diagram:{bad:[['b',10,30,120,110,'','n'],['t',70,50,'original','s','middle'],['b',22,60,96,28,'questions','x'],['b',170,30,120,110,'','n'],['t',230,50,'copy','s','middle'],['a',170,74,120,74,'','x'],['t',150,124,'shared! edit one = both','kx','middle']],
good:[['b',4,20,118,100,'','n'],['t',63,38,'original','s','middle'],['b',16,48,94,26,'questions','v'],['b',178,20,118,100,'','n'],['t',237,38,'copy','s','middle'],['b',190,48,94,26,'own questions','v'],['a',122,61,176,61,'','k'],['t',150,52,'replicate','kv','middle'],['b',96,136,108,26,'School','n'],['a',63,120,120,136,'','d'],['a',237,120,180,136,'','d'],['t',150,130,'shared','s','middle']]},
before:String.raw`$copy = $original->replicate();
$copy->save();
// $copy has NO questions: replicate() copies the row only.
// Or worse: pointing the copy at the same question rows → editing one edits both.`,
after:String.raw`public function duplicate(Survey $original, string $newTitle): Survey
{
    return DB::transaction(function () use ($original, $newTitle) {    // all or nothing
        $copy = $original->replicate(['published_at']);      // ★ copy the row (not its relations)
        $copy->title = $newTitle;
        $copy->save();                                        // school_id, author_id: shared on purpose

        foreach ($original->questions()->with('options')->get() as $question) {
            $newQuestion = $copy->questions()->save($question->replicate());   // ★ deep copy owned children
            $newQuestion->options()->saveMany(
                $question->options->map(fn (Option $o) => $o->replicate()),
            );
        }

        return $copy;
    });
}`},
{
id:'bridge', name:'Bridge', fam:'str', famName:'Structure',
hook:'TV remotes and TVs: any remote works with any TV because they’re designed separately.',
rule:'A class varies in two independent ways (what × how) → two hierarchies, one holds the other. A + B classes, not A × B.',
pain:'InvoicePaidMail, InvoicePaidSms, OrderShippedMail, OrderShippedSms… every new channel multiplies the classes.',
fix:'A notification says WHAT. A channel decides HOW. One notification works on every channel.',
smells:['Class names that combine two words from two lists (PdfSalesReport)','Adding one option means adding N classes','Two things that change for different reasons'],
job:'Many notification types (invoice paid, order shipped…) sent over mail, SMS, database, Slack.',
seen:['Laravel Notifications + via() channels','Report × output format','Shape × renderer in graphics'],
test:'You have InvoicePaidMail, InvoicePaidSms, OrderShippedMail, OrderShippedSms, and Slack is coming.',
diagram:{bad:[['b',6,14,138,26,'InvoicePaidMail','x'],['b',156,14,138,26,'InvoicePaidSms','x'],['b',6,50,138,26,'ShippedMail','x'],['b',156,50,138,26,'ShippedSms','x'],['b',6,86,138,26,'RefundMail','x'],['b',156,86,138,26,'RefundSms','x'],['t',150,138,'+ Slack = 3 more classes','kx','middle']],
good:[['b',4,10,104,26,'Notification','i'],['b',14,46,94,24,'InvoicePaid','v'],['b',14,76,94,24,'OrderShipped','v'],['b',14,106,94,24,'Refund','v'],['b',192,10,104,26,'Channel','i'],['b',202,46,94,24,'mail','n'],['b',202,76,94,24,'sms','n'],['b',202,106,94,24,'+ slack','i'],['a',108,23,190,23,'','k'],['t',150,16,'via()','kv','middle'],['t',150,150,'3 + 3, not 3 × 3','s','middle']]},
before:String.raw`final class InvoicePaidMail { /* ... */ }
final class InvoicePaidSms  { /* ... */ }
final class OrderShippedMail { /* ... */ }
final class OrderShippedSms  { /* ... */ }
// Slack arrives → InvoicePaidSlack, OrderShippedSlack, ...`,
after:String.raw`final class InvoicePaid extends Notification              // WHAT to say: one class
{
    use Queueable;

    public function __construct(private Invoice $invoice) {}

    public function via(object $notifiable): array            // ★ HOW: chosen per user, not per class
    {
        return $notifiable->prefers_sms ? ['vonage', 'database'] : ['mail', 'database'];
    }

    public function toMail(object $notifiable): MailMessage
    {
        return (new MailMessage)
            ->subject("Invoice #{$this->invoice->number} paid")
            ->line('Thank you, your payment was received.');
    }

    public function toVonage(object $notifiable): VonageMessage
    {
        return (new VonageMessage)->content("Invoice #{$this->invoice->number} paid. Thank you.");
    }

    public function toArray(object $notifiable): array
    {
        return ['invoice_id' => $this->invoice->id];
    }
}

$user->notify(new InvoicePaid($invoice));                     // ★ any notification × any channel`},
{
id:'abstract-factory', name:'Abstract Factory', fam:'cre', famName:'Creation',
hook:'An IKEA collection: pick one style, and the table, chair and lamp all match.',
rule:'Several objects must come from the same family → one factory creates the whole family, so they can never be mixed.',
pain:'S3 storage with a database queue and a log mailer: pieces from different setups, wired by hand, easy to mix.',
fix:'Pick one kit (AWS or Local). Storage, queue and mailer all come from that kit and always match.',
smells:['Several new X() calls that must "go together"','Bugs from mixing a production piece with a dev piece','The same if ($env) repeated for 3+ related objects'],
job:'Production runs on AWS (S3, SQS, SES). Local dev uses disk, database queue and log mailer.',
seen:['Database connection + its SQL grammar + schema builder','Cloud provider SDK kits','UI themes (button + input + dialog)'],
test:'Production uses S3 + SQS + SES, local uses disk + database queue + log mailer. Someone wired S3 with the local mailer by mistake.',
diagram:{bad:[['b',20,20,80,30,'S3','n'],['b',110,20,80,30,'DB queue','n'],['b',200,20,80,30,'Log mail','n'],['t',150,90,'mixed by hand','kx','middle'],['t',150,112,'prod storage + dev mail?','kx','middle'],['b',14,10,272,50,'','x']],
good:[['b',8,8,134,28,'AwsKit','v'],['b',18,46,114,24,'S3','v'],['b',18,76,114,24,'SQS','v'],['b',18,106,114,24,'SES','v'],['b',158,8,134,28,'LocalKit','n'],['b',168,46,114,24,'Disk','n'],['b',168,76,114,24,'DB queue','n'],['b',168,106,114,24,'Log mail','n'],['t',150,152,'one choice, matching set','s','middle']]},
before:String.raw`$storage = app()->isProduction() ? new S3Storage(...)  : new DiskStorage(...);
$queue   = app()->isProduction() ? new SqsQueue(...)   : new DatabaseQueue(...);
$mailer  = app()->isProduction() ? new LogMailer(...)  : new SesMailer(...);   // ← swapped by mistake`,
after:String.raw`interface CloudKit                                         // ★ one method per family member
{
    public function storage(): FileStorage;
    public function queue(): MessageQueue;
    public function mailer(): Mailer;
}

final class AwsKit implements CloudKit
{
    public function __construct(private \Aws\Sdk $aws) {}

    public function storage(): FileStorage { return new S3Storage($this->aws->createS3()); }
    public function queue(): MessageQueue  { return new SqsQueue($this->aws->createSqs()); }
    public function mailer(): Mailer       { return new SesMailer($this->aws->createSesV2()); }
}

final class LocalKit implements CloudKit
{
    public function storage(): FileStorage { return new DiskStorage(storage_path('app')); }
    public function queue(): MessageQueue  { return new DatabaseQueue(DB::connection()); }
    public function mailer(): Mailer       { return new LogMailer(Log::channel('mail')); }
}

// AppServiceProvider: the ONE decision
$this->app->singleton(CloudKit::class, fn ($app) => $app->isProduction()
    ? new AwsKit(new \Aws\Sdk(['region' => config('services.aws.region'), 'version' => 'latest']))
    : new LocalKit());                                          // ★ everything below matches

$kit = app(CloudKit::class);
$kit->storage()->put('reports/42.pdf', $pdf);
$kit->queue()->push(new ReportReady(42));`}
];

const EXTRA = [
{
id:'simple-factory', name:'Simple Factory', fam:'cre', famName:'Creation',
hook:'A vending machine: press B4 and it hands you the right snack.',
rule:'Turning raw input (a string, a payload) into the right object is copied around → put that decision and the building in ONE place.',
pain:'The if/else that turns a webhook "type" into an event object is copied in the controller and a replay command. The copy forgot refunds, so they were silently skipped.',
fix:'WebhookEventFactory::fromPayload() is the only place that reads the type and builds the event. An unknown type throws instead of being ignored.',
smells:['A switch where each branch only says new X(), and it is copied in 2+ places','Objects built from raw arrays, with the field names repeated everywhere','A default branch that silently ignores or guesses'],
job:'A payment provider sends webhooks: payment succeeded, payment failed, refund created. A controller, a replay command and the tests all turn them into event objects.',
seen:['Response::json(), Carbon::parse()','Request::create(), Money::egp()','Often picks a Strategy: the factory chooses, the strategy works'],
test:'Payment webhooks arrive with a "type" field. The if/else that turns each type into the right event object is copied in the controller and a replay command, and one copy forgot refunds.',
vs:{id:'strategy', name:'Strategy', rows:[
  ['Answers','Which object do I build from this input?','How is the job done?'],
  ['Looks like','One class with one match','Several classes behind one interface'],
  ['Add an option','One new line in the match','One new class, no edits'],
  ['Inside the switch','Each branch only says new X()','Each branch does the work'],
  ['Together','The factory picks…','…the strategy that does the work'],
]},
diagram:{bad:[['b',6,14,150,40,'','x'],['t',16,38,'Controller: if type…','m'],['b',6,64,150,40,'','x'],['t',16,88,'Replay: if type…','m'],['b',6,114,150,40,'','x'],['t',16,138,'forgot refund ✗','kx'],['t',230,84,'copies drift','kx','middle'],['t',230,104,'refunds skipped','kx','middle']],
good:[['b',4,14,62,24,'Controller','n'],['b',4,72,62,24,'Replay','n'],['b',4,130,62,24,'Tests','n'],['a',66,26,98,72],['a',66,84,98,84],['a',66,142,98,96],['b',100,60,96,48,'fromPayload()','v'],['a',196,72,214,30,'','k'],['a',196,84,214,84,'','k'],['a',196,96,214,136],['b',216,16,80,28,'Succeeded','n'],['b',216,70,80,28,'Failed','n'],['b',216,122,80,28,'throws','x']]},
before:String.raw`// WebhookController:
if ($payload['type'] === 'payment.succeeded') {
    $event = new PaymentSucceeded($payload['data']['id'], $payload['data']['amount']);
} elseif ($payload['type'] === 'payment.failed') {
    $event = new PaymentFailed($payload['data']['id'], $payload['data']['failure_message']);
}
// ReplayWebhooksCommand: the same if/else, copied... and it forgot 'refund.created',
// so replayed refunds were silently skipped.`,
after:String.raw`final class WebhookEventFactory
{
    public static function fromPayload(array $payload): WebhookEvent
    {
        if (!isset($payload['data'])) {
            throw new InvalidWebhook('Payload has no data.');
        }
        $data = $payload['data'];

        return match ($payload['type'] ?? null) {            // ★ the ONE place that decides
            'payment.succeeded' => new PaymentSucceeded(       // ★ and knows how to build each one
                paymentId: $data['id'],
                amount: new Money((int) $data['amount'], strtoupper($data['currency'])),
            ),
            'payment.failed' => new PaymentFailed(
                paymentId: $data['id'],
                reason: $data['failure_message'] ?? 'unknown',
            ),
            'refund.created' => new RefundCreated(
                refundId: $data['id'],
                paymentId: $data['payment_id'],
            ),
            default => throw new UnknownWebhookType(          // ★ never silently ignored
                'Unknown webhook type [' . ($payload['type'] ?? 'missing') . '].'
            ),
        };
    }
}

// WebhookController, ReplayWebhooksCommand and the tests: the same line
$event = WebhookEventFactory::fromPayload($request->json()->all());
event($event);

// Note: PaymentSucceeded and RefundCreated are NOT interchangeable strategies.
// They hold different data. The pattern here is only about building the right one.`},
{
id:'null-object', name:'Null Object', fam:'beh', famName:'Behaviour',
hook:'A muted microphone: the meeting runs normally, your mic just sends nothing.',
rule:'"Nothing" is a NORMAL case (no coupon, no logger) → pass an object that safely does nothing, instead of null.',
pain:'if ($coupon !== null) is copied in the order, invoice, receipt and report. One place forgot: "Call to a member function on null".',
fix:'NoDiscount returns the total unchanged. Everyone just calls apply(). There is nothing to forget.',
smells:['The same null check in many places','"Call to a member function … on null" in your logs','An optional collaborator (logger, discount, notifier)'],
job:'Checkout with an optional coupon. The discount is used by the order, the invoice, the receipt and the reports.',
seen:['Psr\\Log\\NullLogger','Laravel "null" cache store, log channel, broadcaster','Symfony Console NullOutput'],
test:'A coupon is optional. "if ($coupon !== null)" appears in 4 places, and one place crashed with "call to a member function on null".',
diagram:{bad:[['b',10,14,135,40,'','n'],['t',20,38,'Order: if !== null','m'],['b',155,14,135,40,'','n'],['t',165,38,'Invoice: if !== null','m'],['b',10,64,135,40,'','n'],['t',20,88,'Receipt: if !== null','m'],['b',155,64,135,40,'','x'],['t',165,88,'Report: forgot!','kx'],['t',150,138,'Call to apply() on null','kx','middle']],
good:[['b',4,14,70,24,'Order','n'],['b',4,52,70,24,'Invoice','n'],['b',4,90,70,24,'Receipt','n'],['b',4,128,70,24,'Report','n'],['a',74,26,110,74],['a',74,64,110,80],['a',74,102,110,88],['a',74,140,110,94],['b',112,62,80,40,'Discount','i'],['a',192,74,214,34],['a',192,90,214,122,'','k'],['b',216,18,80,30,'Coupon','n'],['b',216,108,80,30,'NoDiscount','v'],['t',256,160,'does nothing, safely','s','middle']]},
before:String.raw`// copied in Order, Invoice, Receipt, MonthlyReport:
$total = $coupon !== null ? $coupon->apply($subtotal) : $subtotal;

// MonthlyReport forgot the check:
$total = $coupon->apply($subtotal);   // Error: Call to a member function apply() on null`,
after:String.raw`interface Discount
{
    public function apply(Money $subtotal): Money;
}

final class NoDiscount implements Discount
{
    public function apply(Money $subtotal): Money
    {
        return $subtotal;                                    // ★ does nothing, safely
    }
}

final class CouponDiscount implements Discount { /* percentage, expiry, limits */ }

// Decided ONCE, where the request is read:
$discount = $request->filled('coupon')
    ? $coupons->findValidOrFail($request->input('coupon'))   // a wrong coupon = 422, never ignored
    : new NoDiscount();                                      // ★ "no coupon" is normal

// Order, Invoice, Receipt, Report — no null checks anywhere:
$total = $discount->apply($cart->subtotal());

// ✗ Never use it for something whose absence is a BUG:
//   no payment method → throw, don't pass a "NoPayment" that charges nothing.`},
{
id:'value-object', name:'Value Object', fam:'cre', famName:'Creation',
hook:'A banknote: any 100-pound note equals any other, and nobody can edit what’s printed on it.',
rule:'A value with rules (money, email, date range) → a small immutable class that checks itself and is compared by value.',
pain:'Money as float: 0.1 + 0.2 ≠ 0.3, EGP added to USD, negative totals, and the same checks copied everywhere.',
fix:'Money stores integer piastres, refuses bad input, and add() returns a NEW Money. It can never be invalid.',
smells:['float for money','The same validation of a value (email, phone, range) in many places','Arrays like [\'amount\' => …, \'currency\' => …] passed around'],
job:'Invoices with prices, shipping and discounts, in more than one currency.',
seen:['CarbonImmutable','Laravel custom casts','brick/money, ramsey/uuid'],
test:'Prices are floats. A report shows 100.30000000001, and someone added a USD fee to an EGP total without any error.',
diagram:{bad:[['b',14,20,272,120,'','x'],['t',30,50,'0.1 + 0.2 = 0.30000000000000004','m'],['t',30,78,'100 EGP + 5 USD = 105 ???','kx'],['t',30,106,'$total = -20  (nobody checked)','kx']],
good:[['b',6,24,82,36,'100 EGP','v'],['t',100,47,'+','','middle'],['b',112,24,82,36,'20 EGP','v'],['a',194,42,212,42,'','k'],['b',214,20,82,44,'120 EGP','v'],['t',255,80,'a NEW object','s','middle'],['b',30,104,240,40,'','i'],['t',150,128,'readonly · checks itself · equal by value','s','middle']]},
before:String.raw`$total = $price + $shipping;           // 0.1 + 0.2 = 0.30000000000000004
$total = $priceEgp + $feeUsd;          // EGP + USD, no error
if ($total < 0) { /* this check is copied in 6 places, and missing in 2 */ }`,
after:String.raw`final class Money
{
    public function __construct(
        public readonly int $amount,                 // ★ smallest unit (piastres): exact math
        public readonly string $currency,
    ) {
        if ($amount < 0) {
            throw new InvalidArgumentException('Money cannot be negative.');   // ★ can't exist invalid
        }
        if (! preg_match('/^[A-Z]{3}$/', $currency)) {
            throw new InvalidArgumentException("Invalid currency [{$currency}].");
        }
    }

    public function add(Money $other): self
    {
        if ($other->currency !== $this->currency) {
            throw new LogicException("Cannot add {$other->currency} to {$this->currency}.");
        }

        return new self($this->amount + $other->amount, $this->currency);   // ★ a NEW object
    }

    public function equals(Money $other): bool
    {
        return $this->amount === $other->amount && $this->currency === $other->currency;
    }
}

// Eloquent cast: the column stays an integer, your code only ever sees Money
final class MoneyCast implements \Illuminate\Contracts\Database\Eloquent\CastsAttributes
{
    public function get(Model $model, string $key, mixed $value, array $attributes): Money
    {
        return new Money((int) $value, $attributes['currency']);
    }

    public function set(Model $model, string $key, mixed $value, array $attributes): array
    {
        return [$key => $value->amount, 'currency' => $value->currency];
    }
}

$total = $total->add($shipping);    // ★ always keep the return value`},
{
id:'event-dispatcher', name:'Event Dispatcher', fam:'beh', famName:'Behaviour',
hook:'A post office: senders drop letters at one counter, and never meet the people who receive them.',
rule:'Many parts of the app send events and many listen → one shared middleman; events are small data classes.',
pain:'Plain Observer: every service keeps its own listener list and subscribe() method, and listeners must hold a reference to each sender.',
fix:'One dispatcher. Any service dispatches; listeners register by event class. Queues and after-commit live in one place.',
smells:['subscribe() / notify() code duplicated in several services','A listener needs a reference to the exact service object','You want some listeners queued, some after commit'],
job:'Orders, Payments and Users all emit events. Billing listens to orders AND payments. Analytics listens to everything.',
seen:['Laravel event() + Event::listen()','Symfony EventDispatcher','PSR-14'],
test:'OrderService, PaymentService and UserService each have their own subscribe() and notify() code, and Billing must subscribe to all of them.',
diagram:{bad:[['b',6,14,110,40,'','n'],['t',16,30,'OrderService','m'],['t',16,46,'+ own list','kx'],['b',6,104,110,40,'','n'],['t',16,120,'PaymentService','m'],['t',16,136,'+ own list','kx'],['a',116,34,190,70,'','x'],['a',116,124,190,92,'','x'],['b',192,58,100,44,'Billing','n'],['t',242,124,'wired to each','kx','middle']],
good:[['b',4,20,82,26,'Orders','n'],['b',4,70,82,26,'Payments','n'],['b',4,120,82,26,'Users','n'],['a',86,33,108,74],['a',86,83,108,83],['a',86,133,108,92],['b',110,58,84,50,'Dispatcher','v'],['a',194,72,214,30,'','k'],['a',194,83,214,83,'','k'],['a',194,94,214,136,'','k'],['b',216,16,80,28,'Billing','n'],['b',216,69,80,28,'Analytics','n'],['b',216,122,80,28,'Receipts','n']]},
before:String.raw`final class PaymentService
{
    private array $observers = [];                     // the same code lives in OrderService,
    public function subscribe(PaymentObserver $o) {...} // UserService, RefundService...
    private function notify(Payment $p) {...}
}

$orders->subscribe($billing);                         // Billing must know every sender
$payments->subscribe($billing);`,
after:String.raw`final class EventDispatcher
{
    /** @var array<class-string, list<string|callable>> */
    private array $listeners = [];

    public function __construct(private \Psr\Container\ContainerInterface $container) {}

    public function listen(string $eventClass, string|callable $listener): void   // ★ by event TYPE
    {
        $this->listeners[$eventClass][] = $listener;
    }

    public function dispatch(object $event): void                                  // ★ one door for every sender
    {
        foreach ($this->listeners[$event::class] ?? [] as $listener) {
            $handler = is_string($listener)
                ? [$this->container->get($listener), 'handle']                    // built only when needed
                : $listener;

            $handler($event);                                                     // exceptions are never swallowed
        }
    }
}

final class PaymentReceived                                  // an event: just data
{
    public function __construct(public readonly int $invoiceId, public readonly int $amount) {}
}

// PaymentService knows only the dispatcher:
$events->dispatch(new PaymentReceived($invoice->id, $amount));

// Listeners never see PaymentService:
$events->listen(PaymentReceived::class, MarkInvoicePaid::class);
$events->listen(PaymentReceived::class, SendReceipt::class);`},
{
id:'generators', name:'Generators', fam:'beh', famName:'Behaviour',
hook:'A water tap: you get water as you need it, not a 10,000-litre tank delivered at once.',
rule:'Big data you loop over once → yield one item at a time; memory stays flat no matter the size.',
pain:'->get() loads 2 million rows into an array. The export dies at 60% with "Allowed memory size exhausted".',
fix:'A generator reads 1,000 rows at a time and yields them one by one. The loop looks the same; memory stays flat.',
smells:['"Allowed memory size … exhausted"','->get() / fetchAll() on a huge table just to loop once','Building a giant array only to pass it to a loop'],
job:'Every night, export 2 million evaluations to CSV.',
seen:['Laravel LazyCollection, lazyById(), cursor()','Iterator pattern: a generator IS an iterator','Streaming downloads'],
test:'A nightly export does DB::table("evaluations")->get() on 2 million rows and crashes with "Allowed memory size exhausted".',
diagram:{bad:[['b',20,14,180,100,'','x'],['t',110,56,'2,000,000 rows','kx','middle'],['t',110,78,'in memory at once','s','middle'],['a',200,64,226,64,'','x'],['b',228,44,66,40,'fatal','x'],['t',150,146,'dies at 60%','kx','middle']],
good:[['b',4,58,74,48,'DB','n'],['t',41,124,'1,000 per read','s','middle'],['a',78,82,104,82],['b',106,66,30,30,'1','v'],['b',140,66,30,30,'2','i'],['b',174,66,30,30,'3','i'],['a',204,82,222,82],['b',224,60,72,44,'fputcsv','n'],['t',155,46,'yield, pause, resume','s','middle'],['t',155,124,'memory stays flat','kv','middle']]},
before:String.raw`$rows = DB::table('evaluations')->get();     // 2,000,000 rows into memory
foreach ($rows as $row) {
    fputcsv($out, (array) $row);
}
// PHP Fatal error: Allowed memory size of 536870912 bytes exhausted`,
after:String.raw`function evaluations(PDO $pdo, int $chunk = 1000): Generator
{
    $lastId = 0;
    $query = $pdo->prepare(
        'SELECT id, school_id, score FROM evaluations WHERE id > :id ORDER BY id LIMIT :n'
    );

    do {
        $query->bindValue(':id', $lastId, PDO::PARAM_INT);
        $query->bindValue(':n', $chunk, PDO::PARAM_INT);
        $query->execute();
        $rows = $query->fetchAll(PDO::FETCH_ASSOC);        // at most 1,000 rows in memory

        foreach ($rows as $row) {
            yield $row;                                     // ★ hand out one, pause here
            $lastId = $row['id'];
        }
    } while (count($rows) === $chunk);                      // WHERE id > ? stays fast at row 2,000,000
}

$out = fopen($path, 'w') ?: throw new RuntimeException("Cannot write {$path}");
foreach (evaluations($pdo) as $row) {                      // ★ looks like a normal loop
    fputcsv($out, $row);
}
fclose($out);

// The Laravel one-liner for the same thing:
// Evaluation::lazyById(1000)->each(fn ($e) => fputcsv($out, $e->only('id', 'school_id', 'score')));`},
{
id:'command-bus', name:'Command Bus', fam:'beh', famName:'Behaviour',
hook:'A dispatch desk: you hand in a form, and the desk knows which department handles it.',
rule:'Split "what to do" (a data object) from "how" (a handler) → the same action runs from web, CLI or queue, with shared rules around it.',
pain:'The business logic lives in a controller. The scheduler and the import need it too, so it gets copied or called through HTTP.',
fix:'RecalculateSchoolStats is data; its handler holds the logic. Any entry point dispatches the same command.',
smells:['The same business action needed from HTTP, CLI and queue','Fat controllers full of business logic','You want one place for transactions / logging around every action'],
job:'"Recalculate school statistics" runs from an admin button, a nightly schedule, and after every import.',
seen:['Laravel Jobs + dispatch()','Symfony Messenger','league/tactician'],
test:'School statistics must be recalculated from an admin button, a nightly schedule and after imports. The logic lives in one controller.',
diagram:{bad:[['b',10,20,280,100,'','x'],['t',24,46,'StatsController::recalculate()','m'],['t',24,70,'  …all the business logic…','m'],['t',24,96,'  scheduler? import? → copy it','kx']],
good:[['b',4,14,62,24,'Button','n'],['b',4,72,62,24,'Schedule','n'],['b',4,130,62,24,'Import','n'],['a',66,26,90,74],['a',66,84,90,84],['a',66,142,90,94],['b',92,62,92,44,'Recalculate…','v'],['t',138,124,'just data','s','middle'],['a',184,84,204,84,'','k'],['b',206,66,32,36,'Bus','n'],['a',238,84,250,84,'','k'],['b',252,62,44,44,'Handler','n']]},
before:String.raw`final class StatsController
{
    public function recalculate(School $school, StatsCalculator $calc, StatsRepository $stats)
    {
        $stats->save($school->id, $calc->forSchool($school->id));   // the scheduler and the importer
        return back();                                               // need this too... copy it?
    }
}`,
after:String.raw`final class RecalculateSchoolStats                         // ★ the command: only data
{
    public function __construct(public readonly int $schoolId) {}
}

final class RecalculateSchoolStatsHandler                   // ★ the handler: logic + dependencies
{
    public function __construct(private StatsCalculator $calc, private StatsRepository $stats) {}

    public function handle(RecalculateSchoolStats $command): void
    {
        $this->stats->save($command->schoolId, $this->calc->forSchool($command->schoolId));
    }
}

final class CommandBus
{
    /** @param array<class-string, class-string> $handlers */
    public function __construct(
        private \Psr\Container\ContainerInterface $container,
        private array $handlers,
    ) {}

    public function dispatch(object $command): mixed
    {
        if (!isset($this->handlers[$command::class])) {
            throw new LogicException('No handler for ' . $command::class);   // wiring bugs fail loudly
        }
        $handler = $this->handlers[$command::class];

        return DB::transaction(                                              // ★ one place for shared rules
            fn () => $this->container->get($handler)->handle($command)
        );
    }
}

// Admin button, nightly schedule, after an import — the same line:
$bus->dispatch(new RecalculateSchoolStats($schoolId));`},
{
id:'outbox', name:'Transactional Outbox', fam:'beh', famName:'Behaviour',
hook:'A sealed envelope in the outgoing tray: it leaves only if the paperwork is filed, and the courier keeps trying until it’s delivered.',
rule:'Saving data AND calling an outside system must never get out of sync → write the message in the same DB transaction; a worker sends it and retries.',
pain:'Save, then call the API: the server crashes between the two lines. The data is saved; the partner never hears about it, and nobody knows.',
fix:'The message is a row saved in the same transaction. A worker sends unsent rows, retries failures, and logs them.',
smells:['"The order is saved but the email / webhook never went out"','Data save + external API call in the same request','Payments, partner syncs, webhooks that must never be lost'],
job:'When an evaluation is approved, the ministry’s API must be notified. Never lost, never twice.',
seen:['Symfony Messenger doctrine transport','Laravel afterCommit (closes half the gap)','Debezium / change data capture'],
test:'When an evaluation is approved you call a partner API right after saving. Sometimes the save succeeds but the partner is never notified.',
diagram:{bad:[['b',6,40,90,40,'save ✓','n'],['a',96,60,122,60,'','x'],['b',124,40,60,40,'crash','x'],['a',184,60,206,60,'','x'],['b',208,40,88,40,'API never','x'],['t',150,120,'saved, but the partner','kx','middle'],['t',150,138,"never hears. Nobody knows.",'kx','middle']],
good:[['b',4,14,140,104,'','i'],['t',74,32,'one transaction','s','middle'],['b',16,42,116,28,'save evaluation','n'],['b',16,78,116,28,'outbox row','v'],['a',144,92,170,92,'','k'],['b',172,72,56,40,'Worker','n'],['a',228,92,248,92,'','k'],['b',250,72,46,40,'API','n'],['t',212,138,'retries until sent','s','middle']]},
before:String.raw`$evaluation->update(['status' => 'approved']);
Http::post($ministryUrl, ['evaluation_id' => $evaluation->id]);
// crash, deploy or timeout between these two lines → the ministry never knows`,
after:String.raw`DB::transaction(function () use ($evaluation) {
    $evaluation->update(['status' => 'approved']);

    DB::table('outbox')->insert([                                   // ★ same transaction: both or neither
        'idempotency_key' => "ministry-sync:{$evaluation->id}",      // unique index: never recorded twice
        'type'            => 'ministry.sync',
        'payload'         => json_encode(['evaluation_id' => $evaluation->id]),
        'attempts'        => 0,
        'created_at'      => now(),
    ]);
});

// Worker — schedule: ->everyMinute()->withoutOverlapping()
DB::table('outbox')->whereNull('sent_at')->where('attempts', '<', 10)->orderBy('id')->limit(100)->get()
    ->each(function (object $row) use ($ministry) {
        try {
            $ministry->sync(json_decode($row->payload, true), $row->idempotency_key);   // ★ receiver ignores repeats
            DB::table('outbox')->where('id', $row->id)->update(['sent_at' => now()]);
        } catch (Throwable $e) {
            DB::table('outbox')->where('id', $row->id)
                ->increment('attempts', 1, ['last_error' => mb_substr($e->getMessage(), 0, 1000)]);
            Log::error('outbox.failed', ['id' => $row->id, 'error' => $e->getMessage()]);   // never silent
        }
    });`},
{
id:'static-proxy', name:'Laravel Facade (static proxy)', fam:'str', famName:'Structure',
hook:'A speed-dial button: one press, and it calls the real number for you.',
rule:'Cache::get() is a static shortcut that FORWARDS to one object in the container. It is a Proxy, not the GoF Facade.',
pain:'People think Cache::get() is static code that can’t be swapped, call it "the Facade pattern", and hide dependencies inside domain classes.',
fix:'Know the mechanism: __callStatic → container → the real object. Use it in routes and scripts; inject the real class in your own services.',
smells:['You want a short global shortcut for a service (routes, Blade, scripts)','Someone calls Cache:: "the Facade pattern"','A domain class full of static calls that tests can’t see'],
job:'You built an AiManager and want a short Ai:: shortcut in Blade views and Artisan commands.',
seen:['Cache::, DB::, Log::, Storage::','Cache::fake(), Ai::shouldReceive() in tests','Real-time facades: Facades\\App\\…'],
test:'You want a short static shortcut like Cache::get() for your own AiManager, to use in Blade views and routes.',
diagram:{bad:[['b',10,20,280,110,'','x'],['t',24,46,'class ReportService {','m'],['t',24,70,'  Cache::get(…)  ← hidden','kx'],['t',24,94,'  Ai::summarize(…) ← hidden','kx'],['t',24,118,'}  constructor says nothing','m']],
good:[['b',4,62,82,40,'Ai::driver()','n'],['a',86,82,108,82,'','k'],['b',110,58,84,48,'__callStatic','v'],['t',152,124,'forwards','s','middle'],['a',194,82,214,82,'','k'],['b',216,62,80,40,'AiManager','n'],['t',256,124,'ONE real object','s','middle']]},
before:String.raw`// repeated in every Blade view, route file and Artisan command:
app(AiManager::class)->driver()->summarize($text);`,
after:String.raw`// How it works (simplified):
abstract class Facade
{
    abstract protected static function accessor(): string;

    public static function __callStatic(string $method, array $args): mixed   // ★ PHP calls this for Ai::anything()
    {
        return app(static::accessor())->{$method}(...$args);                 // ★ forward to the ONE real object
    }
}

// The Laravel way, for your own service:
final class Ai extends \Illuminate\Support\Facades\Facade
{
    protected static function getFacadeAccessor(): string
    {
        return AiManager::class;
    }
}

Ai::driver()->summarize($text);          // = app(AiManager::class)->driver()->summarize($text)

// In tests:
Ai::shouldReceive('driver->summarize')->andReturn('short summary');

// In your OWN service classes, prefer the visible dependency:
public function __construct(private AiManager $ai) {}`}
];
const NON_GOF = ['container','manager','simple-factory','null-object','value-object','event-dispatcher','generators','command-bus','outbox','static-proxy'];
const ORDER = ['strategy','simple-factory','null-object','adapter','decorator','observer','event-dispatcher','facade','static-proxy','template','builder','value-object','state','command','command-bus','outbox','iterator','generators','composite','container','factory-method','manager','prototype','bridge','abstract-factory'];
const ALL = [...BASE, ...EXTRA];
const P = ORDER.map(id => { const p = ALL.find(x => x.id === id); if (!p) throw new Error('missing ' + id); return {...p, gof: !NON_GOF.includes(id)}; });

/* ───────────────────────── rendering (shared by the build script and the browser) ───────────────────────── */

const SITE = 'https://sha-hin.github.io/pattern-playbook/';
const FAMILY = { cre: 'Creation', str: 'Structure', beh: 'Behaviour' };

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const KW = new Set('abstract and as break case catch class clone const continue declare default do echo else elseif enum extends final finally fn for foreach function if implements instanceof interface match namespace new or private protected public readonly return static switch throw trait try use var while yield'.split(' '));
const LIT = new Set(['true', 'false', 'null', 'TRUE', 'FALSE', 'NULL']);
const TYPES = new Set('array bool callable float int iterable mixed never object string void self parent'.split(' '));

function codeHtml(src) {
  const hot = [];
  const clean = src.split('\n').map((line, n) => {
    hot[n] = line.includes('★');
    return line.replace(/\s*\/\/ ★\s*/, '  // ').replace('★', '').replace(/\s+\/\/\s*$/, '');
  }).join('\n');

  const re = /(\/\*[\s\S]*?\*\/|\/\/[^\n]*|#(?!\[)[^\n]*)|('(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*")|(\$[A-Za-z_]\w*)|(\b\d[\d_]*(?:\.\d+)?\b)|([A-Za-z_]\w*)/g;
  const out = [];
  let last = 0, m;
  const push = (text, cls) => { if (text) out.push([text, cls]); };
  while ((m = re.exec(clean))) {
    push(clean.slice(last, m.index), '');
    last = re.lastIndex;
    const [t, com, str, v, num, word] = m;
    if (com) push(t, 'c');
    else if (str) push(t, 's');
    else if (v) push(t, v === '$this' ? 'k' : 'v');
    else if (num) push(t, 'n');
    else if (word) {
      const before = clean.slice(Math.max(0, m.index - 2), m.index);
      const after = clean.slice(last).match(/^\s*\(/);
      if (before === '->' || before === '?>') push(t, after ? 'f' : 'p');
      else if (KW.has(t.toLowerCase()) && before.slice(-1) !== ':' ) push(t, 'k');
      else if (LIT.has(t) || TYPES.has(t)) push(t, 'k');
      else if (after) push(t, 'f');
      else if (/^[A-Z]/.test(t)) push(t, 't');
      else push(t, '');
    }
  }
  push(clean.slice(last), '');

  const lines = [''];
  for (const [text, cls] of out) {
    text.split('\n').forEach((piece, i) => {
      if (i > 0) lines.push('');
      if (piece) lines[lines.length - 1] += cls ? `<span class="${cls}">${esc(piece)}</span>` : esc(piece);
    });
  }
  return lines
    .map(l => l.replace(/(\S|<\/span>) ( +)(<span class="c">)/, (_, a, sp, c) => `${a} <span class="al">${sp}</span>${c}`))   // alignment spaces before a comment, hidden on phones
    .map((l, n) => {
      const indent = clean.split('\n')[n].match(/^ */)[0].length;   // used on phones: wrapped lines stay indented
      return `<span class="ln${hot[n] ? ' h' : ''}" style="--i:${indent}">${l}</span>`;
    }).join('<span class="nl">\n</span>');
}

function shape(el) {
  const t = el[0];
  if (t === 'b') {
    const [, x, y, w, h, label, kind] = el;
    const cls = { n: 'bn', v: 'bv', v2: 'bv2', i: 'bi', x: 'bx' }[kind] || 'bn';
    let s = `<rect class="${cls}" x="${x}" y="${y}" width="${w}" height="${h}" rx="7"/>`;
    if (label) s += `<text x="${x + w / 2}" y="${y + h / 2 + 4}" text-anchor="middle" class="${kind === 'v' || kind === 'v2' ? 'kv' : kind === 'x' ? 'kx' : ''}">${esc(label)}</text>`;
    return s;
  }
  if (t === 'a') {
    const [, x1, y1, x2, y2, , kind] = el;
    const cls = kind === 'k' ? 'lk' : kind === 'x' ? 'lx' : kind === 'd' ? 'ld' : 'ln';
    return `<line class="${cls}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" marker-end="url(#${kind === 'x' ? 'arx' : 'ar'})"/>`;
  }
  if (t === 't') {
    const [, x, y, text, cls, anchor] = el;
    return `<text x="${x}" y="${y}" class="${cls || ''}"${anchor ? ` text-anchor="${anchor}"` : ''}>${esc(text)}</text>`;
  }
  if (t === 'p') {
    const [, d, kind] = el;
    return `<path class="${kind === 'd' ? 'ld' : 'ln'}" d="${d}" marker-end="url(#ar)"/>`;
  }
  return '';
}

const svg = (els, label) => `<svg class="d" viewBox="0 0 300 166" role="img" aria-label="${esc(label)}">${els.map(shape).join('')}</svg>`;

function chipsHtml(current, prefix) {
  return P.map(p =>
    `<a class="${p.fam}${p.gof ? '' : ' ext'}" href="${prefix}${p.id}/"${p.id === current ? ' aria-current="page"' : ''} data-umami-event="Open pattern" data-umami-event-pattern="${p.id}" data-umami-event-from="chips"><i></i>${esc(p.name)}</a>`
  ).join('');
}

const REPO = 'https://github.com/sha-hin/pattern-playbook/blob/main/';

function scratchHtml(p) {
  const x = p.scratch;
  return `<section class="scratch" aria-labelledby="build-${p.id}">
    <h2 class="g" id="build-${p.id}">Build it yourself: the full ${esc(p.name)} pattern in plain PHP</h2>
    <p class="sub2">No framework. Every part of the pattern is here, labelled with its role. Copy it, run it, change it.</p>
    <div class="roles" role="table" aria-label="The parts of ${esc(p.name)}">
      ${x.roles.map(r => `<div class="role" role="row"><span role="rowheader">${esc(r.role)}</span><span role="cell"><code>${esc(r.classes)}</code>${r.note ? ` <small>${esc(r.note)}</small>` : ''}</span></div>`).join('')}
    </div>
    ${x.notes.map(n => `<p class="rolenote">${esc(n)}</p>`).join('')}
    <pre><code>${codeHtml(x.code)}</code></pre>
    <p class="legend"><mark>Highlighted lines</mark> are the ones that make it this pattern. Run it: <code>php examples/${p.id}.php</code> · <a href="${REPO}examples/${p.id}.php" data-umami-event="View example" data-umami-event-pattern="${p.id}">Open the file on GitHub</a></p>
    ${x.output ? `<div class="output"><span>Output</span><pre><code>${esc(x.output)}</code></pre></div>` : ''}
  </section>`;
}

function cardHtml(p, prefix) {
  const i = P.indexOf(p), prev = P[i - 1], next = P[i + 1];
  return `<article class="card ${p.fam}">
  <div class="head"><span class="count">${i + 1} / ${P.length}</span><h1 class="name">${esc(p.name)}</h1><span class="fam">${FAMILY[p.fam]}</span>${p.gof ? '<span class="book">GoF book</span>' : '<span class="book ext">Not in the book</span>'}</div>
  <p class="hook">${esc(p.hook)}</p>
  <p class="rule"><span>The rule to remember</span>${esc(p.rule)}</p>
  <div class="panels">
    <div class="panel bad"><h2>Without it: the pain</h2>${svg(p.diagram.bad, 'Without ' + p.name + ': ' + p.pain)}<p>${esc(p.pain)}</p></div>
    <div class="panel good"><h2>With it: the fix</h2>${svg(p.diagram.good, 'With ' + p.name + ': ' + p.fix)}<p>${esc(p.fix)}</p></div>
  </div>
  <div class="when">
    <div class="box"><h2>Reach for it when you see</h2><ul>${p.smells.map(s => `<li>${esc(s)}</li>`).join('')}</ul></div>
    <div class="box"><h2>Real job where it fits</h2><p>${esc(p.job)}</p></div>
  </div>
  <div class="code"><h2 class="b">Before: the code that hurts</h2><pre class="before"><code>${codeHtml(p.before)}</code></pre></div>
  ${p.scratch ? scratchHtml(p) : ''}
  <div class="code"><h2 class="lv">In a real Laravel project</h2>
    <p class="sub2">The same pattern the way you would write it at work, using what the framework already gives you.</p>
    <pre><code>${codeHtml(p.after)}</code></pre>
    ${p.scratch && p.scratch.laravel ? `<p class="howlaravel"><b>How Laravel builds it inside:</b> ${esc(p.scratch.laravel)}</p>` : ''}</div>
  ${p.vs ? `<div class="vsbox"><h2>Don't confuse it with <a href="${prefix}${p.vs.id}/" data-umami-event="Open pattern" data-umami-event-pattern="${p.vs.id}" data-umami-event-from="compare">${esc(p.vs.name)}</a></h2>
    <div class="vstable" role="table" aria-label="${esc(p.name)} compared with ${esc(p.vs.name)}">
      <div class="vsrow vshead" role="row"><span role="columnheader"></span><span role="columnheader">${esc(p.name)}</span><span role="columnheader">${esc(p.vs.name)}</span></div>
      ${p.vs.rows.map(r => `<div class="vsrow" role="row"><span role="rowheader">${esc(r[0])}</span><span role="cell">${esc(r[1])}</span><span role="cell">${esc(r[2])}</span></div>`).join('')}
    </div></div>` : ''}
  <div><h2 class="seenh">You already use it in</h2><div class="seen">${p.seen.map(s => `<span>${esc(s)}</span>`).join('')}</div></div>
  <nav class="nav" aria-label="Previous and next pattern">
    ${prev ? `<a class="navbtn" rel="prev" href="${prefix}${prev.id}/" data-umami-event="Open pattern" data-umami-event-pattern="${prev.id}" data-umami-event-from="previous"><small>← Previous</small>${esc(prev.name)}</a>` : '<span></span>'}
    ${next ? `<a class="navbtn" rel="next" href="${prefix}${next.id}/" data-umami-event="Open pattern" data-umami-event-pattern="${next.id}" data-umami-event-from="next"><small>Next →</small>${esc(next.name)}</a>` : `<a class="navbtn" href="${prefix}"><small>Done →</small>All patterns</a>`}
  </nav>
</article>`;
}

function hubHtml(prefix) {
  const groups = [
    ['Use these every week', P.slice(0, 9)],
    ['Common in real projects', P.slice(9, 18)],
    ['Specialised: learn them last', P.slice(18)],
  ];
  return groups.map(([title, items]) => `<section class="group"><h2>${title}</h2><div class="tiles">${items.map(p =>
    `<a class="tile ${p.fam}" href="${prefix}${p.id}/" data-umami-event="Open pattern" data-umami-event-pattern="${p.id}" data-umami-event-from="hub"><span class="tnum">${P.indexOf(p) + 1}</span><b>${esc(p.name)}</b><span class="tags"><span class="fam">${FAMILY[p.fam]}</span>${p.gof ? '' : '<span class="book ext">Not in the book</span>'}</span><span class="th">${esc(p.hook)}</span><span class="tr">${esc(p.rule)}</span></a>`
  ).join('')}</div></section>`).join('');
}

/* ───────────────────────── browser behaviour ───────────────────────── */

if (typeof document !== 'undefined') {
  const $ = s => document.querySelector(s);
  const prefix = document.body.dataset.prefix || '';
  const pageId = document.body.dataset.page;          // 'hub' or a pattern id
  const view = $('#view');
  // Umami custom events; a no-op when the script is blocked or not loaded yet.
  const track = (name, data) => { try { window.umami && window.umami.track(name, data); } catch (e) {} };
  const learnHtml = view.innerHTML;

  // Old #strategy-style links from the first version → the real page
  const legacy = location.hash.slice(1);
  if (pageId === 'hub' && P.some(p => p.id === legacy)) location.replace(prefix + legacy + '/');

  let deck = [], pos = 0, right = 0, done = 0, mode = 'learn';
  const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

  function setMode(m) {
    mode = m;
    $('#m-learn').setAttribute('aria-pressed', String(m === 'learn'));
    $('#m-test').setAttribute('aria-pressed', String(m === 'test'));
    if (m === 'learn') { view.innerHTML = learnHtml; } else { deck = []; track('Start test', { page: pageId }); test(); }
    window.scrollTo({ top: 0 });
  }

  function test() {
    if (!deck.length) { deck = shuffle(P.map(p => p.id)); pos = 0; right = 0; done = 0; }
    const p = P.find(x => x.id === deck[pos]);
    view.innerHTML = `
    <section class="test ${p.fam}" aria-live="polite">
      <p class="lab">Scenario ${pos + 1} of ${deck.length}</p>
      <p class="q">${esc(p.test)}</p>
      <p class="lab">Which pattern? Say it in your head, then reveal.</p>
      <div id="ans"></div>
      <div class="row" id="btns"><button class="primary" id="reveal">Show answer</button></div>
      <p class="score">${done ? `Score so far: ${right} / ${done}` : 'Answer honestly, the score is just for you.'}</p>
    </section>`;
    $('#reveal').onclick = () => {
      $('#ans').innerHTML = `<div class="ans"><b>${esc(p.name)}</b>${esc(p.rule)}</div>`;
      $('#btns').innerHTML = `<button class="primary" id="ok">I got it</button><button id="no">I missed it</button><a class="btnlink" href="${prefix}${p.id}/" data-umami-event="Open pattern" data-umami-event-pattern="${p.id}" data-umami-event-from="test">Open the ${esc(p.name)} page</a>`;
      const nextQ = got => {
        track('Test answer', { pattern: p.id, result: got ? 'got it' : 'missed' });
        done++; if (got) right++; pos++; pos >= deck.length ? finish() : test();
      };
      $('#ok').onclick = () => nextQ(true);
      $('#no').onclick = () => nextQ(false);
    };
  }

  function finish() {
    track('Test finished', { score: `${right}/${done}`, percent: Math.round(right / done * 100) });
    view.innerHTML = `<section class="test"><p class="q">You got ${right} of ${done}.</p><p class="lab">${right === done ? 'All of them.' : 'Open the patterns you missed, then try again.'}</p><div class="row"><button class="primary" id="again">Shuffle and try again</button></div></section>`;
    deck = [];
    $('#again').onclick = test;
  }

  $('#m-learn').onclick = () => setMode('learn');
  $('#m-test').onclick = () => setMode('test');

  document.addEventListener('keydown', e => {
    const typing = e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable);
    if (typing || !$('.cmdk').hidden) return;
    if (mode !== 'learn' || pageId === 'hub' || e.altKey || e.metaKey || e.ctrlKey) return;
    const i = P.findIndex(p => p.id === pageId);
    if (e.key === 'ArrowRight' && P[i + 1]) location.href = prefix + P[i + 1].id + '/';
    if (e.key === 'ArrowLeft' && P[i - 1]) location.href = prefix + P[i - 1].id + '/';
  });

  /* ── Light / dark toggle (the choice is shared with sha-hin.github.io: same origin, same key) ── */
  const root = document.documentElement;
  const themeBtn = $('.theme-toggle');
  const mq = window.matchMedia ? matchMedia('(prefers-color-scheme: dark)') : null;
  const currentTheme = () => root.getAttribute('data-theme') || (mq && mq.matches ? 'dark' : 'light');
  const syncTheme = () => themeBtn.setAttribute('aria-label', currentTheme() === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
  function toggleTheme() {
    const next = currentTheme() === 'dark' ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    try { localStorage.setItem('theme', next); } catch (e) {}
    syncTheme();
    track('Switch theme', { to: next });
  }
  themeBtn.addEventListener('click', toggleTheme);
  if (mq) { const f = () => { if (!root.getAttribute('data-theme')) syncTheme(); }; mq.addEventListener ? mq.addEventListener('change', f) : mq.addListener(f); }
  syncTheme();

  /* ── Quick navigation: Ctrl/⌘ K or "/" ── */
  const mac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  document.querySelectorAll('.k-mod').forEach(k => { k.textContent = mac ? '⌘' : 'Ctrl'; });

  const wrap = document.createElement('div');
  wrap.className = 'cmdk';
  wrap.hidden = true;
  wrap.innerHTML = `<div class="cmdk-back" data-close></div>
    <div class="cmdk-panel" role="dialog" aria-modal="true" aria-label="Find a pattern">
      <div class="cmdk-in"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/></svg>
      <input id="cmdk-q" type="text" placeholder="Pattern name or a problem: queue, cache, undo, import…" aria-label="Find a pattern" autocomplete="off" spellcheck="false"><kbd>Esc</kbd></div>
      <ul class="cmdk-list" role="listbox"></ul>
    </div>`;
  document.body.appendChild(wrap);
  const input = wrap.querySelector('input'), list = wrap.querySelector('.cmdk-list');

  const items = [
    ...P.map((p, i) => ({
      g: 'Patterns', t: p.name, sub: p.hook, s: FAMILY[p.fam] + (p.gof ? '' : ' · modern'), i: String(i + 1), fam: p.fam, id: p.id,
      kw: [p.rule, p.job, p.test, ...p.smells, ...p.seen].join(' '),
      run: () => { track('Open pattern', { pattern: p.id, from: 'search' }); location.href = prefix + p.id + '/'; },
    })),
    { g: 'Actions', t: 'Test me', sub: 'Shuffle real-world scenarios and pick the pattern', i: '?', kw: 'quiz practice test exam', run: () => setMode('test') },
    { g: 'Actions', t: 'All patterns', sub: 'The overview page', i: '≡', kw: 'home hub index list', run: () => { location.href = prefix; } },
    { g: 'Actions', t: 'Switch light / dark theme', i: '◐', kw: 'dark light mode theme', run: toggleTheme },
    { g: 'Actions', t: 'Source on GitHub', i: '↗', kw: 'github code repo', run: () => { track('View source'); location.href = 'https://github.com/sha-hin/pattern-playbook'; } },
  ];

  let shown = [], sel = 0, lastFocus = null;
  // Name matches first, then matches in the hook, then matches anywhere in the text.
  function score(it, q) {
    if (!q) return 1;
    const name = it.t.toLowerCase(), rest = ((it.sub || '') + ' ' + (it.kw || '') + ' ' + it.g).toLowerCase();
    const words = q.split(/\s+/).filter(Boolean);
    if (!words.every(w => name.includes(w) || rest.includes(w))) return 0;
    return name.startsWith(q) ? 4 : name.includes(q) ? 3 : (it.sub || '').toLowerCase().includes(q) ? 2 : 1;
  }
  function render() {
    const q = input.value.trim().toLowerCase();
    list.innerHTML = '';
    const ranked = items.map((it, i) => ({ it, sc: score(it, q), i })).filter(x => x.sc > 0);
    if (q) ranked.sort((a, b) => b.sc - a.sc || a.i - b.i);
    shown = [];
    let grp = null;
    ranked.forEach(({ it }) => {
      if (!q && it.g !== grp) { grp = it.g; const h = document.createElement('li'); h.className = 'cmdk-grp'; h.setAttribute('role', 'presentation'); h.textContent = grp; list.appendChild(h); }
      const li = document.createElement('li');
      li.className = 'cmdk-item' + (it.fam ? ' ' + it.fam : '');
      li.setAttribute('role', 'option');
      li.id = 'cmdk-opt-' + shown.length;
      li.innerHTML = `<span class="ci"></span><span class="ct"><span></span>${it.sub ? '<small></small>' : ''}</span><span class="cs"></span>`;
      li.querySelector('.ci').textContent = it.i;
      li.querySelector('.ct span').textContent = it.t;
      if (it.sub) li.querySelector('.ct small').textContent = it.sub;
      li.querySelector('.cs').textContent = it.id === pageId ? 'you are here' : (it.s || '');
      const idx = shown.length;
      li.addEventListener('mousemove', () => { if (sel !== idx) { sel = idx; mark(); } });
      li.addEventListener('click', () => { sel = idx; run(); });
      shown.push({ it, el: li });
      list.appendChild(li);
    });
    if (!shown.length) { const e = document.createElement('li'); e.className = 'cmdk-empty'; e.textContent = 'No pattern matches that. Try a problem word like "cache" or "queue".'; list.appendChild(e); }
    sel = Math.min(sel, Math.max(shown.length - 1, 0));
    mark();
  }
  function mark() {
    shown.forEach((x, i) => { x.el.setAttribute('aria-selected', i === sel ? 'true' : 'false'); if (i === sel) x.el.scrollIntoView({ block: 'nearest' }); });
    input.setAttribute('aria-activedescendant', shown[sel] ? shown[sel].el.id : '');
  }
  function run() { const x = shown[sel]; if (!x) return; close(); setTimeout(() => x.it.run(), 20); }
  function open() {
    if (!wrap.hidden) return;
    lastFocus = document.activeElement;
    wrap.hidden = false; input.value = ''; sel = 0; render(); input.focus();
    document.body.style.overflow = 'hidden';
    track('Open search');
  }
  function close() {
    if (wrap.hidden) return;
    wrap.hidden = true; document.body.style.overflow = '';
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  input.addEventListener('input', () => { sel = 0; render(); });
  wrap.addEventListener('click', e => { if (e.target.hasAttribute('data-close')) close(); });
  wrap.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); if (shown.length) { sel = (sel + 1) % shown.length; mark(); } }
    else if (e.key === 'ArrowUp') { e.preventDefault(); if (shown.length) { sel = (sel - 1 + shown.length) % shown.length; mark(); } }
    else if (e.key === 'Enter') { e.preventDefault(); run(); }
    else if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'Tab') { e.preventDefault(); input.focus(); }
  });
  document.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); wrap.hidden ? open() : close(); return; }
    const t = e.target, typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
    if (e.key === '/' && !typing && wrap.hidden) { e.preventDefault(); open(); }
  });
  $('.searchbtn').addEventListener('click', open);

  const current = document.querySelector('.chips a[aria-current]');
  if (current) current.scrollIntoView({ block: 'nearest', inline: 'center' });
}

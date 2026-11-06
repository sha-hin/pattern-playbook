// Part 6: infrastructure and the editor (chapters 27–30).

export const PART6 = {

  // ════════════════════════════════════════════════════════════════════
  '27-abstract-factory': {
    description: 'Production stored an export on one server’s disk while queueing the follow-up job in the cloud, and the worker could not find the file. Make storage and queue come from one family with the Abstract Factory pattern in PHP.',
    ticket: {
      from: 'Operations',
      title: 'The inspector never got the Ministry export',
      body: 'Since we moved the workers to the cloud, the "notify inspector" job fails every time with "file not found". The web server writes the export to its own disk, but the job runs on a cloud worker that has a different disk. Locally everything works, which is why nobody noticed.',
    },
    pain: {
      text: ['Storage and queue are configured separately, so any combination is possible:'],
      code: `// bootstrap/app.php: two independent decisions
$app->singleton(FileStorage::class, fn () => getenv('STORAGE') === 's3'
    ? new S3Storage(new S3Client(), 'evalu8-exports')
    : new LocalDiskStorage(__DIR__ . '/../var/storage'));

$app->singleton(Queue::class, fn (Container $c) => getenv('QUEUE') === 'sqs'
    ? new SqsQueue(new SqsClient(), $queueUrl)
    : new DatabaseQueue($c->make(PDO::class)));

// production .env: STORAGE=local, QUEUE=sqs   ← nobody notices until a job runs`,
      after: [
        'The two services only work in **matching pairs**: local disk with the database queue (one server, the worker can read the disk), or S3 with SQS (many servers, everyone reads S3). The other two combinations look fine in every test and fail only in production.',
        'We want one decision that picks a whole **family** of services, so a mismatched pair can’t be built at all.',
      ],
    },
    pattern: {
      name: 'Abstract Factory',
      rule: 'Several objects must always come from the same family → one factory interface creates each of them, and one concrete factory per family creates only matching ones.',
      explain: [
        '`InfrastructureKit` is the abstract factory: it has one method per product, `storage()` and `queue()`. `LocalKit` creates the local family (disk + database queue); `CloudKit` creates the cloud family (S3 + SQS).',
        'The code that uses them, here `ExportPublisher`, receives a kit and asks it for both services. Because both come from the same kit, they always belong together. The environment chooses the kit **once**, in one line of the bootstrap.',
        'Compare with Factory Method (chapter 13): that is one method that creates one product and is overridden by subclasses. An Abstract Factory is an object that creates a **set** of related products.',
      ],
      drawing: {
        bad: [['b', 2, 62, 80, 40, 'Web server', 'n'], ['a', 82, 74, 108, 34], ['a', 82, 90, 108, 130], ['b', 110, 14, 90, 36, 'Local disk', 'n'], ['b', 110, 116, 90, 36, 'Cloud queue', 'n'], ['a', 200, 134, 222, 98], ['b', 224, 62, 72, 40, 'Worker', 'x'], ['a', 224, 66, 202, 36, '', 'x'], ['t', 260, 124, 'file not found', 'kx', 'middle']],
        good: [['b', 4, 64, 70, 38, 'Publisher', 'n'], ['a', 74, 83, 92, 83], ['b', 94, 58, 112, 50, 'InfrastructureKit', 'i'], ['a', 206, 74, 218, 46, '', 'k'], ['a', 206, 92, 218, 120, '', 'k'], ['b', 220, 20, 76, 48, 'LocalKit', 'v'], ['b', 220, 98, 76, 48, 'CloudKit', 'v'], ['t', 150, 126, 'storage + queue', 's', 'middle'], ['t', 150, 146, 'always one family', 's', 'middle']],
        badCaption: 'Storage and queue are chosen separately, so a local file can be paired with a cloud worker.',
        goodCaption: 'One kit creates both. A kit only knows how to make matching pieces.',
      },
    },
    steps: [
      { title: 'The storage interface', text: ['`put()` returns a **location**, not a server path. Whoever reads the file later passes the location back to `get()`.'], file: 'src/Storage/FileStorage.php' },
      { title: 'Product 1, local family: files on this server’s disk', text: ['Its locations start with `disk://`: they only mean something on this server.'], file: 'src/Storage/LocalDiskStorage.php' },
      { title: 'Product 1, cloud family: files in S3', text: [], file: 'src/Storage/S3Storage.php' },
      { title: 'A stand-in for the AWS SDK’s S3 client', text: ['Same call shape as `Aws\\S3\\S3Client` (`putObject`, `getObject`), kept in memory so the project runs offline.'], file: 'fakes/Aws/S3Client.php' },
      { title: 'And for the SQS client', text: [], file: 'fakes/Aws/SqsClient.php' },
      { title: 'Product 2, cloud family: a queue on SQS', text: ['It implements the same `Queue` interface as the database queue from chapter 23, so the worker and the bus don’t change.'], file: 'src/Bus/SqsQueue.php' },
      { title: 'The abstract factory', text: ['One method per product. Nothing that receives a kit can mix families.'], file: 'src/Infrastructure/Kit/InfrastructureKit.php' },
      { title: 'Concrete factory: the local family', text: ['Each product is created once and reused (`??=`), so the whole app shares one storage and one queue.'], file: 'src/Infrastructure/Kit/LocalKit.php' },
      { title: 'Concrete factory: the cloud family', text: [], file: 'src/Infrastructure/Kit/CloudKit.php' },
      { title: 'The client: store the file, then queue the follow-up', text: [], file: 'src/Reporting/ExportPublisher.php' },
      { title: 'The follow-up job', text: [], file: 'src/Reporting/NotifyInspector.php' },
      { title: 'Its handler reads the file back', text: ['On the worker, the storage it receives is the same family that wrote the file, so the location always resolves.'], file: 'src/Reporting/NotifyInspectorHandler.php' },
      { title: 'Autoload the AWS stand-ins', text: [], file: 'composer.json', diff: 'composer.json' },
      { title: 'One decision picks the family', text: ['`EVALU8_INFRA` selects the kit, and the app’s `Queue` and `FileStorage` are taken **from** the kit. There is no longer a way to configure them separately.'], file: 'bootstrap/app.php', diff: 'bootstrap/app.php' },
      { title: 'Run it with both families', text: [], file: 'bin/publish-export.php' },
    ],
    run: {
      script: 'bin/publish-export.php',
      cmd: 'composer dump-autoload\nphp bin/publish-export.php',
      text: ['With the local kit the file goes to `disk://…` and the job sits in the database queue; with the cloud kit the file goes to S3 and the job to SQS. In both cases the worker finds the file and notifies the inspector.'],
    },
    laravel: {
      text: [
        'Laravel configures disks (`FILESYSTEM_DISK`) and queues (`QUEUE_CONNECTION`) separately, so the mismatch in this ticket is possible there too. Keep them in one place per environment, or bind your own kit in a service provider.',
        'Inside the framework, every database connection is an abstract factory: a connection creates its own matching query grammar, schema grammar and post-processor, so MySQL SQL can never be sent to PostgreSQL.',
      ],
      code: `// Illuminate\\Database\\MySqlConnection (simplified): one family of products
class MySqlConnection extends Connection
{
    protected function getDefaultQueryGrammar(): MySqlGrammar
    {
        return new MySqlGrammar($this);
    }

    protected function getDefaultSchemaGrammar(): MySqlSchemaGrammar
    {
        return new MySqlSchemaGrammar($this);
    }

    protected function getDefaultPostProcessor(): MySqlProcessor
    {
        return new MySqlProcessor();
    }
}
// PostgresConnection and SQLiteConnection create their own matching set.`,
    },
    check: [
      { q: 'A third environment, "on-premise", uses MinIO for files and RabbitMQ for jobs. What do you add?', a: 'One new kit (`OnPremiseKit implements InfrastructureKit`) that creates the MinIO storage and the RabbitMQ queue, and one more `match` arm in the bootstrap. `ExportPublisher` and the worker don’t change.' },
      { q: 'How is this different from the Factory Method in chapter 13?', a: 'Factory Method is one overridable method that creates one product. Abstract Factory is an object with several creation methods whose products must match each other.' },
      { q: 'Why does `LocalDiskStorage` return `disk://exports/…` instead of the full path?', a: 'A location must be passed back to the same storage, not opened directly. A server path would invite code to read the file itself, which only works on that one server.' },
    ],
    next: 'Teachers want their results by WhatsApp, principals by email and in the app, and there are three kinds of notification. Next: how not to write twelve classes.',
  },

  // ════════════════════════════════════════════════════════════════════
  '28-bridge': {
    description: 'Three kinds of notification over four channels would mean twelve classes. Split "what to say" from "how to deliver" with the Bridge pattern in PHP.',
    ticket: {
      from: 'Ahmed Nabil, Product Owner',
      title: 'Notifications over email, SMS, WhatsApp and in the app',
      body: 'We send three notifications: results published (to teachers), low response rate (to principals) and survey reminders (to students and parents). Each user picks a channel in their profile: email, SMS, WhatsApp or the in-app inbox. Next quarter we add push notifications and one more notification type.',
    },
    pain: {
      text: ['The first version made one class per notification per channel:'],
      code: `final class ResultsPublishedEmail { /* text + SMTP code */ }
final class ResultsPublishedSms { /* text again + SMS gateway code */ }
final class ResultsPublishedWhatsApp { /* text again + WhatsApp code */ }
final class LowResponseRateEmail { /* ... */ }
// ... 3 notifications × 4 channels = 12 classes
// next quarter: 4 × 5 = 20 classes`,
      after: [
        'Every class mixes two unrelated things: the wording of one notification and the delivery code of one channel. A change to the SMS gateway touches three classes; a new notification needs four. The number of classes is the **product** of the two lists, and it grows every time either list grows.',
        'There are two independent dimensions here: **what** to say and **how** to deliver it. Each should vary without touching the other.',
      ],
    },
    pattern: {
      name: 'Bridge',
      rule: 'Two things vary independently (what × how) → split them into two class trees and connect them with one reference, so you write their sum, not their product.',
      explain: [
        'The **abstraction** side says what to say: `Notification`, with `ResultsPublished`, `LowResponseRate` and `SurveyReminder`. The **implementor** side says how to deliver: the `Channel` interface, with `EmailChannel`, `SmsChannel`, `WhatsAppChannel` and `InAppChannel`.',
        'A notification holds a channel. That single reference is the bridge. `send()` asks the notification for its `Message` and hands it to whatever channel it holds. Three notifications plus four channels is seven classes, and every combination works.',
        'Bridge looks like Strategy from chapter 3 (an object holding an interface). The difference is intent: Strategy swaps one algorithm inside one class; Bridge separates two whole hierarchies that both keep growing.',
      ],
      drawing: {
        bad: [['b', 20, 10, 260, 146, '', 'x'], ['t', 36, 34, 'ResultsPublishedEmail', 'm'], ['t', 36, 54, 'ResultsPublishedSms', 'm'], ['t', 36, 74, 'ResultsPublishedWhatsApp', 'm'], ['t', 36, 94, 'LowResponseRateEmail', 'm'], ['t', 36, 114, 'LowResponseRateSms …', 'm'], ['t', 36, 140, '3 × 4 = 12 classes', 'kx']],
        good: [['b', 2, 14, 118, 32, 'ResultsPublished', 'v2'], ['b', 2, 67, 118, 32, 'LowResponseRate', 'v2'], ['b', 2, 120, 118, 32, 'SurveyReminder', 'v2'], ['a', 120, 30, 132, 72], ['a', 120, 83, 132, 83], ['a', 120, 136, 132, 94], ['b', 134, 63, 64, 40, 'Channel', 'i'], ['a', 198, 76, 222, 22, '', 'k'], ['a', 198, 80, 222, 61, '', 'k'], ['a', 198, 86, 222, 100, '', 'k'], ['a', 198, 90, 222, 140, '', 'k'], ['b', 224, 8, 72, 28, 'Email', 'v'], ['b', 224, 47, 72, 28, 'SMS', 'v'], ['b', 224, 86, 72, 28, 'WhatsApp', 'v'], ['b', 224, 125, 72, 28, 'In-app', 'v'], ['t', 166, 124, 'the bridge', 's', 'middle'], ['t', 166, 154, '3 + 4 = 7 classes', 's', 'middle']],
        badCaption: 'One class per combination: wording and delivery code mixed together.',
        goodCaption: 'What to say on the left, how to deliver on the right, one reference between them.',
      },
    },
    steps: [
      { title: 'Who receives it', text: ['Not everyone has every contact detail: Nadia has no email, a student has only a phone.'], file: 'src/Notify/Recipient.php' },
      { title: 'What is said, in two lengths', text: ['Email and the inbox show the full text; SMS and WhatsApp need a short one. The 160-character limit is checked when the message is created, not by the SMS gateway at 2 a.m.'], file: 'src/Notify/Message.php' },
      { title: 'The implementor: how to deliver', text: [], file: 'src/Notify/Channel.php' },
      { title: 'When a recipient can’t be reached', text: ['A missing phone number is reported loudly, so the caller can fall back to another channel.'], file: 'src/Notify/ChannelUnavailable.php' },
      { title: 'Channel: email', text: ['It reuses the `Mailer` from chapter 6.'], file: 'src/Notify/EmailChannel.php' },
      { title: 'Channel: SMS', text: [], file: 'src/Notify/SmsChannel.php' },
      { title: 'Channel: WhatsApp', text: [], file: 'src/Notify/WhatsAppChannel.php' },
      { title: 'Channel: the in-app inbox', text: [], file: 'src/Notify/InAppChannel.php' },
      { title: 'The inbox table', text: [], file: 'src/Infrastructure/Sqlite/Schema.php', diff: 'src/Infrastructure/Sqlite/Schema.php' },
      { title: 'The abstraction: what to say', text: ['It holds a `Channel` (the bridge). `send()` is `final`: every notification is delivered the same way, and each subclass only writes its message.'], file: 'src/Notify/Notification.php' },
      { title: 'Notification: results published', text: [], file: 'src/Notify/ResultsPublished.php' },
      { title: 'Notification: low response rate', text: [], file: 'src/Notify/LowResponseRate.php' },
      { title: 'Notification: survey reminder', text: [], file: 'src/Notify/SurveyReminder.php' },
      { title: 'Find a channel by the name in a user’s profile', text: [], file: 'src/Notify/Channels.php' },
      { title: 'Register the channels once', text: [], file: 'bootstrap/app.php', diff: 'bootstrap/app.php' },
      { title: 'Send each notification over the channel each person chose', text: [], file: 'bin/notify.php' },
    ],
    run: {
      script: 'bin/notify.php',
      cmd: 'composer dump-autoload\nphp bin/notify.php',
      text: ['The same `ResultsPublished` goes to Hany by email and to Nadia by WhatsApp; the same `LowResponseRate` goes to the principal by email and into her in-app inbox. The reminder can’t be emailed to a student without an address, and says so.'],
    },
    laravel: {
      text: [
        'Laravel Notifications have the same two sides. Your notification class says what to send and lists its channels in `via()`; each channel class (`mail`, `database`, `vonage`, `slack`…) knows how to deliver. Any notification can use any channel.',
        'One difference: in Laravel the notification formats itself for each channel (`toMail()`, `toVonage()`), so a new channel means a new method in the notifications that use it. Here a channel only needs the shared `Message`.',
      ],
      code: `final class ResultsPublished extends Notification
{
    public function __construct(private string $term, private string $score) {}

    /** @return list<string> */
    public function via(User $user): array
    {
        return [$user->preferred_channel];                 // 'mail', 'vonage', 'database'...
    }

    public function toMail(User $user): MailMessage
    {
        return (new MailMessage())
            ->subject("Your {$this->term} evaluation result")
            ->line("Your result is {$this->score}.");
    }

    public function toVonage(User $user): VonageMessage
    {
        return (new VonageMessage())->content("Your {$this->term} result is {$this->score}.");
    }
}

$teacher->notify(new ResultsPublished('2026-T1', '4.13'));`,
    },
    check: [
      { q: 'Push notifications arrive next quarter. How many classes do you add?', a: 'One: `PushChannel implements Channel`. All three notifications can use it immediately.' },
      { q: 'And a fourth notification type, "comment flagged"?', a: 'One class extending `Notification` that writes its message. It works on all four (or five) channels.' },
      { q: 'How is Bridge different from Strategy?', a: 'Strategy swaps one algorithm inside one class. Bridge separates two hierarchies that both grow, so their combinations don’t multiply into classes.' },
    ],
    next: 'The survey editor’s question form has fields that keep changing each other: the question type, the scale, the "scored" checkbox, the preview. Next: one place for those rules.',
  },

  // ════════════════════════════════════════════════════════════════════
  '29-mediator': {
    description: 'In the survey editor, every field updates the others directly, and the rules are spread over six classes. Move every interaction into one Mediator in PHP.',
    ticket: {
      from: 'Mona Saleh, Head of Quality',
      title: 'The editor let me save a scored comment question',
      body: 'I changed a question to "comment" and the "count in score" box stayed ticked, so the report tried to average text. Another time I changed the scale to 1–7 and the preview still showed 1–5. The rules are simple: comments are never scored, scored questions use 1–5, the preview always shows the current question.',
    },
    pain: {
      text: ['Each field was written to update the fields it affects:'],
      code: `final class QuestionTypeField
{
    public function __construct(
        private ScaleField $scale,
        private ScoredCheckbox $scored,
        private PreviewPanel $preview,
        private ValidationPanel $validation,
    ) {}

    public function choose(QuestionType $type): void
    {
        $this->value = $type;
        $this->scale->enabled = $type === QuestionType::Scale;
        $this->scored->enabled = $type !== QuestionType::Text;   // forgot to untick it
        $this->preview->render(/* ... */);
        $this->validation->check(/* ... */);
    }
}
// ScaleField, ScoredCheckbox and QuestionTextField each do the same with the others.`,
      after: [
        'Every field knows every other field: six fields means up to thirty connections, and each rule ("comments are never scored") is split across several classes. The bug in the ticket is one of those pieces missing. Adding a field means editing all the others.',
        'The fields shouldn’t talk to each other at all. They should report "I changed" to one object that knows the rules.',
      ],
    },
    pattern: {
      name: 'Mediator',
      rule: 'Many objects affect each other → they stop talking to each other and talk to one mediator, which holds every rule about how they interact.',
      explain: [
        'Each field (a **colleague**) knows only the mediator. When the user changes it, it calls `$mediator->changed($this)`. It doesn’t know that a scale, a checkbox or a preview exist.',
        '`QuestionEditor` is the **mediator**. It creates the fields, and in `changed()` it applies every rule: what a type change enables or disables, then the preview and the list of problems. Each rule is written once, in one place, and the ticket’s bug becomes one line in one method.',
        'The event dispatcher from chapter 22 is also a mediator, for the whole app: senders and listeners never know each other. This chapter’s mediator is the classic, local kind: one small group of objects with rules that are specific to them.',
      ],
      drawing: {
        bad: [['b', 14, 14, 84, 34, 'Type', 'n'], ['b', 202, 14, 84, 34, 'Scale', 'n'], ['b', 14, 118, 84, 34, 'Scored', 'n'], ['b', 202, 118, 84, 34, 'Preview', 'n'], ['a', 98, 31, 200, 31, '', 'x'], ['a', 98, 135, 200, 135, '', 'x'], ['a', 56, 48, 56, 116, '', 'x'], ['a', 244, 48, 244, 116, '', 'x'], ['a', 98, 44, 200, 122, '', 'x'], ['a', 98, 122, 200, 44, '', 'x'], ['t', 150, 100, 'everyone calls everyone', 'kx', 'middle']],
        good: [['b', 14, 14, 84, 34, 'Type', 'n'], ['b', 202, 14, 84, 34, 'Scale', 'n'], ['b', 14, 118, 84, 34, 'Scored', 'n'], ['b', 202, 118, 84, 34, 'Preview', 'n'], ['b', 96, 64, 108, 38, 'QuestionEditor', 'v'], ['a', 80, 48, 110, 64, '', 'k'], ['a', 220, 48, 190, 64, '', 'k'], ['a', 80, 118, 110, 102, '', 'k'], ['a', 220, 118, 190, 102, '', 'k'], ['t', 150, 160, 'all the rules in one class', 's', 'middle']],
        badCaption: 'Each field updates the others itself, so every rule is split across classes.',
        goodCaption: 'Each field tells the editor it changed; the editor applies the rules.',
      },
    },
    steps: [
      { title: 'The three kinds of question', text: [], file: 'src/Editor/QuestionType.php' },
      { title: 'The mediator interface', text: ['One method: "this field changed".'], file: 'src/Editor/EditorMediator.php' },
      { title: 'The colleague base class', text: ['A field holds its mediator and notifies it. If someone forgets to attach a field, it fails at once instead of silently ignoring the change.'], file: 'src/Editor/Field.php' },
      { title: 'Field: the question text', text: [], file: 'src/Editor/QuestionTextField.php' },
      { title: 'Field: the question type', text: ['Look at what is missing: no reference to the scale, the checkbox or the preview.'], file: 'src/Editor/QuestionTypeField.php' },
      { title: 'Field: the scale', text: [], file: 'src/Editor/ScaleField.php' },
      { title: 'Field: “count in score”', text: [], file: 'src/Editor/ScoredCheckbox.php' },
      { title: 'Panel: the preview', text: ['Panels only display what the mediator gives them.'], file: 'src/Editor/PreviewPanel.php' },
      { title: 'Panel: the problems list', text: [], file: 'src/Editor/ValidationPanel.php' },
      { title: 'The mediator: every rule in one place', text: ['`applyType()` holds the enable/disable rules, including the line the old code forgot: a comment question unticks "scored". `problems()` holds the validation rules. `refresh()` runs after every change.'], file: 'src/Editor/QuestionEditor.php' },
      { title: 'Simulate a user editing a question', text: [], file: 'bin/editor.php' },
    ],
    run: {
      script: 'bin/editor.php',
      cmd: 'composer dump-autoload\nphp bin/editor.php',
      text: ['Each action changes one field. The editor updates the preview, enables or disables the other fields, and lists the problems. Turning the question into a comment unticks and disables "scored", exactly what the ticket asked for.'],
    },
    laravel: {
      text: [
        'On the server, Laravel’s event dispatcher is the app-wide mediator (chapter 22). In a Livewire form, the parent component plays the role of this chapter’s mediator: child components dispatch events, and the parent applies the rules and updates the others.',
      ],
      code: `// Child component: only reports what happened
final class QuestionTypeSelect extends Component
{
    public string $type = 'scale';

    public function updatedType(): void
    {
        $this->dispatch('type-changed', type: $this->type);
    }
}

// Parent component: the mediator, the only place with the rules
final class QuestionEditor extends Component
{
    public bool $scaleEnabled = true;
    public bool $scored = true;

    #[On('type-changed')]
    public function applyType(string $type): void
    {
        $this->scaleEnabled = $type === 'scale';
        if ($type === 'text') {
            $this->scored = false;
        }
    }
}`,
    },
    check: [
      { q: 'A new field, "required question", must be disabled for comment questions. What changes?', a: 'A new `RequiredCheckbox` field, and one line in `QuestionEditor::applyType()`. No other field changes.' },
      { q: 'Where would you look to find every rule about how the fields affect each other?', a: 'Only in `QuestionEditor`. The fields contain no rules about each other.' },
      { q: 'What is the risk of a mediator, and how do you limit it?', a: 'It can grow into a "god object" that knows everything. Keep one mediator per small group (this one form), and keep logic that belongs to one field inside that field.' },
    ],
    next: 'Now that the editor holds the whole question state in one place, schools ask for the most requested editor feature of all: undo.',
  },

  // ════════════════════════════════════════════════════════════════════
  '30-memento': {
    description: 'Schools want undo and redo in the survey editor without exposing the editor’s internals. Save and restore its state with the Memento pattern in PHP.',
    ticket: {
      from: 'Support desk',
      title: '“I changed the wrong question and can’t go back”',
      body: 'A coordinator turned a scored question into a comment by mistake. Turning it back didn’t restore the scale and the "scored" setting she had before, and she had to rebuild it from memory. Please add Undo and Redo to the question editor.',
    },
    pain: {
      text: ['A first idea was an undo function that copies values out of the fields and back again:'],
      code: `$saved = [
    'text' => $editor->text->value,
    'type' => $editor->type->value,
    'max' => $editor->scale->max,
];
// ... later
$editor->text->value = $saved['text'];
$editor->type->value = $saved['type'];
$editor->scale->max = $saved['max'];
// forgot "scored"; didn't re-apply the editor's rules; the preview is now stale`,
      after: [
        'The undo code has to know every field inside the editor and keep that list up to date; the next field added (or the one already forgotten) silently breaks undo. Writing the values back also skips the editor’s rules, so the preview and the enabled fields don’t match what is shown.',
        'Only the editor knows its full state and how to put it back correctly. The rest of the app should just be able to say "save this moment" and "go back to it".',
      ],
    },
    pattern: {
      name: 'Memento',
      rule: 'You need to save and restore an object’s state without exposing its internals → the object writes its own snapshot, someone else keeps the snapshots, and only the object can restore from one.',
      explain: [
        'Three roles. The **originator** (`QuestionEditor`) can create a snapshot of itself and restore from one, re-applying its own rules. The **memento** (`EditorSnapshot`) is that saved state: immutable, so nobody can change it while it waits. The **caretaker** (`History`) keeps the snapshots in an undo stack and a redo stack, and never looks inside them.',
        'Before each user change, `History::record()` saves a snapshot. Undo puts the current state on the redo stack and restores the previous one; a new change clears the redo stack, as in every editor. The stack has a limit, so a long session can’t grow memory forever.',
        'In the book, the memento’s contents are hidden from the caretaker with language features PHP doesn’t have. Here immutability gives the same safety: the history can store and return a snapshot, but can’t alter it.',
      ],
      drawing: {
        bad: [['b', 4, 64, 76, 38, 'Undo code', 'x'], ['a', 80, 72, 206, 24, '', 'x'], ['a', 80, 78, 206, 64, '', 'x'], ['a', 80, 88, 206, 104, '', 'x'], ['a', 80, 94, 206, 144, '', 'x'], ['b', 208, 10, 88, 28, 'text', 'n'], ['b', 208, 50, 88, 28, 'type', 'n'], ['b', 208, 90, 88, 28, 'scale', 'n'], ['b', 208, 130, 88, 28, 'scored?', 'x'], ['t', 120, 150, 'knows every field', 'kx', 'middle']],
        good: [['b', 4, 62, 92, 40, 'QuestionEditor', 'n'], ['a', 96, 82, 116, 82, '', 'k'], ['b', 118, 62, 84, 40, 'Snapshot', 'v'], ['a', 202, 82, 222, 82, '', 'k'], ['b', 224, 62, 72, 40, 'History', 'v2'], ['t', 160, 122, 'immutable', 's', 'middle'], ['t', 150, 146, 'History stores it, only the editor reads it', 's', 'middle']],
        badCaption: 'The undo code reaches into every field, and forgets some.',
        goodCaption: 'The editor saves itself into a snapshot; History only keeps it.',
      },
    },
    steps: [
      { title: 'The memento', text: ['Everything needed to put the editor back exactly as it was, and when it was taken.'], file: 'src/Editor/EditorSnapshot.php' },
      { title: 'The originator saves and restores itself', text: ['`restore()` sets the values, then runs the same rules as a user change once (`applyType()` and `refresh()`), so the preview and the enabled fields always match.'], file: 'src/Editor/QuestionEditor.php', diff: 'src/Editor/QuestionEditor.php' },
      { title: 'The caretaker', text: ['Two stacks and a limit. It calls `snapshot()` and `restore()` and never reads a snapshot’s contents.'], file: 'src/Editor/History.php' },
      { title: 'Every user change goes through the history', text: [], file: 'bin/editor.php', diff: 'bin/editor.php' },
    ],
    run: {
      script: 'bin/editor.php',
      cmd: 'composer dump-autoload\nphp bin/editor.php',
      text: ['Two undos bring the question back to the scored 1–5 scale, with the preview and the problems list correct at every step. Redo goes forward again, and a new change switches Redo off.'],
    },
    laravel: {
      text: [
        'Laravel has no Memento class, but Eloquent keeps one for every model: the attributes as they were loaded. `getOriginal()` returns them, `isDirty()` compares, and `fill($model->getOriginal())` goes back. For undo across requests, store snapshots in the database (packages like `spatie/laravel-activitylog` save the before/after of every change).',
      ],
      code: `$question = Question::find(12);          // Eloquent remembers the loaded attributes
$question->type = 'text';
$question->scored = false;

$question->isDirty('type');              // true
$question->getOriginal('type');          // 'scale': the saved state

$question->fill($question->getOriginal());   // "undo" before saving
$question->isDirty();                    // false`,
    },
    check: [
      { q: 'A new field, "required", is added to the editor. What must change for undo to keep working?', a: 'The snapshot gets a `required` property, and `snapshot()` and `restore()` in the editor handle it. `History` doesn’t change.' },
      { q: 'Why does `restore()` call `applyType()` and `refresh()` instead of only setting values?', a: 'Restoring must leave the editor consistent: the enabled fields, the preview and the problems list depend on the values. Setting them without the rules was the bug of the quick fix.' },
      { q: 'Why does a new change clear the redo stack?', a: 'Redo means "go forward to a state that came after this one". After a new change, those states belong to a different history, so redoing them would mix two timelines.' },
    ],
    next: 'That was the last chapter. Evalu8 now uses all 23 Gang of Four patterns and 15 more. The pattern index on the course page lists each one and the chapter where it solves a real problem.',
  },
};

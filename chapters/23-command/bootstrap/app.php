<?php

declare(strict_types=1);

/*
 * The ONE place that decides how the app's objects are built and connected.
 * Every entry script (bin/*.php) starts with: $app = require __DIR__ . '/../bootstrap/app.php';
 */

use Evalu8\Analysis\AnalyzeTeacherComments;
use Evalu8\Analysis\AnalyzeTeacherCommentsHandler;
use Evalu8\Analysis\AnalyzerManager;
use Evalu8\Bus\CommandBus;
use Evalu8\Bus\DatabaseQueue;
use Evalu8\Bus\Queue;
use Evalu8\Analysis\CachingCommentAnalyzer;
use Evalu8\Analysis\CommentAnalyzer;
use Evalu8\Analysis\LoggingCommentAnalyzer;
use Evalu8\Analysis\RetryingCommentAnalyzer;
use Evalu8\Cache\ArrayCache;
use Evalu8\Cache\Cache;
use Evalu8\Closing\TermClosing;
use Evalu8\Container\Container;
use Evalu8\Events\EventDispatcher;
use Evalu8\Lifecycle\Listeners\EmailThePrincipal;
use Evalu8\Lifecycle\Listeners\NotifyMinistry;
use Evalu8\Lifecycle\Listeners\QueueCommentAnalysis;
use Evalu8\Lifecycle\Listeners\WriteAuditLog;
use Evalu8\Lifecycle\SurveyClosed;
use Evalu8\Demo\SampleData;
use Evalu8\Domain\ResponseRepository;
use Evalu8\Domain\SchoolRepository;
use Evalu8\Domain\TeacherRepository;
use Evalu8\Infrastructure\Sqlite\Schema;
use Evalu8\Infrastructure\Sqlite\SqliteResponseRepository;
use Evalu8\Infrastructure\Sqlite\SqliteSchoolRepository;
use Evalu8\Infrastructure\Sqlite\SqliteTeacherRepository;
use Evalu8\Infrastructure\Sqlite\SqliteTermResultStore;
use Evalu8\Logging\Logger;
use Evalu8\Logging\StreamLogger;
use Evalu8\Mail\ConsoleMailer;
use Evalu8\Mail\Mailer;
use Evalu8\Reporting\MinistryExport;
use Evalu8\Reporting\TermReport;
use Evalu8\Reporting\TermResultStore;

require __DIR__ . '/../vendor/autoload.php';

$app = new Container();

// One database connection for the whole run, built the first time something needs it.
$app->singleton(PDO::class, function (): PDO {
    $db = new PDO(getenv('EVALU8_DSN') ?: 'sqlite::memory:');
    $db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    Schema::create($db);
    SampleData::load($db);

    return $db;
});

// Interfaces → the classes that implement them. Everything else is built automatically.
$app->singleton(TeacherRepository::class, fn (Container $c) => $c->make(SqliteTeacherRepository::class));
$app->singleton(ResponseRepository::class, fn (Container $c) => $c->make(SqliteResponseRepository::class));
$app->singleton(SchoolRepository::class, fn (Container $c) => $c->make(SqliteSchoolRepository::class));
$app->singleton(TermResultStore::class, fn (Container $c) => $c->make(SqliteTermResultStore::class));
$app->singleton(Mailer::class, fn () => new ConsoleMailer());

// TermClosing needs one plain value (where to write exports), so it gets a factory.
$app->bind(TermClosing::class, fn (Container $c) => new TermClosing(
    $c->make(TermReport::class),
    $c->make(TermResultStore::class),
    $c->make(Mailer::class),
    $c->make(MinistryExport::class),
    $c->make(Logger::class),
    getenv('EVALU8_EXPORT_DIR') ?: __DIR__ . '/../var',
));

// Which analyzer runs is decided by config/ai.php, per environment.
$app->singleton(AnalyzerManager::class, fn () => new AnalyzerManager(require __DIR__ . '/../config/ai.php'));
$app->singleton(Cache::class, fn () => new ArrayCache());
$app->singleton(Logger::class, fn () => new StreamLogger(STDOUT));

// The analyzer the app uses: the configured driver, wrapped in three layers.
// Read it from the inside out: retry timeouts → log each real call → cache the result.
$app->singleton(CommentAnalyzer::class, fn (Container $c) => new CachingCommentAnalyzer(
    new LoggingCommentAnalyzer(
        new RetryingCommentAnalyzer($c->make(AnalyzerManager::class)->driver()),
        $c->make(Logger::class),
    ),
    $c->make(Cache::class),
));

// Commands and the handler that carries out each one.
$app->singleton(Queue::class, fn (Container $c) => $c->make(DatabaseQueue::class));
$app->singleton(CommandBus::class, function (Container $c): CommandBus {
    $bus = new CommandBus(fn (string $class): object => $c->make($class), $c->make(Queue::class), $c->make(Logger::class));
    $bus->register(AnalyzeTeacherComments::class, AnalyzeTeacherCommentsHandler::class);

    return $bus;
});

// Who reacts to what: the only place that lists the listeners of each event.
$app->singleton(EventDispatcher::class, function (Container $c): EventDispatcher {
    $events = new EventDispatcher(fn (string $class): object => $c->make($class), $c->make(Logger::class));

    $events->listen(SurveyClosed::class, EmailThePrincipal::class);
    $events->listen(SurveyClosed::class, QueueCommentAnalysis::class);
    $events->listen(SurveyClosed::class, NotifyMinistry::class);
    $events->listen(SurveyClosed::class, WriteAuditLog::class);

    return $events;
});

return $app;

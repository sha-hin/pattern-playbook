<?php

declare(strict_types=1);

/*
 * The ONE place that decides how the app's objects are built and connected.
 * Every entry script (bin/*.php) starts with: $app = require __DIR__ . '/../bootstrap/app.php';
 */

use Evalu8\Analysis\AnalyzerManager;
use Evalu8\Analysis\CachingCommentAnalyzer;
use Evalu8\Analysis\CommentAnalyzer;
use Evalu8\Analysis\LoggingCommentAnalyzer;
use Evalu8\Analysis\RetryingCommentAnalyzer;
use Evalu8\Cache\ArrayCache;
use Evalu8\Cache\Cache;
use Evalu8\Container\Container;
use Evalu8\Demo\SampleData;
use Evalu8\Domain\ResponseRepository;
use Evalu8\Domain\SchoolRepository;
use Evalu8\Domain\TeacherRepository;
use Evalu8\Infrastructure\Sqlite\Schema;
use Evalu8\Infrastructure\Sqlite\SqliteResponseRepository;
use Evalu8\Infrastructure\Sqlite\SqliteSchoolRepository;
use Evalu8\Infrastructure\Sqlite\SqliteTeacherRepository;
use Evalu8\Logging\Logger;
use Evalu8\Logging\StreamLogger;

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

return $app;

<?php

declare(strict_types=1);

/*
 * The ONE place that decides how the app's objects are built and connected.
 * Every entry script (bin/*.php) starts with: $app = require __DIR__ . '/../bootstrap/app.php';
 */

use Evalu8\Analysis\CommentAnalyzer;
use Evalu8\Analysis\OllamaCommentAnalyzer;
use Evalu8\Container\Container;
use Evalu8\Demo\SampleData;
use Evalu8\Domain\ResponseRepository;
use Evalu8\Domain\SchoolRepository;
use Evalu8\Domain\TeacherRepository;
use Evalu8\Infrastructure\Sqlite\Schema;
use Evalu8\Infrastructure\Sqlite\SqliteResponseRepository;
use Evalu8\Infrastructure\Sqlite\SqliteSchoolRepository;
use Evalu8\Infrastructure\Sqlite\SqliteTeacherRepository;

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

// Comment analysis runs on our own Ollama server (comments must stay on our servers).
// Switching to OpenAI is one line: bind OpenAiCommentAnalyzer instead. Nothing else changes.
$app->singleton(CommentAnalyzer::class, fn () => new OllamaCommentAnalyzer(
    new Ollama\Client(getenv('OLLAMA_HOST') ?: 'http://localhost:11434'),
    getenv('OLLAMA_MODEL') ?: 'llama3.2',
));

return $app;

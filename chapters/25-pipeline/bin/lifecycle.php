<?php

declare(strict_types=1);

/*
 * Evalu8, chapter 23: slow work is queued as commands and done by a background worker.
 *
 *     composer dump-autoload
 *     php bin/lifecycle.php
 */

use Evalu8\Analysis\AnalyzeTeacherComments;
use Evalu8\Bus\CommandBus;
use Evalu8\Bus\Queue;
use Evalu8\Bus\Worker;
use Evalu8\Container\Container;
use Evalu8\Demo\SampleData;
use Evalu8\Domain\EmailAddress;
use Evalu8\Domain\ResponseRepository;
use Evalu8\Events\EventDispatcher;
use Evalu8\Lifecycle\SurveyRun;
use Evalu8\Logging\Logger;

const CURRENT_TERM = '2026-T1';

/** @var Container $app */
$app = require __DIR__ . '/../bootstrap/app.php';
SampleData::loadAnswers($app->make(ResponseRepository::class), CURRENT_TERM);

echo "── THE WEB REQUEST: the principal clicks \"Close survey\" ──\n";
$run = new SurveyRun('Teacher evaluation', CURRENT_TERM, 'Smouha', new EmailAddress('principal@smouha.edu.eg'));
$run->open();
$run->submitAnswer();
$run->close(new DateTimeImmutable('2026-06-11'));
foreach ($run->releaseEvents() as $event) {
    $app->make(EventDispatcher::class)->dispatch($event);   // the listener queues one job per teacher
}

// A support agent re-runs the analysis for a teacher id that doesn't exist:
$app->make(CommandBus::class)->dispatch(new AnalyzeTeacherComments(99, CURRENT_TERM));
echo "HTTP 202 Accepted: the analysis runs in the background.\n";

echo "\n── LATER, THE WORKER PROCESS ──\n";
$worker = new Worker($app->make(Queue::class), $app->make(CommandBus::class), $app->make(Logger::class), maxAttempts: 3);
$worker->runUntilEmpty();

echo "\n── STORED SUMMARIES ──\n";
foreach ($app->make(PDO::class)->query('SELECT teacher_id, summary FROM comment_summaries ORDER BY teacher_id') as $row) {
    echo "  teacher {$row['teacher_id']}: {$row['summary']}\n";
}
echo "\n── JOBS TABLE ──\n";
foreach ($app->make(PDO::class)->query('SELECT id, status, attempts, last_error FROM jobs') as $row) {
    echo "  job {$row['id']}: {$row['status']} after {$row['attempts']} attempt(s)" . ($row['last_error'] ? " ({$row['last_error']})" : '') . "\n";
}

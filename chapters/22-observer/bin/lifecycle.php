<?php

declare(strict_types=1);

/*
 * Evalu8, chapter 22: closing a survey announces it; listeners react.
 *
 *     composer dump-autoload
 *     php bin/lifecycle.php
 */

use Evalu8\Container\Container;
use Evalu8\Domain\EmailAddress;
use Evalu8\Events\EventDispatcher;
use Evalu8\Lifecycle\SurveyRun;

/** @var Container $app */
$app = require __DIR__ . '/../bootstrap/app.php';
$events = $app->make(EventDispatcher::class);

$run = new SurveyRun('Teacher evaluation 2026-T2', 'Smouha', new EmailAddress('principal@smouha.edu.eg'));
$run->open();
$run->submitAnswer();
$run->submitAnswer();
$run->close(new DateTimeImmutable('2026-06-11'));
echo "Survey is now {$run->status()}. Dispatching what happened:\n";

foreach ($run->releaseEvents() as $event) {
    $failures = $events->dispatch($event);
    echo $event::class . ': ' . (count($failures) === 0 ? 'all listeners ran' : count($failures) . ' listener(s) failed, the others still ran') . "\n";
    foreach ($failures as $failure) {
        echo "  failed: {$failure}\n";
    }
}

echo 'Events left to dispatch: ' . count($run->releaseEvents()) . "\n";

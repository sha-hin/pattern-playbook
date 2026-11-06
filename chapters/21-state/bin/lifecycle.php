<?php

declare(strict_types=1);

/*
 * Evalu8, chapter 21: a survey run moves through its statuses, and each status decides what is allowed.
 *
 *     composer dump-autoload
 *     php bin/lifecycle.php
 */

require __DIR__ . '/../vendor/autoload.php';

use Evalu8\Lifecycle\SurveyRun;
use Evalu8\Lifecycle\TransitionNotAllowed;

$run = new SurveyRun('Teacher evaluation 2026-T2, Smouha');
$day = fn (int $n): DateTimeImmutable => new DateTimeImmutable("2026-06-01 +{$n} days");

/** @param callable(): void $action */
function attempt(string $label, callable $action, SurveyRun $run): void
{
    try {
        $action();
        echo str_pad($label, 34) . "ok, now {$run->status()}\n";
    } catch (TransitionNotAllowed $e) {
        echo str_pad($label, 34) . "refused: {$e->getMessage()}\n";
    }
}

attempt('Student answers the draft', fn () => $run->submitAnswer(), $run);
attempt('Principal opens it', fn () => $run->open(), $run);
attempt('Student answers', fn () => $run->submitAnswer(), $run);
attempt('Student answers', fn () => $run->submitAnswer(), $run);
attempt('Closed on day 10', fn () => $run->close($day(10)), $run);
attempt('Late student answers', fn () => $run->submitAnswer(), $run);
attempt('Reopened on day 12', fn () => $run->reopen($day(12)), $run);
attempt('Late student answers', fn () => $run->submitAnswer(), $run);
attempt('Closed again on day 14', fn () => $run->close($day(14)), $run);
attempt('Reopen attempt on day 30', fn () => $run->reopen($day(30)), $run);
attempt('Archived', fn () => $run->archive(), $run);
attempt('Reopen the archive', fn () => $run->reopen($day(31)), $run);

echo "\n{$run->answers()} answers accepted\n";
echo 'History: ' . implode(', ', $run->history()) . "\n";

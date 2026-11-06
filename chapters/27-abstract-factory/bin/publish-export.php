<?php

declare(strict_types=1);

/*
 * Evalu8, chapter 27: storage and queue always come from the same infrastructure family.
 *
 *     composer dump-autoload
 *     php bin/publish-export.php
 *
 * In production one environment variable picks the family: EVALU8_INFRA=local or EVALU8_INFRA=cloud.
 * This demo runs both, one after the other.
 */

use Evalu8\Bus\Worker;
use Evalu8\Container\Container;
use Evalu8\Demo\SampleData;
use Evalu8\Domain\ResponseRepository;
use Evalu8\Infrastructure\Kit\InfrastructureKit;
use Evalu8\Reporting\ExportPublisher;
use Evalu8\Reporting\TermReport;

const CURRENT_TERM = '2026-T1';

foreach (['local', 'cloud'] as $infrastructure) {
    putenv("EVALU8_INFRA={$infrastructure}");

    /** @var Container $app */
    $app = require __DIR__ . '/../bootstrap/app.php';
    echo "\n== {$app->make(InfrastructureKit::class)->name()} ==\n";
    SampleData::loadAnswers($app->make(ResponseRepository::class), CURRENT_TERM);

    $csv = "teacher,score\n";
    foreach ($app->make(TermReport::class)->results(CURRENT_TERM) as $result) {
        $csv .= "{$result->teacher->name}," . ($result->score === null ? '' : round($result->score, 2)) . "\n";
    }

    // The web request: store the file and queue the follow-up job. One kit, so they match.
    $location = $app->make(ExportPublisher::class)->publish(CURRENT_TERM, $csv);
    echo "Stored at: {$location}\n";

    // The worker (on the same server for "local", on any server for "cloud") reads the file back.
    $app->make(Worker::class)->runUntilEmpty();
}

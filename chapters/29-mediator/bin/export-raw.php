<?php

declare(strict_types=1);

/*
 * Evalu8, chapter 14: export every answer of a big term with flat memory.
 *
 *     composer dump-autoload
 *     php bin/export-raw.php
 */

use Evalu8\Container\Container;
use Evalu8\Demo\SampleData;
use Evalu8\Domain\ResponseRepository;
use Evalu8\Reporting\RawAnswersExport;
use Evalu8\Reporting\TermResponses;

const BIG_TERM = '2026-T1';
const ANSWERS = 100_000;

/** @var Container $app */
$app = require __DIR__ . '/../bootstrap/app.php';
SampleData::loadManyAnswers($app->make(PDO::class), BIG_TERM, ANSWERS);

$responses = $app->make(ResponseRepository::class);
$export = new RawAnswersExport();
$path = sys_get_temp_dir() . '/evalu8-raw-answers.csv';

/** Runs $work and returns how many MB of extra memory it needed at its peak. */
function peakMb(callable $work): float
{
    gc_collect_cycles();
    memory_reset_peak_usage();
    $before = memory_get_usage();
    $work();

    return round((memory_get_peak_usage() - $before) / 1_048_576, 1);
}

echo 'Exporting ' . number_format(ANSWERS) . " answers\n\n";

$asArray = peakMb(function () use ($responses, $export, $path): void {
    $all = iterator_to_array($responses->inTerm(BIG_TERM), false);   // the old way: load everything first
    $export->write($all, $path);
});
echo "Load everything into an array, then write: {$asArray} MB\n";

$streamed = peakMb(function () use ($responses, $export, $path): void {
    $export->write($responses->inTerm(BIG_TERM), $path);             // stream: one batch at a time
});
echo "Stream with a generator:                   {$streamed} MB\n";

// TermResponses can be looped over more than once; a bare generator can't.
$term = new TermResponses($responses, BIG_TERM);
$first = 0;
foreach ($term as $response) {
    $first++;
}
$second = 0;
foreach ($term as $response) {
    $second++;
}
echo "\nLooped twice over TermResponses: {$first} and {$second} answers\n";

$generator = $responses->inTerm(BIG_TERM);
foreach ($generator as $index => $response) {
    if ($index === 1) {
        break;                                              // read two answers...
    }
}
try {
    foreach ($generator as $response) {                     // ...and try to loop over it again
    }
} catch (Exception $e) {
    echo "Looping twice over a bare generator: {$e->getMessage()}\n";
}

unlink($path);

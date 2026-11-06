<?php

declare(strict_types=1);

/*
 * Evalu8, chapter 15: a whole term in memory, with shared Score objects.
 *
 *     composer dump-autoload
 *     php bin/statistics.php
 */

use Evalu8\Container\Container;
use Evalu8\Demo\SampleData;
use Evalu8\Domain\Response;
use Evalu8\Domain\ResponseRepository;
use Evalu8\Domain\Score;

const BIG_TERM = '2026-T1';
const ANSWERS = 100_000;

/** @var Container $app */
$app = require __DIR__ . '/../bootstrap/app.php';
SampleData::loadManyAnswers($app->make(PDO::class), BIG_TERM, ANSWERS);
$responses = $app->make(ResponseRepository::class);

/**
 * Loads the whole term and returns [the answers, MB of memory they occupy].
 *
 * @param callable(Response): Response $copy
 * @return array{0: list<Response>, 1: float}
 */
function loadTerm(ResponseRepository $responses, callable $copy): array
{
    gc_collect_cycles();
    $before = memory_get_usage();

    $all = [];
    foreach ($responses->inTerm(BIG_TERM) as $response) {
        $all[] = $copy($response);
    }

    return [$all, round((memory_get_usage() - $before) / 1_048_576, 1)];
}

// What the mapper produced before this chapter: a new Score and a new term string for every row.
[$unshared, $unsharedMb] = loadTerm($responses, fn (Response $r): Response => new Response(
    $r->teacherId,
    str_repeat($r->term, 1),                                // a fresh copy, as PDO returns it
    $r->role,
    new Score($r->score->value),                            // a fresh object per answer
    $r->comment,
));
unset($unshared);

// What it produces now: shared Score objects and one shared term string.
[$all, $sharedMb] = loadTerm($responses, fn (Response $r): Response => $r);

echo 'Holding ' . number_format(count($all)) . " answers in memory
";
echo "  one Score object per answer: {$unsharedMb} MB
";
echo "  shared Score objects (now):  {$sharedMb} MB\n\n";

// How many different Score objects are there behind 100,000 answers?
$scoreObjects = [];
$distribution = [];
foreach ($all as $response) {
    $scoreObjects[spl_object_id($response->score)] = true;
    $distribution[$response->score->value] = ($distribution[$response->score->value] ?? 0) + 1;
}
ksort($distribution);

echo 'Distinct Score objects: ' . count($scoreObjects) . "\n";
echo 'Score::of(4) === Score::of(4): ' . (Score::of(4) === Score::of(4) ? 'yes, the same object' : 'no') . "\n\n";

echo "DISTRIBUTION\n";
foreach ($distribution as $score => $count) {
    echo "  {$score}: " . str_repeat('#', intdiv($count, 1000)) . " {$count}\n";
}

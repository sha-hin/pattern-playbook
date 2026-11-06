<?php

declare(strict_types=1);

/*
 * Evalu8, chapter 11: closing a term is one call, wherever it is started from.
 *
 *     composer dump-autoload
 *     php bin/close-term.php
 */

use Evalu8\Closing\TermAlreadyClosed;
use Evalu8\Closing\TermClosing;
use Evalu8\Container\Container;
use Evalu8\Demo\SampleData;
use Evalu8\Domain\ResponseRepository;

const CURRENT_TERM = '2026-T1';

/** @var Container $app */
$app = require __DIR__ . '/../bootstrap/app.php';
SampleData::loadAnswers($app->make(ResponseRepository::class), CURRENT_TERM);

$closing = $app->make(TermClosing::class);

echo "CLOSING " . CURRENT_TERM . "\n";
$summary = $closing->close(CURRENT_TERM);                   // the whole process, in the right order

echo "\nSUMMARY\n";
echo "  teachers:    {$summary->teachers}\n";
echo "  emailed:     {$summary->emailed}\n";
echo '  not emailed: ' . implode(', ', $summary->notEmailed) . "\n";
echo '  export:      ' . basename($summary->exportPath) . "\n";
echo "\n" . file_get_contents($summary->exportPath);

echo "\nTHE SCHEDULER TRIES TO CLOSE IT AGAIN\n";
try {
    $closing->close(CURRENT_TERM);
} catch (TermAlreadyClosed $e) {
    echo "  refused: {$e->getMessage()}\n";
}

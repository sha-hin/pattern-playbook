<?php

declare(strict_types=1);

/*
 * Evalu8, chapter 12: every file format is imported by the same recipe.
 *
 *     composer dump-autoload
 *     php bin/import.php
 */

use Evalu8\Container\Container;
use Evalu8\Import\GoogleFormsCsvImport;
use Evalu8\Import\ImportResult;
use Evalu8\Import\MicrosoftFormsJsonImport;

const CURRENT_TERM = '2026-T1';

/** @var Container $app */
$app = require __DIR__ . '/../bootstrap/app.php';

function report(ImportResult $result): void
{
    echo "{$result->source}: {$result->imported} imported, " . count($result->rejected) . " rejected\n";
    foreach ($result->rejected as $reason) {
        echo "  {$reason}\n";
    }
}

report($app->make(GoogleFormsCsvImport::class)->import(__DIR__ . '/../data/google-forms.csv', CURRENT_TERM));
report($app->make(MicrosoftFormsJsonImport::class)->import(__DIR__ . '/../data/microsoft-forms.json', CURRENT_TERM));

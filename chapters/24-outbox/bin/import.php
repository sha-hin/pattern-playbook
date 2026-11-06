<?php

declare(strict_types=1);

/*
 * Evalu8, chapter 13: preview a file, then import it. Each format creates its own reader.
 *
 *     composer dump-autoload
 *     php bin/import.php
 */

use Evalu8\Container\Container;
use Evalu8\Import\AnswerImport;
use Evalu8\Import\ExcelCsvImport;
use Evalu8\Import\GoogleFormsCsvImport;
use Evalu8\Import\MicrosoftFormsJsonImport;

const CURRENT_TERM = '2026-T1';

/** @var Container $app */
$app = require __DIR__ . '/../bootstrap/app.php';

/** @var array<string, class-string<AnswerImport>> $files */
$files = [
    'google-forms.csv' => GoogleFormsCsvImport::class,
    'microsoft-forms.json' => MicrosoftFormsJsonImport::class,
    'excel-export.csv' => ExcelCsvImport::class,
];

foreach ($files as $file => $importClass) {
    $import = $app->make($importClass);
    $path = __DIR__ . "/../data/{$file}";

    echo "{$file}\n  preview:\n";
    foreach ($import->preview($path, 2) as $raw) {
        echo "    teacher {$raw->teacherId}, {$raw->role}, score {$raw->score}\n";
    }

    $result = $import->import($path, CURRENT_TERM);
    echo "  {$result->imported} imported, " . count($result->rejected) . " rejected\n";
    foreach ($result->rejected as $reason) {
        echo "    {$reason}\n";
    }
    echo "\n";
}

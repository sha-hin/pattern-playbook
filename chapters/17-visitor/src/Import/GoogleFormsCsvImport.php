<?php

declare(strict_types=1);

namespace Evalu8\Import;

/**
 * Google Forms → "Download responses (.csv)". The first line holds the question titles.
 */
final class GoogleFormsCsvImport extends AnswerImport
{
    protected function createReader(): RowReader
    {
        return new CsvRowReader(',');
    }

    protected function mapRow(array $row): RawAnswer
    {
        return new RawAnswer($row['Teacher ID'], $row['You are'], $row['Score (1-5)'], $row['Comment']);
    }

    protected function sourceName(): string
    {
        return 'Google Forms CSV';
    }
}

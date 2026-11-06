<?php

declare(strict_types=1);

namespace Evalu8\Import;

/**
 * Evalu8's Excel template, saved as "CSV UTF-8". Excel in Arabic and many European locales
 * separates columns with ";" and starts the file with a byte-order mark.
 */
final class ExcelCsvImport extends AnswerImport
{
    protected function createReader(): RowReader
    {
        return new CsvRowReader(';');
    }

    protected function mapRow(array $row): RawAnswer
    {
        return new RawAnswer($row['Teacher'], $row['Role'], $row['Score'], $row['Comment']);
    }

    protected function sourceName(): string
    {
        return 'Excel CSV';
    }
}

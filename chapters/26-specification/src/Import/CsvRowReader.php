<?php

declare(strict_types=1);

namespace Evalu8\Import;

use RuntimeException;

/**
 * Reads a CSV file whose first line holds the column names.
 * Handles any delimiter, and the byte-order mark Excel adds to UTF-8 files.
 */
final readonly class CsvRowReader implements RowReader
{
    private const UTF8_BOM = "\xEF\xBB\xBF";

    public function __construct(private string $delimiter = ',')
    {
    }

    public function rows(string $path): iterable
    {
        $file = fopen($path, 'r');
        if ($file === false) {
            throw new RuntimeException("Can't open {$path}.");
        }

        try {
            if (fread($file, 3) !== self::UTF8_BOM) {
                rewind($file);                              // no BOM: start again from the first byte
            }

            $header = fgetcsv($file, separator: $this->delimiter, escape: '');
            if ($header === false) {
                return;
            }

            $line = 1;
            while (($values = fgetcsv($file, separator: $this->delimiter, escape: '')) !== false) {
                $line++;
                if ($values === [null]) {
                    continue;                               // a blank line
                }

                /** @var array<string, string> $row */
                $row = array_combine($header, array_pad(array_map('strval', $values), count($header), ''));
                yield $line => $row;
            }
        } finally {
            fclose($file);
        }
    }
}

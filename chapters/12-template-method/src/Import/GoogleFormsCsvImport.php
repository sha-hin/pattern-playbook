<?php

declare(strict_types=1);

namespace Evalu8\Import;

use RuntimeException;

/**
 * Google Forms → "Download responses (.csv)". The first line holds the question titles.
 */
final class GoogleFormsCsvImport extends AnswerImport
{
    protected function readRows(string $path): iterable
    {
        $file = fopen($path, 'r');
        if ($file === false) {
            throw new RuntimeException("Can't open {$path}.");
        }

        try {
            $header = fgetcsv($file, escape: '');
            if ($header === false) {
                return;
            }

            $line = 1;
            while (($values = fgetcsv($file, escape: '')) !== false) {
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

    protected function mapRow(array $row): RawAnswer
    {
        return new RawAnswer($row['Teacher ID'], $row['You are'], $row['Score (1-5)'], $row['Comment']);
    }

    protected function sourceName(): string
    {
        return 'Google Forms CSV';
    }
}

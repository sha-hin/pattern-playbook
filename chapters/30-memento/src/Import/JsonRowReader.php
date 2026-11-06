<?php

declare(strict_types=1);

namespace Evalu8\Import;

use RuntimeException;

/**
 * Reads a JSON list of submissions, e.g. [{"id": 1, "answers": {...}}, ...].
 */
final readonly class JsonRowReader implements RowReader
{
    public function __construct(
        private string $idField = 'id',
        private string $rowField = 'answers',
    ) {
    }

    public function rows(string $path): iterable
    {
        $json = file_get_contents($path);
        if ($json === false) {
            throw new RuntimeException("Can't open {$path}.");
        }

        /** @var list<array<string, mixed>> $items */
        $items = json_decode($json, true, flags: JSON_THROW_ON_ERROR);

        foreach ($items as $item) {
            /** @var array<string, string> $row */
            $row = $item[$this->rowField] ?? [];
            yield (int) ($item[$this->idField] ?? 0) => $row;
        }
    }
}

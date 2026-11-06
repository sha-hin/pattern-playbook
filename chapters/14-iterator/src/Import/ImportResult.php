<?php

declare(strict_types=1);

namespace Evalu8\Import;

final readonly class ImportResult
{
    /** @param list<string> $rejected one line per rejected row, with its row number and reason */
    public function __construct(
        public string $source,
        public int $imported,
        public array $rejected,
    ) {
    }
}

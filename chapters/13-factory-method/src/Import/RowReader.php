<?php

declare(strict_types=1);

namespace Evalu8\Import;

/**
 * Reads rows out of one kind of file. Usable on its own: by imports, previews, or anything else.
 */
interface RowReader
{
    /** @return iterable<int, array<string, string>> row number (or id) => column name => value */
    public function rows(string $path): iterable;
}

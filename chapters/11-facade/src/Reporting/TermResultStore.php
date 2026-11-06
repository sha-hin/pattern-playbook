<?php

declare(strict_types=1);

namespace Evalu8\Reporting;

/**
 * Keeps the final results of a closed term, so late answers can never change them.
 */
interface TermResultStore
{
    public function isClosed(string $term): bool;

    /** @param list<TeacherResult> $results */
    public function saveAndClose(string $term, array $results): void;
}

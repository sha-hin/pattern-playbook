<?php

declare(strict_types=1);

namespace Evalu8\Analysis;

/**
 * Turns a teacher's written comments into a short summary for the report.
 */
interface CommentAnalyzer
{
    /** @param list<string> $comments */
    public function summarize(array $comments): string;
}

<?php

declare(strict_types=1);

namespace Evalu8\Analysis;

/**
 * The Null Object: a real CommentAnalyzer that safely does nothing.
 * Used for schools whose plan doesn't include analysis, so no caller
 * ever needs to check "is there an analyzer?".
 */
final readonly class NoCommentAnalysis implements CommentAnalyzer
{
    public function summarize(array $comments): string
    {
        return 'not included in this school’s plan';
    }
}

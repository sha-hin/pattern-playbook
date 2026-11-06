<?php

declare(strict_types=1);

namespace Evalu8\Analysis;

use Evalu8\Domain\School;

/**
 * Decides ONCE, from the school's settings, which analyzer it gets.
 * "No analysis" is a normal choice here, so it is an object, not null.
 */
final readonly class CommentAnalyzerFactory
{
    public function __construct(private CommentAnalyzer $analyzer)
    {
    }

    public function forSchool(School $school): CommentAnalyzer
    {
        return $school->commentAnalysis ? $this->analyzer : new NoCommentAnalysis();
    }
}

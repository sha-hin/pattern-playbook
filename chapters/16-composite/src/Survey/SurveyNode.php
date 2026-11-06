<?php

declare(strict_types=1);

namespace Evalu8\Survey;

/**
 * The Component: what a single question and a whole section have in common.
 * Code that works with the survey treats both the same way.
 */
interface SurveyNode
{
    public function title(): string;

    /** How much this node counts inside its parent section. */
    public function weight(): float;

    /** @return float|null null when nothing inside this node was answered */
    public function score(AnswerSheet $answers): ?float;

    /** @return list<SurveyNode> empty for a question */
    public function children(): array;
}

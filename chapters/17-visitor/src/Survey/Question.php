<?php

declare(strict_types=1);

namespace Evalu8\Survey;

use InvalidArgumentException;

/**
 * The Leaf: one question, answered with a 1–5 score. It has no children.
 */
final readonly class Question implements SurveyNode
{
    public function __construct(
        public string $code,                                // e.g. "q1"; how answers refer to it
        public string $text,
        private float $weight = 1.0,
    ) {
        if ($weight <= 0) {
            throw new InvalidArgumentException("Question {$code} must have a positive weight.");
        }
    }

    public function title(): string
    {
        return $this->text;
    }

    public function weight(): float
    {
        return $this->weight;
    }

    public function score(AnswerSheet $answers): ?float
    {
        $score = $answers->scoreFor($this->code);

        return $score === null ? null : (float) $score->value;   // a leaf simply answers
    }

    public function children(): array
    {
        return [];
    }

    public function accept(SurveyVisitor $visitor): void
    {
        $visitor->visitQuestion($this);
    }
}

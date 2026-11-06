<?php

declare(strict_types=1);

namespace Evalu8\Survey;

use InvalidArgumentException;

/**
 * The Composite: a section holds questions AND other sections, to any depth.
 * Its score is the weighted average of its children's scores; it never asks what a child is.
 */
final class Section implements SurveyNode
{
    /** @var list<SurveyNode> */
    private array $children = [];

    public function __construct(
        private readonly string $title,
        private readonly float $weight = 1.0,
    ) {
        if ($weight <= 0) {
            throw new InvalidArgumentException("Section \"{$title}\" must have a positive weight.");
        }
    }

    public function add(SurveyNode $child): self
    {
        $this->children[] = $child;

        return $this;
    }

    public function title(): string
    {
        return $this->title;
    }

    public function weight(): float
    {
        return $this->weight;
    }

    public function score(AnswerSheet $answers): ?float
    {
        $weightedTotal = 0.0;
        $usedWeight = 0.0;

        foreach ($this->children as $child) {
            $score = $child->score($answers);               // a question or a whole section: same call
            if ($score === null) {
                continue;                                   // unanswered parts don't drag the score down
            }

            $weightedTotal += $score * $child->weight();
            $usedWeight += $child->weight();
        }

        return $usedWeight > 0 ? $weightedTotal / $usedWeight : null;
    }

    public function children(): array
    {
        return $this->children;
    }
}

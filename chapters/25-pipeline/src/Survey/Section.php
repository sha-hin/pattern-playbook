<?php

declare(strict_types=1);

namespace Evalu8\Survey;

use InvalidArgumentException;

/**
 * The Composite: a section holds questions AND other sections, to any depth.
 * Its score is the weighted average of its children's scores; it never asks what a child is.
 *
 * Prototype: `clone $section` gives an independent copy of the whole tree (see __clone).
 */
final class Section implements SurveyNode
{
    /** @var list<SurveyNode> */
    private array $children = [];

    public function __construct(
        private string $title,
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

    public function rename(string $title): self
    {
        $this->title = $title;

        return $this;
    }

    /**
     * Finds a section anywhere inside this one, by title.
     *
     * @throws InvalidArgumentException when there is no such section
     */
    public function section(string $title): self
    {
        foreach ($this->children as $child) {
            if (!$child instanceof self) {
                continue;
            }
            if ($child->title === $title) {
                return $child;
            }
            try {
                return $child->section($title);
            } catch (InvalidArgumentException) {
                // not in this branch, keep looking
            }
        }

        throw new InvalidArgumentException("No section \"{$title}\" inside \"{$this->title}\".");
    }

    /**
     * Runs on the NEW object right after `clone`. PHP's clone copies the $children array,
     * but the sections inside it would still be shared with the original. So we clone them
     * too (each one runs this same method for its own children: a deep copy).
     *
     * Questions are not cloned: they are immutable (readonly), so sharing them is safe.
     */
    public function __clone(): void
    {
        foreach ($this->children as $index => $child) {
            if ($child instanceof self) {
                $this->children[$index] = clone $child;
            }
        }
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

    public function accept(SurveyVisitor $visitor): void
    {
        $visitor->visitSection($this);                      // the visitor decides whether to go inside
    }
}

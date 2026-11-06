<?php

declare(strict_types=1);

/**
 * Composite: the full pattern in plain PHP, no framework.
 * Run it: php examples/composite.php
 *
 * Roles:
 * - Component: SurveyNode (the interface for items AND groups)
 * - Leaf: Question (no children)
 * - Composite: Section (holds SurveyNodes, which can be Questions or other Sections)
 * - Client: code that calls maxScore() or render() on the top node, at any depth
 *
 * In Laravel:
 * Laravel's core has little of this. The classic PHP example is Symfony's Form component:
 * a form holds fields and child forms, and submit(), isValid() and getErrors() work the
 * same on a single field or a whole nested form.
 */

interface SurveyNode                                            // ★ Component: one shape for both
{
    public function maxScore(): int;

    public function questionCount(): int;

    public function render(string $indent = ''): string;
}

final class Question implements SurveyNode                      // ★ Leaf
{
    public function __construct(private readonly string $text, private readonly int $points) {}

    public function maxScore(): int
    {
        return $this->points;
    }

    public function questionCount(): int
    {
        return 1;
    }

    public function render(string $indent = ''): string
    {
        return "{$indent}- {$this->text} ({$this->points} pts)" . PHP_EOL;
    }
}

final class Section implements SurveyNode                       // ★ Composite
{
    /** @var list<SurveyNode> */
    private array $children = [];

    public function __construct(private readonly string $title) {}

    public function add(SurveyNode $node): self                 // ★ accepts items or groups
    {
        $this->children[] = $node;

        return $this;
    }

    public function maxScore(): int
    {
        return array_sum(array_map(fn (SurveyNode $c): int => $c->maxScore(), $this->children));   // ★ just ask the children
    }

    public function questionCount(): int
    {
        return array_sum(array_map(fn (SurveyNode $c): int => $c->questionCount(), $this->children));
    }

    public function render(string $indent = ''): string
    {
        $out = "{$indent}{$this->title}" . PHP_EOL;
        foreach ($this->children as $child) {
            $out .= $child->render($indent . '  ');
        }

        return $out;
    }
}

// ── Build a tree of any depth ───────────────────────────────────────────
$survey = (new Section('Teacher evaluation'))
    ->add((new Section('Classroom'))
        ->add(new Question('Explains clearly', 5))
        ->add((new Section('Time management'))
            ->add(new Question('Starts on time', 3))
            ->add(new Question('Finishes the plan', 2))))
    ->add(new Question('Overall rating', 10));

echo $survey->render();
echo "Max score: {$survey->maxScore()}, questions: {$survey->questionCount()}", PHP_EOL;   // no instanceof anywhere

<?php

declare(strict_types=1);

/**
 * Composite: the full pattern in plain PHP, no framework.
 * Run it: php examples/composite.php
 *
 * Roles:
 * - Component: SurveyNode (one interface for single items AND groups)
 * - Leaf: Question (has no children)
 * - Composite: Section (holds SurveyNodes, which can be Questions or other Sections)
 * - Client: code that calls maxScore() on the top node, whatever the depth
 *
 * In Laravel:
 * Nested where groups in the query builder. where(function ($q) { ... }) stores a whole
 * group as ONE condition, and when the SQL is built, a group compiles its own conditions
 * inside brackets. Groups can hold groups: "status = ? and (total > ? or vip = ?)".
 */

// ── Step 1: the Component. One interface for items and groups. ──
interface SurveyNode                                        // ★ Component
{
    public function maxScore(): int;

    public function show(string $indent): void;
}

// ── Step 2: the Leaf. A single question. ──
final class Question implements SurveyNode                  // ★ Leaf
{
    public function __construct(private readonly string $text, private readonly int $points)
    {
    }

    public function maxScore(): int
    {
        return $this->points;                               // a leaf just answers
    }

    public function show(string $indent): void
    {
        echo "{$indent}- {$this->text} ({$this->points} pts)\n";
    }
}

// ── Step 3: the Composite. A section that holds questions OR other sections. ──
final class Section implements SurveyNode                   // ★ Composite
{
    /** @var list<SurveyNode> */
    private array $children = [];

    public function __construct(private readonly string $title)
    {
    }

    public function add(SurveyNode $node): static           // ★ accepts a Question or a Section
    {
        $this->children[] = $node;

        return $this;
    }

    public function maxScore(): int
    {
        $total = 0;
        foreach ($this->children as $child) {
            $total += $child->maxScore();                   // ★ just ask each child; no instanceof
        }

        return $total;
    }

    public function show(string $indent): void
    {
        echo "{$indent}{$this->title}\n";
        foreach ($this->children as $child) {
            $child->show($indent . '  ');
        }
    }
}

// ── Using it: a tree of any depth ──
$timeManagement = new Section('Time management');
$timeManagement->add(new Question('Starts on time', 3));
$timeManagement->add(new Question('Finishes the plan', 2));

$classroom = new Section('Classroom');
$classroom->add(new Question('Explains clearly', 5));
$classroom->add($timeManagement);                           // a section inside a section

$survey = new Section('Teacher evaluation');
$survey->add($classroom);
$survey->add(new Question('Overall rating', 10));

$survey->show('');
echo 'Max score: ' . $survey->maxScore() . "\n";           // 20, counted through every level

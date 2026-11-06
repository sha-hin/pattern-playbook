<?php

declare(strict_types=1);

/**
 * Prototype: the full pattern in plain PHP, no framework.
 * Run it: php examples/prototype.php
 *
 * Roles:
 * - Prototype: Survey (an existing object you copy instead of building from scratch)
 * - Cloning: PHP's clone keyword (copies the object, but objects inside it stay SHARED)
 * - Deep copy: __clone() (runs on the new copy; clones what the copy should OWN)
 * - Shared on purpose: School (the copy points to the same school; it is not owned)
 *
 * In Laravel:
 * Eloquent's $model->replicate() is a prototype copy of ONE row: it copies the attributes
 * into a new, unsaved model without the primary key and timestamps. Relations are not
 * copied, so owned children (questions, options) must be replicated by hand, as below.
 */

final class School
{
    public function __construct(public string $name) {}
}

final class Option
{
    public function __construct(public string $label) {}
}

final class Question
{
    /** @param list<Option> $options */
    public function __construct(public string $text, public array $options) {}

    public function __clone()                                   // ★ deep copy: the copy owns its own options
    {
        $this->options = array_map(fn (Option $o): Option => clone $o, $this->options);
    }
}

final class Survey                                              // ★ Prototype
{
    /** @param list<Question> $questions */
    public function __construct(public string $title, public School $school, public array $questions) {}

    public function __clone()                                   // ★ runs on the NEW copy, right after clone
    {
        $this->questions = array_map(fn (Question $q): Question => clone $q, $this->questions);
        // $this->school is NOT cloned: both surveys belong to the same school (shared on purpose)
    }
}

// ── The original: last term's survey ───────────────────────────────────
$school = new School('Smouha Language School');
$lastTerm = new Survey('Term 1 evaluation', $school, [
    new Question('Explains clearly', [new Option('Yes'), new Option('No')]),
    new Question('Starts on time', [new Option('Always'), new Option('Sometimes')]),
]);

// ── "Start new term from last term" ────────────────────────────────────
$nextTerm = clone $lastTerm;                                    // ★ copy instead of rebuilding
$nextTerm->title = 'Term 2 evaluation';
$nextTerm->questions[0]->text = 'Explains clearly and checks understanding';
$nextTerm->questions[0]->options[1]->label = 'Not yet';

echo "Original: {$lastTerm->title} / {$lastTerm->questions[0]->text} / {$lastTerm->questions[0]->options[1]->label}", PHP_EOL;
echo "Copy:     {$nextTerm->title} / {$nextTerm->questions[0]->text} / {$nextTerm->questions[0]->options[1]->label}", PHP_EOL;
echo 'Same school object? ', var_export($lastTerm->school === $nextTerm->school, true), PHP_EOL;

// Remove the two __clone() methods and run again: editing the copy changes the original too.

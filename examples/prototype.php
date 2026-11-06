<?php

declare(strict_types=1);

/**
 * Prototype: the full pattern in plain PHP, no framework.
 * Run it: php examples/prototype.php
 *
 * Roles:
 * - Prototype: Survey (an existing object you copy instead of building from scratch)
 * - clone: PHP's copy keyword (copies the object, but objects INSIDE it are still shared)
 * - __clone(): runs on the new copy, so it can copy what the copy should own (a deep copy)
 * - Shared on purpose: School (both surveys belong to the same school)
 *
 * In Laravel:
 * $model->replicate() copies ONE row's columns into a new, unsaved model (without the id and
 * timestamps). Related rows are not copied: the copy even points at the same loaded relation
 * objects. Owned children like questions must be replicated by hand.
 */

final class School
{
    public function __construct(public readonly string $name)
    {
    }
}

final class Question
{
    public function __construct(public string $text)
    {
    }
}

// ── The Prototype ──
final class Survey                                          // ★ Prototype
{
    /**
     * @param list<Question> $questions
     */
    public function __construct(
        public string $title,
        public readonly School $school,
        public array $questions,
    ) {
    }

    public function __clone(): void                               // ★ runs on the NEW copy, right after clone
    {
        $copies = [];
        foreach ($this->questions as $question) {
            $copies[] = clone $question;                    // ★ the copy gets its OWN questions
        }
        $this->questions = $copies;

        // $this->school is NOT cloned: both surveys belong to the same school.
    }
}

// ── Last term's survey ──
$school = new School('Smouha Language School');
$lastTerm = new Survey('Term 1 evaluation', $school, [
    new Question('Explains clearly'),
    new Question('Starts on time'),
]);

// ── "Start new term from last term": copy it, then change what differs ──
$nextTerm = clone $lastTerm;                                // ★ copy instead of rebuilding
$nextTerm->title = 'Term 2 evaluation';
$nextTerm->questions[0]->text = 'Explains clearly and checks understanding';

echo 'Original: ' . $lastTerm->title . ' / ' . $lastTerm->questions[0]->text . "\n";
echo 'Copy:     ' . $nextTerm->title . ' / ' . $nextTerm->questions[0]->text . "\n";
echo 'Same school? ' . ($lastTerm->school === $nextTerm->school ? 'yes' : 'no') . "\n";

// Delete the __clone() method and run again: editing the copy's question
// changes the original too, because both would share the same Question objects.

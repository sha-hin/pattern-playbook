<?php

declare(strict_types=1);

namespace Evalu8\Survey\Visitor;

use Evalu8\Survey\Question;
use Evalu8\Survey\Section;
use Evalu8\Survey\SurveyVisitor;

/**
 * Finds mistakes a survey designer can make: duplicate question codes, empty sections,
 * and question texts that are too long for the phone layout.
 */
final class SurveyValidator implements SurveyVisitor
{
    private const MAX_QUESTION_LENGTH = 80;

    /** @var list<string> */
    public array $errors = [];

    /** @var array<string, true> */
    private array $codesSeen = [];

    public function visitQuestion(Question $question): void
    {
        if (isset($this->codesSeen[$question->code])) {
            $this->errors[] = "Question code \"{$question->code}\" is used twice; answers would be mixed up.";
        }
        $this->codesSeen[$question->code] = true;

        if (mb_strlen($question->text) > self::MAX_QUESTION_LENGTH) {
            $this->errors[] = "Question {$question->code} is longer than " . self::MAX_QUESTION_LENGTH . ' characters.';
        }
    }

    public function visitSection(Section $section): void
    {
        if (count($section->children()) === 0) {
            $this->errors[] = "Section \"{$section->title()}\" is empty.";
        }

        foreach ($section->children() as $child) {
            $child->accept($this);
        }
    }

    public function isValid(): bool
    {
        return count($this->errors) === 0;
    }
}

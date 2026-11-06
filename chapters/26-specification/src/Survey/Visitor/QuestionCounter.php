<?php

declare(strict_types=1);

namespace Evalu8\Survey\Visitor;

use Evalu8\Survey\Question;
use Evalu8\Survey\Section;
use Evalu8\Survey\SurveyVisitor;

/**
 * Counts questions and sections, at any depth.
 */
final class QuestionCounter implements SurveyVisitor
{
    public int $questions = 0;
    public int $sections = 0;

    public function visitQuestion(Question $question): void
    {
        $this->questions++;
    }

    public function visitSection(Section $section): void
    {
        $this->sections++;
        foreach ($section->children() as $child) {
            $child->accept($this);
        }
    }
}

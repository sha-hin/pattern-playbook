<?php

declare(strict_types=1);

namespace Evalu8\Survey;

/**
 * The Visitor: one method per kind of node. A new operation on the survey is a new
 * class implementing this interface; Question and Section never change again.
 */
interface SurveyVisitor
{
    public function visitQuestion(Question $question): void;

    public function visitSection(Section $section): void;
}

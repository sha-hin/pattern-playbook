<?php

declare(strict_types=1);

namespace Evalu8\Survey\Rules;

use Evalu8\Domain\RespondentRole;
use Evalu8\Survey\AnswerSheet;

/**
 * What a rule can look at: the answers given so far, and who is answering.
 */
final readonly class RuleContext
{
    public function __construct(
        public AnswerSheet $answers,
        public RespondentRole $role,
    ) {
    }
}

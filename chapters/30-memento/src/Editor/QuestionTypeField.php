<?php

declare(strict_types=1);

namespace Evalu8\Editor;

final class QuestionTypeField extends Field
{
    public QuestionType $value = QuestionType::Scale;

    public function choose(QuestionType $type): void       // the user picked from the dropdown
    {
        $this->value = $type;
        $this->notifyChanged();
    }
}

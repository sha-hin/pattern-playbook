<?php

declare(strict_types=1);

namespace Evalu8\Editor;

final class QuestionTextField extends Field
{
    public string $value = '';

    public function type(string $text): void                // the user typed in the box
    {
        $this->value = trim($text);
        $this->notifyChanged();
    }
}

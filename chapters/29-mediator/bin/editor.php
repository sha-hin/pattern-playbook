<?php

declare(strict_types=1);

/*
 * Evalu8, chapter 29: the question editor's fields talk only to the editor.
 *
 *     composer dump-autoload
 *     php bin/editor.php
 */

require __DIR__ . '/../vendor/autoload.php';

use Evalu8\Editor\QuestionEditor;
use Evalu8\Editor\QuestionType;

function screen(string $action, QuestionEditor $editor): void
{
    $onOff = fn (bool $enabled): string => $enabled ? 'on' : 'off';

    echo "\n> {$action}\n";
    echo "  preview: {$editor->preview->html}\n";
    echo "  scale: 1–{$editor->scale->max} ({$onOff($editor->scale->enabled)})"
        . '   scored: ' . ($editor->scored->checked ? 'yes' : 'no') . " ({$onOff($editor->scored->enabled)})\n";
    echo '  problems: ' . ($editor->validation->problems === [] ? 'none, Save is enabled' : implode(' | ', $editor->validation->problems)) . "\n";
}

$editor = new QuestionEditor();
screen('Open the editor', $editor);

$editor->text->type('Explains the lesson clearly');
screen('Type the question', $editor);

$editor->scale->setMax(7);
screen('Change the scale to 1–7', $editor);

$editor->type->choose(QuestionType::Text);
screen('Make it a comment question', $editor);

$editor->type->choose(QuestionType::Scale);
$editor->scale->setMax(5);
$editor->scored->toggle(true);
screen('Back to a scored 1–5 scale', $editor);

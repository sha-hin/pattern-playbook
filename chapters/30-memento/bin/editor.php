<?php

declare(strict_types=1);

/*
 * Evalu8, chapter 30: undo and redo in the question editor.
 *
 *     composer dump-autoload
 *     php bin/editor.php
 */

require __DIR__ . '/../vendor/autoload.php';

use Evalu8\Editor\History;
use Evalu8\Editor\QuestionEditor;
use Evalu8\Editor\QuestionType;

function screen(string $action, QuestionEditor $editor, History $history): void
{
    echo "\n> {$action}\n";
    echo "  preview: {$editor->preview->html}   scored: " . ($editor->scored->checked ? 'yes' : 'no') . "\n";
    echo '  problems: ' . ($editor->validation->problems === [] ? 'none' : implode(' | ', $editor->validation->problems)) . "\n";
    echo '  [Undo ' . ($history->canUndo() ? 'on' : 'off') . '] [Redo ' . ($history->canRedo() ? 'on' : 'off') . "]\n";
}

$editor = new QuestionEditor();
$history = new History();

$history->record($editor, fn () => $editor->text->type('Explains the lesson clearly'));
screen('Type the question', $editor, $history);

$history->record($editor, fn () => $editor->scale->setMax(7));
screen('Change the scale to 1–7', $editor, $history);

$history->record($editor, fn () => $editor->type->choose(QuestionType::Text));
screen('Make it a comment question (scoring is switched off)', $editor, $history);

$history->undo($editor);
screen('Undo', $editor, $history);

$history->undo($editor);
screen('Undo again: back to the 1–5 scored scale', $editor, $history);

$history->redo($editor);
screen('Redo', $editor, $history);

$history->record($editor, fn () => $editor->text->type('Explains the lesson clearly and checks understanding'));
screen('A new change clears Redo', $editor, $history);

<?php

declare(strict_types=1);

namespace Evalu8\Editor;

/**
 * The concrete Mediator: every rule about how the editor's fields affect each other is here,
 * in one class, instead of being spread over the fields.
 */
final class QuestionEditor implements EditorMediator
{
    public const MAX_SCALE = 10;

    public readonly QuestionTextField $text;
    public readonly QuestionTypeField $type;
    public readonly ScaleField $scale;
    public readonly ScoredCheckbox $scored;
    public readonly PreviewPanel $preview;
    public readonly ValidationPanel $validation;

    public function __construct()
    {
        $this->text = new QuestionTextField();
        $this->type = new QuestionTypeField();
        $this->scale = new ScaleField();
        $this->scored = new ScoredCheckbox();
        $this->preview = new PreviewPanel();
        $this->validation = new ValidationPanel();

        foreach ([$this->text, $this->type, $this->scale, $this->scored, $this->preview, $this->validation] as $field) {
            $field->attach($this);
        }

        $this->refresh();
    }

    public function changed(Field $field): void
    {
        if ($field === $this->type) {
            $this->applyType();                             // only a type change enables or disables fields
        }

        $this->refresh();                                   // every change updates the preview and the problems
    }

    private function applyType(): void
    {
        switch ($this->type->value) {
            case QuestionType::Scale:
                $this->scale->enabled = true;
                $this->scored->enabled = true;
                break;
            case QuestionType::YesNo:
                $this->scale->enabled = false;              // the "scale" is fixed: yes or no
                $this->scored->enabled = true;
                break;
            case QuestionType::Text:
                $this->scale->enabled = false;
                $this->scored->enabled = false;
                $this->scored->checked = false;             // a comment can never count in a score
                break;
        }
    }

    private function refresh(): void
    {
        $this->preview->show($this->renderPreview());
        $this->validation->show($this->problems());
    }

    private function renderPreview(): string
    {
        $question = $this->text->value === '' ? '(no text yet)' : $this->text->value;

        return match ($this->type->value) {
            QuestionType::Scale => "{$question}  [1 … {$this->scale->max}]",
            QuestionType::YesNo => "{$question}  [Yes] [No]",
            QuestionType::Text => "{$question}  [__________]",
        };
    }

    /** @return list<string> */
    private function problems(): array
    {
        $problems = [];

        if ($this->text->value === '') {
            $problems[] = 'The question needs a text.';
        }
        if ($this->scale->enabled && ($this->scale->max < 2 || $this->scale->max > self::MAX_SCALE)) {
            $problems[] = 'The scale must end between 2 and ' . self::MAX_SCALE . '.';
        }
        if ($this->scored->checked && $this->type->value === QuestionType::Scale && $this->scale->max !== 5) {
            $problems[] = 'Scored questions must use the 1–5 scale, or teachers’ scores can’t be compared.';
        }

        return $problems;
    }
}

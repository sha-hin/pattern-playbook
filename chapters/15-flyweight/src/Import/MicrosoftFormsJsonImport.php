<?php

declare(strict_types=1);

namespace Evalu8\Import;

/**
 * Microsoft Forms → export as JSON: a list of submissions, each with an "answers" object.
 */
final class MicrosoftFormsJsonImport extends AnswerImport
{
    private const ROLE_LABELS = [
        'peer (colleague)' => 'peer',
        'principal / head' => 'principal',
    ];

    protected function createReader(): RowReader
    {
        return new JsonRowReader('id', 'answers');
    }

    protected function mapRow(array $row): RawAnswer
    {
        return new RawAnswer($row['teacher'] ?? '', $row['role'] ?? '', $row['rating'] ?? '', $row['feedback'] ?? '');
    }

    protected function sourceName(): string
    {
        return 'Microsoft Forms JSON';
    }

    /** This tool uses its own labels for roles, so this subclass replaces the hook. */
    protected function roleText(string $label): string
    {
        $text = parent::roleText($label);

        return self::ROLE_LABELS[$text] ?? $text;
    }
}

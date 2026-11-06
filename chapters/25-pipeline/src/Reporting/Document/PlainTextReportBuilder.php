<?php

declare(strict_types=1);

namespace Evalu8\Reporting\Document;

use Evalu8\Reporting\TeacherResult;

/**
 * Builds the report as plain text, for the email to the Ministry inspector.
 */
final class PlainTextReportBuilder implements ReportBuilder
{
    /** @var list<string> */
    private array $lines = [];

    public function title(string $title): void
    {
        $this->lines[] = mb_strtoupper($title);
        $this->lines[] = str_repeat('=', mb_strlen($title));
    }

    public function schoolHeading(string $school): void
    {
        $this->lines[] = '';
        $this->lines[] = $school;
    }

    public function teacherRow(TeacherResult $result): void
    {
        $this->lines[] = '  ' . str_pad($result->teacher->name, 16) . str_pad($result->method, 10) . $result->formattedScore();
    }

    public function footnote(string $text): void
    {
        $this->lines[] = '';
        $this->lines[] = "* {$text}";
    }

    public function text(): string
    {
        return implode("\n", $this->lines) . "\n";
    }
}

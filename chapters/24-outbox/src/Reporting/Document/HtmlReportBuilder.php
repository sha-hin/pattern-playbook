<?php

declare(strict_types=1);

namespace Evalu8\Reporting\Document;

use Evalu8\Reporting\TeacherResult;

/**
 * Builds the report as an HTML page, for the principal's dashboard.
 */
final class HtmlReportBuilder implements ReportBuilder
{
    private string $html = '';
    private bool $tableOpen = false;

    public function title(string $title): void
    {
        $this->html .= '<h1>' . $this->e($title) . "</h1>\n";
    }

    public function schoolHeading(string $school): void
    {
        $this->closeTable();
        $this->html .= '<h2>' . $this->e($school) . "</h2>\n<table>\n<tr><th>Teacher</th><th>Method</th><th>Score</th></tr>\n";
        $this->tableOpen = true;
    }

    public function teacherRow(TeacherResult $result): void
    {
        $this->html .= '<tr><td>' . $this->e($result->teacher->name) . '</td><td>' . $this->e($result->method)
            . '</td><td>' . $this->e($result->formattedScore()) . "</td></tr>\n";
    }

    public function footnote(string $text): void
    {
        $this->closeTable();
        $this->html .= '<p><small>' . $this->e($text) . "</small></p>\n";
    }

    /** The finished product. Each builder has its own result method, because products differ. */
    public function html(): string
    {
        $this->closeTable();

        return $this->html;
    }

    private function closeTable(): void
    {
        if ($this->tableOpen) {
            $this->html .= "</table>\n";
            $this->tableOpen = false;
        }
    }

    private function e(string $text): string
    {
        return htmlspecialchars($text, ENT_QUOTES | ENT_HTML5, 'UTF-8');
    }
}

<?php

declare(strict_types=1);

namespace Evalu8\Reporting\Document;

use Evalu8\Reporting\TeacherResult;

/**
 * Builder (the book's form): the steps every term report document is made of.
 * Each concrete builder turns the same steps into a different kind of document.
 */
interface ReportBuilder
{
    public function title(string $title): void;

    public function schoolHeading(string $school): void;

    public function teacherRow(TeacherResult $result): void;

    public function footnote(string $text): void;
}

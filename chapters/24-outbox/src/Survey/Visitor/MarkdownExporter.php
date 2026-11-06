<?php

declare(strict_types=1);

namespace Evalu8\Survey\Visitor;

use Evalu8\Survey\Question;
use Evalu8\Survey\Section;
use Evalu8\Survey\SurveyVisitor;

/**
 * Writes the survey as Markdown, for the printed handout: sections become headings,
 * questions become lines with five boxes.
 */
final class MarkdownExporter implements SurveyVisitor
{
    private string $markdown = '';

    /** @var list<string> titles of the sections we are inside, outermost first */
    private array $open = [];

    /** true after a sub-section ends: the next question needs its section's heading again */
    private bool $resumeHeading = false;

    public function visitQuestion(Question $question): void
    {
        if ($this->resumeHeading) {
            $this->heading(end($this->open) . ' (continued)');
            $this->resumeHeading = false;
        }

        $this->markdown .= "- **{$question->code}.** {$question->text} ☐1 ☐2 ☐3 ☐4 ☐5\n";
    }

    public function visitSection(Section $section): void
    {
        $this->open[] = $section->title();
        $this->heading($section->title());
        $this->resumeHeading = false;

        foreach ($section->children() as $child) {
            $child->accept($this);
        }

        array_pop($this->open);
        $this->resumeHeading = true;
    }

    public function markdown(): string
    {
        return $this->markdown;
    }

    private function heading(string $title): void
    {
        $level = str_repeat('#', min(count($this->open), 6));
        $separator = $this->markdown === '' || str_ends_with($this->markdown, "\n\n") ? '' : "\n";
        $this->markdown .= "{$separator}{$level} {$title}\n\n";
    }
}

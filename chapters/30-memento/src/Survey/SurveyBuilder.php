<?php

declare(strict_types=1);

namespace Evalu8\Survey;

use Evalu8\Survey\Rules\RuleParser;
use Evalu8\Survey\Visitor\SurveyValidator;
use LogicException;

/**
 * Builder: assembles a survey step by step, in the order you read it, and checks the
 * whole result in build(). You get a valid survey, or an exception listing every problem.
 *
 *     SurveyBuilder::survey('Teacher evaluation')
 *         ->section('Teaching', weight: 3)
 *             ->question('q1', 'Explains clearly')
 *         ->end()
 *         ->build();
 */
final class SurveyBuilder
{
    /** @var list<Section> the root and every section still open, innermost last */
    private array $open;

    private function __construct(string $title, private readonly RuleParser $rules)
    {
        $this->open = [new Section($title)];
    }

    public static function survey(string $title): self
    {
        return new self($title, new RuleParser());
    }

    /** Opens a section inside the current one. Close it with end(). */
    public function section(string $title, float $weight = 1.0): self
    {
        $section = new Section($title, $weight);
        $this->current()->add($section);
        $this->open[] = $section;

        return $this;
    }

    /** Adds a question to the current section. $visibleIf uses the rule language from chapter 18. */
    public function question(string $code, string $text, float $weight = 1.0, ?string $visibleIf = null): self
    {
        $this->current()->add(new Question(
            $code,
            $text,
            $weight,
            $visibleIf === null ? null : $this->rules->parse($visibleIf),
        ));

        return $this;
    }

    /** Closes the current section. */
    public function end(): self
    {
        if (count($this->open) === 1) {
            throw new LogicException('end() called with no open section.');
        }
        array_pop($this->open);

        return $this;
    }

    /** The last step: checks everything, then hands over the finished survey. */
    public function build(): Section
    {
        $problems = [];
        if (count($this->open) > 1) {
            $problems[] = 'Section "' . $this->current()->title() . '" was never closed with end().';
        }

        $validator = new SurveyValidator();                 // the visitor from chapter 17
        $this->open[0]->accept($validator);
        $problems = [...$problems, ...$validator->errors];

        if (count($problems) > 0) {
            throw new InvalidSurvey($problems);
        }

        return $this->open[0];
    }

    private function current(): Section
    {
        return $this->open[count($this->open) - 1];
    }
}

<?php

declare(strict_types=1);

namespace Evalu8\Survey;

use Evalu8\Domain\Score;

/**
 * One respondent's answers to a survey: question code => score.
 */
final readonly class AnswerSheet
{
    /** @param array<string, Score> $scores */
    private function __construct(private array $scores)
    {
    }

    /** @param array<string, int> $answers e.g. ['q1' => 5, 'q2' => 4]; values are validated by Score */
    public static function fromArray(array $answers): self
    {
        $scores = [];
        foreach ($answers as $code => $value) {
            $scores[$code] = Score::of($value);
        }

        return new self($scores);
    }

    public function scoreFor(string $questionCode): ?Score
    {
        return $this->scores[$questionCode] ?? null;       // null = not answered
    }
}

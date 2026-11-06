<?php

declare(strict_types=1);

namespace Evalu8\Analysis;

/**
 * Evalu8's built-in analysis: finds recurring themes by keyword.
 * (Chapter 7 replaces it with a real language model; the interface stays the same.)
 */
final readonly class KeywordCommentAnalyzer implements CommentAnalyzer
{
    /** theme => words that point to it */
    private const THEMES = [
        'clarity' => ['clear', 'clearly', 'explains', 'understand'],
        'punctuality' => ['late', 'on time', 'starts'],
        'pace' => ['fast', 'slow', 'rushed'],
        'planning' => ['plan', 'planning', 'organised', 'organized'],
        'assessment' => ['test', 'exam', 'grade', 'failed'],
    ];

    public function summarize(array $comments): string
    {
        if (count($comments) === 0) {
            return 'no written comments';
        }

        $counts = [];
        foreach ($comments as $comment) {
            $text = strtolower($comment);
            foreach (self::THEMES as $theme => $words) {
                foreach ($words as $word) {
                    if (str_contains($text, $word)) {
                        $counts[$theme] = ($counts[$theme] ?? 0) + 1;
                        break;                              // count each theme once per comment
                    }
                }
            }
        }

        if (count($counts) === 0) {
            return 'no recurring themes in ' . count($comments) . ' comment(s)';
        }

        arsort($counts);
        $parts = [];
        foreach ($counts as $theme => $count) {
            $parts[] = "{$theme} ({$count})";
        }

        return 'themes: ' . implode(', ', $parts);
    }
}

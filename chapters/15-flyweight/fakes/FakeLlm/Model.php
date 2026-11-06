<?php

declare(strict_types=1);

namespace FakeLlm;

/**
 * A deterministic stand-in for a language model: it reads the "- comment" lines
 * of the prompt and names the most frequent meaningful words.
 */
final class Model
{
    private const IGNORE = ['about', 'their', 'there', 'which', 'these', 'lesson', 'lessons', 'teacher'];

    public static function reply(string $prompt): string
    {
        preg_match_all('/^- (.+)$/m', $prompt, $matches);
        $comments = $matches[1];

        $words = [];
        foreach ($comments as $comment) {
            foreach (str_word_count(strtolower($comment), 1) as $word) {
                if (strlen($word) >= 5 && !in_array($word, self::IGNORE, true)) {
                    $words[$word] = ($words[$word] ?? 0) + 1;
                }
            }
        }
        arsort($words);

        $top = array_slice(array_keys($words), 0, 2);

        return count($comments) . ' comment(s); main topics: ' . (count($top) > 0 ? implode(', ', $top) : 'none') . '.';
    }
}

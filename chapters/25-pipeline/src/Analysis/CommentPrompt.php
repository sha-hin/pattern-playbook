<?php

declare(strict_types=1);

namespace Evalu8\Analysis;

/**
 * The instruction we send to any language model, so every provider is asked the same thing.
 */
final class CommentPrompt
{
    /** @param list<string> $comments */
    public static function for(array $comments): string
    {
        $lines = [];
        foreach ($comments as $comment) {
            $lines[] = '- ' . str_replace("\n", ' ', $comment);
        }

        return "Summarise these anonymous comments about a teacher in one short sentence. "
            . "Name the main topics. Do not quote anyone.\n\n" . implode("\n", $lines);
    }
}

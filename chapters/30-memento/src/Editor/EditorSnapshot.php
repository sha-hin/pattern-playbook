<?php

declare(strict_types=1);

namespace Evalu8\Editor;

use DateTimeImmutable;

/**
 * The Memento: the editor's state at one moment. Immutable, so whoever stores it (the History)
 * can keep it and hand it back, but can never change it. Only QuestionEditor creates and reads it.
 */
final readonly class EditorSnapshot
{
    public function __construct(
        public string $text,
        public QuestionType $type,
        public int $scaleMax,
        public bool $scored,
        public DateTimeImmutable $takenAt,
    ) {
    }
}

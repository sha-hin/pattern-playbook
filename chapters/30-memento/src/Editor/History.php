<?php

declare(strict_types=1);

namespace Evalu8\Editor;

/**
 * The Caretaker: keeps snapshots for undo and redo. It never looks inside them.
 */
final class History
{
    /** @var list<EditorSnapshot> oldest first */
    private array $undo = [];

    /** @var list<EditorSnapshot> */
    private array $redo = [];

    public function __construct(private readonly int $limit = 50)
    {
    }

    /**
     * Saves the current state, then applies a change made by the user.
     *
     * @param callable(): void $change
     */
    public function record(QuestionEditor $editor, callable $change): void
    {
        $this->undo[] = $editor->snapshot();
        if (count($this->undo) > $this->limit) {
            array_shift($this->undo);                       // forget the oldest step, keep memory bounded
        }
        $this->redo = [];                                   // a new change makes the old "future" invalid

        $change();
    }

    public function undo(QuestionEditor $editor): bool
    {
        $previous = array_pop($this->undo);
        if ($previous === null) {
            return false;                                   // nothing to undo: the button is disabled
        }

        $this->redo[] = $editor->snapshot();
        $editor->restore($previous);

        return true;
    }

    public function redo(QuestionEditor $editor): bool
    {
        $next = array_pop($this->redo);
        if ($next === null) {
            return false;
        }

        $this->undo[] = $editor->snapshot();
        $editor->restore($next);

        return true;
    }

    public function canUndo(): bool
    {
        return $this->undo !== [];
    }

    public function canRedo(): bool
    {
        return $this->redo !== [];
    }
}

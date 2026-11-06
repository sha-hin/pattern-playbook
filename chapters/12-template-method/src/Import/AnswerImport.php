<?php

declare(strict_types=1);

namespace Evalu8\Import;

use Evalu8\Domain\InvalidValue;
use Evalu8\Domain\RespondentRole;
use Evalu8\Domain\Response;
use Evalu8\Domain\ResponseRepository;
use Evalu8\Domain\Score;
use Evalu8\Domain\TeacherRepository;

/**
 * Template Method: import() is the fixed recipe every file format follows.
 * Subclasses fill in only the steps that differ: how to read the file and where each field is.
 */
abstract class AnswerImport
{
    public function __construct(
        private readonly ResponseRepository $responses,
        private readonly TeacherRepository $teachers,
    ) {
    }

    /**
     * The template method. `final`: the order of the steps, and the validation, can't be changed or skipped.
     */
    final public function import(string $path, string $term): ImportResult
    {
        $knownTeachers = $this->knownTeacherIds();
        $imported = 0;
        $rejected = [];

        foreach ($this->readRows($path) as $line => $row) {        // 1. read     (differs per format)
            $raw = $this->mapRow($row);                             // 2. map      (differs per format)

            try {
                $response = $this->toResponse($raw, $term, $knownTeachers);   // 3. validate (the same for all)
            } catch (InvalidValue $e) {
                $rejected[] = "row {$line}: {$e->getMessage()}";
                continue;
            }

            $this->responses->add($response);                       // 4. save     (the same for all)
            $imported++;
        }

        return new ImportResult($this->sourceName(), $imported, $rejected);
    }

    /**
     * Step 1: read the file. Keys are row numbers (or ids), so rejections can point at the right row.
     *
     * @return iterable<int, array<string, string>>
     */
    abstract protected function readRows(string $path): iterable;

    /**
     * Step 2: find our four fields in this format's row.
     *
     * @param array<string, string> $row
     */
    abstract protected function mapRow(array $row): RawAnswer;

    /** A name for messages, e.g. "Google Forms CSV". */
    abstract protected function sourceName(): string;

    /**
     * A hook: a step with a sensible default that a subclass MAY replace.
     * Forms tools label roles differently ("Peer (colleague)"); the default just tidies the text.
     */
    protected function roleText(string $label): string
    {
        return strtolower(trim($label));
    }

    /** @param array<int, true> $knownTeachers */
    private function toResponse(RawAnswer $raw, string $term, array $knownTeachers): Response
    {
        $teacherId = filter_var($raw->teacherId, FILTER_VALIDATE_INT);
        if ($teacherId === false || !isset($knownTeachers[$teacherId])) {
            throw new InvalidValue("Unknown teacher \"{$raw->teacherId}\".");
        }

        return new Response(
            $teacherId,
            $term,
            RespondentRole::fromInput($this->roleText($raw->role)),
            Score::fromInput($raw->score),
            trim($raw->comment),
        );
    }

    /** @return array<int, true> */
    private function knownTeacherIds(): array
    {
        $ids = [];
        foreach ($this->teachers->all() as $teacher) {
            $ids[$teacher->id] = true;
        }

        return $ids;
    }
}

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
 * Factory Method: createReader() lets each subclass decide WHICH reader the recipe uses.
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

        foreach ($this->createReader()->rows($path) as $line => $row) {   // 1. read  (the subclass chose the reader)
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
     * Shows the first rows as they would be imported, without validating or saving anything.
     *
     * @return list<RawAnswer>
     */
    final public function preview(string $path, int $limit = 3): array
    {
        $preview = [];
        foreach ($this->createReader()->rows($path) as $row) {    // the same factory method, a second use
            $preview[] = $this->mapRow($row);
            if (count($preview) >= $limit) {
                break;
            }
        }

        return $preview;
    }

    /**
     * The factory method: each subclass decides which RowReader to create.
     */
    abstract protected function createReader(): RowReader;

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

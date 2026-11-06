<?php

declare(strict_types=1);

namespace Evalu8\Domain;

/**
 * Where survey answers are stored and read back. Methods are named after
 * what the app needs ("this teacher's answers for this term"), not after SQL.
 */
interface ResponseRepository
{
    public function add(Response $response): void;

    /** @return list<Response> */
    public function forTeacherInTerm(int $teacherId, string $term): array;

    /**
     * Every answer of a term, streamed: rows are read in small batches while you loop,
     * so memory stays flat however many answers there are.
     *
     * @return iterable<Response>
     */
    public function inTerm(string $term): iterable;
}

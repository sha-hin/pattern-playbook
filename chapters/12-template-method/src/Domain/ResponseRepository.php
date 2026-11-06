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
}

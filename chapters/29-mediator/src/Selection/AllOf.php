<?php

declare(strict_types=1);

namespace Evalu8\Selection;

use Evalu8\Reporting\TeacherResult;

final class AllOf extends BaseSpecification
{
    /** @var list<Specification> */
    private readonly array $parts;

    public function __construct(Specification ...$parts)
    {
        $this->parts = array_values($parts);
    }

    public function isSatisfiedBy(TeacherResult $result): bool
    {
        foreach ($this->parts as $part) {
            if (!$part->isSatisfiedBy($result)) {
                return false;
            }
        }

        return true;
    }

    public function describe(): string
    {
        return implode(' and ', array_map(fn (Specification $s): string => $s->describe(), $this->parts));
    }
}

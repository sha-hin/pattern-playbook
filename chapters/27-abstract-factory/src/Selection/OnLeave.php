<?php

declare(strict_types=1);

namespace Evalu8\Selection;

use Evalu8\Reporting\TeacherResult;

final class OnLeave extends BaseSpecification
{
    public function isSatisfiedBy(TeacherResult $result): bool
    {
        return $result->teacher->onLeave;
    }

    public function describe(): string
    {
        return 'on leave';
    }
}

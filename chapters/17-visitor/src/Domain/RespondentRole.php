<?php

declare(strict_types=1);

namespace Evalu8\Domain;

/**
 * Who answered the survey. A backed enum is PHP's built-in value object for
 * "one of a fixed list": there is no way to create RespondentRole::Studnet.
 */
enum RespondentRole: string
{
    case Student = 'student';
    case Peer = 'peer';
    case Principal = 'principal';

    public static function fromInput(string $raw): self
    {
        $role = self::tryFrom(strtolower(trim($raw)));

        if ($role === null) {
            throw new InvalidValue("Unknown respondent role \"{$raw}\".");
        }

        return $role;
    }
}

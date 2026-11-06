<?php

declare(strict_types=1);

namespace Evalu8\Auth;

/**
 * The signed-in person looking at a page.
 */
final readonly class Viewer
{
    public function __construct(
        public string $name,
        public ViewerRole $role,
        public ?int $teacherId = null,                      // set when the viewer is a teacher
    ) {
    }
}

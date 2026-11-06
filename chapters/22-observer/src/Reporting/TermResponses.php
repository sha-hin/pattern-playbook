<?php

declare(strict_types=1);

namespace Evalu8\Reporting;

use Evalu8\Domain\Response;
use Evalu8\Domain\ResponseRepository;
use IteratorAggregate;
use Traversable;

/**
 * "All answers of a term", as something you can loop over as often as you like.
 *
 * A generator can only be looped over once. IteratorAggregate fixes that: every foreach
 * calls getIterator() and gets a fresh generator, starting from the first row again.
 *
 * @implements IteratorAggregate<int, Response>
 */
final readonly class TermResponses implements IteratorAggregate
{
    public function __construct(
        private ResponseRepository $responses,
        private string $term,
    ) {
    }

    /** @return Traversable<int, Response> */
    public function getIterator(): Traversable
    {
        yield from $this->responses->inTerm($this->term);
    }
}

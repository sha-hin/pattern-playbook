<?php

declare(strict_types=1);

namespace Evalu8\Reporting;

use Evalu8\Infrastructure\Kit\InfrastructureKit;

/**
 * The client of the Abstract Factory: it uses the storage and the queue, and because both
 * come from the same kit, they always belong together.
 */
final readonly class ExportPublisher
{
    public function __construct(private InfrastructureKit $kit)
    {
    }

    public function publish(string $term, string $csv): string
    {
        $location = $this->kit->storage()->put("exports/ministry-{$term}.csv", $csv);
        $this->kit->queue()->push(new NotifyInspector($term, $location));

        return $location;
    }
}

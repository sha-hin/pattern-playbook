<?php

declare(strict_types=1);

namespace Evalu8\Reporting;

use Evalu8\Logging\Logger;
use Evalu8\Storage\FileStorage;

final readonly class NotifyInspectorHandler
{
    public function __construct(
        private FileStorage $storage,                       // must be the storage that wrote the file
        private Logger $logger,
    ) {
    }

    public function handle(NotifyInspector $command): void
    {
        $csv = $this->storage->get($command->location);
        $rows = count(explode("\n", trim($csv))) - 1;

        $this->logger->info('inspector notified', ['term' => $command->term, 'rows' => $rows, 'file' => $command->location]);
    }
}

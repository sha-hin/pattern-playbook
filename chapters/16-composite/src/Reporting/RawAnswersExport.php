<?php

declare(strict_types=1);

namespace Evalu8\Reporting;

use Evalu8\Domain\Response;
use RuntimeException;

/**
 * The Ministry's raw file: one anonymous line per answer.
 * It accepts any iterable, so it works the same with an array or a stream.
 */
final readonly class RawAnswersExport
{
    /**
     * @param iterable<Response> $responses
     * @return int the number of answers written
     */
    public function write(iterable $responses, string $path): int
    {
        $file = fopen($path, 'w');
        if ($file === false) {
            throw new RuntimeException("Can't write the raw answers export to {$path}.");
        }

        $count = 0;
        try {
            fputcsv($file, ['term', 'teacher_id', 'role', 'score'], escape: '');
            foreach ($responses as $response) {            // one answer in memory at a time
                fputcsv($file, [$response->term, $response->teacherId, $response->role->value, $response->score->value], escape: '');
                $count++;
            }
        } finally {
            fclose($file);
        }

        return $count;
    }
}

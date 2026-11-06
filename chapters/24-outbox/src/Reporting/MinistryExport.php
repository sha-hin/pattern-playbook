<?php

declare(strict_types=1);

namespace Evalu8\Reporting;

use RuntimeException;

/**
 * Writes the Ministry's CSV file. fputcsv() quotes names that contain commas or quotes.
 */
final readonly class MinistryExport
{
    /**
     * @param list<TeacherResult> $results
     * @return int the number of teacher rows written
     */
    public function write(array $results, string $path): int
    {
        $file = fopen($path, 'w');
        if ($file === false) {
            throw new RuntimeException("Can't write the Ministry export to {$path}.");
        }

        try {
            fputcsv($file, ['teacher', 'school', 'responses', 'method', 'score'], escape: '');
            foreach ($results as $result) {
                fputcsv($file, [
                    $result->teacher->name,
                    $result->teacher->school,
                    $result->responseCount,
                    $result->method,
                    $result->score === null ? '' : round($result->score, 2),
                ], escape: '');
            }
        } finally {
            fclose($file);
        }

        return count($results);
    }
}

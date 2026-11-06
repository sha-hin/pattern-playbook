<?php

declare(strict_types=1);

namespace Evalu8\Demo;

use PDO;

/**
 * Demo schools and teachers. The demo database lives in memory, so it is filled on every run;
 * a real deployment would point the container at a database that already has its data.
 */
final class SampleData
{
    public static function load(PDO $db): void
    {
        $db->exec("INSERT INTO schools (name, scoring_method, scoring_weights, comment_analysis) VALUES
            ('Smouha', 'weighted', '{\"student\": 0.5, \"peer\": 0.2, \"principal\": 0.3}', 1),
            ('Miami', 'median', NULL, 0),
            ('Victoria', 'average', NULL, 1)");

        $db->exec("INSERT INTO teachers (id, name, email, school) VALUES
            (1, 'Hany Mostafa', 'hany@smouha.edu.eg', 'Smouha'),
            (2, 'Nadia Fawzy', NULL, 'Smouha'),
            (3, 'Karim Adel', 'karim@miami.edu.eg', 'Miami'),
            (4, 'Laila Samir', 'laila@victoria.edu.eg', 'Victoria')");
    }
}

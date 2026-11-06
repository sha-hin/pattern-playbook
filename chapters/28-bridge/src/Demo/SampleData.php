<?php

declare(strict_types=1);

namespace Evalu8\Demo;

use Evalu8\Domain\RespondentRole;
use Evalu8\Domain\Response;
use Evalu8\Domain\ResponseRepository;
use Evalu8\Domain\Score;
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

        $db->exec("INSERT INTO teachers (id, name, email, school, on_leave) VALUES
            (1, 'Hany Mostafa', 'hany@smouha.edu.eg', 'Smouha', 0),
            (2, 'Nadia Fawzy', NULL, 'Smouha', 0),
            (3, 'Karim Adel', 'karim@miami.edu.eg', 'Miami', 1),
            (4, 'Laila Samir', 'laila@victoria.edu.eg', 'Victoria', 0)");
    }

    /**
     * This term's answers, for scripts that need data but don't demonstrate the import.
     */
    public static function loadAnswers(ResponseRepository $responses, string $term): void
    {
        $answers = [
            [1, 'student', 5, 'Explains clearly'], [1, 'student', 4, ''], [1, 'student', 5, ''],
            [1, 'peer', 3, ''], [1, 'principal', 4, 'Good planning'],
            [2, 'student', 3, 'Starts late'], [2, 'student', 4, ''], [2, 'peer', 2, ''], [2, 'principal', 2, ''],
            [3, 'student', 1, 'I failed the test'], [3, 'student', 4, ''], [3, 'student', 4, ''], [3, 'peer', 5, ''],
            [4, 'student', 4, 'Explains clearly'], [4, 'peer', 3, 'Lessons feel rushed'],
        ];

        foreach ($answers as [$teacherId, $role, $score, $comment]) {
            $responses->add(new Response($teacherId, $term, RespondentRole::from($role), Score::of($score), $comment));
        }
    }

    /**
     * A big term for performance demos: $count answers spread over the four teachers.
     */
    public static function loadManyAnswers(PDO $db, string $term, int $count): void
    {
        $roles = ['student', 'student', 'student', 'peer', 'principal'];
        $insert = $db->prepare('INSERT INTO responses (teacher_id, term, role, score, comment) VALUES (?, ?, ?, ?, ?)');

        $db->beginTransaction();
        for ($i = 0; $i < $count; $i++) {
            $insert->execute([1 + $i % 4, $term, $roles[$i % 5], 1 + $i % 5, $i % 3 === 0 ? 'Explains clearly' : '']);
        }
        $db->commit();
    }
}

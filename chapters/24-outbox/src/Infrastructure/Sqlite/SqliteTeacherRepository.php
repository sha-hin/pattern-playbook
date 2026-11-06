<?php

declare(strict_types=1);

namespace Evalu8\Infrastructure\Sqlite;

use Evalu8\Domain\EmailAddress;
use Evalu8\Domain\NotFound;
use Evalu8\Domain\Teacher;
use Evalu8\Domain\TeacherRepository;
use PDO;

final readonly class SqliteTeacherRepository implements TeacherRepository
{
    public function __construct(private PDO $db)
    {
    }

    public function all(): array
    {
        $rows = $this->db->query('SELECT id, name, email, school FROM teachers ORDER BY id')->fetchAll(PDO::FETCH_ASSOC);

        $teachers = [];
        foreach ($rows as $row) {
            $teachers[] = $this->toTeacher($row);
        }

        return $teachers;
    }

    public function get(int $id): Teacher
    {
        $select = $this->db->prepare('SELECT id, name, email, school FROM teachers WHERE id = ?');
        $select->execute([$id]);
        $row = $select->fetch(PDO::FETCH_ASSOC);

        if ($row === false) {
            throw new NotFound("No teacher with id {$id}.");
        }

        return $this->toTeacher($row);
    }

    /**
     * The "mapper" part: one database row → one Teacher object.
     *
     * @param array<string, mixed> $row
     */
    private function toTeacher(array $row): Teacher
    {
        $email = trim((string) $row['email']);

        return new Teacher(
            (int) $row['id'],
            (string) $row['name'],
            $email === '' ? null : new EmailAddress($email),
            (string) $row['school'],
        );
    }
}

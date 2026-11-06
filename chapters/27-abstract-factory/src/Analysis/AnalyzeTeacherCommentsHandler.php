<?php

declare(strict_types=1);

namespace Evalu8\Analysis;

use Evalu8\Domain\ResponseRepository;
use Evalu8\Domain\TeacherRepository;
use PDO;

/**
 * The handler: the logic that carries out AnalyzeTeacherComments. It gets its services from
 * the container, so the command itself stays plain data.
 */
final readonly class AnalyzeTeacherCommentsHandler
{
    public function __construct(
        private TeacherRepository $teachers,
        private ResponseRepository $responses,
        private CommentAnalyzer $analyzer,
        private PDO $db,
    ) {
    }

    public function handle(AnalyzeTeacherComments $command): string
    {
        $teacher = $this->teachers->get($command->teacherId);   // throws NotFound for an unknown teacher

        $comments = [];
        foreach ($this->responses->forTeacherInTerm($teacher->id, $command->term) as $response) {
            if ($response->comment !== '') {
                $comments[] = $response->comment;
            }
        }

        $summary = $this->analyzer->summarize($comments);

        $save = $this->db->prepare('REPLACE INTO comment_summaries (teacher_id, term, summary) VALUES (?, ?, ?)');
        $save->execute([$teacher->id, $command->term, $summary]);

        return $summary;
    }
}

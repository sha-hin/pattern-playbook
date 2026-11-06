// Part 4: survey structure (chapters 16–20).

export const PART4 = {

  // ════════════════════════════════════════════════════════════════════
  '16-composite': {
    description: 'The new survey has sections inside sections, and the score must be calculated at every level. Fix it with the Composite pattern in PHP: questions and sections share one interface.',
    ticket: {
      from: 'Mona Saleh, Head of Quality',
      title: 'The 2026-T2 survey has sections inside sections',
      body: 'Until now each answer was one score. From next term the survey has sections (Teaching, Classroom), Classroom contains a sub-section (Time management), and some parts count more than others: Teaching ×3, Classroom ×2. We need a score for every section and for the whole survey, and next year there may be a third level.',
    },
    pain: {
      text: ['The first attempt loops over sections, then over their questions:'],
      code: `$total = 0;
foreach ($survey->sections as $section) {
    foreach ($section->questions as $question) {
        $total += $answers[$question->code] * $question->weight;
    }
    // ...and if $section contains another section? Another foreach.
    // And a third level next year? Another one.
}`,
      after: [
        'The code hard-wires the depth of the tree. Every new level means another nested loop, and code that walks the tree (scoring, printing, counting) needs `instanceof` checks to know whether it is holding a question or a section.',
        'A section and a question look different, but the report asks both the same thing: **what is your score?**',
      ],
    },
    pattern: {
      name: 'Composite',
      rule: 'Items and groups of items must be treated the same way, in a tree of any depth → give both one interface; a group answers by asking its children.',
      explain: [
        '`SurveyNode` is the shared interface (the **component**). `Question` is a **leaf**: it answers `score()` from the answer sheet. `Section` is a **composite**: it holds any `SurveyNode`s, questions or sections, and answers `score()` by asking each child and taking the weighted average.',
        'Nothing checks what kind of node it has. A section inside a section inside a section works automatically, because each level makes the same call.',
        'Unanswered questions return `null` and are left out of the average instead of counting as zero, the same rule as the weighted scoring in chapter 3.',
      ],
      drawing: {
        bad: [['b', 30, 14, 240, 142, '', 'x'], ['t', 46, 40, 'foreach ($sections as $s)', 'm'], ['t', 56, 62, 'foreach ($s->questions …)', 'm'], ['t', 66, 84, '$total += …', 'm'], ['t', 56, 106, '// section in a section?', 'm'], ['t', 46, 140, 'works only two levels deep', 'kx']],
        good: [['b', 110, 4, 80, 26, 'Survey', 'v2'], ['a', 150, 30, 50, 52, '', 'k'], ['a', 150, 30, 150, 52, '', 'k'], ['a', 150, 30, 250, 52, '', 'k'], ['b', 10, 54, 80, 26, 'Teaching', 'v2'], ['b', 110, 54, 80, 26, 'Classroom', 'v2'], ['b', 220, 54, 60, 26, 'q6', 'n'], ['a', 50, 80, 30, 104], ['a', 50, 80, 72, 104], ['b', 12, 106, 36, 24, 'q1', 'n'], ['b', 54, 106, 36, 24, 'q2', 'n'], ['a', 150, 80, 130, 104], ['a', 150, 80, 190, 104, '', 'k'], ['b', 112, 106, 36, 24, 'q3', 'n'], ['b', 156, 106, 84, 24, 'Time mgmt', 'v2'], ['t', 150, 152, 'score(): the same call at every level', 's', 'middle']],
        badCaption: 'The loops assume a fixed depth. A deeper survey breaks the code.',
        goodCaption: 'Sections and questions share one interface. A section asks its children.',
      },
    },
    steps: [
      { title: 'One respondent’s answers', text: ['Question code → `Score` (the flyweight from chapter 15). Building it validates every value.'], file: 'src/Survey/AnswerSheet.php' },
      { title: 'The component interface', text: ['What a question and a section have in common.'], file: 'src/Survey/SurveyNode.php' },
      { title: 'The leaf: a question', text: ['It answers from the answer sheet and has no children. It is `readonly`: once created, a question never changes.'], file: 'src/Survey/Question.php' },
      {
        title: 'The composite: a section',
        text: ['`add()` accepts any `SurveyNode`. `score()` calls `score()` on each child, whatever it is, and returns the weighted average of the answered ones.'],
        file: 'src/Survey/Section.php',
      },
      { title: 'The real survey', text: ['Three levels deep. Time management sits inside Classroom.'], file: 'src/Survey/TeacherEvaluationSurvey.php' },
      { title: 'Score every node', text: ['`show()` calls `score()` and recurses through `children()`. It never asks whether it holds a question or a section.'], file: 'bin/survey.php' },
    ],
    run: {
      script: 'bin/survey.php',
      cmd: 'composer dump-autoload\nphp bin/survey.php',
      text: ['Every level has a score. Time management ignores the skipped q5 instead of counting it as 0, and the overall 3.67 is (4.33 × 3 + 2.50 × 2 + 4.00 × 1) / 6.'],
    },
    laravel: {
      text: [
        'Laravel’s query builder uses Composite for nested conditions: `where(function ($q) { ... })` stores a whole group as one condition, and when SQL is generated, a group compiles its own conditions inside brackets, to any depth.',
        'In your app, a self-referencing Eloquent relation stores the same tree in one table:',
      ],
      code: `// survey_nodes: id, parent_id, type ('section' | 'question'), title, code, weight
final class SurveyNode extends Model
{
    public function children(): HasMany
    {
        return $this->hasMany(self::class, 'parent_id');
    }
}

// Nested where groups: a group of conditions treated as one condition.
Response::where('term', '2026-T1')
    ->where(fn ($q) => $q->where('score', '<=', 2)->orWhere(fn ($q) => $q->whereNull('score')->where('role', 'peer')))
    ->get();`,
    },
    check: [
      { q: 'A fourth level of sections is added. What changes in the scoring code?', a: 'Nothing. Each section asks its children; depth doesn’t matter.' },
      { q: 'Why does an unanswered question return `null` and not `0`?', a: 'A skipped question is not a score of zero. Returning `null` lets the section leave it out of the average.' },
      { q: 'Which class is the leaf and which is the composite?', a: '`Question` is the leaf (no children). `Section` is the composite (holds other nodes).' },
    ],
    next: 'Now the quality team wants to count questions, check surveys for mistakes and print them as handouts. Each request adds another method to both Question and Section.',
  },

  // ════════════════════════════════════════════════════════════════════
  '17-visitor': {
    description: 'Every new operation on the survey tree adds a method to Question and Section. Add operations without touching them, with the Visitor pattern in PHP.',
    ticket: {
      from: 'Mona Saleh, Head of Quality',
      title: 'Count, check and print our surveys',
      body: 'We need three things before term starts: how many questions each survey has, a check that catches design mistakes (two questions with the same code, empty sections), and a printable handout for schools without tablets. Next term we will probably ask for a PDF and an accessibility check too.',
    },
    pain: {
      text: ['The obvious way adds a method per request to both node classes:'],
      code: `interface SurveyNode
{
    public function score(AnswerSheet $answers): ?float;
    public function countQuestions(): int;
    public function validate(array &$errors, array &$codesSeen): void;
    public function toMarkdown(int $depth): string;
    // next term: toPdf(), accessibilityIssues(), ...
}`,
      after: [
        '`Question` and `Section` were small and stable. Now they grow with every report request, they mix scoring with printing and checking, and all the code for "printing a survey" is split across two classes.',
        'The tree’s **structure** rarely changes (there are only questions and sections). The **operations** on it keep growing. We want to add operations without editing the node classes.',
      ],
    },
    pattern: {
      name: 'Visitor',
      rule: 'A stable set of node types needs a growing list of operations → put each operation in its own visitor class with one method per node type; the nodes only accept visitors.',
      explain: [
        'Each node gets one method, `accept(SurveyVisitor $visitor)`, and calls back the visitor method for its own type: a question calls `visitQuestion($this)`, a section calls `visitSection($this)`. This is **double dispatch**: the right method is chosen by both the visitor and the node, without any `instanceof`.',
        'Each operation is now one class: `QuestionCounter`, `SurveyValidator`, `MarkdownExporter`. Everything about printing is in one file, and a new operation never touches `Question` or `Section`.',
        '**The trade-off:** adding a new node type (say, a free-text question) means adding a method to every visitor. Use Visitor when the types are stable and the operations change, not the other way round.',
      ],
      drawing: {
        bad: [['b', 10, 14, 130, 138, '', 'x'], ['t', 20, 36, 'Question', 'm'], ['t', 26, 60, 'score()', 'm'], ['t', 26, 80, 'count()', 'm'], ['t', 26, 100, 'validate()', 'm'], ['t', 26, 120, 'toMarkdown()', 'm'], ['t', 26, 140, 'toPdf() …', 'kx'], ['b', 160, 14, 130, 138, '', 'x'], ['t', 170, 36, 'Section', 'm'], ['t', 176, 60, 'score()', 'm'], ['t', 176, 80, 'count()', 'm'], ['t', 176, 100, 'validate()', 'm'], ['t', 176, 120, 'toMarkdown()', 'm'], ['t', 176, 140, 'toPdf() …', 'kx']],
        good: [['b', 6, 30, 90, 34, 'Question', 'n'], ['b', 6, 96, 90, 34, 'Section', 'n'], ['t', 51, 84, 'accept($v)', 's', 'middle'], ['a', 96, 47, 198, 28, '', 'k'], ['a', 96, 113, 198, 134, '', 'k'], ['a', 96, 80, 198, 81, '', 'k'], ['b', 200, 10, 96, 34, 'Counter', 'v'], ['b', 200, 64, 96, 34, 'Validator', 'v'], ['b', 200, 118, 96, 34, 'Markdown', 'v'], ['t', 150, 162, 'new operation = new visitor', 's', 'middle']],
        badCaption: 'Every request adds a method to both node classes.',
        goodCaption: 'Nodes only accept visitors. Each operation is its own class.',
      },
    },
    steps: [
      { title: 'The visitor interface', text: ['One method per node type. There are two node types, so two methods.'], file: 'src/Survey/SurveyVisitor.php' },
      { title: 'Nodes accept a visitor', text: ['The only change to the tree, made once.'], file: 'src/Survey/SurveyNode.php', diff: 'src/Survey/SurveyNode.php' },
      { title: 'A question calls visitQuestion()', text: [], file: 'src/Survey/Question.php', diff: 'src/Survey/Question.php' },
      { title: 'A section calls visitSection()', text: ['The visitor decides whether to go inside, by calling `accept()` on each child.'], file: 'src/Survey/Section.php', diff: 'src/Survey/Section.php' },
      { title: 'Visitor 1: count', text: [], file: 'src/Survey/Visitor/QuestionCounter.php' },
      {
        title: 'Visitor 2: check for mistakes',
        text: ['It remembers the codes it has seen while walking the tree, so it can spot a duplicate anywhere, at any depth.'],
        file: 'src/Survey/Visitor/SurveyValidator.php',
      },
      {
        title: 'Visitor 3: the printable handout',
        text: ['Sections become headings and questions become lines with five boxes. When a sub-section ends and more questions follow, the parent’s heading is repeated with "(continued)", because Markdown can’t close a heading.'],
        file: 'src/Survey/Visitor/MarkdownExporter.php',
      },
      { title: 'Use all three', text: ['Each operation is: create the visitor, `accept()` it on the root, read the result.'], file: 'bin/survey.php', diff: 'bin/survey.php' },
    ],
    run: {
      script: 'bin/survey.php',
      cmd: 'composer dump-autoload\nphp bin/survey.php',
      text: ['The real survey passes the check; the draft fails with both mistakes named. The handout keeps q6 under the survey’s own heading, not under Time management.'],
    },
    laravel: {
      text: [
        'PHP-Parser (used by PHPStan, Rector and Laravel Pint’s tooling) is the best-known PHP visitor: a `NodeVisitor` walks a syntax tree that has many node types and few new ones. Laravel’s query grammars apply the same idea to queries: one grammar class per database "visits" each part of a query and turns it into SQL.',
      ],
      code: `// With nikic/php-parser: one class per operation over PHP code
final class FindDdCalls extends NodeVisitorAbstract
{
    /** @var list<int> */
    public array $lines = [];

    public function enterNode(Node $node): null
    {
        if ($node instanceof Node\\Expr\\FuncCall && $node->name instanceof Node\\Name && $node->name->toString() === 'dd') {
            $this->lines[] = $node->getStartLine();
        }

        return null;
    }
}`,
    },
    check: [
      { q: 'Next term needs a PDF export. Which classes change?', a: 'None. You add one class, `PdfExporter implements SurveyVisitor`.' },
      { q: 'A new node type, `TextQuestion`, is added. What changes?', a: 'The visitor interface gains `visitTextQuestion()`, and every existing visitor must implement it. That is Visitor’s cost.' },
      { q: 'What is double dispatch here?', a: 'The method that runs depends on two things: the visitor (which operation) and the node (which `visit...` method it calls back).' },
    ],
    next: 'The quality team wants follow-up questions that appear only for some respondents, and they want to write those rules themselves, without waiting for a developer.',
  },

  // ════════════════════════════════════════════════════════════════════
  '18-interpreter': {
    description: '"Show Q8 only to peers who gave Q1 at least 4": let admins write rules as text and evaluate them with the Interpreter pattern in PHP, one class per grammar rule.',
    ticket: {
      from: 'Mona Saleh, Head of Quality',
      title: 'Follow-up questions that only some people see',
      body: 'If a student rates punctuality 2 or lower, ask them what would help. Only peers who rated the explanations 4 or higher should be asked about co-teaching. The principal gets a question only when something is low. We want to type these rules in the survey editor ourselves, for example: role = "peer" and q1 >= 4.',
    },
    pain: {
      text: ['Without a rule language, each rule is PHP code that a developer writes and deploys:'],
      code: `function isVisible(string $code, array $answers, RespondentRole $role): bool
{
    if ($code === 'q7') return ($answers['q4'] ?? 99) <= 2;
    if ($code === 'q8') return $role === RespondentRole::Peer && ($answers['q1'] ?? 0) >= 4;
    if ($code === 'q9') return $role === RespondentRole::Principal && (/* ... */);
    // every new survey, every changed threshold: a ticket, a developer, a deploy
    return true;
}`,
      after: [
        'The rules belong to the quality team, but they live in code only developers can change. The function grows with every survey and mixes the rules of all surveys.',
        'The rules form a small **language**: comparisons joined with `and`, `or`, `not` and brackets. If we represent each sentence of that language as a tree of objects, the tree can evaluate itself.',
      ],
    },
    pattern: {
      name: 'Interpreter',
      rule: 'Users need to express rules in a small language → represent each grammar rule as a class, build a tree of those objects from the text, and let the tree evaluate itself.',
      explain: [
        'Each piece of the language is a class with one job: `Comparison` (`q1 >= 4`), `AllOf` (`and`), `AnyOf` (`or`), `Not`, and the operands `AnswerTo` (`q1`), `Role` and `Literal` (`4`, `"peer"`). Each one knows how to evaluate itself against a `RuleContext` (the answers so far and the respondent’s role). That tree of classes **is** the Interpreter pattern.',
        '`RuleParser` turns the text into the tree. It is not part of the pattern, but you need one for users to type rules. Ours is a small recursive-descent parser: one method per grammar level, so `and` binds tighter than `or`, exactly as in PHP.',
        'Use Interpreter for **small** languages like this one. For anything bigger, use an existing engine (Symfony ExpressionLanguage, JSON Logic) instead of growing your own.',
      ],
      drawing: {
        bad: [['b', 30, 14, 240, 142, '', 'x'], ['t', 46, 40, "if ($code === 'q8'", 'm'], ['t', 56, 62, '&& $role === Peer', 'm'], ['t', 56, 84, "&& $answers['q1'] >= 4)", 'm'], ['t', 46, 114, 'every new rule = a developer', 'kx'], ['t', 46, 134, '… and a deploy', 'kx']],
        good: [['b', 20, 4, 260, 26, 'role = "peer" and q1 >= 4', 'n'], ['a', 150, 30, 150, 50, '', 'k'], ['t', 160, 45, 'parse', 's'], ['b', 110, 52, 80, 28, 'AllOf', 'v'], ['a', 150, 80, 76, 104, '', 'k'], ['a', 150, 80, 224, 104, '', 'k'], ['b', 8, 106, 136, 28, 'role = "peer"', 'v2'], ['b', 156, 106, 136, 28, 'q1 >= 4', 'v2'], ['t', 150, 156, 'each node evaluates itself', 's', 'middle']],
        badCaption: 'Every rule is PHP code that only a developer can change.',
        goodCaption: 'The text becomes a tree of small objects, and the tree evaluates itself.',
      },
    },
    steps: [
      { title: 'What a rule can see', text: [], file: 'src/Survey/Rules/RuleContext.php' },
      { title: 'True-or-false expressions', text: ['`describe()` writes the rule back with brackets, so the editor can show how it was understood.'], file: 'src/Survey/Rules/Condition.php' },
      { title: 'Value expressions', text: [], file: 'src/Survey/Rules/Operand.php' },
      { title: 'q1, q2…: an answer', text: ['`?->` returns `null` when the question wasn’t answered.'], file: 'src/Survey/Rules/AnswerTo.php' },
      { title: 'role', text: [], file: 'src/Survey/Rules/Role.php' },
      { title: '4, "peer": a fixed value', text: [], file: 'src/Survey/Rules/Literal.php' },
      {
        title: 'A comparison',
        text: ['An unanswered question makes every comparison false, so a follow-up never appears because of a missing answer.'],
        file: 'src/Survey/Rules/Comparison.php',
      },
      { title: 'and', text: [], file: 'src/Survey/Rules/AllOf.php' },
      { title: 'or', text: [], file: 'src/Survey/Rules/AnyOf.php' },
      { title: 'not', text: [], file: 'src/Survey/Rules/Not.php' },
      { title: 'An error for rules that don’t make sense', text: [], file: 'src/Survey/Rules/InvalidRule.php' },
      {
        title: 'The parser: text → tree',
        text: [
          '`tokenize()` cuts the text into words, numbers, strings and operators. Then one method per level of the grammar: `parseOr()` calls `parseAnd()`, which calls `parseUnary()`. Because `or` is handled at the outermost level, `and` binds tighter. Every error names the position in the rule.',
        ],
        file: 'src/Survey/Rules/RuleParser.php',
      },
      { title: 'Questions can have a rule', text: [], file: 'src/Survey/Question.php', diff: 'src/Survey/Question.php' },
      { title: 'Rules typed by the quality team', text: [], file: 'bin/survey-rules.php' },
    ],
    run: {
      script: 'bin/survey-rules.php',
      cmd: 'composer dump-autoload\nphp bin/survey-rules.php',
      text: ['Each rule is printed with brackets showing how it was understood, then evaluated for three respondents. The last block shows four typos rejected with their position, when the rule is saved rather than when a student opens the survey.'],
    },
    laravel: {
      text: [
        'Laravel has no rule-language component, but the Symfony **ExpressionLanguage** component (installable in any Laravel app) is a production-grade interpreter: it parses expressions into a tree of node objects and evaluates them, with caching of parsed rules.',
      ],
      code: `use Symfony\\Component\\ExpressionLanguage\\ExpressionLanguage;

$language = new ExpressionLanguage();

$visible = $language->evaluate('role == "peer" and q1 >= 4', [
    'role' => 'peer',
    'q1' => 5,
]);   // true`,
    },
    check: [
      { q: 'Which part is the Interpreter pattern: the parser or the classes like `Comparison` and `AllOf`?', a: 'The classes. Each one represents one rule of the grammar and evaluates itself. The parser only builds the tree.' },
      { q: 'Why does `a or b and c` mean `a or (b and c)`?', a: 'The parser handles `or` at the outermost level and `and` one level deeper, so `and` groups first.' },
      { q: 'Why is an unanswered question treated as "false" in every comparison?', a: 'So a follow-up question can’t appear because an answer is missing, whatever the operator.' },
    ],
    next: 'Next term’s survey should start as a copy of this term’s. Last time someone copied it, editing the copy changed the original.',
  },

  // ════════════════════════════════════════════════════════════════════
  '19-prototype': {
    description: 'Start next term’s survey from a copy of this term’s, without the copy sharing parts with the original. Clone object trees safely with the Prototype pattern and __clone in PHP.',
    ticket: {
      from: 'Mona Saleh, Head of Quality',
      title: 'Editing next term’s survey changed this term’s survey',
      body: 'We copied the 2026-T2 survey to prepare 2027-T1 and added a homework question to Time management. Now the 2026-T2 survey, which 1,200 students already answered, also shows that question, and its scores changed.',
    },
    pain: {
      text: ['The copy was made with PHP’s `clone`, which looked right:'],
      code: `$nextTerm = clone $thisTerm;
$nextTerm->rename('Teacher evaluation 2027-T1');
$nextTerm->section('Time management')->add(new Question('q7', 'Gives homework back within a week'));
// $thisTerm now has q7 too!`,
      after: [
        '`clone` makes a **shallow copy**: a new root object, but its `$children` array still points to the **same** section objects as the original. Adding a question to the copy’s Time management section adds it to the only Time management section there is.',
        'Rebuilding the survey from scratch avoids the bug but means re-typing 40 lines for every term. We want a real, independent copy that we then edit.',
      ],
    },
    pattern: {
      name: 'Prototype',
      rule: 'A new object should start as a copy of an existing, configured one → clone it, and make the clone deep where it must own its parts.',
      explain: [
        'In PHP, `clone` creates the copy and then runs `__clone()` on the **new** object. `Section::__clone()` replaces each child section with a clone of it; each of those runs its own `__clone()` for its children. The result is a deep copy of every section, at any depth.',
        'Questions are **not** cloned. They are `readonly` and can never change, so the original and the copy can safely share them, which also saves memory. Deep-copy what can change; share what can’t.',
        'The surveys from earlier terms are the **prototypes**: configured objects you copy instead of building new ones from nothing.',
      ],
      drawing: {
        bad: [['b', 6, 20, 110, 34, '2026-T2', 'n'], ['b', 184, 20, 110, 34, '2027-T1 copy', 'n'], ['a', 61, 54, 140, 100, '', 'x'], ['a', 239, 54, 160, 100, '', 'x'], ['b', 90, 102, 120, 34, 'Time management', 'x'], ['t', 150, 154, 'shallow copy: one shared section', 'kx', 'middle']],
        good: [['b', 6, 10, 110, 30, '2026-T2', 'n'], ['b', 184, 10, 110, 30, '2027-T1', 'n'], ['a', 61, 40, 61, 64], ['a', 239, 40, 239, 64], ['b', 6, 66, 110, 30, 'Time mgmt', 'v2'], ['b', 184, 66, 110, 30, 'Time mgmt', 'v2'], ['a', 61, 96, 140, 124, '', 'k'], ['a', 239, 96, 160, 124, '', 'k'], ['b', 100, 126, 100, 28, 'q4, q5', 'n'], ['t', 150, 164, 'sections copied, questions shared', 's', 'middle']],
        badCaption: 'Both surveys point to the same section. Editing one edits both.',
        goodCaption: 'Each survey owns its sections. The immutable questions are safely shared.',
      },
    },
    steps: [
      {
        title: 'Section learns to copy itself properly',
        text: [
          '`__clone()` runs on the new object right after `clone`. It replaces each child section with its own clone, recursively. The title is no longer `readonly`, so a copy can be renamed, and `section()` finds a section anywhere in the tree by its title.',
        ],
        file: 'src/Survey/Section.php', diff: 'src/Survey/Section.php',
      },
      {
        title: 'Copy, then change only what’s new',
        text: ['The script copies this term’s survey, renames it, adds a question deep inside, and compares the two.'],
        file: 'bin/new-term.php',
      },
    ],
    run: {
      script: 'bin/new-term.php',
      cmd: 'composer dump-autoload\nphp bin/new-term.php',
      text: ['The original still has six questions and two in Time management; the copy has seven and three. Their sections are separate objects; their questions are shared on purpose.'],
    },
    laravel: {
      text: [
        'Eloquent’s `$model->replicate()` is a prototype operation: it copies one row’s attributes into a new, unsaved model, without the primary key and timestamps. It does **not** copy relations; for a survey with sections and questions you replicate the children yourself, inside a transaction.',
      ],
      code: `$copy = DB::transaction(function () use ($survey): Survey {
    $copy = $survey->replicate(['published_at']);
    $copy->title = 'Teacher evaluation 2027-T1';
    $copy->save();

    foreach ($survey->sections as $section) {
        $copy->sections()->save($section->replicate());   // and so on for each level
    }

    return $copy;
});`,
    },
    check: [
      { q: 'What does PHP’s `clone` copy by default?', a: 'The object itself and its property values. Objects held in properties (or inside arrays) are not copied: the copy points to the same ones.' },
      { q: 'Why aren’t questions cloned in `__clone()`?', a: 'They are immutable. Nobody can change a shared question, so sharing is safe and saves memory.' },
      { q: 'When is `__clone()` called, and on which object?', a: 'Right after `clone`, on the new copy, never on the original.' },
    ],
    next: 'The survey is still built with nested `new Section(...)->add(...)` calls, and principals want the term report as an HTML page while the inspector wants plain text.',
  },

  // ════════════════════════════════════════════════════════════════════
  '20-builder': {
    description: 'Build surveys step by step and get the term report as HTML and plain text from one recipe. The Builder pattern in PHP, in its modern fluent form and the original Gang of Four form.',
    ticket: {
      from: 'Mona Saleh, Head of Quality, and the Ministry inspector',
      title: 'Surveys are hard to read, and the report must come in two formats',
      body: 'Our survey designers can’t read the nested code that defines a survey, and mistakes (a duplicate code) are found only when students answer. Separately: principals want the term report as a web page, the inspector wants it as plain text in an email, and the first two versions we got didn’t even sort the schools the same way.',
    },
    pain: {
      text: ['Two report functions, each with its own copy of the structure:'],
      code: `function htmlReport(array $results): string
{
    // group by school, sort schools, write <h2> and <tr>...
}

function textReport(array $results): string
{
    // group by school (but forgot to sort), write lines...
}`,
      after: [
        'The **structure** of the report (title, then each school with its teachers, then a note) is copied into each format, and the copies already disagree. Survey definitions have a similar problem: the order of construction is buried in nested calls, and nothing checks the whole survey when it is created.',
        'Both problems are about **building** something complex step by step. The Builder pattern has two forms, and this chapter uses both.',
      ],
    },
    pattern: {
      name: 'Builder',
      rule: 'A complex object is assembled step by step → let a builder collect the steps and produce the result at the end; to get different products from the same steps, give each product its own builder.',
      explain: [
        '**The modern, fluent form** (what most PHP code calls a builder): `SurveyBuilder` collects sections and questions in reading order, with `end()` closing a section. Nothing is final until `build()`, which checks the **whole** survey (unclosed sections, plus the validator from chapter 17) and either returns it or throws with every problem listed. Laravel’s query builder works this way.',
        '**The book’s form**: a `ReportBuilder` interface defines the steps of a report document. `HtmlReportBuilder` and `PlainTextReportBuilder` implement those steps to produce two different products. The **director**, `TermReportWriter`, knows the order of the steps (title, schools sorted, teachers, footnote) and drives any builder. Grouping and sorting are written once.',
      ],
      drawing: {
        bad: [['b', 6, 14, 138, 138, '', 'x'], ['t', 16, 36, 'htmlReport()', 'm'], ['t', 22, 60, 'group by school', 'm'], ['t', 22, 82, 'sort', 'm'], ['t', 22, 104, '<h2>, <tr> …', 'm'], ['b', 156, 14, 138, 138, '', 'x'], ['t', 166, 36, 'textReport()', 'm'], ['t', 172, 60, 'group by school', 'm'], ['t', 172, 82, '(forgot sort)', 'kx'], ['t', 172, 104, 'lines …', 'm']],
        good: [['b', 4, 62, 80, 40, 'Director', 'v'], ['a', 84, 82, 104, 82], ['b', 106, 60, 92, 44, 'ReportBuilder', 'i'], ['a', 198, 82, 212, 40, '', 'k'], ['a', 198, 82, 212, 124, '', 'k'], ['b', 214, 22, 82, 36, 'HTML', 'v2'], ['b', 214, 106, 82, 36, 'Plain text', 'v2'], ['t', 44, 124, 'owns the order', 's', 'middle'], ['t', 255, 158, 'different products', 's', 'middle']],
        badCaption: 'Each format copies the report’s structure, and the copies drift.',
        goodCaption: 'The director owns the steps. Each builder turns them into its own format.',
      },
    },
    steps: [
      { title: 'An error that lists every problem', text: [], file: 'src/Survey/InvalidSurvey.php' },
      {
        title: 'The fluent survey builder',
        text: [
          'It keeps a stack of open sections: `section()` pushes one, `end()` pops it, `question()` adds to the innermost. Rules are given as text and parsed with the interpreter from chapter 18, so a typo fails at build time.',
          '`build()` collects every problem before throwing, so the designer fixes them all in one go.',
        ],
        file: 'src/Survey/SurveyBuilder.php',
      },
      {
        title: 'The survey, readable top to bottom',
        text: ['Compare it with chapter 16: the indentation now matches the survey’s structure. The new follow-up question q7 carries its rule.'],
        file: 'src/Survey/TeacherEvaluationSurvey.php', diff: 'src/Survey/TeacherEvaluationSurvey.php',
      },
      { title: 'The book’s form: the builder interface', text: ['The steps every report document is made of.'], file: 'src/Reporting/Document/ReportBuilder.php' },
      {
        title: 'Builder 1: HTML',
        text: ['Every value goes through `htmlspecialchars()`. Each builder has its own result method (`html()`, `text()`), because the products don’t share a type.'],
        file: 'src/Reporting/Document/HtmlReportBuilder.php',
      },
      { title: 'Builder 2: plain text', text: [], file: 'src/Reporting/Document/PlainTextReportBuilder.php' },
      { title: 'The director', text: ['Grouping and sorting by school are written here, once.'], file: 'src/Reporting/Document/TermReportWriter.php' },
      { title: 'Both forms in action', text: [], file: 'bin/documents.php' },
    ],
    run: {
      script: 'bin/documents.php',
      cmd: 'composer dump-autoload\nphp bin/documents.php',
      text: ['The draft survey fails with all three problems in one message. The same director then produces the plain-text and HTML reports, with the schools in the same order.'],
    },
    laravel: {
      text: [
        'The query builder is the fluent form: `where()`, `orderBy()` and `limit()` collect parts, and nothing touches the database until `get()`. The HTTP client is another: `Http::withToken()->timeout(10)->retry(3)->post()`.',
        'The book’s form appears in Laravel’s mail: `MailMessage` is built with steps (`subject()`, `line()`, `action()`), and the same message is rendered to HTML and to plain text by different renderers.',
      ],
      code: `// Fluent builders you already use every day:
$teachers = Teacher::query()
    ->where('school', 'Smouha')
    ->whereHas('responses', fn ($q) => $q->where('term', '2026-T1'))
    ->orderBy('name')
    ->get();                    // the only step that runs SQL

return (new MailMessage)
    ->subject('Your 2026-T1 evaluation result')
    ->line('Your weighted score is 4.13.')
    ->action('Open your dashboard', url('/dashboard'));   // rendered as HTML and as text`,
    },
    check: [
      { q: 'Why does `SurveyBuilder::build()` validate, instead of each `question()` call?', a: 'Some problems only exist in the whole survey: a duplicate code, an empty or unclosed section. `build()` is the first moment the whole survey exists.' },
      { q: 'In the book’s form, which class knows the order of the steps?', a: 'The director (`TermReportWriter`). The builders only know how to write each step in their format.' },
      { q: 'The inspector now wants a CSV version of the report. What do you add?', a: 'One class, `CsvReportBuilder implements ReportBuilder`. The director and the other builders don’t change.' },
    ],
    next: 'Part 5 starts: surveys now have a lifecycle (draft, open, closed, archived), and every action checks the status with a growing ladder of `if`s.',
  },
};

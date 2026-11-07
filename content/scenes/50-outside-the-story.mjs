// After the story · Five patterns a Laravel PMS doesn't need, each built for a job where it does fit.

export default {
  description: 'Composite, Data Mapper, Interpreter, Visitor and Flyweight had no honest place in Nordic Stays. Each is built here, from scratch, for a real job where it fits: a permission-aware menu, a plain domain object saved by a mapper, a small rule language for hosts, new operations on that language’s tree, and memory shared by 300,000 amenities. With tests, and where you will meet each one.',
  intro: [
    'The story used a pattern only where a real team would write it. These five never came up, because a vacation-rental PMS on Laravel doesn’t need them. You will still meet them: in Symfony and Doctrine codebases, in the tools that check your code, in rule engines, in interviews.',
    'Each one below is a small, complete example: the problem, the code, the tests, and the places it lives in real software. The code sits in `examples/`, outside the Nordic Stays app, so nothing in the story depends on it.',
  ],
  parts: [
    {
      id: 'composite',
      title: 'Composite: a menu where a group and a link are the same kind of thing',
      text: [
        'The host app’s sidebar is a tree: links, and groups of links, and groups inside groups. Each link may need a permission, and a group whose links are all hidden must disappear too. Written with nested arrays, every place that walks the menu needs `if (isset($item[\'children\']))` and its own recursion.',
        'With Composite, a link and a group implement the same interface, so code that renders the menu calls one method and never asks which kind it has. The group does the recursion, once.',
      ],
      sections: [
        {
          title: 'The code',
          blocks: [
            {
              path: 'examples/composite/MenuNode.php',
              code: String.raw`<?php

namespace Examples\Composite;

use Illuminate\Contracts\Auth\Access\Authorizable;

interface MenuNode
{
    /** @return array<string, mixed>|null what this viewer sees, or null when they see nothing */
    public function render(Authorizable $viewer): ?array;
}`,
            },
            {
              title: 'The leaf',
              path: 'examples/composite/MenuLink.php',
              code: String.raw`<?php

namespace Examples\Composite;

use Illuminate\Contracts\Auth\Access\Authorizable;

final readonly class MenuLink implements MenuNode
{
    public function __construct(
        private string $label,
        private string $url,
        private ?string $ability = null,                               // a Gate ability, or null for everyone
    ) {
    }

    public function render(Authorizable $viewer): ?array
    {
        if ($this->ability !== null && ! $viewer->can($this->ability)) {
            return null;
        }

        return ['label' => $this->label, 'url' => $this->url];
    }
}`,
            },
            {
              title: 'The composite',
              path: 'examples/composite/MenuGroup.php',
              code: String.raw`<?php

namespace Examples\Composite;

use Illuminate\Contracts\Auth\Access\Authorizable;

final readonly class MenuGroup implements MenuNode
{
    /** @param list<MenuNode> $children links or groups: the group doesn't care which */
    public function __construct(
        private string $label,
        private array $children,
    ) {
    }

    public function render(Authorizable $viewer): ?array
    {
        $visible = array_values(array_filter(
            array_map(fn (MenuNode $child): ?array => $child->render($viewer), $this->children),
        ));

        return $visible === [] ? null : ['label' => $this->label, 'children' => $visible];   // nothing visible: no empty group
    }
}`,
            },
            {
              title: 'The menu, built once',
              path: 'examples/composite/HostMenu.php',
              code: String.raw`<?php

namespace Examples\Composite;

final class HostMenu
{
    public static function make(): MenuNode
    {
        return new MenuGroup('Nordic Stays', [
            new MenuLink('Calendar', '/calendar'),
            new MenuLink('Cleanings', '/cleanings'),
            new MenuGroup('Money', [
                new MenuLink('Payouts', '/payouts', 'viewPayouts'),
                new MenuLink('Exports', '/exports', 'export'),
            ]),
            new MenuGroup('Settings', [
                new MenuLink('Team', '/team', 'manageMembers'),
                new MenuGroup('Channels', [
                    new MenuLink('Airbnb', '/channels/airbnb', 'manageChannels'),
                    new MenuLink('Booking.com', '/channels/booking-com', 'manageChannels'),
                ]),
            ]),
        ]);
    }
}`,
              after: ['`HostMenu::make()->render($request->user())` gives the whole tree for that user, as an array the front end draws. A cleaner gets Calendar and Cleanings, and no empty “Money” or “Settings” heading.'],
            },
          ],
        },
      ],
      reveal: {
        names: ['Composite'],
        rules: [['Composite', 'Leaves and groups of leaves implement the same interface, so a whole tree is used the same way as a single item.']],
        points: [
          '**Where you’ll meet it:** menus and navigation (Filament, Nova), nested categories, permission groups, a document made of sections made of paragraphs, the DOM itself, and every UI component tree (React, Livewire, Blade components with slots).',
          'Laravel’s own `Collection` of collections and validation rules nested with `Rule::forEach()` follow the same idea: the caller treats one and many alike.',
        ],
        whenNot: [
          'A flat list: a loop is clearer than a tree with one level.',
          'When leaves and groups really need different operations: forcing them under one interface means methods that do nothing on one side.',
        ],
      },
      tests: {
        summary: 'Each viewer sees exactly their tree, and empty groups disappear',
        blocks: [
          {
            path: 'tests/Unit/Examples/CompositeMenuTest.php',
            code: String.raw`<?php

use Examples\Composite\HostMenu;
use Illuminate\Contracts\Auth\Access\Authorizable;

/** @param list<string> $abilities */
function viewerWith(array $abilities): Authorizable
{
    return new class($abilities) implements Authorizable {
        /** @param list<string> $abilities */
        public function __construct(private array $abilities)
        {
        }

        public function can($abilities, $arguments = []): bool
        {
            return in_array($abilities, $this->abilities, true);
        }
    };
}

it('shows a cleaner only what needs no permission, without empty groups', function () {
    expect(HostMenu::make()->render(viewerWith([])))->toBe([
        'label' => 'Nordic Stays',
        'children' => [
            ['label' => 'Calendar', 'url' => '/calendar'],
            ['label' => 'Cleanings', 'url' => '/cleanings'],
        ],
    ]);
});

it('keeps a group that has one visible link, three levels down', function () {
    $menu = HostMenu::make()->render(viewerWith(['manageChannels']));

    expect($menu['children'][2]['label'])->toBe('Settings')
        ->and($menu['children'][2]['children'][0]['label'])->toBe('Channels')
        ->and($menu['children'][2]['children'][0]['children'])->toHaveCount(2);
});`,
          },
        ],
      },
    },
    {
      id: 'data-mapper',
      title: 'Data Mapper: a domain object that knows nothing about the database',
      text: [
        'Every model in this course is **Active Record** (scene 3): the object is a row, and it saves itself with `$booking->save()`. That is Laravel’s choice, and it is fast to work with. **Data Mapper** separates the two: the object holds the rules and nothing else, and a separate mapper moves it in and out of the database. It is how Doctrine works, so it is how most Symfony codebases work.',
        'Here is the same idea as a reservation in a small, plain-PHP domain: the object enforces its rules, and the mapper is the only code that knows the table.',
      ],
      sections: [
        {
          title: 'The code',
          blocks: [
            {
              title: 'The domain object: rules only, no base class, no database',
              path: 'examples/data-mapper/Reservation.php',
              code: String.raw`<?php

namespace Examples\DataMapper;

use Carbon\CarbonImmutable;
use DomainException;
use InvalidArgumentException;

final class Reservation
{
    private function __construct(
        private ?int $id,
        private readonly string $guest,
        private readonly CarbonImmutable $checkIn,
        private readonly CarbonImmutable $checkOut,
        private string $status,
    ) {
    }

    public static function hold(string $guest, CarbonImmutable $checkIn, CarbonImmutable $checkOut): self
    {
        if ($checkOut->lessThanOrEqualTo($checkIn)) {
            throw new InvalidArgumentException('Check-out must be after check-in.');
        }

        return new self(null, $guest, $checkIn, $checkOut, 'pending');
    }

    public function confirm(): void
    {
        if ($this->status !== 'pending') {
            throw new DomainException("A {$this->status} reservation can't be confirmed.");
        }

        $this->status = 'confirmed';
    }

    public function id(): ?int
    {
        return $this->id;
    }

    public function status(): string
    {
        return $this->status;
    }

    public function nights(): int
    {
        return (int) $this->checkIn->diffInDays($this->checkOut);
    }

    /** @internal For ReservationMapper: rebuild a saved reservation without running hold()'s rules again. */
    public static function fromRow(object $row): self
    {
        return new self((int) $row->id, $row->guest, CarbonImmutable::parse($row->check_in), CarbonImmutable::parse($row->check_out), $row->status);
    }

    /** @internal For ReservationMapper. @return array<string, string> */
    public function toRow(): array
    {
        return [
            'guest' => $this->guest,
            'check_in' => $this->checkIn->toDateString(),
            'check_out' => $this->checkOut->toDateString(),
            'status' => $this->status,
        ];
    }

    /** @internal For ReservationMapper, once, after the first insert. */
    public function identify(int $id): void
    {
        $this->id ??= $id;
    }
}`,
            },
            {
              title: 'The mapper: the only code that knows the table',
              path: 'examples/data-mapper/ReservationMapper.php',
              code: String.raw`<?php

namespace Examples\DataMapper;

use Illuminate\Database\ConnectionInterface;

final readonly class ReservationMapper
{
    public function __construct(private ConnectionInterface $db)
    {
    }

    public function find(int $id): ?Reservation
    {
        $row = $this->db->table('reservations')->find($id);

        return $row === null ? null : Reservation::fromRow($row);
    }

    public function save(Reservation $reservation): void
    {
        $row = $reservation->toRow();

        if ($reservation->id() === null) {
            $reservation->identify($this->db->table('reservations')->insertGetId($row));
            return;
        }

        $this->db->table('reservations')->where('id', $reservation->id())->update($row);
    }
}`,
              after: ['The mapper uses Laravel’s query builder, not Eloquent: it is plain SQL with bindings. `Reservation` can be tested without a database at all, and changing the table (a column renamed, a second table for history) changes only the mapper.'],
            },
            {
              title: 'The same thing in Doctrine',
              path: 'a Symfony app with Doctrine (for comparison)',
              fragment: true,
              code: String.raw`#[ORM\Entity]
#[ORM\Table(name: 'reservations')]
class Reservation
{
    #[ORM\Id, ORM\GeneratedValue, ORM\Column]
    private ?int $id = null;

    #[ORM\Column]
    private string $status = 'pending';
    // … the same rules as above; Doctrine reads the attributes instead of a hand-written mapper
}

$reservation = Reservation::hold('Lena Berg', $checkIn, $checkOut);
$entityManager->persist($reservation);   // tracked, not saved yet
$reservation->confirm();
$entityManager->flush();                 // one INSERT with status = confirmed`,
              after: ['`flush()` is Doctrine’s **Unit of Work** (scene 41): it tracks every entity you loaded or persisted and writes all their changes at once. Data Mapper and Unit of Work come together; Active Record (Eloquent) has neither, and saves each object when you call `save()`.'],
            },
          ],
        },
      ],
      reveal: {
        names: ['Data Mapper'],
        rules: [['Data Mapper', 'A layer that moves data between objects and the database, keeping each independent of the other. The objects hold the rules; the mapper holds the SQL.']],
        points: [
          '**Where you’ll meet it:** Doctrine (Symfony, many enterprise PHP apps), Hibernate in Java, Entity Framework in .NET, and domain-driven design codebases in any language.',
          '**Active Record vs Data Mapper** is a classic interview question. Active Record: less code, the object is the row, best when the domain is close to the tables (most Laravel apps). Data Mapper: more code, the domain can be shaped freely and tested without a database, best when the rules are complex and the tables shouldn’t dictate them.',
        ],
        whenNot: [
          'In a Laravel app, for its own models: you would rebuild Eloquent by hand and lose relations, scopes and eager loading.',
          'For CRUD with few rules: the mapper is pure overhead when the object has nothing to protect.',
        ],
      },
      tests: {
        summary: 'The object’s rules without a database, and a round trip through the mapper',
        blocks: [
          {
            path: 'tests/Feature/Examples/DataMapperTest.php',
            code: String.raw`<?php

use Carbon\CarbonImmutable;
use Examples\DataMapper\Reservation;
use Examples\DataMapper\ReservationMapper;
use Illuminate\Database\ConnectionInterface;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;

/** The example's own database: SQLite in memory, outside the app's tables and RefreshDatabase's transaction. */
function examplesDatabase(): ConnectionInterface
{
    config(['database.connections.examples' => ['driver' => 'sqlite', 'database' => ':memory:', 'prefix' => '']]);
    $db = DB::connection('examples');
    $db->getSchemaBuilder()->create('reservations', function (Blueprint $table) {
        $table->id();
        $table->string('guest');
        $table->date('check_in');
        $table->date('check_out');
        $table->string('status');
    });

    return $db;
}

it('enforces its rules with no database involved', function () {
    $reservation = Reservation::hold('Lena Berg', CarbonImmutable::parse('2027-07-10'), CarbonImmutable::parse('2027-07-13'));
    $reservation->confirm();

    expect($reservation->nights())->toBe(3)
        ->and(fn () => $reservation->confirm())->toThrow(DomainException::class);
});

it('saves and loads a reservation through the mapper only', function () {
    $mapper = new ReservationMapper(examplesDatabase());
    $reservation = Reservation::hold('Lena Berg', CarbonImmutable::parse('2027-07-10'), CarbonImmutable::parse('2027-07-13'));

    $mapper->save($reservation);
    $loaded = $mapper->find($reservation->id());
    $loaded->confirm();
    $mapper->save($loaded);

    expect($mapper->find($reservation->id())->status())->toBe('confirmed');
});`,
          },
        ],
      },
    },
    {
      id: 'interpreter',
      title: 'Interpreter: a small rule language for hosts',
      text: [
        'Hosts ask for automatic messages with conditions: “send the long-stay tips when **nights >= 7 and (channel == "airbnb" or channel == "booking_com")**”. Storing PHP for that is out of the question, and a form with a dropdown per condition can’t express the brackets. A tiny language can: a parser turns the text into a tree of expression objects, and each object knows how to evaluate itself.',
      ],
      sections: [
        {
          title: 'The code',
          blocks: [
            {
              title: 'Every node of a rule is an expression',
              path: 'examples/interpreter/Expression.php',
              code: String.raw`<?php

namespace Examples\Interpreter;

/** One node of a parsed rule. Every node can evaluate itself against the facts of one booking. */
interface Expression
{
    /** @param array<string, int|string|bool> $facts e.g. ['nights' => 7, 'channel' => 'airbnb'] */
    public function evaluate(array $facts): int|string|bool;
}`,
            },
            { path: 'examples/interpreter/Literal.php', code: String.raw`<?php

namespace Examples\Interpreter;

final readonly class Literal implements Expression
{
    public function __construct(private int|string $value)
    {
    }

    public function evaluate(array $facts): int|string
    {
        return $this->value;
    }
}` },
            { path: 'examples/interpreter/Fact.php', code: String.raw`<?php

namespace Examples\Interpreter;

use InvalidArgumentException;

final readonly class Fact implements Expression
{
    public function __construct(private string $name)
    {
    }

    public function evaluate(array $facts): int|string|bool
    {
        return $facts[$this->name] ?? throw new InvalidArgumentException("Unknown fact \"{$this->name}\".");
    }
}` },
            { path: 'examples/interpreter/Comparison.php', code: String.raw`<?php

namespace Examples\Interpreter;

final readonly class Comparison implements Expression
{
    public function __construct(private Expression $left, private string $operator, private Expression $right)
    {
    }

    public function evaluate(array $facts): bool
    {
        $left = $this->left->evaluate($facts);
        $right = $this->right->evaluate($facts);

        return match ($this->operator) {
            '==' => $left === $right,
            '!=' => $left !== $right,
            '>=' => $left >= $right,
            '<=' => $left <= $right,
            '>' => $left > $right,
            '<' => $left < $right,
        };
    }
}` },
            { path: 'examples/interpreter/AllOf.php', code: String.raw`<?php

namespace Examples\Interpreter;

final readonly class AllOf implements Expression
{
    public function __construct(private Expression $left, private Expression $right)
    {
    }

    public function evaluate(array $facts): bool
    {
        return $this->left->evaluate($facts) === true && $this->right->evaluate($facts) === true;
    }
}` },
            { path: 'examples/interpreter/AnyOf.php', code: String.raw`<?php

namespace Examples\Interpreter;

final readonly class AnyOf implements Expression
{
    public function __construct(private Expression $left, private Expression $right)
    {
    }

    public function evaluate(array $facts): bool
    {
        return $this->left->evaluate($facts) === true || $this->right->evaluate($facts) === true;
    }
}` },
            {
              title: 'The parser turns text into that tree',
              text: ['The grammar is in the docblock: four lines. A recursive-descent parser has one method per line, so `and` binds tighter than `or`, and brackets work, without any precedence table.'],
              path: 'examples/interpreter/RuleParser.php',
              code: String.raw`<?php

namespace Examples\Interpreter;

use InvalidArgumentException;

/**
 * rule       := all ( "or" all )*
 * all        := comparison ( "and" comparison )*
 * comparison := value ( ("==" | "!=" | ">=" | "<=" | ">" | "<") value )?  |  "(" rule ")"
 * value      := number | "quoted string" | fact name
 */
final class RuleParser
{
    /** @var list<string> */
    private array $tokens = [];

    private int $at = 0;

    public function parse(string $rule): Expression
    {
        preg_match_all('/\s*(\d+|"[^"]*"|[a-z_]+|==|!=|>=|<=|[<>()])/A', $rule, $matches);
        $this->tokens = $matches[1];
        $this->at = 0;

        if (implode('', array_map('trim', $matches[0])) !== preg_replace('/\s+/', '', $rule)) {
            throw new InvalidArgumentException("The rule has characters it can’t read: \"{$rule}\".");
        }

        $expression = $this->anyOf();

        if ($this->at < count($this->tokens)) {
            throw new InvalidArgumentException("Unexpected \"{$this->tokens[$this->at]}\" in \"{$rule}\".");
        }

        return $expression;
    }

    private function anyOf(): Expression
    {
        $left = $this->allOf();
        while ($this->take('or')) {
            $left = new AnyOf($left, $this->allOf());
        }

        return $left;
    }

    private function allOf(): Expression
    {
        $left = $this->comparison();
        while ($this->take('and')) {
            $left = new AllOf($left, $this->comparison());
        }

        return $left;
    }

    private function comparison(): Expression
    {
        if ($this->take('(')) {
            $inner = $this->anyOf();
            $this->expect(')');

            return $inner;
        }

        $left = $this->value();
        foreach (['==', '!=', '>=', '<=', '>', '<'] as $operator) {
            if ($this->take($operator)) {
                return new Comparison($left, $operator, $this->value());
            }
        }

        return $left;
    }

    private function value(): Expression
    {
        $token = $this->tokens[$this->at++] ?? throw new InvalidArgumentException('The rule ends too early.');

        return match (true) {
            ctype_digit($token) => new Literal((int) $token),
            str_starts_with($token, '"') => new Literal(substr($token, 1, -1)),
            in_array($token, ['and', 'or', '(', ')'], true) => throw new InvalidArgumentException("Expected a value, found \"{$token}\"."),
            default => new Fact($token),
        };
    }

    private function take(string $token): bool
    {
        if (($this->tokens[$this->at] ?? null) !== $token) {
            return false;
        }
        $this->at++;

        return true;
    }

    private function expect(string $token): void
    {
        if (! $this->take($token)) {
            throw new InvalidArgumentException("Expected \"{$token}\".");
        }
    }
}`,
              after: ['The rule is parsed **when the host saves it**, so a typo is a validation error on the form, never a failure at send time. The parsed tree can be cached; evaluating it per booking is a few method calls.'],
            },
          ],
        },
      ],
      reveal: {
        names: ['Interpreter'],
        rules: [['Interpreter', 'Represent each rule of a small language as a class, and a sentence of that language as a tree of those classes that can evaluate itself.']],
        points: [
          '**Where you’ll meet it:** Symfony ExpressionLanguage (security rules, routing conditions, workflow guards), template engines, spreadsheet formulas, search query syntaxes like `status:open author:me`, and the rule builders of marketing and pricing tools.',
          'In a real Laravel app, reach for `symfony/expression-language` before writing your own: it parses, caches and evaluates exactly this kind of rule. Build one yourself when the language must stay smaller than that, or must explain itself to users.',
        ],
        whenNot: [
          'For a handful of fixed options: a form with fields is clearer than a language.',
          'For a language that will keep growing: a tiny interpreter becomes a slow, buggy programming language. Use an existing one.',
        ],
      },
      tests: {
        summary: 'Brackets and precedence, unknown facts, and rules that can’t be parsed',
        blocks: [
          {
            path: 'tests/Unit/Examples/InterpreterTest.php',
            code: String.raw`<?php

use Examples\Interpreter\RuleParser;

it('evaluates a host’s rule for each booking', function (array $facts, bool $send) {
    $rule = (new RuleParser())->parse('nights >= 7 and (channel == "airbnb" or channel == "booking_com")');

    expect($rule->evaluate($facts))->toBe($send);
})->with([
    'a week from Airbnb' => [['nights' => 7, 'channel' => 'airbnb'], true],
    'a week, booked direct' => [['nights' => 7, 'channel' => 'direct'], false],
    'three nights from Airbnb' => [['nights' => 3, 'channel' => 'airbnb'], false],
]);

it('lets "and" bind tighter than "or", like every language the hosts know', function () {
    $rule = (new RuleParser())->parse('nights >= 7 and channel == "airbnb" or guests > 4');

    expect($rule->evaluate(['nights' => 2, 'channel' => 'direct', 'guests' => 6]))->toBeTrue();   // (… and …) or guests > 4
});

it('refuses a rule it can’t read, when the host saves it', function (string $rule) {
    expect(fn () => (new RuleParser())->parse($rule))->toThrow(InvalidArgumentException::class);
})->with(['nights >= ', 'nights => 7', 'nights >= 7 and', '(nights >= 7', 'nights >= 7 ;']);

it('names a fact the booking doesn’t have', function () {
    expect(fn () => (new RuleParser())->parse('pets == 1')->evaluate(['nights' => 2]))
        ->toThrow(InvalidArgumentException::class, 'Unknown fact "pets".');
});`,
          },
        ],
      },
    },
    {
      id: 'visitor',
      title: 'Visitor: new operations on the rule tree, without touching its nodes',
      text: [
        'The Interpreter above parses a host’s rule into a tree of five node classes. Hosts now need two more things done with that tree: **read the rule back in plain words** under the box they typed it in, and **list the facts it uses**, so a rule naming a fact that doesn’t exist (`pets`) is refused when it is saved, not when a message fails to send.',
        'Adding a `describe()` and a `facts()` method to all five node classes would work, and the next request would add a third to all five again. Visitor puts each operation in its own class instead. The nodes get one method, `accept()`, once; every new operation after that is a new class, and the nodes never change again.',
      ],
      sections: [
        {
          title: 'The visitor interface: one method per kind of node',
          blocks: [
            {
              path: 'examples/visitor/RuleVisitor.php',
              code: String.raw`<?php

namespace Examples\Visitor;

use Examples\Interpreter\AllOf;
use Examples\Interpreter\AnyOf;
use Examples\Interpreter\Comparison;
use Examples\Interpreter\Fact;
use Examples\Interpreter\Literal;

/**
 * One operation over a rule tree: one method per kind of node.
 *
 * @template T what the operation produces
 */
interface RuleVisitor
{
    /** @return T */
    public function visitLiteral(Literal $node): mixed;

    /** @return T */
    public function visitFact(Fact $node): mixed;

    /** @return T */
    public function visitComparison(Comparison $node): mixed;

    /** @return T */
    public function visitAllOf(AllOf $node): mixed;

    /** @return T */
    public function visitAnyOf(AnyOf $node): mixed;
}`,
              after: ['`@template T` says what an operation produces: a `string` for the description, a list of names for the facts. PHPStan (scene 47) checks that each visitor returns what it promises.'],
            },
          ],
        },
        {
          title: 'The nodes accept a visitor: double dispatch',
          text: [
            'Each node gets the same small method. It calls back the visitor method **for its own class**: a `Comparison` calls `visitComparison($this)`. That is the trick of the pattern, called **double dispatch**: which code runs depends on two things, the visitor (which operation) and the node (which kind), without a single `instanceof` in the visitors.',
            'These are the node classes from the Interpreter part, with `accept()` added and their properties made public so visitors can read them:',
          ],
          blocks: [
            {
              path: 'examples/interpreter/Expression.php',
              code: String.raw`<?php

namespace Examples\Interpreter;

use Examples\Visitor\RuleVisitor;

/** One node of a parsed rule. Every node can evaluate itself against the facts of one booking. */
interface Expression
{
    /** @param array<string, int|string|bool> $facts e.g. ['nights' => 7, 'channel' => 'airbnb'] */
    public function evaluate(array $facts): int|string|bool;

    /**
     * Hand this node to a visitor, which runs its own method for this kind of node.
     *
     * @template T
     * @param RuleVisitor<T> $visitor
     * @return T
     */
    public function accept(RuleVisitor $visitor): mixed;
}`,
            },
            { path: 'examples/interpreter/Literal.php', code: String.raw`<?php

namespace Examples\Interpreter;

use Examples\Visitor\RuleVisitor;

final readonly class Literal implements Expression
{
    public function __construct(public int|string $value)
    {
    }

    public function evaluate(array $facts): int|string
    {
        return $this->value;
    }

    public function accept(RuleVisitor $visitor): mixed
    {
        return $visitor->visitLiteral($this);                         // the node picks the method: "I am a Literal"
    }
}` },
            { path: 'examples/interpreter/Fact.php', code: String.raw`<?php

namespace Examples\Interpreter;

use Examples\Visitor\RuleVisitor;
use InvalidArgumentException;

final readonly class Fact implements Expression
{
    public function __construct(public string $name)
    {
    }

    public function evaluate(array $facts): int|string|bool
    {
        return $facts[$this->name] ?? throw new InvalidArgumentException("Unknown fact \"{$this->name}\".");
    }

    public function accept(RuleVisitor $visitor): mixed
    {
        return $visitor->visitFact($this);
    }
}` },
            { path: 'examples/interpreter/Comparison.php', code: String.raw`<?php

namespace Examples\Interpreter;

use Examples\Visitor\RuleVisitor;

final readonly class Comparison implements Expression
{
    public function __construct(public Expression $left, public string $operator, public Expression $right)
    {
    }

    public function evaluate(array $facts): bool
    {
        $left = $this->left->evaluate($facts);
        $right = $this->right->evaluate($facts);

        return match ($this->operator) {
            '==' => $left === $right,
            '!=' => $left !== $right,
            '>=' => $left >= $right,
            '<=' => $left <= $right,
            '>' => $left > $right,
            '<' => $left < $right,
        };
    }

    public function accept(RuleVisitor $visitor): mixed
    {
        return $visitor->visitComparison($this);
    }
}` },
            { path: 'examples/interpreter/AllOf.php', code: String.raw`<?php

namespace Examples\Interpreter;

use Examples\Visitor\RuleVisitor;

final readonly class AllOf implements Expression
{
    public function __construct(public Expression $left, public Expression $right)
    {
    }

    public function evaluate(array $facts): bool
    {
        return $this->left->evaluate($facts) === true && $this->right->evaluate($facts) === true;
    }

    public function accept(RuleVisitor $visitor): mixed
    {
        return $visitor->visitAllOf($this);
    }
}` },
            { path: 'examples/interpreter/AnyOf.php', code: String.raw`<?php

namespace Examples\Interpreter;

use Examples\Visitor\RuleVisitor;

final readonly class AnyOf implements Expression
{
    public function __construct(public Expression $left, public Expression $right)
    {
    }

    public function evaluate(array $facts): bool
    {
        return $this->left->evaluate($facts) === true || $this->right->evaluate($facts) === true;
    }

    public function accept(RuleVisitor $visitor): mixed
    {
        return $visitor->visitAnyOf($this);
    }
}` },
          ],
        },
        {
          title: 'Two operations, two classes',
          blocks: [
            {
              title: 'The rule in plain words',
              path: 'examples/visitor/DescribeRule.php',
              code: String.raw`<?php

namespace Examples\Visitor;

use Examples\Interpreter\AllOf;
use Examples\Interpreter\AnyOf;
use Examples\Interpreter\Comparison;
use Examples\Interpreter\Expression;
use Examples\Interpreter\Fact;
use Examples\Interpreter\Literal;

/**
 * The rule in plain words, shown to the host under the rule they typed.
 *
 * @implements RuleVisitor<string>
 */
final class DescribeRule implements RuleVisitor
{
    private const WORDS = ['==' => 'is', '!=' => 'is not', '>=' => 'is at least', '<=' => 'is at most', '>' => 'is more than', '<' => 'is less than'];

    public function describe(Expression $rule): string
    {
        return ucfirst($rule->accept($this));
    }

    public function visitLiteral(Literal $node): string
    {
        return is_int($node->value) ? (string) $node->value : "“{$node->value}”";
    }

    public function visitFact(Fact $node): string
    {
        return str_replace('_', ' ', $node->name);                     // lead_days → lead days
    }

    public function visitComparison(Comparison $node): string
    {
        return $node->left->accept($this) . ' ' . self::WORDS[$node->operator] . ' ' . $node->right->accept($this);
    }

    public function visitAllOf(AllOf $node): string
    {
        return $this->part($node->left, AnyOf::class) . ' and ' . $this->part($node->right, AnyOf::class);
    }

    public function visitAnyOf(AnyOf $node): string
    {
        return $this->part($node->left, AllOf::class) . ' or ' . $this->part($node->right, AllOf::class);
    }

    /** A child of the other kind (an "or" inside an "and", or the reverse) gets brackets, so the words can't be misread. */
    private function part(Expression $child, string $bracketed): string
    {
        $words = $child->accept($this);

        return $child instanceof $bracketed ? "({$words})" : $words;
    }
}`,
              after: ['`nights >= 7 and (channel == "airbnb" or channel == "booking_com")` reads back as **“Nights is at least 7 and (channel is “airbnb” or channel is “booking_com”)”**. A host who meant something else sees it before saving.'],
            },
            {
              title: 'The facts a rule uses',
              path: 'examples/visitor/FactsInRule.php',
              code: String.raw`<?php

namespace Examples\Visitor;

use Examples\Interpreter\AllOf;
use Examples\Interpreter\AnyOf;
use Examples\Interpreter\Comparison;
use Examples\Interpreter\Expression;
use Examples\Interpreter\Fact;
use Examples\Interpreter\Literal;

/**
 * Every fact a rule reads, so a rule naming an unknown fact is refused when the host saves it.
 *
 * @implements RuleVisitor<list<string>>
 */
final class FactsInRule implements RuleVisitor
{
    /** @return list<string> each fact once, sorted */
    public function of(Expression $rule): array
    {
        $facts = array_unique($rule->accept($this));
        sort($facts);

        return $facts;
    }

    public function visitLiteral(Literal $node): array
    {
        return [];
    }

    public function visitFact(Fact $node): array
    {
        return [$node->name];
    }

    public function visitComparison(Comparison $node): array
    {
        return [...$node->left->accept($this), ...$node->right->accept($this)];
    }

    public function visitAllOf(AllOf $node): array
    {
        return [...$node->left->accept($this), ...$node->right->accept($this)];
    }

    public function visitAnyOf(AnyOf $node): array
    {
        return [...$node->left->accept($this), ...$node->right->accept($this)];
    }
}`,
              after: ['On save: `array_diff((new FactsInRule())->of($rule), [\'nights\', \'channel\', \'guests\', \'lead_days\'])` lists the unknown facts, and the form shows them as a validation error.'],
            },
          ],
        },
      ],
      reveal: {
        names: ['Visitor'],
        rules: [['Visitor', 'Put each operation on a structure of objects in its own class. The objects only accept a visitor and call its method for their own type, so new operations never change the objects.']],
        points: [
          '**Interpreter and Visitor, side by side.** The Interpreter put the operation (`evaluate()`) **in** the nodes. The Visitor puts operations **outside** them. Nodes rarely change and operations keep coming? Visitor. A new kind of node every month? Methods on the nodes.',
          '**Where you’ll meet it:** every PHP code tool. `nikic/php-parser`, which PHPStan, Rector and Pest’s arch tests are built on, walks PHP’s syntax tree with visitors; Twig compiles templates with node visitors; Doctrine turns DQL into SQL by walking a tree. A custom PHPStan or Rector rule is a visitor you write for them.',
        ],
        whenNot: [
          'When the node types change often: every new node class means a new method in the interface and in every visitor.',
          'For one operation, or a flat list: a method on the class, or a loop with a `match`, is simpler.',
        ],
      },
      tests: {
        summary: 'Both visitors on the same tree, and a rule refused for an unknown fact',
        blocks: [
          {
            path: 'tests/Unit/Examples/VisitorTest.php',
            code: String.raw`<?php

use Examples\Interpreter\RuleParser;
use Examples\Visitor\DescribeRule;
use Examples\Visitor\FactsInRule;

it('reads a rule back in plain words, with brackets where "and" and "or" mix', function (string $rule, string $words) {
    expect((new DescribeRule())->describe((new RuleParser())->parse($rule)))->toBe($words);
})->with([
    ['nights >= 7 and (channel == "airbnb" or channel == "booking_com")', 'Nights is at least 7 and (channel is “airbnb” or channel is “booking_com”)'],
    ['nights >= 7 and channel == "airbnb" or guests > 4', '(nights is at least 7 and channel is “airbnb”) or guests is more than 4'],
]);

it('lists every fact a rule uses, once', function () {
    $rule = (new RuleParser())->parse('nights >= 7 and (channel == "airbnb" or channel == "booking_com")');

    expect((new FactsInRule())->of($rule))->toBe(['channel', 'nights']);
});

it('finds the fact that would make a saved rule fail at send time', function () {
    $rule = (new RuleParser())->parse('nights >= 3 and pets == 1');

    expect(array_values(array_diff((new FactsInRule())->of($rule), ['nights', 'channel', 'guests', 'lead_days'])))->toBe(['pets']);
});`,
            after: ['The same tree, parsed once, goes through three operations: `evaluate()` from the Interpreter, and the two visitors. None of the node classes knows what a description or a fact list is.'],
          },
        ],
      },
    },
    {
      id: 'flyweight',
      title: 'Flyweight: 300,000 amenities that are really fifteen',
      text: [
        'Every property lists its amenities: sauna, Wi-Fi, sea view, fifteen kinds in all, each with a code, a label, an icon and a category. A search result page of 20,000 properties that builds a new object for every amenity of every property holds **300,000** objects that are copies of **fifteen**.',
        'A flyweight is an object that is immutable and shared: instead of creating a copy, every user gets the same instance. In PHP, enum cases are exactly that, built into the language.',
      ],
      sections: [
        {
          title: 'The code',
          blocks: [
            {
              title: 'The shared objects: one per amenity, for the whole process',
              path: 'examples/flyweight/Amenity.php',
              code: String.raw`<?php

namespace Examples\Flyweight;

enum Amenity: string
{
    case Sauna = 'sauna';
    case Wifi = 'wifi';
    case SeaView = 'sea_view';
    case Parking = 'parking';
    case PetsAllowed = 'pets';
    case Fireplace = 'fireplace';
    case HotTub = 'hot_tub';
    case EvCharger = 'ev_charger';
    case Kitchen = 'kitchen';
    case Washer = 'washer';
    case Barbecue = 'bbq';
    case AirConditioning = 'air_conditioning';
    case Crib = 'crib';
    case Bikes = 'bikes';
    case Garden = 'garden';

    public function label(): string
    {
        return match ($this) {
            self::Wifi => 'Wi-Fi',
            self::SeaView => 'Sea view',
            self::HotTub => 'Hot tub',
            self::EvCharger => 'EV charger',
            self::PetsAllowed => 'Pets allowed',
            self::Barbecue => 'Barbecue',
            self::AirConditioning => 'Air conditioning',
            default => ucfirst($this->value),                          // Sauna, Parking, Kitchen …
        };
    }

    public function icon(): string
    {
        return "icon-{$this->value}";
    }
}`,
            },
            {
              title: 'What a property holds: references to the shared ones',
              path: 'examples/flyweight/PropertyAmenities.php',
              code: String.raw`<?php

namespace Examples\Flyweight;

final readonly class PropertyAmenities
{
    /** @param list<Amenity> $amenities */
    private function __construct(public array $amenities)
    {
    }

    /** @param list<string> $codes as stored, e.g. ["sauna", "wifi"] */
    public static function fromCodes(array $codes): self
    {
        return new self(array_map(fn (string $code): Amenity => Amenity::from($code), $codes));   // no new object: the shared case
    }

    public function has(Amenity $amenity): bool
    {
        return in_array($amenity, $this->amenities, true);              // identity: the same instance
    }
}`,
            },
            {
              title: 'Measured, not guessed',
              table: [
                ['20,000 properties × 15 amenities', 'Memory (PHP 8.3)'],
                ['A new object per amenity per property', '66.8 MB'],
                ['The shared enum cases', '7.7 MB, almost all of it the arrays themselves'],
              ],
              after: [
                'The shared version stores 300,000 references to fifteen objects. It is also faster: no object to build, and `===` compares an address.',
                'A flyweight must be **immutable**: if one property could change “Sauna”’s label, every property would see it. Enums can’t be changed at all, which is what makes them safe to share.',
              ],
            },
          ],
        },
      ],
      reveal: {
        names: ['Flyweight'],
        rules: [['Flyweight', 'Share immutable objects that many users need, instead of giving each user its own copy. What differs per user is kept outside, by the user.']],
        points: [
          '**Where you’ll meet it:** PHP enums and interned strings, the glyphs of a text editor, tiles and sprites in games, the shared style objects of a spreadsheet, a font cache.',
          'In this story the enums were flyweights all along: every `BookingStatus::Confirmed` in every booking is the same object, and scene 43’s `App\\Enums\\Amenity` is exactly this enum, cast onto every property with `AsEnumCollection`. Here it is built outside Laravel, so the sharing can be measured.',
        ],
        whenNot: [
          'When the objects aren’t really the same: sharing objects that differ slightly needs the differences stored elsewhere, which costs more than it saves.',
          'For a few hundred objects: PHP’s per-request memory makes the savings invisible, and a plain object is clearer.',
        ],
      },
      tests: {
        summary: 'One shared instance per amenity, whatever the number of properties',
        blocks: [
          {
            path: 'tests/Unit/Examples/FlyweightTest.php',
            code: String.raw`<?php

use Examples\Flyweight\Amenity;
use Examples\Flyweight\PropertyAmenities;

it('shares one instance per amenity across every property', function () {
    $cottage = PropertyAmenities::fromCodes(['sauna', 'wifi']);
    $loft = PropertyAmenities::fromCodes(['wifi', 'sea_view']);

    expect($cottage->amenities[1])->toBe($loft->amenities[0])              // the very same object
        ->and($loft->has(Amenity::SeaView))->toBeTrue()
        ->and($cottage->has(Amenity::SeaView))->toBeFalse();
});

it('refuses an amenity that doesn’t exist, instead of creating one', function () {
    expect(fn () => PropertyAmenities::fromCodes(['helipad']))->toThrow(ValueError::class);
});`,
          },
        ],
      },
    },
  ],
  next: 'That is every pattern in the course: the ones the story needed, written where a real team would write them, and these five, built where they belong.',
};

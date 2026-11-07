// Scene 47 · How it fits together: one booking end to end, where code goes, the container, and the checks before every push.

export default {
  description: 'A developer joins and asks three questions: what happens between Book and the guest’s email, where new code goes, and what must pass before a push. Answer them with the app built in this course: the path of one booking through every layer, the rules for where code lives, how Laravel’s container builds it, and the checks (Pint, Larastan, architecture tests, mutation testing, Rector) that keep it that way.',
  incident: {
    channel: '#dev',
    when: 'Monday 10:00',
    messages: [
      ['Amira · developer, first week', 'I’ve read the code for two days. Three questions. **What happens** between a host pressing Book and the guest getting an email? **Where do I put** new code? And **what has to pass** before I push?'],
      ['Sara · tech lead', 'Good questions, in a good order. Let’s go through one booking, then the rules, then the checks. The checks already found something this morning, so you’ll see one fixed.'],
    ],
  },
  sections: [
    {
      title: 'One booking, from the button to the guest’s email',
      text: ['Every layer of the app is on this path once. The scene that built each step is in the last column.'],
      blocks: [
        {
          table: [
            ['#', 'Step', 'Where', 'Scene'],
            ['1', '`POST /api/v1/properties/412/bookings` with an `Idempotency-Key`', 'the mobile app', '35'],
            ['2', 'Middleware, in order: `auth:sanctum` (who), `SetCurrentAccount` (which account), `Idempotent` (a retry?)', '`routes/api.php`', '19, 35'],
            ['3', 'Route model binding loads property 412; `->can(\'createBooking\', \'property\')` asks the policy', '`PropertyPolicy`', '3, 20'],
            ['4', 'The Form Request validates the input, including the minimum stay', '`StoreBookingRequest`', '3, 25, 29'],
            ['5', 'The controller hands over to one action and returns a resource', '`BookingController::store`', '3'],
            ['6', 'The action: transaction, lock the property, the availability rule, the price, save the hold and its lines', '`CreateBooking`', '4, 7, 30'],
            ['7', 'The coordinator: overbookings, the cleaning, a push per channel, the open calendars, the partner’s outbox row', '`CalendarSync`', '18, 26, 31, 34'],
            ['8', 'Commit. Only now do the queued pushes, broadcasts and notifications leave', '`afterCommit()`', '9, 17'],
            ['9', 'The guest pays; Stripe’s webhook is stored, answered 200, processed in a job', '`ProcessStripeWebhook`', '8'],
            ['10', 'The state confirms the hold; the guest’s messages are scheduled at local times', '`BookingConfirmation`, `ConfirmedState`', '6, 9, 21'],
            ['11', 'Horizon’s workers send the confirmation by the guest’s channel, once', '`SendScheduledMessage`, `GuestMessage`', '22, 25'],
          ],
          after: ['Read it from step 5 down and the pattern of the whole app is visible: HTTP concerns end at the controller; a use case lives in one action; everything that must follow a calendar change goes through one coordinator; anything slow or external waits for the commit and runs in a queue.'],
        },
      ],
    },
    {
      title: 'Where code goes',
      text: ['The folders are by **domain**, not by kind: a new feature about pricing goes next to the rest of pricing.'],
      blocks: [
        {
          path: 'app/',
          lang: 'tree',
          code: String.raw`app/
├── Accounts/         InviteMember, AcceptInvitation, RemoveMember
├── Bookings/         CreateBooking, ChangeBookingDates, MoveBooking, CancelBooking, Stay (value), States/, Refunds/
├── Channels/         CalendarSync (the coordinator), ChannelManager, Airbnb/, BookingCom/, Ical/
├── Exports/          AccountExport and its three exports
├── Messaging/        send times, scheduling, templates and their variables
├── Money/            Money, Currency (values)
├── Operations/       PlanTurnover
├── Payments/         the gateway, Stripe, events, reconciliation
├── Pricing/          PriceQuoter, QuoteBuilder, NightlyRates, the caching proxy
├── Properties/       DuplicateProperty, search and its two repositories
├── Http/             Controllers, Requests, Resources, Middleware: HTTP only
├── Jobs/ Events/ Listeners/ Notifications/ Observers/ Policies/ Console/ Models/ Providers/
`,
        },
        {
          table: [
            ['Kind of code', 'Goes in', 'Rule'],
            ['Who may do it', 'a Policy', 'never an `if` in a controller'],
            ['Is the input valid', 'a Form Request', 'shape and simple rules; business rules ask the model (`stayTooShort()`)'],
            ['One thing a user or a system does', 'an action, in its domain folder', 'one public method; owns its transaction and its locks'],
            ['What a value is', 'a value object (`Money`, `Stay`)', 'immutable, validated when created'],
            ['Relations, casts, query rules', 'the model', 'scopes for rules that are queries (`availableFor()`)'],
            ['What must follow a calendar change, in order', '`CalendarSync`, called directly', 'a direct call when the steps must all happen and their order matters'],
            ['Reactions that don’t depend on each other', 'an event and its listeners', 'scene 22’s `BookingCancelled`: each listener can fail alone'],
            ['Anything slow or external', 'a queued job, after commit', 'with tries, backoff, a timeout and `failed()`'],
          ],
          after: [
            '**Actions, services, repositories.** An action is one use case (`CreateBooking`). A "service" that collects ten unrelated methods (`BookingService`) is where code goes to be forgotten; this app has none. A repository appears once, where two stores really answer the same question (scene 43).',
          ],
        },
      ],
    },
    {
      title: 'Laravel inside: how the container builds an action',
      text: [
        'No action in this app is built with `new`. The controller asks for `CreateBooking`; the container reads its constructor, sees `PriceQuoter` and `CalendarSync`, builds those the same way, and so on down: `PriceQuoter` needs `NightlyPrices`, an interface, which `AppServiceProvider` binds to `NightlyRates` (scene 35). That recursion is the whole trick:',
      ],
      blocks: [
        {
          path: 'Illuminate/Container/Container.php (simplified)',
          fragment: true,
          code: String.raw`public function build($concrete)
{
    $reflector = new ReflectionClass($concrete);
    $constructor = $reflector->getConstructor();

    if ($constructor === null) {
        return new $concrete;                                     // no dependencies: done
    }

    $dependencies = array_map(
        fn (ReflectionParameter $parameter) => $this->make($parameter->getType()->getName()),   // each type, built the same way
        $constructor->getParameters(),
    );

    return $reflector->newInstanceArgs($dependencies);
}`,
          after: [
            '`make()` checks the bindings first: a `singleton()` returns the one instance (scene 5), a contextual binding gives `QuoteController` the cached rates (scene 35), an interface without a binding is an error at once. Everything else is built by reading its constructor.',
            'That is why every class here takes its dependencies in the constructor and none of them calls `app()` inside a method: the dependencies are visible, and a test can pass different ones.',
          ],
        },
      ],
    },
    {
      title: 'What must pass before a push',
      text: ['Five checks, all run by CI on every push (scene 45), and all runnable on a laptop in under a minute.'],
      blocks: [
        {
          title: '1. Pint: one code style, never discussed in review',
          path: 'pint.json',
          lang: 'json',
          code: String.raw`{
    "preset": "laravel",
    "rules": {
        "concat_space": { "spacing": "one" }
    }
}`,
          after: ['`vendor/bin/pint` fixes the style; `vendor/bin/pint --test` only checks it, which is what CI runs.'],
        },
        {
          title: '2. Larastan: types checked without running the code',
          path: 'phpstan.neon',
          lang: 'yaml',
          code: String.raw`includes:
    - vendor/larastan/larastan/extension.neon
    - phpstan-baseline.neon

parameters:
    paths:
        - app
    level: 8`,
          after: [
            'Larastan teaches PHPStan Laravel’s magic: relations, scopes, facades. Level 8 includes null safety: `$property->ratePlan->name` is an error, because the plan can be null; `$property->ratePlan?->name` is fine.',
            'A codebase that never ran it finds hundreds of errors on the first run. `vendor/bin/phpstan --generate-baseline` records today’s errors in `phpstan-baseline.neon`, so CI fails only on **new** ones, and the baseline shrinks as code is touched.',
          ],
        },
        {
          title: '3. Architecture tests: the rules above, as tests',
          path: 'tests/ArchTest.php',
          code: String.raw`<?php

use Illuminate\Database\Eloquent\Model;
use Symfony\Component\Finder\Finder;

arch('debugging calls never reach production')
    ->expect(['dd', 'dump', 'var_dump', 'ray'])
    ->not->toBeUsed();

arch('env() is read in config files only')                           // under config:cache, env() returns null (scene 46)
    ->expect('env')
    ->not->toBeUsed();

arch('controllers only speak HTTP: no queries, no transactions')
    ->expect('App\Http\Controllers')
    ->not->toUse('Illuminate\Support\Facades\DB');

arch('models are Eloquent models')
    ->expect('App\Models')
    ->toExtend(Model::class);

it('keeps no static state in app classes, which long-running workers would keep forever', function () {
    $offenders = [];

    foreach (Finder::create()->files()->in(app_path())->name('*.php') as $file) {
        $class = 'App\\' . str_replace(['/', '.php'], ['\\', ''], $file->getRelativePathname());
        if (! class_exists($class) && ! trait_exists($class)) {
            continue;                                                // interfaces and enums have no properties
        }

        foreach ((new ReflectionClass($class))->getProperties(ReflectionProperty::IS_STATIC) as $property) {
            if ($property->getDeclaringClass()->getName() === $class) {
                $offenders[] = "{$class}::\${$property->getName()}";
            }
        }
    }

    expect($offenders)->toBe([]);                                    // scene 46's postmortem, action 4
});`,
          after: ['The first run this morning failed once: `AcceptInvitationController` from scene 20 uses `DB::transaction()`. It is fixed below.'],
        },
        {
          title: 'What the architecture test found',
          text: ['Scene 20 put the acceptance in the controller, with its transaction, and checked `accepted_at` **before** the transaction: two clicks on the link at once both passed the check. As an action it locks the invitation first, so the second click finds it already used:'],
          path: 'app/Accounts/AcceptInvitation.php',
          code: String.raw`<?php

namespace App\Accounts;

use App\Models\AccountInvitation;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Symfony\Component\HttpKernel\Exception\HttpException;

final class AcceptInvitation
{
    public function handle(AccountInvitation $invitation, User $user): void
    {
        DB::transaction(function () use ($invitation, $user): void {
            $invitation = AccountInvitation::whereKey($invitation->id)->lockForUpdate()->firstOrFail();   // two clicks: one waits here

            if ($invitation->accepted_at !== null) {
                throw new HttpException(410, 'This invitation was already used.');
            }

            if (mb_strtolower($user->email) !== $invitation->email) {
                throw new HttpException(403, 'This invitation is for another email address.');
            }

            $invitation->account->users()->syncWithoutDetaching([$user->id => ['role' => $invitation->role->value]]);
            $invitation->forceFill(['accepted_at' => now()])->save();
            $user->forceFill(['current_account_id' => $invitation->account_id])->save();
        });
    }
}`,
        },
        {
          path: 'app/Http/Controllers/AcceptInvitationController.php',
          code: String.raw`<?php

namespace App\Http\Controllers;

use App\Accounts\AcceptInvitation;
use App\Models\AccountInvitation;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;

class AcceptInvitationController extends Controller
{
    public function __invoke(Request $request, AccountInvitation $invitation, AcceptInvitation $accept): RedirectResponse
    {
        $accept->handle($invitation, $request->user());                 // 410 or 403 from the action, as before

        return redirect('/dashboard');
    }
}`,
        },
        {
          title: '4. Mutation testing: do the tests notice when the code is wrong?',
          text: ['Coverage says a line ran during the tests; it doesn’t say a test would fail if the line were wrong. `pest --mutate` changes the code in small ways (`<` to `<=`, `-$x` to `$x`, a removed line) and runs the tests against each change. A change no test notices is a gap. One line in a test file says which class it covers:'],
          path: 'tests/Unit/MoneyTest.php',
          code: String.raw`<?php

use App\Money\Money;

mutates(Money::class);                                                      // pest --mutate changes this class, and only it

it('multiplies exactly, with no lost cent', function () {
    expect(Money::of(15_010, 'EUR')->times(3)->amount)->toBe(45_030);   // the incident
});

it('never changes the original', function () {
    $nightly = Money::of(15_010, 'EUR');

    $nightly->times(3);

    expect($nightly->amount)->toBe(15_010);
});

it('refuses to mix currencies', function () {
    Money::of(100, 'EUR')->add(Money::of(100, 'EGP'));
})->throws(LogicException::class, "Can't combine EUR with EGP.");

it('compares by value', function () {
    expect(Money::of(45_030, 'EUR')->equals(Money::of(45_030, 'EUR')))->toBeTrue()
        ->and(Money::of(45_030, 'EUR')->equals(Money::of(45_030, 'USD')))->toBeFalse();
});

it('formats with the currency’s own decimals', function (int $amount, string $currency, string $shown) {
    expect(Money::of($amount, $currency)->format())->toBe($shown);
})->with([
    [45_030, 'EUR', '€450.30'],
    [15_010, 'JPY', '¥15,010'],
]);

it('rounds a negative percentage away from zero, so a discount stays negative', function () {
    expect(Money::of(-101, 'EUR')->percent(5_000)->amount)->toBe(-51);          // -50.5 cents: the mutant made it +51
});`,
        },
        {
          path: 'terminal',
          lang: 'shell',
          code: String.raw`$ vendor/bin/pest tests/Unit/MoneyTest.php --mutate

  UNTESTED  app/Money/Money.php > Line 44: UnaryMinusToNegated
  - return new self($product < 0 ? -$rounded : $rounded, $this->currency);
  + return new self($product < 0 ? $rounded : $rounded, $this->currency);

  Mutations: 1 untested, 23 tested`,
          after: ['No test multiplied a **negative** amount by a percentage, so a discount (scene 7) could have turned positive without a single failure. The last test in the file above was written for it, and the next run reports 24 of 24.'],
        },
        {
          title: '5. Rector: changes across the whole codebase, done by a tool',
          path: 'rector.php',
          code: String.raw`<?php

use Rector\Config\RectorConfig;

return RectorConfig::configure()
    ->withPaths([__DIR__ . '/app', __DIR__ . '/tests'])
    ->withPhpSets()                                            // the PHP version in composer.json: readonly, match, first-class callables …
    ->withPreparedSets(deadCode: true, typeDeclarations: true);`,
          after: [
            '`vendor/bin/rector --dry-run` shows the changes; without `--dry-run` it makes them, and the tests decide whether they stay. For **Laravel upgrades**, `driftingly/rector-laravel` adds the rename sets for each major version. A major upgrade is then: read the upgrade guide, raise the version in `composer.json`, run Rector’s set for that version, run the tests, deploy to staging, one major version at a time.',
          ],
        },
        {
          title: 'CI runs all five',
          path: '.github/workflows/ci.yml',
          lang: 'yaml',
          code: String.raw`name: CI
on: [push, pull_request]

jobs:
  tests:
    runs-on: ubuntu-24.04
    services:
      mysql:
        image: mysql:8.4
        env: { MYSQL_ROOT_PASSWORD: secret, MYSQL_DATABASE: pms_test }
        ports: ['3306:3306']
        options: --health-cmd="mysqladmin ping -psecret" --health-interval=5s
      redis:
        image: redis:7.4
        ports: ['6379:6379']
      meilisearch:
        image: getmeili/meilisearch:v1.11
        env: { MEILI_MASTER_KEY: ci-key }
        ports: ['7700:7700']
    env:
      DB_HOST: 127.0.0.1
      DB_PASSWORD: secret
      REDIS_HOST: 127.0.0.1
      MEILISEARCH_HOST: http://127.0.0.1:7700
      MEILISEARCH_KEY: ci-key
    steps:
      - uses: actions/checkout@v4
      - uses: shivammathur/setup-php@v2
        with: { php-version: '8.4', extensions: 'pdo_mysql, redis, pcntl', coverage: none }
      - run: composer install --no-interaction --prefer-dist
      - run: cp .env.example .env && php artisan key:generate
      - run: vendor/bin/pint --test                     # style
      - run: vendor/bin/phpstan analyse --no-progress   # types, against the baseline
      - run: vendor/bin/rector --dry-run                # fails if Rector would still change something
      - run: vendor/bin/pest --parallel                 # tests, architecture tests included
      - run: vendor/bin/pest --mutate --parallel --min=90   # at least 90% of mutations caught`,
        },
      ],
    },
  ],
  next: 'Amira ships her first change on Wednesday. Next: the interview, where all of this has to be explained out loud, on a whiteboard.',
};

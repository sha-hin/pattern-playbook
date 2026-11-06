// Foundation, part 5: Pest configuration, the helpers every lesson's tests use, and the foundation's own tests.

export const testing = {
  id: 'testing',
  title: 'Test setup',
  text: [
    'Every lesson ends with Pest tests that assume this setup: a MySQL test database refreshed per test, **time frozen** at a known moment, **no real HTTP**, and two helpers for the question almost every test asks first: "who is acting, with which role?"',
  ],
  numbered: false,
  blocks: [
    {
      id: 'phpunit',
      title: 'The test environment',
      text: ['Tests run on MySQL, not SQLite: SQLite ignores `lockForUpdate()` and has no gap locks, so concurrency bugs would pass. `sync` runs queued jobs inline unless a test fakes the queue.'],
      path: 'phpunit.xml (php section)',
      lang: 'text',
      code: String.raw`<php>
    <env name="APP_ENV" value="testing"/>
    <env name="DB_CONNECTION" value="mysql"/>
    <env name="DB_DATABASE" value="pms_test"/>
    <env name="QUEUE_CONNECTION" value="sync"/>
    <env name="CACHE_STORE" value="array"/>
    <env name="SESSION_DRIVER" value="array"/>
    <env name="MAIL_MAILER" value="array"/>
    <env name="BCRYPT_ROUNDS" value="4"/>
    <env name="STRIPE_SECRET" value="sk_test_fake"/>
    <env name="STRIPE_WEBHOOK_SECRET" value="whsec_test"/>
</php>`,
    },
    {
      id: 'pest-config',
      title: 'Pest configuration',
      text: [
        'The clock is frozen at **1 June 2027, 10:00 UTC** before every test, so factory defaults ("four weeks from now") and rules like `after_or_equal:today` give the same answer on every run. A test that needs another moment (a DST night, an expired hold) calls `$this->travelTo()` itself.',
        '`Http::preventStrayRequests()` makes any HTTP call without a matching `Http::fake()` throw, so a test can never reach Stripe or Airbnb by accident.',
      ],
      path: 'tests/Pest.php',
      code: String.raw`<?php

use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;

pest()->extend(Tests\TestCase::class)
    ->use(RefreshDatabase::class)
    ->beforeEach(function (): void {
        $this->travelTo(CarbonImmutable::parse('2027-06-01 10:00:00', 'UTC'));
        Http::preventStrayRequests();
    })
    ->in('Feature', 'Unit');

require __DIR__ . '/helpers.php';`,
    },
    {
      id: 'test-helpers',
      title: 'Test helpers',
      text: ['`memberOf()` creates a user with a role in an account; `hostOf()` does the same for the account that owns a property. `fixture()` loads a recorded API payload, so channel and Stripe tests use real response shapes, not invented ones.'],
      path: 'tests/helpers.php',
      code: String.raw`<?php

use App\Enums\MembershipRole;
use App\Models\Account;
use App\Models\Property;
use App\Models\User;

function memberOf(Account $account, MembershipRole $role = MembershipRole::Owner): User
{
    $user = User::factory()->create(['current_account_id' => $account->id]);
    $account->users()->attach($user, ['role' => $role->value]);

    return $user;
}

function hostOf(Property $property, MembershipRole $role = MembershipRole::Owner): User
{
    return memberOf($property->account, $role);
}

/** @return array<string, mixed> a recorded payload from tests/Fixtures, e.g. fixture('airbnb/reservation.json') */
function fixture(string $path): array
{
    return json_decode(file_get_contents(__DIR__ . "/Fixtures/{$path}"), true, flags: JSON_THROW_ON_ERROR);
}`,
    },
  ],
};

export const foundationTests = {
  summary: 'Tests for the foundation: every factory, the states and the helpers',
  text: [
    'The schema itself isn’t tested (that would test MySQL). What is tested is our code: every factory produces a row the database and strict mode accept, the states mean what the lessons assume, and the helpers attach the right role.',
  ],
  blocks: [
    {
      title: 'Every factory creates a valid row',
      text: ['One dataset over every model. A factory that misses a NOT NULL column, or sets a key strict mode rejects, fails here before any lesson depends on it.'],
      path: 'tests/Feature/FactoriesTest.php',
      code: String.raw`<?php

use App\Models;

it('creates a valid row', function (string $model) {
    $record = $model::factory()->create();

    expect($record->exists)->toBeTrue();
})->with([
    Models\User::class, Models\Account::class, Models\AccountInvitation::class,
    Models\Property::class, Models\CalendarDay::class, Models\RateRule::class, Models\ChecklistTemplate::class,
    Models\Booking::class, Models\BookingLineItem::class, Models\Payment::class,
    Models\ChannelConnection::class, Models\ChannelListing::class, Models\IcalFeed::class,
    Models\WebhookEvent::class, Models\ReconciliationIssue::class,
    Models\MessageTemplate::class, Models\ScheduledMessage::class, Models\Conversation::class,
    Models\ChatMessage::class, Models\ReviewRequest::class, Models\CleaningTask::class, Models\OutboxMessage::class,
]);

it('seeds without errors', function () {
    $this->seed();

    expect(Models\Booking::count())->toBe(6);
});`,
    },
    {
      title: 'The states mean what the lessons assume',
      path: 'tests/Feature/BookingFactoryTest.php',
      code: String.raw`<?php

use App\Enums\BookingStatus;
use App\Models\Booking;
use App\Models\CleaningTask;

it('creates a stay of the requested number of nights', function () {
    $booking = Booking::factory()->forStay('2027-07-01', 3)->create();

    expect($booking->check_in->toDateString())->toBe('2027-07-01')
        ->and($booking->check_out->toDateString())->toBe('2027-07-04');
});

it('creates pending bookings as holds that expire', function () {
    $booking = Booking::factory()->pending()->create();

    expect($booking->status)->toBe(BookingStatus::Pending)
        ->and($booking->confirmed_at)->toBeNull()
        ->and($booking->expires_at->isFuture())->toBeTrue();
});

it('treats only pending and confirmed bookings as occupying the calendar', function (BookingStatus $status, bool $blocks) {
    expect(in_array($status, BookingStatus::blocking(), true))->toBe($blocks);
})->with([
    [BookingStatus::Pending, true],
    [BookingStatus::Confirmed, true],
    [BookingStatus::Cancelled, false],
    [BookingStatus::Expired, false],
]);

it('stores the door code encrypted', function () {
    $booking = Booking::factory()->withDoorCode('4711')->create();

    expect($booking->getRawOriginal('door_code'))->not->toContain('4711')
        ->and($booking->fresh()->door_code)->toBe('4711');
});

it('puts a cleaning task on the property of its booking', function () {
    $task = CleaningTask::factory()->create();

    expect($task->property_id)->toBe($task->booking->property_id);
});`,
    },
    {
      title: 'The helpers attach the right role',
      path: 'tests/Feature/HelpersTest.php',
      code: String.raw`<?php

use App\Enums\MembershipRole;
use App\Models\Property;

it('makes a host of the property with the given role', function () {
    $property = Property::factory()->create();

    $cleaner = hostOf($property, MembershipRole::Cleaner);

    expect($cleaner->roleIn($property->account_id))->toBe(MembershipRole::Cleaner)
        ->and($cleaner->roleIn($property->account_id + 1))->toBeNull();
});`,
    },
  ],
};

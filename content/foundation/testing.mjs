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

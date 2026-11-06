// Foundation, part 4: a factory for every model, with the states the lessons' tests use, and the seeder.

export const factories = {
  id: 'factories',
  title: 'Factories',
  text: [
    'One factory per model. States read like the sentence a test needs: `Booking::factory()->pending()->forStay(\'2027-07-01\', 3)`. Defaults are valid on their own, so `X::factory()->create()` always works. Factories are unguarded, so they can set statuses and ownership columns that `$fillable` keeps away from requests.',
    'Dates that matter to a rule (check-in, `send_at`, `due_at`) are always given by the test; random dates only appear where the value is irrelevant.',
  ],
  numbered: false,
  blocks: [
    {
      id: 'factory-account',
      title: 'User, Account, AccountInvitation',
      text: ['Memberships are attached, not factoried: the test helper [`memberOf()`](F#test-helpers) does it with the role.'],
      path: 'database/factories/UserFactory.php · AccountFactory.php · AccountInvitationFactory.php',
      code: String.raw`<?php

namespace Database\Factories;

use App\Enums\MembershipRole;
use App\Models\Account;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Facades\Hash;

/** @extends Factory<User> */
class UserFactory extends Factory
{
    public function definition(): array
    {
        return [
            'name' => fake()->name(),
            'email' => fake()->unique()->safeEmail(),
            'email_verified_at' => now(),
            'password' => Hash::make('password'),
            'phone' => '+4512345678',
            'notification_channels' => ['mail', 'database'],
        ];
    }

    /** @param list<string> $channels */
    public function notifiedVia(array $channels): static
    {
        return $this->state(fn () => ['notification_channels' => $channels]);
    }
}

/** @extends Factory<Account> */
class AccountFactory extends Factory
{
    public function definition(): array
    {
        return ['name' => fake()->company()];
    }
}

/** @extends Factory<\App\Models\AccountInvitation> */
class AccountInvitationFactory extends Factory
{
    public function definition(): array
    {
        return [
            'account_id' => Account::factory(),
            'invited_by' => User::factory(),
            'email' => fake()->unique()->safeEmail(),
            'role' => MembershipRole::CoHost,
            'expires_at' => now()->addDays(7),
        ];
    }

    public function expired(): static
    {
        return $this->state(fn () => ['expires_at' => now()->subMinute()]);
    }

    public function accepted(): static
    {
        return $this->state(fn () => ['accepted_at' => now()]);
    }
}`,
    },
    {
      id: 'factory-property',
      title: 'Property, CalendarDay, RateRule, ChecklistTemplate',
      text: ['The default property is a Copenhagen flat priced in EUR, because Copenhagen has DST and a 25% VAT rate: the cases lessons 15 and 16 need. Other timezones and currencies come from states.'],
      path: 'database/factories/PropertyFactory.php · CalendarDayFactory.php · RateRuleFactory.php · ChecklistTemplateFactory.php',
      code: String.raw`<?php

namespace Database\Factories;

use App\Enums\CancellationPolicy;
use App\Enums\RateRuleType;
use App\Models\Account;
use App\Models\Property;
use Illuminate\Database\Eloquent\Factories\Factory;

/** @extends Factory<Property> */
class PropertyFactory extends Factory
{
    public function definition(): array
    {
        return [
            'account_id' => Account::factory(),
            'name' => fake()->streetName() . ' flat',
            'city' => 'Copenhagen',
            'country' => 'DK',
            'latitude' => 55.676098,
            'longitude' => 12.568337,
            'timezone' => 'Europe/Copenhagen',
            'check_in_time' => '15:00',
            'check_out_time' => '11:00',
            'bedrooms' => 2,
            'max_guests' => 4,
            'pets_allowed' => false,
            'amenities' => ['wifi', 'kitchen'],
            'min_nights' => 1,
            'booking_lead_hours' => 0,
            'nightly_rate_cents' => 15_000,
            'cleaning_fee_cents' => 6_000,
            'tax_rate_bps' => 2_500,
            'currency' => 'EUR',
            'cancellation_policy' => CancellationPolicy::Moderate,
        ];
    }

    public function priced(int $nightlyCents, string $currency, ?int $cleaningFeeCents = null): static
    {
        return $this->state(fn () => [
            'nightly_rate_cents' => $nightlyCents,
            'currency' => $currency,
            'cleaning_fee_cents' => $cleaningFeeCents,
        ]);
    }

    public function in(string $city, string $country, string $timezone): static
    {
        return $this->state(fn () => ['city' => $city, 'country' => $country, 'timezone' => $timezone]);
    }

    public function withoutCleaningFee(): static
    {
        return $this->state(fn () => ['cleaning_fee_cents' => null]);
    }

    public function petFriendly(): static
    {
        return $this->state(fn () => ['pets_allowed' => true]);
    }

    public function policy(CancellationPolicy $policy): static
    {
        return $this->state(fn () => ['cancellation_policy' => $policy]);
    }
}

/** @extends Factory<\App\Models\CalendarDay> */
class CalendarDayFactory extends Factory
{
    public function definition(): array
    {
        return ['property_id' => Property::factory(), 'date' => '2027-07-01', 'blocked' => false];
    }

    public function blocked(): static
    {
        return $this->state(fn () => ['blocked' => true]);
    }
}

/** @extends Factory<\App\Models\RateRule> */
class RateRuleFactory extends Factory
{
    public function definition(): array
    {
        return [
            'property_id' => Property::factory(),
            'type' => RateRuleType::Weekend,
            'name' => 'Weekend',
            'settings' => ['price_cents' => 18_000],
            'position' => 0,
        ];
    }

    /** A season that holds other rules (lesson 12). */
    public function season(string $startsOn, string $endsOn): static
    {
        return $this->state(fn () => [
            'type' => RateRuleType::Group,
            'name' => 'Season',
            'starts_on' => $startsOn,
            'ends_on' => $endsOn,
            'settings' => [],
        ]);
    }

    public function lengthOfStay(int $nights, int $discountBps): static
    {
        return $this->state(fn () => [
            'type' => RateRuleType::LengthOfStay,
            'name' => "{$nights}+ nights",
            'settings' => ['nights' => $nights, 'discount_bps' => $discountBps],
        ]);
    }
}

/** @extends Factory<\App\Models\ChecklistTemplate> */
class ChecklistTemplateFactory extends Factory
{
    public function definition(): array
    {
        return [
            'property_id' => Property::factory(),
            'items' => [
                ['area' => 'Kitchen', 'task' => 'Empty the dishwasher'],
                ['area' => 'Bedroom', 'task' => 'Change the bed linen'],
                ['area' => 'Bathroom', 'task' => 'Replace the towels'],
            ],
        ];
    }
}`,
    },
    {
      id: 'factory-booking',
      title: 'Booking, BookingLineItem',
      text: [
        'The default booking is **confirmed**, three nights, four weeks from the frozen test date. A test that cares about dates calls `forStay()`; one that cares about status calls a status state. Each status state sets the timestamps that go with it, so a cancelled booking always has `cancelled_at`.',
      ],
      path: 'database/factories/BookingFactory.php · BookingLineItemFactory.php',
      code: String.raw`<?php

namespace Database\Factories;

use App\Enums\BookingSource;
use App\Enums\BookingStatus;
use App\Enums\CancellationPolicy;
use App\Enums\GuestChannel;
use App\Enums\LineItemType;
use App\Models\Booking;
use App\Models\Property;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Factories\Factory;

/** @extends Factory<Booking> */
class BookingFactory extends Factory
{
    public function definition(): array
    {
        $checkIn = now()->addWeeks(4)->startOfDay();

        return [
            'property_id' => Property::factory(),
            'guest_name' => fake()->name(),
            'guest_email' => fake()->safeEmail(),
            'guest_phone' => '+4587654321',
            'guest_channel' => GuestChannel::Mail,
            'guest_locale' => 'en',
            'check_in' => $checkIn->toDateString(),
            'check_out' => $checkIn->addDays(3)->toDateString(),
            'guests' => 2,
            'status' => BookingStatus::Confirmed,
            'total_cents' => 45_000,
            'currency' => 'EUR',
            'cancellation_policy' => CancellationPolicy::Moderate,
            'source' => BookingSource::Direct,
            'confirmed_at' => now(),
        ];
    }

    public function forStay(string $checkIn, int $nights): static
    {
        return $this->state(fn () => [
            'check_in' => $checkIn,
            'check_out' => CarbonImmutable::parse($checkIn)->addDays($nights)->toDateString(),
        ]);
    }

    public function pending(): static
    {
        return $this->state(fn () => [
            'status' => BookingStatus::Pending,
            'confirmed_at' => null,
            'expires_at' => now()->addMinutes(30),
        ]);
    }

    public function cancelled(): static
    {
        return $this->state(fn () => ['status' => BookingStatus::Cancelled, 'cancelled_at' => now()]);
    }

    public function expired(): static
    {
        return $this->state(fn () => [
            'status' => BookingStatus::Expired,
            'confirmed_at' => null,
            'expires_at' => now()->subMinute(),
        ]);
    }

    public function fromChannel(BookingSource $source, string $externalId, int $version = 1): static
    {
        return $this->state(fn () => ['source' => $source, 'external_id' => $externalId, 'external_version' => $version]);
    }

    public function withDoorCode(string $code = '4711'): static
    {
        return $this->state(fn () => ['door_code' => $code]);
    }

    public function messagedVia(GuestChannel $channel): static
    {
        return $this->state(fn () => ['guest_channel' => $channel]);
    }

    /** Copies price, currency and policy from the property, the way a real booking does. */
    public function pricedFrom(Property $property, int $nights): static
    {
        return $this->for($property)->state(fn () => [
            'total_cents' => $property->nightly_rate_cents * $nights,
            'currency' => $property->currency,
            'cancellation_policy' => $property->cancellation_policy,
        ]);
    }
}

/** @extends Factory<\App\Models\BookingLineItem> */
class BookingLineItemFactory extends Factory
{
    public function definition(): array
    {
        return [
            'booking_id' => Booking::factory(),
            'type' => LineItemType::Night,
            'description' => 'Night',
            'night' => '2027-07-01',
            'amount_cents' => 15_000,
            'currency' => 'EUR',
        ];
    }

    public function of(LineItemType $type, int $amountCents): static
    {
        return $this->state(fn () => [
            'type' => $type,
            'description' => str($type->value)->replace('_', ' ')->ucfirst()->toString(),
            'night' => null,
            'amount_cents' => $amountCents,
        ]);
    }
}`,
    },
    {
      id: 'factory-payment',
      title: 'Payment',
      path: 'database/factories/PaymentFactory.php',
      code: String.raw`<?php

namespace Database\Factories;

use App\Enums\PaymentKind;
use App\Enums\PaymentStatus;
use App\Models\Booking;
use Illuminate\Database\Eloquent\Factories\Factory;

/** @extends Factory<\App\Models\Payment> */
class PaymentFactory extends Factory
{
    public function definition(): array
    {
        return [
            'booking_id' => Booking::factory(),
            'kind' => PaymentKind::Deposit,
            'amount_cents' => 13_500,
            'currency' => 'EUR',
            'status' => PaymentStatus::Pending,
            'provider_payment_id' => 'pi_' . fake()->unique()->bothify('????????????????'),
        ];
    }

    public function succeeded(): static
    {
        return $this->state(fn () => ['status' => PaymentStatus::Succeeded]);
    }

    public function failed(string $reason = 'card_declined'): static
    {
        return $this->state(fn () => ['status' => PaymentStatus::Failed, 'failure_reason' => $reason]);
    }

    public function balanceDue(string $dueAt): static
    {
        return $this->state(fn () => ['kind' => PaymentKind::Balance, 'due_at' => $dueAt, 'provider_payment_id' => null]);
    }

    public function refund(int $amountCents): static
    {
        return $this->state(fn () => [
            'kind' => PaymentKind::Refund,
            'amount_cents' => $amountCents,
            'provider_payment_id' => 're_' . fake()->unique()->bothify('????????????????'),
        ]);
    }
}`,
    },
    {
      id: 'factory-channels',
      title: 'ChannelConnection, ChannelListing, IcalFeed, WebhookEvent, ReconciliationIssue',
      text: ['`WebhookEvent::factory()->stripe(...)` builds the event the way it is stored after verification (lesson 6 parses it). Recorded payloads from the real APIs live in `tests/Fixtures/` and are used with `Http::fake()` (lesson 9).'],
      path: 'database/factories/ChannelConnectionFactory.php · ChannelListingFactory.php · IcalFeedFactory.php · WebhookEventFactory.php · ReconciliationIssueFactory.php',
      code: String.raw`<?php

namespace Database\Factories;

use App\Enums\Channel;
use App\Enums\ReconciliationKind;
use App\Enums\WebhookStatus;
use App\Models\Account;
use App\Models\Property;
use Illuminate\Database\Eloquent\Factories\Factory;

/** @extends Factory<\App\Models\ChannelConnection> */
class ChannelConnectionFactory extends Factory
{
    public function definition(): array
    {
        return [
            'account_id' => Account::factory(),
            'channel' => Channel::Airbnb,
            'access_token' => 'access-' . fake()->sha1(),
            'refresh_token' => 'refresh-' . fake()->sha1(),
            'expires_at' => now()->addHour(),
        ];
    }

    public function tokenExpired(): static
    {
        return $this->state(fn () => ['expires_at' => now()->subMinute()]);
    }
}

/** @extends Factory<\App\Models\ChannelListing> */
class ChannelListingFactory extends Factory
{
    public function definition(): array
    {
        return [
            'property_id' => Property::factory(),
            'channel' => Channel::Airbnb,
            'external_listing_id' => (string) fake()->unique()->numberBetween(10_000_000, 99_999_999),
        ];
    }

    public function on(Channel $channel): static
    {
        return $this->state(fn () => ['channel' => $channel]);
    }
}

/** @extends Factory<\App\Models\IcalFeed> */
class IcalFeedFactory extends Factory
{
    public function definition(): array
    {
        return [
            'property_id' => Property::factory(),
            'source' => Channel::Airbnb,
            'url' => 'https://www.airbnb.com/calendar/ical/' . fake()->numberBetween(1_000_000, 9_999_999) . '.ics?s=abc',
        ];
    }

    public function from(Channel $source, string $url): static
    {
        return $this->state(fn () => ['source' => $source, 'url' => $url]);
    }
}

/** @extends Factory<\App\Models\WebhookEvent> */
class WebhookEventFactory extends Factory
{
    public function definition(): array
    {
        return $this->stripePayload('payment_intent.succeeded', ['id' => 'pi_test', 'metadata' => ['booking_id' => '1']]);
    }

    /** @param array<string, mixed> $object */
    public function stripe(string $type, array $object): static
    {
        return $this->state(fn () => $this->stripePayload($type, $object));
    }

    public function processed(): static
    {
        return $this->state(fn () => ['status' => WebhookStatus::Processed, 'processed_at' => now()]);
    }

    /**
     * @param array<string, mixed> $object
     * @return array<string, mixed>
     */
    private function stripePayload(string $type, array $object): array
    {
        $eventId = 'evt_' . fake()->unique()->bothify('????????????????');

        return [
            'provider' => 'stripe',
            'event_id' => $eventId,
            'type' => $type,
            'payload' => ['id' => $eventId, 'type' => $type, 'data' => ['object' => $object]],
            'status' => WebhookStatus::Received,
        ];
    }
}

/** @extends Factory<\App\Models\ReconciliationIssue> */
class ReconciliationIssueFactory extends Factory
{
    public function definition(): array
    {
        return [
            'kind' => ReconciliationKind::MissingOnChannel,
            'property_id' => Property::factory(),
            'details' => ['date' => '2027-07-01'],
        ];
    }
}`,
    },
    {
      id: 'factory-messaging',
      title: 'MessageTemplate, ScheduledMessage, Conversation, ChatMessage, ReviewRequest',
      path: 'database/factories/MessageTemplateFactory.php · ScheduledMessageFactory.php · ConversationFactory.php · ChatMessageFactory.php · ReviewRequestFactory.php',
      code: String.raw`<?php

namespace Database\Factories;

use App\Enums\ChatSender;
use App\Enums\MessageTrigger;
use App\Enums\ReviewRequestStatus;
use App\Enums\ScheduledMessageStatus;
use App\Models\Account;
use App\Models\Booking;
use App\Models\Conversation;
use App\Models\MessageTemplate;
use Illuminate\Database\Eloquent\Factories\Factory;

/** @extends Factory<MessageTemplate> */
class MessageTemplateFactory extends Factory
{
    public function definition(): array
    {
        return [
            'account_id' => Account::factory(),
            'name' => 'Booking confirmed',
            'trigger' => MessageTrigger::BookingConfirmed,
            'offset_minutes' => 0,
            'send_time' => null,
            'subject' => 'Your stay at {property_name}',
            'body' => 'Hi {guest_name}, your booking from {check_in} to {check_out} is confirmed.',
            'active' => true,
        ];
    }

    /** "1 day before check-in at 15:00": the classic arrival message, with the door code. */
    public function dayBeforeCheckIn(string $sendTime = '15:00'): static
    {
        return $this->state(fn () => [
            'name' => 'Arrival details',
            'trigger' => MessageTrigger::BeforeCheckIn,
            'offset_minutes' => -1440,
            'send_time' => $sendTime,
            'subject' => 'Arriving tomorrow',
            'body' => 'Hi {guest_name}, the door code is {door_code}. Check-in from {check_in_time}.',
        ]);
    }

    public function afterCheckOut(int $offsetMinutes = 1440): static
    {
        return $this->state(fn () => [
            'name' => 'Thank you',
            'trigger' => MessageTrigger::AfterCheckOut,
            'offset_minutes' => $offsetMinutes,
            'subject' => 'Thanks for staying',
            'body' => 'Thanks for staying with us, {guest_name}.',
        ]);
    }

    public function inactive(): static
    {
        return $this->state(fn () => ['active' => false]);
    }
}

/** @extends Factory<\App\Models\ScheduledMessage> */
class ScheduledMessageFactory extends Factory
{
    public function definition(): array
    {
        return [
            'booking_id' => Booking::factory(),
            'message_template_id' => MessageTemplate::factory(),
            'send_at' => now()->addDay(),
            'status' => ScheduledMessageStatus::Pending,
        ];
    }

    public function due(): static
    {
        return $this->state(fn () => ['send_at' => now()->subMinute()]);
    }

    public function sent(): static
    {
        return $this->state(fn () => ['status' => ScheduledMessageStatus::Sent, 'sent_at' => now()]);
    }
}

/** @extends Factory<Conversation> */
class ConversationFactory extends Factory
{
    public function definition(): array
    {
        return ['booking_id' => Booking::factory()];
    }
}

/** @extends Factory<\App\Models\ChatMessage> */
class ChatMessageFactory extends Factory
{
    public function definition(): array
    {
        return [
            'conversation_id' => Conversation::factory(),
            'sender' => ChatSender::Guest,
            'body' => 'Is early check-in possible?',
        ];
    }

    public function fromHost(\App\Models\User $host): static
    {
        return $this->state(fn () => ['sender' => ChatSender::Host, 'user_id' => $host->id, 'body' => 'Yes, from 13:00.']);
    }
}

/** @extends Factory<\App\Models\ReviewRequest> */
class ReviewRequestFactory extends Factory
{
    public function definition(): array
    {
        return [
            'booking_id' => Booking::factory(),
            'send_at' => now()->addDay(),
            'status' => ReviewRequestStatus::Pending,
        ];
    }
}`,
    },
    {
      id: 'factory-operations',
      title: 'CleaningTask, OutboxMessage',
      path: 'database/factories/CleaningTaskFactory.php · OutboxMessageFactory.php',
      code: String.raw`<?php

namespace Database\Factories;

use App\Enums\CleaningTaskStatus;
use App\Models\Booking;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Str;

/** @extends Factory<\App\Models\CleaningTask> */
class CleaningTaskFactory extends Factory
{
    public function definition(): array
    {
        return [
            'booking_id' => Booking::factory(),
            'property_id' => fn (array $attributes) => Booking::find($attributes['booking_id'])->property_id,   // the booking's own property
            'due_at' => now()->addWeeks(4)->setTime(9, 0),
            'status' => CleaningTaskStatus::Open,
            'checklist' => [['area' => 'Kitchen', 'task' => 'Empty the dishwasher', 'done' => false]],
        ];
    }

    public function assignedTo(User $cleaner): static
    {
        return $this->state(fn () => ['cleaner_id' => $cleaner->id, 'status' => CleaningTaskStatus::Assigned]);
    }
}

/** @extends Factory<\App\Models\OutboxMessage> */
class OutboxMessageFactory extends Factory
{
    public function definition(): array
    {
        return [
            'message_id' => (string) Str::uuid(),
            'type' => 'booking.confirmed.v1',
            'payload' => ['booking_id' => 1],
        ];
    }

    public function published(): static
    {
        return $this->state(fn () => ['published_at' => now()]);
    }
}`,
    },
  ],
};

export const seeders = {
  id: 'seed',
  title: 'Seed data',
  text: ['`php artisan migrate:fresh --seed` gives a realistic account to click through: three roles, two properties in different timezones and currencies, a season of rate rules, message templates, channel links and bookings that cover every status and the back-to-back case.'],
  numbered: false,
  blocks: [
    {
      id: 'seeder',
      title: 'DatabaseSeeder',
      path: 'database/seeders/DatabaseSeeder.php',
      code: String.raw`<?php

namespace Database\Seeders;

use App\Enums\BookingSource;
use App\Enums\Channel;
use App\Enums\MembershipRole;
use App\Models\Account;
use App\Models\Booking;
use App\Models\CalendarDay;
use App\Models\ChannelListing;
use App\Models\ChecklistTemplate;
use App\Models\IcalFeed;
use App\Models\MessageTemplate;
use App\Models\Property;
use App\Models\RateRule;
use App\Models\User;
use Illuminate\Database\Seeder;

class DatabaseSeeder extends Seeder
{
    public function run(): void
    {
        $account = Account::factory()->create(['name' => 'Nordic Stays']);

        foreach (['owner' => MembershipRole::Owner, 'cohost' => MembershipRole::CoHost, 'cleaner' => MembershipRole::Cleaner] as $name => $role) {
            $user = User::factory()->create(['email' => "{$name}@nordicstays.test", 'current_account_id' => $account->id]);
            $account->users()->attach($user, ['role' => $role->value]);
        }

        $flat = Property::factory()->for($account)->create(['name' => 'Nyhavn flat']);
        $loft = Property::factory()->for($account)->in('Cairo', 'EG', 'Africa/Cairo')
            ->priced(450_000, 'EGP', cleaningFeeCents: null)->petFriendly()->create(['name' => 'Zamalek loft']);

        ChecklistTemplate::factory()->for($flat)->create();
        CalendarDay::factory()->for($flat)->blocked()->create(['date' => '2027-07-20']);    // owner's own use

        $summer = RateRule::factory()->for($flat)->season('2027-06-15', '2027-08-31')->create(['name' => 'Summer']);
        RateRule::factory()->for($flat)->create(['parent_id' => $summer->id, 'position' => 1]);
        RateRule::factory()->for($flat)->lengthOfStay(7, 1_000)->create(['parent_id' => $summer->id, 'position' => 2]);

        MessageTemplate::factory()->for($account)->create();
        MessageTemplate::factory()->for($account)->dayBeforeCheckIn()->create();
        MessageTemplate::factory()->for($account)->afterCheckOut()->create();

        ChannelListing::factory()->for($flat)->on(Channel::Airbnb)->create();
        IcalFeed::factory()->for($loft)->from(Channel::BookingCom, 'https://admin.booking.com/hotel/hoteladmin/ical.html?t=demo')->create();

        Booking::factory()->pricedFrom($flat, 3)->forStay('2027-07-01', 3)->withDoorCode()->create();
        Booking::factory()->pricedFrom($flat, 2)->forStay('2027-07-04', 2)->create();          // arrives as the first guest leaves
        Booking::factory()->pricedFrom($flat, 5)->forStay('2027-07-10', 5)->cancelled()->create();
        Booking::factory()->pricedFrom($flat, 2)->forStay('2027-07-25', 2)->pending()->create();
        Booking::factory()->pricedFrom($flat, 7)->forStay('2027-08-01', 7)->fromChannel(BookingSource::Airbnb, 'HMABC123')->create();
        Booking::factory()->pricedFrom($loft, 4)->forStay('2027-07-01', 4)->create();
    }
}`,
    },
  ],
};

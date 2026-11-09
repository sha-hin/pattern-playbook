// Scene 5 · Singleton and the Dependency Injection Container.

export default {
  description: 'A developer’s test run created 312 real payments in the live Stripe account because the Stripe client was created inside the code and could not be replaced. Fix it with Laravel’s service container: one binding, constructor injection, and a fake in tests. Singleton vs the container’s singleton().',
  incident: {
    channel: '#finance',
    when: 'Friday 09:30',
    messages: [
      ['Lina · finance', 'Our **live** Stripe account has **312 new payments** since last night, all €450.30, all “Test booking, Nyhavn flat”, all incomplete. And Stripe’s risk team emailed: “unusual activity on your account”.'],
      ['Karim · developer', 'I ran the test suite on my laptop yesterday. `phpunit.xml` doesn’t override `STRIPE_SECRET`, so the tests used my `.env`, and it still had the **live** key from debugging a payout. No money moved, because nobody confirmed a card. The refund tests ran against live Stripe too; they only found nothing to refund because the payments were incomplete.'],
    ],
  },
  sections: [
    {
      title: 'The broken code',
      text: ['Every class that talks to Stripe builds its own client from the config:'],
      blocks: [
        {
          path: 'app/Payments/StartBookingPayment.php (before)',
          broken: true,
          code: String.raw`<?php

namespace App\Payments;

use App\Enums\PaymentStatus;
use App\Models\Booking;
use Stripe\StripeClient;

final class StartBookingPayment
{
    /** @return string the client secret the browser needs to confirm the payment with Stripe */
    public function handle(Booking $booking): string
    {
        $stripe = new StripeClient(config('services.stripe.secret'));   // copy 1 of 5 in the app

        $intent = $stripe->paymentIntents->create([
            'amount' => $booking->total->amount,
            'currency' => strtolower($booking->total->currency->value),
            'metadata' => ['booking_id' => (string) $booking->id],
        ]);

        $booking->payments()->create([
            'amount_cents' => $booking->total->amount,
            'currency' => $booking->total->currency->value,
            'status' => PaymentStatus::Pending,
            'provider_payment_id' => $intent->id,
        ]);

        return $intent->client_secret;
    }
}`,
          after: ['A test that calls this code **can’t stop it** from reaching Stripe: the `new` is inside the method, out of the test’s reach. Whatever key is in the environment gets used.'],
        },
        {
          title: 'The first attempt: a static singleton',
          text: ['Someone already tried to fix the five copies with the classic Singleton: one shared instance, reachable from anywhere.'],
          path: 'app/Payments/Stripe.php (before)',
          broken: true,
          code: String.raw`<?php

namespace App\Payments;

use Stripe\StripeClient;

final class Stripe
{
    private static ?StripeClient $client = null;

    private function __construct()                          // nobody can create a "Stripe"
    {
    }

    public static function client(): StripeClient
    {
        return self::$client ??= new StripeClient(config('services.stripe.secret'));   // built once, then shared
    }
}`,
          after: [
            'There is now one client instead of five, but the real problem is untouched. Every class still **reaches out** for `Stripe::client()`, so a test still can’t hand it a fake, and nothing in a constructor tells you the class charges cards. The static also survives between tests, so a client built in one test leaks into the next.',
          ],
        },
      ],
    },
    {
      title: 'The fix: ask for it, don’t build it',
      blocks: [
        {
          title: '1. Stripe’s SDK and its configuration',
          text: ['Install the SDK:'],
          path: 'terminal',
          lang: 'shell',
          code: String.raw`composer require stripe/stripe-php`,
        },
        {
          text: ['Laravel’s `config/services.php` holds third-party credentials. The whole file, with Laravel’s unused examples (Postmark, SES, Slack) removed:'],
          path: 'config/services.php',
          code: String.raw`<?php

// Credentials for the services Nordic Stays talks to. Values come from .env, never from code.
return [

    'stripe' => [
        'secret' => env('STRIPE_SECRET'),
        'version' => env('STRIPE_API_VERSION'),              // the API version your Stripe account is pinned to
    ],

];`,
        },
        {
          text: ['And the values, in `.env`:'],
          path: '.env (add these lines)',
          lang: 'env',
          fragment: true,
          code: String.raw`STRIPE_SECRET=sk_test_...
STRIPE_API_VERSION=2025-06-30.basil`,
          after: ['Use the API version shown in your Stripe dashboard under Developers → API version.'],
        },
        {
          title: '2. What the app needs from a payment provider',
          text: ['A small interface, in the app’s own words. It has two implementations from day one: the real one, and the fake the tests use.'],
          path: 'app/Payments/PaymentGateway.php',
          code: String.raw`<?php

namespace App\Payments;

use App\Money\Money;

interface PaymentGateway
{
    /**
     * @param array<string, string> $metadata
     * @return array{id: string, client_secret: string}
     */
    public function createPaymentIntent(Money $amount, array $metadata = []): array;
}`,
        },
        {
          title: '3. The real implementation receives its client',
          text: ['It doesn’t build a `StripeClient`; it asks for one in the constructor. The amount always comes from our own `Money` (scene 1), never from the browser.'],
          path: 'app/Payments/StripeGateway.php',
          code: String.raw`<?php

namespace App\Payments;

use App\Money\Money;
use Stripe\StripeClient;

final readonly class StripeGateway implements PaymentGateway
{
    public function __construct(private StripeClient $stripe)
    {
    }

    public function createPaymentIntent(Money $amount, array $metadata = []): array
    {
        $intent = $this->stripe->paymentIntents->create([
            'amount' => $amount->amount,                            // already in minor units
            'currency' => strtolower($amount->currency->value),
            'automatic_payment_methods' => ['enabled' => true],
            'metadata' => $metadata,
        ]);

        return ['id' => $intent->id, 'client_secret' => $intent->client_secret];
    }
}`,
        },
        {
          title: '4. One place decides what gets built',
          text: [
            '`singleton()` builds the `StripeClient` the first time anything needs it, and hands out the same one after. `bind()` says "when someone asks for a `PaymentGateway`, build a `StripeGateway`".',
            'Bindings go in `register()`. Nothing is *used* there, because other providers may not have registered yet; `boot()` runs after all of them, which is why the [defaults](F#app-provider) live there.',
          ],
          path: 'app/Providers/AppServiceProvider.php (register added)',
          code: String.raw`<?php

namespace App\Providers;

use App\Payments\PaymentGateway;
use App\Payments\StripeGateway;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\Date;
use Illuminate\Support\ServiceProvider;
use Stripe\StripeClient;

class AppServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->app->singleton(StripeClient::class, fn (): StripeClient => new StripeClient([
            'api_key' => config('services.stripe.secret'),
            'stripe_version' => config('services.stripe.version'),    // pinned: a Stripe release can't change responses
            'max_network_retries' => 2,
        ]));

        $this->app->bind(PaymentGateway::class, StripeGateway::class);
    }

    public function boot(): void
    {
        Date::use(CarbonImmutable::class);                        // every date Laravel creates is immutable (scene 1)
        Model::shouldBeStrict(! $this->app->isProduction());     // lazy loading, unknown and unfillable attributes throw
    }
}`,
        },
        {
          title: '5. The consumer declares what it needs',
          text: ['The dependency is now visible in the constructor, and the container fills it in: nobody writes `new StartBookingPayment(...)` by hand.'],
          path: 'app/Payments/StartBookingPayment.php (after)',
          code: String.raw`<?php

namespace App\Payments;

use App\Enums\PaymentStatus;
use App\Models\Booking;

final readonly class StartBookingPayment
{
    public function __construct(private PaymentGateway $gateway)
    {
    }

    /** @return string the client secret the browser needs to confirm the payment with Stripe */
    public function handle(Booking $booking): string
    {
        $intent = $this->gateway->createPaymentIntent($booking->total, ['booking_id' => (string) $booking->id]);

        $booking->payments()->create([
            'amount_cents' => $booking->total->amount,
            'currency' => $booking->total->currency->value,
            'status' => PaymentStatus::Pending,
            'provider_payment_id' => $intent['id'],
        ]);

        return $intent['client_secret'];
    }
}`,
        },
        {
          title: 'Where it is called',
          text: ['The checkout page calls one endpoint, unchanged since launch. The container builds `StartBookingPayment`, and with it the gateway:'],
          path: 'app/Http/Controllers/BookingPaymentController.php',
          code: String.raw`<?php

namespace App\Http\Controllers;

use App\Models\Booking;
use App\Payments\StartBookingPayment;
use Illuminate\Http\JsonResponse;

class BookingPaymentController extends Controller
{
    /** The checkout page asks for a client secret, then confirms the card in the browser with Stripe.js. */
    public function __invoke(Booking $booking, StartBookingPayment $startPayment): JsonResponse
    {
        return response()->json(['client_secret' => $startPayment->handle($booking)], 201);
    }
}`,
        },
        {
          text: ['Its route, next to the booking route from scene 3:'],
          path: 'routes/api.php',
          code: String.raw`<?php

use App\Http\Controllers\BookingController;
use App\Http\Controllers\BookingPaymentController;
use Illuminate\Support\Facades\Route;

// Laravel serves this file under /api: the full URL is /api/v1/properties/{property}/bookings.
Route::post('/v1/properties/{property}/bookings', [BookingController::class, 'store'])
    ->middleware('auth:sanctum')
    ->can('createBooking', 'property');

Route::post('/v1/bookings/{booking}/payment', BookingPaymentController::class)
    ->middleware('auth:sanctum');`,
        },
        {
          title: '6. In tests, a fake takes the real one’s place',
          text: ['One line in a test swaps the gateway for **everything** the container builds afterwards. Nothing in the app changes, and nothing reaches Stripe, whatever key is in `.env`.'],
          path: 'tests/Fakes/FakePaymentGateway.php',
          code: String.raw`<?php

namespace Tests\Fakes;

use App\Money\Money;
use App\Payments\PaymentGateway;

final class FakePaymentGateway implements PaymentGateway
{
    /** @var list<Money> every amount the app tried to charge */
    public array $charged = [];

    public function createPaymentIntent(Money $amount, array $metadata = []): array
    {
        $this->charged[] = $amount;
        $id = 'pi_fake_' . count($this->charged);

        return ['id' => $id, 'client_secret' => "{$id}_secret"];
    }
}`,
        },
      ],
    },
  ],
  reveal: {
    names: ['Singleton', 'Dependency Injection Container'],
    rules: [
      ['Singleton', 'A class that allows only one instance of itself, and gives global access to it.'],
      ['Dependency Injection Container', 'One object that knows how to build everything else, and passes each class the objects it asks for in its constructor.'],
    ],
    text: ['Today’s fix kept the good half of Singleton, **one shared client**, and dropped the bad half, **global access**. The container holds the only instance, and classes receive it instead of reaching for it.'],
    table: [
      ['', 'Static Singleton', 'Container singleton()'],
      ['How many instances?', 'One', 'One'],
      ['How do classes get it?', 'They reach for it: `Stripe::client()`', 'They ask in the constructor'],
      ['Visible in the constructor?', 'No', 'Yes'],
      ['Replace it in a test?', 'No', '`$this->app->instance(...)`'],
      ['Survives between tests?', 'Yes, a static', 'No, a fresh app per test'],
    ],
    whenNot: [
      'Don’t bind every class. The container builds concrete classes on its own (autowiring); bind only interfaces, configured objects and shared instances.',
      'Don’t call `app(SomeService::class)` inside business code: that’s the static singleton again with extra steps. Ask for it in the constructor.',
      'Never `singleton()` something that holds per-request or per-user data: one user’s data would leak into the next request when the app stays in memory (scene 45, Octane).',
    ],
  },
  laravel: {
    title: 'Laravel inside',
    text: ['The container’s core is two methods. `resolve()` decides **whether** to build (a shared instance may already exist); `build()` decides **how**: it reads the constructor with reflection and resolves every parameter the same way, recursively.'],
    blocks: [
      {
        title: 'resolve(): shared instances first',
        path: 'Illuminate/Container/Container.php (simplified)',
        fragment: true,
        code: String.raw`protected function resolve($abstract, $parameters = [])
{
    if (isset($this->instances[$abstract]) && empty($parameters)) {
        return $this->instances[$abstract];                  // a singleton built earlier
    }

    $concrete = $this->getConcrete($abstract);               // PaymentGateway → StripeGateway, from bind()

    $object = $this->isBuildable($concrete, $abstract)
        ? $this->build($concrete)
        : $this->make($concrete);

    if ($this->isShared($abstract) && empty($parameters)) {
        $this->instances[$abstract] = $object;               // singleton(): keep it for next time
    }

    return $object;
}`,
      },
      {
        title: 'build(): autowiring with reflection',
        text: ['Asking for `StartBookingPayment` builds a `StripeGateway`, which needs a `StripeClient`, which comes from the singleton closure. Nobody wrote that chain; the constructors describe it.'],
        path: 'Illuminate/Container/Container.php (simplified)',
        fragment: true,
        code: String.raw`public function build($concrete)
{
    if ($concrete instanceof Closure) {
        return $concrete($this, $this->getLastParameterOverride());   // the closure from singleton()
    }

    $reflector = new ReflectionClass($concrete);

    if (! $reflector->isInstantiable()) {
        throw new BindingResolutionException("Target [$concrete] is not instantiable.");   // an interface nobody bound
    }

    $constructor = $reflector->getConstructor();
    if ($constructor === null) {
        return new $concrete;
    }

    $dependencies = $this->resolveDependencies($constructor->getParameters());   // make() for each class-typed parameter

    return $reflector->newInstanceArgs($dependencies);
}`,
      },
    ],
  },
  tests: {
    summary: 'The payment is started with the fake, and the bindings hold',
    blocks: [
      {
        path: 'tests/Feature/StartBookingPaymentTest.php',
        code: String.raw`<?php

use App\Enums\PaymentStatus;
use App\Models\Booking;
use App\Payments\PaymentGateway;
use App\Payments\StartBookingPayment;
use App\Payments\StripeGateway;
use Stripe\StripeClient;
use Tests\Fakes\FakePaymentGateway;

it('charges the booking total and records a pending payment', function () {
    $gateway = new FakePaymentGateway();
    $this->app->instance(PaymentGateway::class, $gateway);          // everything built from now on gets the fake

    $booking = Booking::factory()->create(['total_cents' => 45_030, 'currency' => 'EUR']);

    $secret = app(StartBookingPayment::class)->handle($booking);

    expect($secret)->toBe('pi_fake_1_secret')
        ->and($gateway->charged)->toHaveCount(1)
        ->and($gateway->charged[0]->amount)->toBe(45_030)
        ->and($booking->payments()->sole())
            ->provider_payment_id->toBe('pi_fake_1')
            ->status->toBe(PaymentStatus::Pending);
});

it('builds the Stripe gateway when nothing is swapped', function () {
    expect(app(PaymentGateway::class))->toBeInstanceOf(StripeGateway::class);
});

it('shares one Stripe client across the app', function () {
    expect(app(StripeClient::class))->toBe(app(StripeClient::class));   // red if singleton() becomes bind()
});`,
        after: ['Belt and braces: the [test environment](F#phpunit) also sets `STRIPE_SECRET=sk_test_fake`, so even code that slipped past the container would get an authentication error instead of a charge.'],
      },
      {
        path: 'phpunit.xml',
        lang: 'xml',
        code: String.raw`<?xml version="1.0" encoding="UTF-8"?>
<phpunit xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:noNamespaceSchemaLocation="vendor/phpunit/phpunit/phpunit.xsd"
         bootstrap="vendor/autoload.php"
         colors="true"
>
    <testsuites>
        <testsuite name="Unit">
            <directory>tests/Unit</directory>
        </testsuite>
        <testsuite name="Feature">
            <directory>tests/Feature</directory>
        </testsuite>
        <testsuite name="Concurrency">
            <directory>tests/Concurrency</directory>
        </testsuite>
    </testsuites>
    <source>
        <include>
            <directory>app</directory>
        </include>
    </source>
    <php>
        <env name="APP_ENV" value="testing"/>
        <env name="DB_CONNECTION" value="mysql"/>
        <env name="DB_DATABASE" value="pms_test"/>
        <env name="QUEUE_CONNECTION" value="sync"/>
        <env name="CACHE_STORE" value="array"/>
        <env name="SESSION_DRIVER" value="array"/>
        <env name="MAIL_MAILER" value="array"/>
        <env name="BCRYPT_ROUNDS" value="4"/>
        <env name="STRIPE_SECRET" value="sk_test_fake"/>
    </php>
</phpunit>`,
      },
    ],
  },
  next: 'Payments start safely now. Friday afternoon, a host marks a bank transfer as paid, and the guest hears nothing.',
};

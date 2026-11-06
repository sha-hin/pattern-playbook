// Lesson 3: Singleton and the Dependency Injection Container.

export default {
  description: 'The Stripe client is created with new in five places, and a static singleton leaks state between tests. Learn the Singleton pattern, why it hurts, and how Laravel’s service container gives one shared instance without global state.',
  ticket: {
    from: 'Engineering lead',
    title: 'Tests hit the real Stripe API, and a refund used last week’s key',
    body: 'The Stripe client is built with `new StripeClient(...)` in five classes. The test suite calls Stripe’s test API for real because nothing can be swapped. Someone "fixed" it with a static `StripeGateway::instance()`, and now one test’s fake leaks into the next. A worker that was not restarted after the key rotation kept using the old key.',
  },
  pain: {
    text: ['First every class built its own client; then a static singleton tried to fix it:'],
    code: String.raw`final class StartBookingPayment
{
    public function handle(Booking $booking): string
    {
        $stripe = new StripeClient(config('services.stripe.secret'));     // copy 1 of 5
        // ...
    }
}

final class StripeGateway
{
    private static ?self $instance = null;

    public static function instance(): self
    {
        return self::$instance ??= new self(new StripeClient(config('services.stripe.secret')));
    }
}

StripeGateway::instance()->refund($payment);                           // hidden dependency, global state`,
    after: [
      'With `new` everywhere, the configuration is repeated and nothing can be replaced in a test. With a static singleton, there is one instance, but every class reaches for it in secret: you can’t see from a constructor that `CancelBooking` talks to Stripe, and the instance lives for the whole process, so state from one test or one request survives into the next.',
    ],
  },
  patterns: [
    {
      name: 'Singleton',
      rule: 'A class that guarantees it has only one instance, and gives global access to it.',
      explain: [
        'The Gang of Four version: a private constructor, a static method that creates the instance on first use and returns the same one after, and no cloning. It solves a real need (one shared, expensive object) but adds **global state**: any code can reach it, dependencies are invisible, and replacing it in a test means resetting a static property.',
        'In long-running PHP (queue workers, Octane) the problem grows: the "one instance" lives for hours, across thousands of jobs or requests.',
      ],
    },
    {
      name: 'Dependency Injection Container',
      rule: 'Classes ask for what they need in their constructor; one container knows how to build everything and decides what is shared.',
      explain: [
        'With dependency injection, `StartBookingPayment` declares `public function __construct(private StripeGateway $stripe)`. It never builds the client and never reaches for a global. The **container** builds it: it reads the constructor, builds each dependency the same way, and passes them in.',
        '`singleton()` on the container keeps the useful part of the Singleton pattern (one shared instance) and drops the harmful part (global access). Dependencies are visible in every constructor, and a test can replace the instance with one line.',
      ],
      drawing: {
        bad: [['b', 4, 14, 96, 30, 'Payments', 'n'], ['b', 4, 68, 96, 30, 'Refunds', 'n'], ['b', 4, 122, 96, 30, 'Reconcile', 'n'], ['a', 100, 29, 188, 72, '', 'x'], ['a', 100, 83, 188, 83, '', 'x'], ['a', 100, 137, 188, 94, '', 'x'], ['b', 190, 58, 106, 50, '::instance()', 'x'], ['t', 243, 128, 'global, hidden', 'kx', 'middle']],
        good: [['b', 4, 60, 92, 46, 'Container', 'v'], ['a', 96, 70, 180, 29, '', 'k'], ['a', 96, 83, 180, 83, '', 'k'], ['a', 96, 96, 180, 137, '', 'k'], ['b', 182, 14, 114, 30, 'Payments(gw)', 'n'], ['b', 182, 68, 114, 30, 'Refunds(gw)', 'n'], ['b', 182, 122, 114, 30, 'Reconcile(gw)', 'n'], ['t', 50, 128, 'one shared gw', 's', 'middle']],
        badCaption: 'Every class reaches for a global instance; nobody can see or replace the dependency.',
        goodCaption: 'The container passes one shared gateway into every constructor.',
      },
    },
  ],
  sections: [
    {
      title: 'Build it',
      blocks: [
        {
          title: 'The GoF Singleton, written correctly (so you can recognise it)',
          text: ['This is the classic form. It is shown here to understand the pattern; the PMS does not use it.'],
          path: 'Singleton (reference, not used in the app)',
          code: String.raw`<?php

final class Config
{
    private static ?self $instance = null;

    private function __construct()                 // nobody else can call "new Config()"
    {
    }

    public static function instance(): self
    {
        return self::$instance ??= new self();     // created on first use, then always the same
    }

    private function __clone()                     // no copies
    {
    }

    public function __wakeup(): void
    {
        throw new LogicException('A singleton cannot be unserialized.');
    }
}`,
        },
        {
          title: 'A gateway class that receives its client',
          text: ['Our own class around the Stripe SDK. It asks for a `StripeClient` instead of building one, so the configuration lives in exactly one place. The **amount always comes from the server** (the booking’s own `Money`), and the idempotency key makes a retried request safe (lesson 20).'],
          path: 'app/Payments/StripeGateway.php',
          code: String.raw`<?php

namespace App\Payments;

use App\Money\Money;
use Stripe\StripeClient;

final readonly class StripeGateway
{
    public function __construct(private StripeClient $stripe)
    {
    }

    /** @return array{id: string, client_secret: string} */
    public function createPaymentIntent(Money $amount, string $idempotencyKey, array $metadata = []): array
    {
        $intent = $this->stripe->paymentIntents->create([
            'amount' => $amount->amount,                       // already in the currency's minor unit (lesson 1)
            'currency' => strtolower($amount->currency->value),
            'automatic_payment_methods' => ['enabled' => true],
            'metadata' => $metadata,
        ], ['idempotency_key' => $idempotencyKey]);

        return ['id' => $intent->id, 'client_secret' => $intent->client_secret];
    }

    public function refund(string $paymentIntentId, Money $amount, string $idempotencyKey): void
    {
        $this->stripe->refunds->create([
            'payment_intent' => $paymentIntentId,
            'amount' => $amount->amount,
        ], ['idempotency_key' => $idempotencyKey]);
    }
}`,
        },
        {
          title: 'One binding, in one place',
          text: [
            '`singleton()` builds the client the first time something needs it and reuses it after. `StripeGateway` needs no binding at all: the container sees its constructor, builds the `StripeClient` from the binding, and passes it in (autowiring).',
            'Bindings go in `register()`. Nothing is resolved there, because other providers may not be registered yet. The `boot()` defaults from [the foundation](F#app-provider) stay as they are; the keys come from [config/services.php](F#services-config).',
          ],
          path: 'app/Providers/AppServiceProvider.php',
          code: String.raw`<?php

namespace App\Providers;

use Illuminate\Support\ServiceProvider;
use Stripe\StripeClient;

class AppServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->app->singleton(StripeClient::class, fn (): StripeClient => new StripeClient([
            'api_key' => config('services.stripe.secret'),
            'stripe_version' => config('services.stripe.version'),
            'max_network_retries' => 2,
        ]));
    }
}`,
        },
        {
          title: 'Consumers declare what they need',
          text: ['The dependency is visible in the constructor. In a test, one call replaces the gateway for everything the container builds. The row goes into [payments](F#table-bookings), whose unique `provider_payment_id` means one Stripe intent can never be recorded twice.'],
          path: 'app/Payments/StartBookingPayment.php',
          code: String.raw`<?php

namespace App\Payments;

use App\Enums\PaymentKind;
use App\Enums\PaymentStatus;
use App\Models\Booking;

final readonly class StartBookingPayment
{
    public function __construct(private StripeGateway $stripe)
    {
    }

    public function handle(Booking $booking): string
    {
        [$deposit] = $booking->total->allocate(30, 70);              // lesson 1

        $intent = $this->stripe->createPaymentIntent(
            $deposit,
            idempotencyKey: "booking-{$booking->id}-deposit",          // the same booking never creates two intents
            metadata: ['booking_id' => $booking->id],
        );

        $booking->payments()->create([
            'kind' => PaymentKind::Deposit,
            'amount_cents' => $deposit->amount,
            'currency' => $deposit->currency->value,
            'status' => PaymentStatus::Pending,
            'provider_payment_id' => $intent['id'],
        ]);

        return $intent['client_secret'];                              // the browser confirms with Stripe Elements
    }
}`,
        },
      ],
    },
  ],
  laravel: {
    text: [
      'The container’s core is two methods. `resolve()` decides **whether** to build (a shared instance may already exist), and `build()` decides **how**: it reflects on the class, reads the constructor, and resolves every parameter the same way, recursively.',
    ],
    blocks: [
      {
        title: 'resolve(): shared instances first',
        path: 'Illuminate/Container/Container.php (simplified)',
        code: String.raw`protected function resolve($abstract, $parameters = [])
{
    if (isset($this->instances[$abstract]) && empty($parameters)) {
        return $this->instances[$abstract];                  // a singleton built earlier
    }

    $concrete = $this->getConcrete($abstract);               // the closure from singleton(), or the class itself

    $object = $this->isBuildable($concrete, $abstract)
        ? $this->build($concrete)
        : $this->make($concrete);

    if ($this->isShared($abstract) && empty($parameters)) {
        $this->instances[$abstract] = $object;               // singleton(): keep it for next time
    }

    $this->fireResolvingCallbacks($abstract, $object);

    return $object;
}`,
      },
      {
        title: 'build(): autowiring with reflection',
        path: 'Illuminate/Container/Container.php (simplified)',
        code: String.raw`public function build($concrete)
{
    if ($concrete instanceof Closure) {
        return $concrete($this, $this->getLastParameterOverride());   // the factory you registered
    }

    $reflector = new ReflectionClass($concrete);

    if (! $reflector->isInstantiable()) {
        throw new BindingResolutionException("Target [$concrete] is not instantiable.");   // an unbound interface
    }

    $constructor = $reflector->getConstructor();
    if ($constructor === null) {
        return new $concrete;
    }

    $instances = $this->resolveDependencies($constructor->getParameters());   // make() for each class-typed parameter

    return $reflector->newInstanceArgs($instances);
}`,
      },
    ],
  },
  topics: {
    blocks: [
      {
        title: 'Binding resolution: the five ways to register',
        table: [
          ['Method', 'Meaning', 'PMS example'],
          ['nothing (autowiring)', 'Concrete classes are built automatically', '`CreateBooking`, `StripeGateway`'],
          ['`bind()`', 'A new instance every time', 'Rarely needed'],
          ['`singleton()`', 'One instance for the whole process', '`StripeClient` (stateless, expensive)'],
          ['`scoped()`', 'One instance per request or job, reset after', 'The current account (below)'],
          ['`instance()`', 'This exact object', 'A fake in a test'],
          ['`when()->needs()->give()`', 'A different dependency for one class', 'A separate Stripe account for payouts'],
        ],
      },
      {
        title: 'Service provider order: register, then boot',
        text: ['Laravel calls `register()` on **every** provider first, then `boot()` on every provider. So `register()` only binds; anything that uses other services (routes, event listeners, `Date::use()`, gates) goes in `boot()`, when all bindings exist. Deferred providers register only when one of their services is first requested.'],
      },
      {
        title: 'Octane: state that leaks between requests',
        text: [
          'Under PHP-FPM every request starts with a fresh app. Under **Octane** the app boots once and serves thousands of requests, so a `singleton()` that holds request data (the current user, the current account) leaks into the next request: account A’s data shown to account B. Stateless services stay `singleton()`; anything per-request becomes `scoped()`, which Octane and the queue worker reset after each request or job.',
        ],
        path: 'app/Accounts/CurrentAccount.php · AppServiceProvider.php', fragment: true,
        code: String.raw`final readonly class CurrentAccount
{
    public function __construct(public ?int $id)
    {
    }
}

public function register(): void
{
    $this->app->scoped(CurrentAccount::class, fn ($app): CurrentAccount => new CurrentAccount(
        $app['request']->user()?->current_account_id,
    ));                                                   // rebuilt for every request and every queued job
}`,
      },
      {
        title: 'PHP-FPM and OPcache',
        text: [
          'PHP-FPM keeps a pool of worker processes; each handles one request at a time and frees everything afterwards (shared-nothing), so memory per request matters more than memory over time. **OPcache** keeps the compiled bytecode of every PHP file in shared memory so files are not parsed on each request. In production `opcache.validate_timestamps=0` (never check files for changes), which is fast but means a deploy must reset OPcache (reload PHP-FPM, or `opcache_reset()`) or the servers keep running the old code.',
        ],
      },
    ],
  },
  whenNot: [
    'Don’t write GoF singletons in a Laravel app. `singleton()` on the container gives one shared instance without the global state.',
    'Don’t bind every class. Autowiring builds concrete classes on its own; bind only interfaces, configured objects and shared instances.',
    'Don’t call `app(SomeService::class)` inside business code. That is a service locator: the same hidden dependency as a static singleton. Ask for it in the constructor.',
    'Never `singleton()` something that holds per-request or per-user data. Use `scoped()`.',
  ],
  tests: {
    summary: 'Replacing the gateway in tests, and the shared-instance guarantees',
    text: ['Because the gateway is injected, tests never reach Stripe. `$this->mock()` builds a Mockery double and registers it with `instance()`.'],
    blocks: [
      {
        path: 'tests/Feature/StartBookingPaymentTest.php',
        code: String.raw`<?php

use App\Models\Booking;
use App\Money\Money;
use App\Payments\StartBookingPayment;
use App\Payments\StripeGateway;
use Stripe\StripeClient;

it('charges a 30% deposit with an idempotency key per booking', function () {
    $booking = Booking::factory()->create(['total_cents' => 45_001, 'currency' => 'EUR']);

    $this->mock(StripeGateway::class)
        ->shouldReceive('createPaymentIntent')
        ->once()
        ->withArgs(fn (Money $amount, string $key) => $amount->amount === 13_501 && $key === "booking-{$booking->id}-deposit")
        ->andReturn(['id' => 'pi_123', 'client_secret' => 'pi_123_secret']);

    $secret = app(StartBookingPayment::class)->handle($booking);

    expect($secret)->toBe('pi_123_secret')
        ->and($booking->payments()->where('provider_payment_id', 'pi_123')->exists())->toBeTrue();
});

it('shares one Stripe client across the app', function () {
    expect(app(StripeClient::class))->toBe(app(StripeClient::class));   // mutation: singleton → bind fails
});

it('builds the current account again for every request', function () {
    $first = app(App\Accounts\CurrentAccount::class);
    app()->forgetScopedInstances();                                     // what Octane does after each request

    expect(app(App\Accounts\CurrentAccount::class))->not->toBe($first);
});`,
      },
    ],
  },
  next: 'Confirming a paid booking takes many steps across many classes. Lesson 4 gives callers one simple door: the Facade pattern, and why Laravel’s "facades" are something else.',
};

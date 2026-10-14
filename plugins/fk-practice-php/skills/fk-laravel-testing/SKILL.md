---
name: fk-laravel-testing
description: Use when writing or fixing Laravel tests with PHPUnit or Pest - test env, factories and states, feature and JSON API tests, Sanctum auth, authorization, fakes for HTTP, mail, queues, storage.
---

# Laravel testing (PHPUnit / Pest)

Use the project's runner (PHPUnit or Pest) consistently. For test-first work OMC's `tdd` workflow drives the cycle. Coverage thresholds are the project's decision (`pest --coverage --min=N` once agreed).

## Setup

- `phpunit.xml` testing env: `APP_ENV=testing`, `BCRYPT_ROUNDS=4`, `CACHE_STORE=array`, `MAIL_MAILER=array`, `QUEUE_CONNECTION=sync`, `SESSION_DRIVER=array`.
- Database: SQLite in-memory is fast but differs from MySQL/Postgres (JSON, constraints, raw SQL); run at least CI against the production engine.
- `RefreshDatabase` (or `LazilyRefreshDatabase`) in every DB test; suites `tests/Unit` and `tests/Feature`.
- Base `TestCase` helpers: `actingAsUser()`, `actingAsAdmin()`.

## Factories

- One factory per model with realistic `fake()` data, a cached hashed password, and states (`admin()`, `unverified()`, `outOfStock()`).
- `create()` to persist, `make()` for in-memory; `count(n)`, `has(...)` for relations, `sequence(...)` for varied rows.
- Override only the attributes a test cares about.

## What to test

| Layer | Cover |
|---|---|
| Models | hidden attributes, casts, scopes, relationships |
| Form requests | each required field and rule (`assertSessionHasErrors([...])` / `assertJsonValidationErrors`) |
| Web controllers | redirects for guests, happy path, `assertDatabaseHas`, forbidden for non-owners |
| JSON APIs | `assertUnauthorized`, `assertOk`/`assertCreated`, `assertJsonStructure`, `assertJsonPath`, `assertJsonCount`, pagination meta |
| Sanctum | register/login token issuance, wrong password -> 422, `withToken($token)` access, token abilities |
| Policies | owner allowed, other user forbidden, admin/super-admin overrides |
| Commands | `artisan('cmd')->expectsOutput(...)->assertExitCode(0)` |

Every write endpoint gets an authorization test with a second user ("attacker") who must receive 403.

## Fakes (mock only boundaries)

- `Http::fake(['api.provider.com/*' => Http::response([...], 200)])`, `Http::sequence()->pushStatus(408)->pushStatus(200)` for retries; `Http::preventStrayRequests()` so unmocked calls fail.
- `Mail::fake()` + `Mail::assertSent(...)`; `Notification::fake()` + `assertSentTo`; `Queue::fake()` + `assertPushed`; `Event::fake()` + `assertDispatched`; `Storage::fake('disk')` + `UploadedFile::fake()->image(...)` + `assertExists`.
- Time: `$this->travel(...)` / `Carbon::setTestNow()`.

## Pest style

```php
uses(RefreshDatabase::class);
beforeEach(fn () => $this->actingAs($this->user = User::factory()->create()));
it('forbids updating another user\'s product', function () {
    $product = Product::factory()->create();
    $this->put(route('products.update', $product), ['name' => 'x'])->assertForbidden();
});
```

## Rules

- Names describe behaviour: `test_guests_cannot_create_products`.
- Independent tests; no reliance on order or leftover rows.
- Do not test framework internals or private methods; do not couple to HTML structure (assert view data or key text).
- `withoutExceptionHandling()` only in tests that need the raw exception, never globally.

## Commands

`php artisan test`, `vendor/bin/phpunit --filter ProductControllerTest`, `vendor/bin/pest --parallel`, coverage with `--coverage` (Xdebug or PCOV enabled).

_Source: adapted from ECC `skills/laravel-tdd` (MIT); see NOTICE.md._

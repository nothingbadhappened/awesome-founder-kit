# Laravel security examples (reference)

Read from `fk-laravel-security` at the step being fixed. Snippets target Laravel 10/11; adjust to the installed version.

## 1. Production configuration

```php
// config/app.php
'debug' => (bool) env('APP_DEBUG', false),

// config/session.php
'secure' => env('SESSION_SECURE_COOKIE', true),
'http_only' => true,
'same_site' => 'lax',

// AppServiceProvider::boot()
if (empty(config('app.key'))) {
    throw new RuntimeException('APP_KEY is not set');
}
if (app()->environment('production')) {
    URL::forceScheme('https');
}
```

Trusted proxies: list your load balancer ranges (e.g. `10.0.0.0/8`), not `*`, so `X-Forwarded-*` cannot be spoofed.

## 2. Authentication

```php
// config/sanctum.php
'expiration' => 60 * 24,   // minutes; null means tokens never expire

$token = $user->createToken('mobile', ['orders:read', 'orders:write'])->plainTextToken;

Route::middleware('auth:sanctum')->group(function () {
    Route::get('/orders', [OrderController::class, 'index'])->middleware('abilities:orders:read');
    Route::post('/orders', [OrderController::class, 'store'])->middleware('abilities:orders:write');
});

// Registration rules
'password' => ['required', 'confirmed', Password::min(12)->letters()->mixedCase()->numbers()->uncompromised()],

// Login / logout
$request->session()->regenerate();
Auth::guard('web')->logout();
$request->session()->invalidate();
$request->session()->regenerateToken();
```

## 3. Authorization

```php
class PostPolicy
{
    public function update(User $user, Post $post): bool { return $user->id === $post->user_id; }
    public function delete(User $user, Post $post): bool { return $user->id === $post->user_id; }
}

// Controller
$this->authorize('update', $post);

// Route
Route::put('/posts/{post}', [PostController::class, 'update'])->middleware('can:update,post');
```

## 4. Eloquent and SQL

```php
protected $fillable = ['name', 'email', 'phone'];          // never role / is_admin
protected $hidden = ['password', 'remember_token', 'two_factor_secret'];
protected $casts = ['password' => 'hashed', 'metadata' => 'encrypted:array'];

User::create($request->validated());

// Safe raw SQL
User::whereRaw('email = ?', [$email])->first();
DB::select('SELECT * FROM users WHERE email = ?', [$email]);

// Sort column from input: allow-list it
$column = in_array($request->sort, ['name', 'created_at'], true) ? $request->sort : 'created_at';
User::orderBy($column)->get();
```

## 5. CSRF and CORS

```blade
<form method="POST" action="/posts">@csrf ...</form>
<meta name="csrf-token" content="{{ csrf_token() }}">
```

```php
// Exclude only signed webhooks
protected $except = ['payments/webhook'];

// config/cors.php
'allowed_origins' => explode(',', env('CORS_ALLOWED_ORIGINS', '')),
'supports_credentials' => true,
```

## 6. XSS and headers

```blade
{{ $user->bio }}                 {{-- escaped --}}
{!! $purifiedHtml !!}            {{-- only after HTMLPurifier with an allow-list --}}
<script>const user = @js($user);</script>
```

```php
$response->headers->set('X-Content-Type-Options', 'nosniff');
$response->headers->set('Referrer-Policy', 'strict-origin-when-cross-origin');
$response->headers->set('Content-Security-Policy', "default-src 'self'; script-src 'self'; frame-ancestors 'none'");
```

## 7. Uploads

```php
'avatar' => ['nullable', 'image', 'mimes:jpg,jpeg,png,webp', 'max:2048',
             'dimensions:min_width=100,min_height=100,max_width=2000,max_height=2000'],
'document' => ['required', 'file', 'mimes:pdf,docx', 'extensions:pdf,docx', 'max:10240'],

$path = $request->file('document')->store('documents', 'local');   // private disk
$this->authorize('download', $document);
return redirect(Storage::temporaryUrl($document->path, now()->addMinutes(15)));
```

## 8. Rate limits and queues

```php
RateLimiter::for('api', fn (Request $r) => Limit::perMinute(60)->by($r->user()?->id ?: $r->ip()));
RateLimiter::for('auth', fn (Request $r) => Limit::perMinute(5)->by($r->ip()));

final class ProcessPaymentJob implements ShouldQueue, ShouldBeEncrypted
{
    public function retryUntil(): DateTime { return now()->addMinutes(5); }
    public function middleware(): array { return [new RateLimited('payments')]; }
}
```

## 9. Security logging

```php
Log::channel('security')->warning('failed_login_attempt', [
    'user_id' => Auth::id(), 'ip' => request()->ip(), 'email_hash' => hash('sha256', $email),
]);
```

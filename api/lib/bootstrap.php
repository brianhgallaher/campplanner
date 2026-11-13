<?php
// Shared setup for the program API: config, database, sessions, auth helpers.
// Compatible with PHP 7.4+.

declare(strict_types=1);

if (!is_file(__DIR__ . '/../config.php')) {
    http_response_code(500);
    header('Content-Type: application/json');
    echo json_encode(['error' => 'Server not configured (api/config.php missing).']);
    exit;
}

$CONFIG = require __DIR__ . '/../config.php';

const SECTIONS = [
    'cubs'      => ['title' => 'Joeys and Cubs', 'meeting' => 'Wednesday 5:00 to 6:30pm'],
    'scouts'    => ['title' => 'Scouts',         'meeting' => 'Tuesday 6:00 to 8:00pm'],
    'venturers' => ['title' => 'Venturers',      'meeting' => 'Wednesday 6:30 to 8:30pm'],
];
const HIGHLIGHTS = ['yellow', 'purple', 'green', 'blue'];
const UPLOAD_DIR = __DIR__ . '/../../uploads/program';
const UPLOAD_URL = 'uploads/program';   // relative to the site root

function config(string $key, $default = null)
{
    global $CONFIG;
    return array_key_exists($key, $CONFIG) ? $CONFIG[$key] : $default;
}

function db(): PDO
{
    static $pdo = null;
    if ($pdo === null) {
        $dsn = sprintf('mysql:host=%s;dbname=%s;charset=utf8mb4', config('db_host'), config('db_name'));
        $pdo = new PDO($dsn, config('db_user'), config('db_pass'), [
            PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES   => false,
        ]);
    }
    return $pdo;
}

function json_out($data, int $status = 200): void
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('X-Content-Type-Options: nosniff');
    echo json_encode($data, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}

function fail(string $message, int $status = 400): void
{
    json_out(['error' => $message], $status);
}

// Turn uncaught errors into a JSON error without leaking details
set_exception_handler(function (Throwable $e) {
    error_log('[program api] ' . $e->getMessage() . ' @ ' . $e->getFile() . ':' . $e->getLine());
    if (!headers_sent()) {
        fail('Something went wrong on the server. Please try again.', 500);
    }
});

// ---------- Sessions ----------

function start_session(): void
{
    if (session_status() === PHP_SESSION_ACTIVE) {
        return;
    }
    $secure = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off');
    session_name('gsg_leaders');
    session_set_cookie_params([
        'lifetime' => 0,
        'path'     => '/',
        'secure'   => $secure,
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
    session_start();
    // Sign leaders out after 8 hours
    if (isset($_SESSION['signed_in_at']) && time() - $_SESSION['signed_in_at'] > 8 * 3600) {
        $_SESSION = [];
        session_regenerate_id(true);
    }
    // Keep the CSRF token available before sign-in too
    if (empty($_SESSION['csrf'])) {
        $_SESSION['csrf'] = bin2hex(random_bytes(32));
    }
}

function csrf_token(): string
{
    start_session();
    if (empty($_SESSION['csrf'])) {
        $_SESSION['csrf'] = bin2hex(random_bytes(32));
    }
    return $_SESSION['csrf'];
}

function require_csrf(): void
{
    $sent = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? '';
    if (!is_string($sent) || !hash_equals(csrf_token(), $sent)) {
        fail('Your session has expired. Please reload the page.', 403);
    }
}

// ---------- Users and permissions ----------

const PASSWORD_MIN = 10;

function user_by_id(int $id): ?array
{
    $stmt = db()->prepare('SELECT * FROM program_users WHERE id = ?');
    $stmt->execute([$id]);
    $user = $stmt->fetch();
    return $user ?: null;
}

function user_by_username(string $username): ?array
{
    $stmt = db()->prepare('SELECT * FROM program_users WHERE username = ?');
    $stmt->execute([strtolower(trim($username))]);
    $user = $stmt->fetch();
    return $user ?: null;
}

// Starts a signed-in session for a leader
function sign_in(array $row): void
{
    start_session();
    session_regenerate_id(true);
    $_SESSION['uid'] = (int) $row['id'];
    $_SESSION['sv'] = (int) $row['session_version'];
    $_SESSION['signed_in_at'] = time();
    unset($_SESSION['csrf']);
}

function sign_out(): void
{
    start_session();
    $_SESSION = [];
    session_regenerate_id(true);
}

// The signed-in leader with resolved permissions, or null.
// A revoked account, or a password reset/change elsewhere, ends the session.
function current_user(): ?array
{
    start_session();
    if (empty($_SESSION['uid'])) {
        return null;
    }
    $row = user_by_id((int) $_SESSION['uid']);
    if (!$row || $row['status'] !== 'active' || (int) $row['session_version'] !== (int) ($_SESSION['sv'] ?? -1)) {
        sign_out();
        return null;
    }
    $admin = (int) $row['is_admin'] === 1;
    // Camp Planner access is separate from program access (managed on campplanner/users.html):
    // campRole none | leader (plans trips) | super (sees all trips, reviews for publishing); campAdmin manages those roles
    $campRole = in_array($row['camp_role'] ?? 'none', ['leader', 'super'], true) ? $row['camp_role'] : 'none';
    return [
        'id'         => (int) $row['id'],
        'username'   => $row['username'],
        'name'       => $row['name'],
        'email'      => $row['email'],
        'isAdmin'    => $admin,
        'mustChange' => (int) $row['must_change'] === 1,
        'sections'   => $admin ? array_keys(SECTIONS) : ($row['sections'] === '' ? [] : explode(',', $row['sections'])),
        'campRole'   => $campRole,
        'campAdmin'  => (int) ($row['camp_admin'] ?? 0) === 1,
        'campEditor' => $campRole !== 'none',      // may plan trips (kept for older pages)
    ];
}

function require_user(): array
{
    $user = current_user();
    if (!$user) {
        fail('Please sign in.', 401);
    }
    if ($user['mustChange']) {
        fail('Please change your temporary password first.', 403);
    }
    return $user;
}

function validate_new_password(string $password, string $username): void
{
    if (mb_strlen($password) < PASSWORD_MIN) {
        fail('Use at least ' . PASSWORD_MIN . ' characters for your password.');
    }
    if (mb_strlen($password) > 200) {
        fail('That password is too long.');
    }
    if (stripos($password, $username) !== false) {
        fail('Your password must not contain your username.');
    }
}

// Readable temporary password for an admin to pass on (no 0/O, 1/l/I)
function temporary_password(): string
{
    $alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
    $out = '';
    for ($i = 0; $i < 14; $i++) {
        $out .= $alphabet[random_int(0, strlen($alphabet) - 1)];
    }
    return $out;
}

function client_ip(): string
{
    return substr((string) ($_SERVER['REMOTE_ADDR'] ?? ''), 0, 45);
}

function require_admin(): array
{
    $user = require_user();
    if (!$user['isAdmin']) {
        fail('Only admins can do that.', 403);
    }
    return $user;
}

function require_section(array $user, string $section): void
{
    if (!isset(SECTIONS[$section])) {
        fail('Unknown section.');
    }
    if (!in_array($section, $user['sections'], true)) {
        fail('You do not have access to the ' . SECTIONS[$section]['title'] . ' program.', 403);
    }
}

// ---------- Program helpers ----------

// Week numbers are calculated, never stored: a weekly meeting is in week
// floor((date - term's week-1 Monday) / 7) + 1. Terms without a week-1 date fall
// back to counting that section's meetings in the term in date order.
// $rows need: id, kind, section, term_id, start_date, week1_start. Returns [id => week].
function meeting_weeks(array $rows, string $section): array
{
    $weeks = [];
    $counters = [];
    usort($rows, function ($a, $b) {
        return [$a['start_date'], (int) $a['id']] <=> [$b['start_date'], (int) $b['id']];
    });
    foreach ($rows as $r) {
        if ($r['kind'] !== 'meeting' || !in_array($section, explode(',', (string) $r['section']), true)) {
            continue;
        }
        if (!empty($r['week1_start'])) {
            $days = (int) floor((strtotime($r['start_date']) - strtotime($r['week1_start'])) / 86400);
            $week = intdiv($days, 7) + 1;
            $weeks[(int) $r['id']] = ($days >= 0 && $week <= 30) ? $week : null;
        } else {
            $key = $r['term_id'];
            $counters[$key] = ($counters[$key] ?? 0) + 1;
            $weeks[(int) $r['id']] = $counters[$key];
        }
    }
    return $weeks;
}

function audit(array $user, string $action, string $entity, ?int $id, $detail = null): void
{
    $stmt = db()->prepare('INSERT INTO program_audit (username, action, entity, entity_id, detail) VALUES (?,?,?,?,?)');
    $stmt->execute([$user['username'], $action, $entity, $id, $detail === null ? null : json_encode($detail, JSON_UNESCAPED_UNICODE)]);
}

// ---------- Input helpers ----------

function body_json(): array
{
    $data = json_decode(file_get_contents('php://input') ?: '', true);
    return is_array($data) ? $data : [];
}

function str_field(array $data, string $key, int $max): string
{
    $value = trim((string) ($data[$key] ?? ''));
    if (mb_strlen($value) > $max) {
        fail("'$key' is too long (max $max characters).");
    }
    return $value;
}

function iso_date(?string $value, string $label, bool $required = true): ?string
{
    $value = trim((string) $value);
    if ($value === '') {
        if ($required) {
            fail("$label is required.");
        }
        return null;
    }
    $d = DateTime::createFromFormat('!Y-m-d', $value);
    if (!$d || $d->format('Y-m-d') !== $value) {
        fail("$label is not a valid date.");
    }
    return $value;
}

// Only http(s) links or links within this site
function clean_link(string $url): ?string
{
    $url = trim($url);
    if ($url === '') {
        return null;
    }
    if (preg_match('~^https?://[^\s"<>]+$~i', $url)) {
        return $url;
    }
    if (preg_match('~^[A-Za-z0-9_\-./#?=&%]+$~', $url) && strpos($url, '//') !== 0 && strpos($url, ':') === false) {
        return $url;
    }
    fail('The link must start with https:// or be a page on this website (e.g. activities/2026/rasoree.html).');
    return null;
}

<?php
// Leader sign-in with a username and password.
//
//   GET  api/auth.php?action=me               -> who is signed in (also returns the CSRF token)
//   POST api/auth.php?action=login            { username, password }
//   POST api/auth.php?action=change_password  { current, password }
//   POST api/auth.php?action=logout
//
// POSTs need the X-CSRF-Token header from ?action=me.

require __DIR__ . '/lib/bootstrap.php';

header('Cache-Control: no-store');
start_session();

const MAX_FAILS_PER_ACCOUNT = 5;    // then the account is locked for LOCK_MINUTES
const MAX_FAILS_PER_IP = 20;        // per 15 minutes, across all usernames
const LOCK_MINUTES = 15;

$action = (string) ($_GET['action'] ?? 'me');
if ($action !== 'me') {
    if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
        fail('Use POST for this action.', 405);
    }
    require_csrf();
}

function record_attempt(string $username, bool $success): void
{
    db()->prepare('INSERT INTO program_login_attempts (ip, username, success) VALUES (?, ?, ?)')
        ->execute([client_ip(), substr($username, 0, 40), $success ? 1 : 0]);
}

switch ($action) {

    case 'login':
        $data = body_json();
        $username = strtolower(trim((string) ($data['username'] ?? '')));
        $password = (string) ($data['password'] ?? '');
        if ($username === '' || $password === '') {
            fail('Enter your username and password.');
        }

        // Slow down guessing from one address
        db()->exec('DELETE FROM program_login_attempts WHERE at < NOW() - INTERVAL 30 DAY');
        $stmt = db()->prepare('SELECT COUNT(*) FROM program_login_attempts WHERE ip = ? AND success = 0 AND at > NOW() - INTERVAL 15 MINUTE');
        $stmt->execute([client_ip()]);
        if ((int) $stmt->fetchColumn() >= MAX_FAILS_PER_IP) {
            fail('Too many failed sign-in attempts. Please wait 15 minutes and try again.', 429);
        }

        $row = user_by_username($username);
        if ($row && $row['locked_until'] && strtotime($row['locked_until']) > time()) {
            record_attempt($username, false);
            fail('This account is locked for ' . LOCK_MINUTES . ' minutes after too many wrong passwords. Try again later or ask an admin to reset it.', 429);
        }

        // Always run a hash check so unknown usernames take the same time
        $hash = $row ? $row['password_hash'] : '$2y$12$LCXipMwIp0b/w4LFPCYvdO9m6QHgd0A0/15NuQUUP09QO6bHjmaq6';
        $ok = password_verify($password, $hash) && $row && $row['status'] === 'active';

        if (!$ok) {
            record_attempt($username, false);
            if ($row) {
                db()->prepare(
                    'UPDATE program_users SET failed_logins = failed_logins + 1,
                            locked_until = IF(failed_logins >= ?, NOW() + INTERVAL ? MINUTE, locked_until)
                      WHERE id = ?'
                )->execute([MAX_FAILS_PER_ACCOUNT, LOCK_MINUTES, $row['id']]);
            }
            fail('That username and password don\'t match.', 401);
        }

        record_attempt($username, true);
        if (password_needs_rehash($row['password_hash'], PASSWORD_DEFAULT)) {
            db()->prepare('UPDATE program_users SET password_hash = ? WHERE id = ?')
                ->execute([password_hash($password, PASSWORD_DEFAULT), $row['id']]);
        }
        db()->prepare('UPDATE program_users SET failed_logins = 0, locked_until = NULL, last_login = NOW() WHERE id = ?')
            ->execute([$row['id']]);
        sign_in($row);
        json_out(['signedIn' => true, 'mustChange' => (int) $row['must_change'] === 1, 'csrf' => csrf_token()]);

    case 'change_password':
        $user = current_user();
        if (!$user) {
            fail('Please sign in.', 401);
        }
        $data = body_json();
        $row = user_by_id($user['id']);
        if (!password_verify((string) ($data['current'] ?? ''), $row['password_hash'])) {
            fail('Your current password is not correct.');
        }
        $new = (string) ($data['password'] ?? '');
        validate_new_password($new, $user['username']);
        if (password_verify($new, $row['password_hash'])) {
            fail('Choose a different password from your current one.');
        }
        db()->prepare('UPDATE program_users SET password_hash = ?, must_change = 0, temp_password = NULL, session_version = session_version + 1 WHERE id = ?')
            ->execute([password_hash($new, PASSWORD_DEFAULT), $user['id']]);
        audit($user, 'password', 'user', $user['id']);
        sign_in(user_by_id($user['id']));   // stay signed in here; other sessions are ended
        json_out(['changed' => true, 'csrf' => csrf_token()]);

    case 'logout':
        sign_out();
        json_out(['signedIn' => false, 'csrf' => csrf_token()]);

    case 'me':
        $user = current_user();
        if (!$user) {
            json_out(['signedIn' => false, 'csrf' => csrf_token()]);
        }
        json_out(['signedIn' => true, 'csrf' => csrf_token(), 'sectionInfo' => SECTIONS, 'passwordMin' => PASSWORD_MIN] + $user);

    default:
        fail('Unknown action.', 404);
}

<?php
// Camp Planner access, managed by Camp Planner admins — separate from program-editor access (api/admin.php).
// Leaders use the same account (username + password) for both; this only sets their Camp Planner role.
//
//   GET  ?action=users                         every leader account with its Camp Planner role
//   POST ?action=save    { id, campRole, campAdmin }        campRole: none | leader | super
//   POST ?action=create  { username, name, email, campRole, campAdmin }  -> temporary password
//                        (a Camp-Planner-only account: no program sections)
//   POST ?action=reset   { id } -> temporary password   (Camp-Planner-only accounts; program admins reset the rest)
//   POST ?action=temp    { id } -> the temporary password of an account that hasn't chosen its own yet
//                        (superusers only; logged). Kept until the leader sets their own password, then erased.

require __DIR__ . '/lib/bootstrap.php';

header('Cache-Control: no-store');

const CAMP_ROLES = ['none', 'leader', 'super'];

$action = (string) ($_GET['action'] ?? '');
$me = require_user();
if (!$me['campAdmin']) {
    fail('Only Camp Planner admins can manage Camp Planner access.', 403);
}
if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'POST') {
    require_csrf();
}

function post_only(): void
{
    if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
        fail('Use POST for this action.', 405);
    }
}

// A Camp-Planner-only account: no program sections and not a program admin
function camp_only(array $u): bool
{
    return $u['sections'] === '' && (int) $u['is_admin'] === 0;
}

function role_of($v): string
{
    $v = (string) $v;
    if (!in_array($v, CAMP_ROLES, true)) {
        fail('Unknown Camp Planner role.');
    }
    return $v;
}

switch ($action) {
    case 'users':
        $counts = [];
        foreach (db()->query("SELECT created_by, COUNT(*) AS n FROM camp_trips GROUP BY created_by") as $r) {
            $counts[$r['created_by']] = (int) $r['n'];
        }
        $rows = db()->query('SELECT * FROM program_users ORDER BY status, name, username')->fetchAll();
        json_out(['users' => array_map(function ($u) use ($counts) {
            return [
                'id'         => (int) $u['id'],
                'username'   => $u['username'],
                'name'       => $u['name'],
                'email'      => $u['email'],
                'campRole'   => in_array($u['camp_role'], CAMP_ROLES, true) ? $u['camp_role'] : 'none',
                'campAdmin'  => (int) $u['camp_admin'] === 1,
                'program'    => (int) $u['is_admin'] === 1 ? 'Program admin' : ($u['sections'] === '' ? '' : 'Program: ' . str_replace(',', ', ', $u['sections'])),
                'campOnly'   => camp_only($u),
                'group'      => $u['group_name'] ?? '',
                'hasTemp'    => (int) $u['must_change'] === 1 && ($u['temp_password'] ?? null) !== null,
                'status'     => $u['status'],
                'mustChange' => (int) $u['must_change'] === 1,
                'lastLogin'  => $u['last_login'],
                'trips'      => $counts[$u['username']] ?? 0,
            ];
        }, $rows)]);

    case 'save':
        post_only();
        $data = body_json();
        $target = user_by_id((int) ($data['id'] ?? 0));
        if (!$target) {
            fail('That leader no longer exists.', 404);
        }
        $role = role_of($data['campRole'] ?? 'none');
        $admin = !empty($data['campAdmin']) ? 1 : 0;
        if ((int) $target['id'] === $me['id'] && !$admin) {
            fail('You cannot remove your own Camp Planner admin access.');
        }
        db()->prepare('UPDATE program_users SET camp_role = ?, camp_admin = ?, camp_editor = ?, updated_by = ? WHERE id = ?')
            ->execute([$role, $admin, $role === 'none' ? 0 : 1, $me['username'], $target['id']]);
        audit($me, 'camp access', 'user', (int) $target['id'], ['username' => $target['username'], 'campRole' => $role, 'campAdmin' => (bool) $admin]);
        json_out(['saved' => true]);

    case 'create':
        post_only();
        $data = body_json();
        $username = strtolower(str_field($data, 'username', 40));
        if (!preg_match('/^[a-z0-9][a-z0-9._-]{2,39}$/', $username)) {
            fail('Usernames are 3-40 characters: letters, numbers, dots, dashes or underscores (e.g. jane.smith).');
        }
        if (user_by_username($username)) {
            fail("The username '$username' is already taken. If they already have a program account, give it Camp Planner access in the list instead.");
        }
        $name = str_field($data, 'name', 120);
        $email = strtolower(str_field($data, 'email', 190));
        if ($email !== '' && !filter_var($email, FILTER_VALIDATE_EMAIL)) {
            fail('That email address does not look right.');
        }
        $role = role_of($data['campRole'] ?? 'leader');
        $admin = !empty($data['campAdmin']) ? 1 : 0;
        if ($role === 'none' && !$admin) {
            fail('Choose a Camp Planner role.');
        }
        $temp = temporary_password();
        db()->prepare(
            "INSERT INTO program_users (username, name, email, group_name, password_hash, temp_password, must_change, sections, is_admin, camp_editor, camp_role, camp_admin, status, updated_by)
             VALUES (?, ?, ?, ?, ?, ?, 1, '', 0, ?, ?, ?, 'active', ?)"
        )->execute([$username, $name, $email ?: null, str_field($data, 'group', 80) ?: null, password_hash($temp, PASSWORD_DEFAULT), $temp, $role === 'none' ? 0 : 1, $role, $admin, $me['username']]);
        $id = (int) db()->lastInsertId();
        audit($me, 'create', 'user', $id, ['username' => $username, 'campRole' => $role, 'campAdmin' => (bool) $admin]);
        json_out(['saved' => true, 'username' => $username, 'temporaryPassword' => $temp]);

    case 'reset':
        post_only();
        $target = user_by_id((int) (body_json()['id'] ?? 0));
        if (!$target) {
            fail('That leader no longer exists.', 404);
        }
        if ((int) $target['id'] === $me['id']) {
            fail('Change your own password on the Leaders page.');
        }
        if (!camp_only($target)) {
            fail('This account is also used for the program editor — ask a program admin to reset its password.', 403);
        }
        $temp = temporary_password();
        db()->prepare(
            'UPDATE program_users SET password_hash = ?, temp_password = ?, must_change = 1, failed_logins = 0, locked_until = NULL,
                    session_version = session_version + 1, updated_by = ? WHERE id = ?'
        )->execute([password_hash($temp, PASSWORD_DEFAULT), $temp, $me['username'], $target['id']]);
        audit($me, 'reset', 'user', (int) $target['id'], ['username' => $target['username']]);
        json_out(['username' => $target['username'], 'temporaryPassword' => $temp]);

    case 'temp':
        post_only();
        if ($me['campRole'] !== 'super' || $me['mustChange']) {
            fail('Only Camp Planner superusers can show temporary passwords.', 403);
        }
        $target = user_by_id((int) (body_json()['id'] ?? 0));
        if (!$target) {
            fail('That leader no longer exists.', 404);
        }
        if ((int) $target['must_change'] !== 1 || ($target['temp_password'] ?? null) === null) {
            fail('This leader has already chosen their own password. Use Reset password if they have forgotten it.');
        }
        audit($me, 'view temp password', 'user', (int) $target['id'], ['username' => $target['username']]);
        json_out(['username' => $target['username'], 'name' => $target['name'], 'temporaryPassword' => $target['temp_password']]);

    default:
        fail('Unknown action.', 404);
}

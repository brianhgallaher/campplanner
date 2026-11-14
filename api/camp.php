<?php
// Camp Planner trips: planning, review and publishing.
//
// Who sees what
//   visitors           published trips that are public (+ private ones they have the link for,
//                      + secret ones they have the link and lock code for)
//   leaders            the same, plus every trip they own or co-plan (any state)
//   superusers         every trip
// Who changes what
//   leaders            create trips; edit trips they own or co-plan
//   superusers         edit any trip; review trips (the author submitting it + 1 superuser's approval publishes a trip;
//                      nobody can approve a trip they own or co-plan)
// Roles are set by Camp Planner admins (api/camp_users.php), separately from program-editor access.
// All writes are POST with an X-CSRF-Token header (get it from auth.php?action=me).
//
//   GET  ?action=list                      summaries of the trips you can see
//   GET  ?action=get&id=<trip id> | &t=<link>   one trip; 423 { locked:true } if a secret trip needs its lock code
//
// Trip ids are random (public_id, e.g. "k7m2xq9wd4ra") so they can't be guessed; the numeric primary key stays
// inside the database. Old numeric ids still work, but only for published public trips (already listed for
// everyone) and for the trip's own leaders / superusers.
//   POST ?action=unlock      { t, code }   unlock a secret trip for this browser session
//   POST ?action=save        { id?, version?, state, meta }  -> { id, version, updated }   (409 on a version clash)
//   POST ?action=delete      { id }                           owner or superuser
//   POST ?action=sharing     { id, visibility, lockCode? }    public | private (link) | secret (link + lock code)
//   POST ?action=new_link    { id }                           new share link (old links stop working)
//   POST ?action=planners    { id, planners[] }               co-planners (owner or superuser)
//   GET  ?action=people                                       leaders who can plan trips (for the co-planner picker)
//   POST ?action=submit      { id }    draft -> in review         (owner / co-planner)
//   POST ?action=withdraw    { id }    in review -> draft         (owner / co-planner)
//   POST ?action=review      { id, decision: approve|changes, comment }   superusers
//   POST ?action=unpublish   { id, comment? }                  published -> draft (owner or superuser)

require __DIR__ . '/lib/bootstrap.php';

header('Cache-Control: no-store');

const CAMP_MAX_BYTES = 4 * 1024 * 1024;
const CAMP_STATUSES = ['planning', 'ready', 'completed', 'archived'];
const VISIBILITIES = ['public', 'private', 'secret'];
const APPROVALS_NEEDED = 1;      // superuser approvals needed after the author submits
const LOCK_MIN = 4;

$action = (string) ($_GET['action'] ?? '');

// ---------- people and permissions ----------

// The signed-in leader (with a usable password), or null
function camp_user(): ?array
{
    $u = current_user();
    return ($u && !$u['mustChange']) ? $u : null;
}

function is_super(?array $u): bool
{
    return $u !== null && $u['campRole'] === 'super';
}

function can_plan(?array $u): bool
{
    return $u !== null && in_array($u['campRole'], ['leader', 'super'], true);
}

function require_planner(): array
{
    $u = current_user();
    if (!$u) {
        fail('Please sign in to change trips.', 401);
    }
    if ($u['mustChange']) {
        fail('Please change your temporary password first (Leaders page).', 403);
    }
    if (!can_plan($u)) {
        fail('Your account can view trips but not plan them. Ask a Camp Planner admin for access.', 403);
    }
    require_csrf();
    return $u;
}

function require_post(): void
{
    if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
        fail('Use POST for this action.', 405);
    }
}

function trip_planners(array $r): array
{
    return $r['planners'] === '' ? [] : explode(',', $r['planners']);
}

// Owner or co-planner (with planning access)
function on_team(?array $u, array $r): bool
{
    return can_plan($u) && ($r['created_by'] === $u['username'] || in_array($u['username'], trip_planners($r), true));
}

function can_edit(?array $u, array $r): bool
{
    return on_team($u, $r) || is_super($u);
}

function is_owner(?array $u, array $r): bool
{
    return can_plan($u) && $r['created_by'] === $u['username'];
}

function unlocked(int $id): bool
{
    start_session();
    return !empty($_SESSION['camp_unlocked'][$id]);
}

function token_ok(array $r, string $token): bool
{
    return $token !== '' && $r['share_token'] !== null && hash_equals((string) $r['share_token'], $token);
}

// May this person see the trip? $token is the share link they came with, if any.
function can_view(?array $u, array $r, string $token): bool
{
    if (can_edit($u, $r)) {
        return true;
    }
    if ($r['pub_status'] !== 'published') {
        return false;
    }
    if ($r['visibility'] === 'public') {
        return true;
    }
    if ($r['visibility'] === 'private') {
        return token_ok($r, $token);
    }
    return token_ok($r, $token) && unlocked((int) $r['id']);
}

// ---------- output ----------

function ms(?string $epoch): int
{
    return (int) $epoch * 1000;
}

// Hide personal details from anyone outside the trip's team and the superusers
function camp_redact(stdClass $s): stdClass
{
    if (isset($s->travel) && is_object($s->travel)) {
        $s->travel->home = null;
        $s->travel->routes = new stdClass();
        if (isset($s->travel->cars) && is_array($s->travel->cars)) {
            foreach ($s->travel->cars as $car) {
                if (is_object($car)) {
                    $car->home = null;
                }
            }
        }
    }
    if (isset($s->emergency) && is_object($s->emergency)) {
        foreach (['contact', 'medical'] as $k) {
            if (isset($s->emergency->$k) && $s->emergency->$k !== '') {
                $s->emergency->$k = '(hidden — only the trip\'s leaders can see this)';
            }
        }
    }
    return $s;
}

// Approvals in each trip's current review round: [tripId => [usernames]]
function approvals_by_trip(): array
{
    $out = [];
    $rows = db()->query(
        "SELECT r.trip_id, r.username FROM camp_reviews r JOIN camp_trips t ON t.id = r.trip_id AND r.round = t.review_round
          WHERE r.decision = 'approve'"
    )->fetchAll();
    foreach ($rows as $r) {
        $out[(int) $r['trip_id']][] = $r['username'];
    }
    return $out;
}

function trip_out(array $r, ?array $u, bool $full, array $approvals): array
{
    $edit = can_edit($u, $r);
    $apr = $approvals[(int) $r['id']] ?? [];
    $out = [
        'id'          => (string) $r['public_id'],
        'meta'        => json_decode($r['meta'], true) ?: [],
        'status'      => $r['status'],
        'created'     => ms($r['created_ts']),
        'updated'     => ms($r['updated_ts']),
        'updatedBy'   => $r['updated_by'],
        'version'     => (int) $r['version'],
        'owner'       => $r['created_by'],
        'ownerName'   => $r['owner_name'] ?? $r['created_by'],
        'planners'    => trip_planners($r),
        'pub'         => $r['pub_status'],
        'visibility'  => $r['visibility'],
        'approvals'   => count($apr),
        'needed'      => APPROVALS_NEEDED,
        'publishedAt' => $r['published_ts'] ? ms($r['published_ts']) : null,
        'changedSincePublished' => $r['pub_status'] === 'published' && $r['published_version'] !== null
                                   && (int) $r['version'] > (int) $r['published_version'],
        'canEdit'     => $edit,
        'team'        => on_team($u, $r),
        'isOwner'     => is_owner($u, $r),
        'canReview'   => is_super($u) && !on_team($u, $r) && $r['pub_status'] === 'review',
        'iApproved'   => $u !== null && in_array($u['username'], $apr, true),
    ];
    if ($edit) {
        $out['shareToken'] = $r['share_token'];
        $out['hasLock'] = $r['lock_hash'] !== null;
    }
    if ($full) {
        // Decode to objects (not arrays) so empty {} stay {} when sent back out
        $state = json_decode($r['state']);
        $out['state'] = ($state instanceof stdClass && !$edit) ? camp_redact($state) : $state;
    }
    return $out;
}

function history(int $id): array
{
    $stmt = db()->prepare(
        'SELECT r.round, r.username, COALESCE(u.name, r.username) AS name, r.decision, r.comment, UNIX_TIMESTAMP(r.at) AS ts
           FROM camp_reviews r LEFT JOIN program_users u ON u.username = r.username WHERE r.trip_id = ? ORDER BY r.id'
    );
    $stmt->execute([$id]);
    return array_map(function ($h) {
        return ['round' => (int) $h['round'], 'username' => $h['username'], 'name' => $h['name'] ?: $h['username'],
                'decision' => $h['decision'], 'comment' => $h['comment'], 'at' => ms($h['ts'])];
    }, $stmt->fetchAll());
}

// The trip's activity log: what its leaders, group leaders and participants did (program_audit rows for the trip; see
// reg_log() in rego.php). Holds group names and counts only, never personal details. Newest first.
function activity(int $id, int $limit = 200): array
{
    $stmt = db()->prepare(
        "SELECT a.username, COALESCE(u.name, a.username) AS name, a.action, a.detail, UNIX_TIMESTAMP(a.at) AS ts
           FROM program_audit a LEFT JOIN program_users u ON u.username = a.username
          WHERE a.entity IN ('trip', 'camp_trip') AND a.entity_id = ? ORDER BY a.id DESC LIMIT " . (int) $limit
    );
    $stmt->execute([$id]);
    return array_map(function ($h) {
        $d = json_decode((string) $h['detail'], true);
        foreach (['promote', 'demote'] as $k) {      // older entries listed ids: show a count
            if (is_array($d) && is_array($d[$k] ?? null)) {
                $d[$k] = count($d[$k]);
            }
        }
        return ['username' => $h['username'], 'name' => $h['name'] ?: $h['username'], 'action' => $h['action'],
                'detail' => is_array($d) ? $d : new stdClass(), 'at' => ms($h['ts'])];
    }, $stmt->fetchAll());
}

function iso_or_null($v): ?string
{
    $v = is_string($v) ? trim($v) : '';
    return preg_match('/^\d{4}-\d{2}-\d{2}$/', $v) && strtotime($v) !== false ? $v : null;
}

const TRIP_COLUMNS = 't.id, t.public_id, t.name, t.status, t.version, t.meta, t.updated_by, t.created_by, t.planners, t.pub_status, t.visibility,
    t.share_token, t.lock_hash, t.review_round, t.published_version, UNIX_TIMESTAMP(t.published_at) AS published_ts,
    UNIX_TIMESTAMP(t.created_at) AS created_ts, UNIX_TIMESTAMP(t.updated_at) AS updated_ts, COALESCE(u.name, t.created_by) AS owner_name';
const TRIP_FROM = 'FROM camp_trips t LEFT JOIN program_users u ON u.username = t.created_by';

function find_trip(int $id, bool $withState = false): array
{
    $stmt = db()->prepare('SELECT ' . TRIP_COLUMNS . ($withState ? ', t.state ' : ' ') . TRIP_FROM . ' WHERE t.id = ?');
    $stmt->execute([$id]);
    $r = $stmt->fetch();
    if (!$r) {
        fail('That trip no longer exists.', 404);
    }
    return $r;
}

// Where a trip's pin goes on the trip map: the camp location, else where its first trail starts
function pin_of($s): array
{
    $t = isset($s->trip) && is_object($s->trip) ? $s->trip : null;
    if ($t && is_numeric($t->lat ?? null) && is_numeric($t->lon ?? null)) {
        return [round((float) $t->lat, 3), round((float) $t->lon, 3)];
    }
    foreach ((isset($s->map->features) && is_array($s->map->features)) ? $s->map->features : [] as $f) {
        if (is_object($f) && ($f->type ?? '') === 'trail' && !empty($f->coords[0]) && is_numeric($f->coords[0][0] ?? null)) {
            return [round((float) $f->coords[0][0], 3), round((float) $f->coords[0][1], 3)];
        }
    }
    return [null, null];
}

// Trips saved before pins existed: work the pin out from the plan once, without touching version / updated time
function fill_pins(array &$rows): void
{
    foreach ($rows as &$r) {
        $meta = json_decode($r['meta'], true) ?: [];
        if (array_key_exists('lat', $meta)) {
            continue;
        }
        $st = db()->prepare('SELECT state FROM camp_trips WHERE id = ?');
        $st->execute([$r['id']]);
        [$meta['lat'], $meta['lon']] = pin_of(json_decode((string) $st->fetchColumn()));
        $r['meta'] = json_encode($meta, JSON_UNESCAPED_UNICODE);
        db()->prepare('UPDATE camp_trips SET meta = ?, updated_at = updated_at WHERE id = ?')->execute([$r['meta'], $r['id']]);
    }
    unset($r);
}

// Look up a trip by the id the browser sent (random public id; old numeric ids only where they reveal nothing)
function ref_trip($ref, bool $withState = false): array
{
    $ref = trim((string) $ref);
    $miss = 'That trip doesn\'t exist or isn\'t shared with you.';
    if (preg_match('/^[a-z0-9]{8,16}$/', $ref) && !ctype_digit($ref)) {
        $stmt = db()->prepare('SELECT ' . TRIP_COLUMNS . ($withState ? ', t.state ' : ' ') . TRIP_FROM . ' WHERE t.public_id = ?');
        $stmt->execute([$ref]);
        $r = $stmt->fetch();
        if (!$r) {
            fail($miss, 404);
        }
        return $r;
    }
    if (ctype_digit($ref) && $ref !== '') {
        $stmt = db()->prepare('SELECT ' . TRIP_COLUMNS . ($withState ? ', t.state ' : ' ') . TRIP_FROM . ' WHERE t.id = ?');
        $stmt->execute([(int) $ref]);
        $r = $stmt->fetch();
        if ($r && (($r['pub_status'] === 'published' && $r['visibility'] === 'public') || can_edit(camp_user(), $r))) {
            return $r;
        }
    }
    fail($miss, 404);
    return [];
}

// 12 random characters, no look-alikes (0/o, 1/l)
function new_public_id(): string
{
    $alphabet = 'abcdefghijkmnpqrstuvwxyz23456789';
    do {
        $id = '';
        for ($i = 0; $i < 12; $i++) {
            $id .= $alphabet[random_int(0, strlen($alphabet) - 1)];
        }
    } while (ctype_digit($id));
    return $id;
}

function new_token(): string
{
    return rtrim(strtr(base64_encode(random_bytes(18)), '+/', '-_'), '=');
}

function log_review(int $id, int $round, array $u, string $decision, string $comment = ''): void
{
    db()->prepare('INSERT INTO camp_reviews (trip_id, round, username, decision, comment) VALUES (?, ?, ?, ?, ?)')
        ->execute([$id, $round, $u['username'], $decision, mb_substr($comment, 0, 1000)]);
}

function trip_reply(int $id, ?array $u): void
{
    $r = find_trip($id);
    json_out(['trip' => trip_out($r, $u, false, approvals_by_trip()), 'history' => history($id)]);
}

// ---------- actions ----------

switch ($action) {
    case 'list':
        $u = camp_user();
        try {
            reg_purge(3600);        // registrations go 30 days after a trip, even if nobody opens a registration page (at most hourly here)
        } catch (Throwable $e) {
            // never stops the list
        }
        $rows = db()->query('SELECT ' . TRIP_COLUMNS . ' ' . TRIP_FROM . ' ORDER BY t.start_date, t.id')->fetchAll();
        fill_pins($rows);
        $apr = approvals_by_trip();
        $out = [];
        foreach ($rows as $r) {
            $listed = is_super($u) || on_team($u, $r) || ($r['pub_status'] === 'published' && $r['visibility'] === 'public');
            if ($listed) {
                $out[] = trip_out($r, $u, false, $apr);
            }
        }
        json_out(['trips' => $out, 'role' => $u ? $u['campRole'] : 'none']);

    case 'get':
        $u = camp_user();
        $token = (string) ($_GET['t'] ?? '');
        if ($token !== '') {
            $stmt = db()->prepare('SELECT ' . TRIP_COLUMNS . ', t.state ' . TRIP_FROM . ' WHERE t.share_token = ?');
            $stmt->execute([$token]);
            $r = $stmt->fetch();
        } else {
            $r = ref_trip($_GET['id'] ?? '', true);
        }
        if (!$r) {
            fail('That trip doesn\'t exist, or the link has been changed.', 404);
        }
        if (!can_view($u, $r, $token)) {
            if ($r['pub_status'] === 'published' && $r['visibility'] === 'secret' && token_ok($r, $token)) {
                json_out(['error' => 'This trip is locked. Enter its lock code.', 'locked' => true], 423);
            }
            if ($r['pub_status'] !== 'published' && ($r['visibility'] === 'public' || token_ok($r, $token))) {
                fail('This trip hasn\'t been approved for publishing yet.' . ($u ? '' : ' Its leaders can sign in to see it.'), 403);
            }
            fail('That trip doesn\'t exist or isn\'t shared with you.' . ($u ? '' : ' Leaders: sign in to see your trips.'), 404);
        }
        $out = ['trip' => trip_out($r, $u, true, approvals_by_trip())];
        if (can_edit($u, $r) || is_super($u)) {
            $out['history'] = history((int) $r['id']);
        }
        json_out($out);

    case 'unlock':
        require_post();
        require_csrf();
        $data = body_json();
        $token = (string) ($data['t'] ?? '');
        $code = (string) ($data['code'] ?? '');
        $ip = client_ip();
        // At most 8 wrong codes per trip, or 25 overall, from one address in 15 minutes
        $stmt = db()->prepare(
            "SELECT SUM(username = ?) AS this_trip, COUNT(*) AS any_trip FROM program_login_attempts
              WHERE ip = ? AND success = 0 AND username LIKE 'trip:%' AND at > NOW() - INTERVAL 15 MINUTE"
        );
        $stmt->execute(['trip:' . substr($token, 0, 30), $ip]);
        $tries = $stmt->fetch();
        if ((int) $tries['this_trip'] >= 8 || (int) $tries['any_trip'] >= 25) {
            fail('Too many wrong lock codes. Wait 15 minutes and try again.', 429);
        }
        $stmt = db()->prepare('SELECT id, public_id, lock_hash, visibility, pub_status FROM camp_trips WHERE share_token = ?');
        $stmt->execute([$token]);
        $r = $stmt->fetch();
        $good = $r && $r['visibility'] === 'secret' && $r['lock_hash'] && password_verify($code, $r['lock_hash']);
        db()->prepare('INSERT INTO program_login_attempts (ip, username, success) VALUES (?, ?, ?)')
            ->execute([$ip, 'trip:' . substr($token, 0, 30), $good ? 1 : 0]);
        if (!$good) {
            fail('That lock code isn\'t right.', 403);
        }
        start_session();
        $_SESSION['camp_unlocked'][(int) $r['id']] = true;
        json_out(['unlocked' => (string) $r['public_id']]);

    case 'save':
        require_post();
        $user = require_planner();
        $raw = file_get_contents('php://input') ?: '';
        if (strlen($raw) > CAMP_MAX_BYTES) {
            fail('This trip is too big to save (over 4 MB). Remove some imported GPX tracks and try again.', 413);
        }
        $body = json_decode($raw);
        if (!($body instanceof stdClass) || !isset($body->state) || !($body->state instanceof stdClass)
            || !isset($body->state->trip) || !($body->state->trip instanceof stdClass) || !isset($body->state->people)) {
            fail('That is not a Camp Planner trip.');
        }
        $s = $body->state;
        $name = mb_substr(trim((string) ($s->trip->name ?? '')), 0, 200) ?: 'Untitled trip';
        $status = in_array($s->trip->status ?? '', CAMP_STATUSES, true) ? $s->trip->status : 'planning';
        $start = iso_or_null($s->trip->start ?? null);
        $end = iso_or_null($s->trip->end ?? null);
        $example = !empty($s->trip->example) ? 1 : 0;
        $metaObj = isset($body->meta) && $body->meta instanceof stdClass ? $body->meta : new stdClass();
        [$metaObj->lat, $metaObj->lon] = pin_of($s);          // the pin comes from the plan itself
        $meta = json_encode($metaObj, JSON_UNESCAPED_UNICODE);
        $state = json_encode($s, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        if ($state === false || $meta === false || strlen($meta) > 8000) {
            fail('That trip could not be read.');
        }
        $ref = trim((string) ($body->id ?? ''));
        $pdo = db();

        if ($ref === '') {
            // New trips start as drafts owned by whoever made them
            $pdo->prepare(
                'INSERT INTO camp_trips (public_id, name, status, start_date, end_date, is_example, meta, state, created_by, updated_by, share_token)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
            )->execute([$publicId = new_public_id(), $name, $status, $start, $end, $example, $meta, $state, $user['username'], $user['username'], new_token()]);
            $id = (int) $pdo->lastInsertId();
            audit($user, 'create', 'trip', $id, ['name' => $name]);
            $version = 1;
        } else {
            $row = ref_trip($ref);
            $id = (int) $row['id'];
            $publicId = $row['public_id'];
            if (!can_edit($user, $row)) {
                fail('Only this trip\'s leaders (owner and co-planners) or a superuser can change it.', 403);
            }
            $version = (int) ($body->version ?? 0);
            $stmt = $pdo->prepare(
                'UPDATE camp_trips SET name = ?, status = ?, start_date = ?, end_date = ?, is_example = ?, meta = ?, state = ?,
                        version = version + 1, updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND version = ?'
            );
            $stmt->execute([$name, $status, $start, $end, $example, $meta, $state, $user['username'], $id, $version]);
            if ($stmt->rowCount() === 0) {
                $cur = $pdo->prepare('SELECT version, updated_by FROM camp_trips WHERE id = ?');
                $cur->execute([$id]);
                $now = $cur->fetch();
                if (!$now) {
                    fail('That trip has been deleted.', 404);
                }
                json_out(['error' => 'Someone else (' . $now['updated_by'] . ') changed this trip while you were editing it.',
                          'conflict' => true, 'updatedBy' => $now['updated_by']], 409);
            }
            $version++;
            // Autosave runs often: log a trip edit at most once per editor per half hour
            $recent = $pdo->prepare(
                "SELECT 1 FROM program_audit WHERE entity = 'trip' AND entity_id = ? AND username = ?
                   AND action = 'update' AND at > NOW() - INTERVAL 30 MINUTE LIMIT 1"
            );
            $recent->execute([$id, $user['username']]);
            if (!$recent->fetch()) {
                audit($user, 'update', 'trip', $id, ['name' => $name]);
            }
        }
        $t = $pdo->prepare('SELECT UNIX_TIMESTAMP(updated_at) FROM camp_trips WHERE id = ?');
        $t->execute([$id]);
        json_out(['id' => (string) $publicId, 'version' => $version, 'updated' => ms($t->fetchColumn())]);

    case 'delete':
        require_post();
        $user = require_planner();
        $row = ref_trip(body_json()['id'] ?? '');
        $id = (int) $row['id'];
        if (!is_owner($user, $row) && !is_super($user)) {
            fail('Only the trip\'s owner or a superuser can delete it.', 403);
        }
        db()->prepare('DELETE FROM camp_reviews WHERE trip_id = ?')->execute([$id]);
        db()->prepare('DELETE FROM camp_positions WHERE trip_id = ?')->execute([$id]);
        db()->prepare('DELETE FROM camp_devices WHERE trip_id = ?')->execute([$id]);
        db()->prepare('DELETE FROM camp_trackers WHERE trip_id = ?')->execute([$id]);
        db()->prepare('DELETE FROM camp_trips WHERE id = ?')->execute([$id]);
        audit($user, 'delete', 'trip', $id, ['name' => $row['name']]);
        json_out(['deleted' => (string) $row['public_id']]);

    case 'sharing':
        require_post();
        $user = require_planner();
        $data = body_json();
        $row = ref_trip($data['id'] ?? '');
        $id = (int) $row['id'];
        if (!can_edit($user, $row)) {
            fail('Only this trip\'s leaders or a superuser can change who can see it.', 403);
        }
        $vis = (string) ($data['visibility'] ?? '');
        if (!in_array($vis, VISIBILITIES, true)) {
            fail('Choose public, private or secret.');
        }
        $code = trim((string) ($data['lockCode'] ?? ''));
        $hash = $row['lock_hash'];
        if ($vis === 'secret') {
            if ($code !== '') {
                if (mb_strlen($code) < LOCK_MIN || mb_strlen($code) > 40) {
                    fail('Use a lock code of ' . LOCK_MIN . ' to 40 characters.');
                }
                $hash = password_hash($code, PASSWORD_DEFAULT);
            } elseif ($hash === null) {
                fail('Set a lock code for a secret trip.');
            }
        } else {
            $hash = null;
        }
        db()->prepare('UPDATE camp_trips SET visibility = ?, lock_hash = ?, share_token = COALESCE(share_token, ?) WHERE id = ?')
            ->execute([$vis, $hash, new_token(), $id]);
        audit($user, 'sharing', 'trip', $id, ['visibility' => $vis, 'lockChanged' => $code !== '']);
        trip_reply($id, $user);

    case 'new_link':
        require_post();
        $user = require_planner();
        $row = ref_trip(body_json()['id'] ?? '');
        $id = (int) $row['id'];
        if (!can_edit($user, $row)) {
            fail('Only this trip\'s leaders or a superuser can change its link.', 403);
        }
        db()->prepare('UPDATE camp_trips SET share_token = ? WHERE id = ?')->execute([new_token(), $id]);
        audit($user, 'new link', 'trip', $id);
        trip_reply($id, $user);

    case 'activity':
        $u = camp_user();
        $r = ref_trip($_GET['id'] ?? '');
        if (!$u || !(can_edit($u, $r) || is_super($u))) {
            fail('Only this trip\'s leaders and superusers can see its activity log.', 403);
        }
        json_out(['activity' => activity((int) $r['id'])]);

    case 'people':
        $u = camp_user();
        if (!can_plan($u)) {
            fail('Please sign in as a Camp Planner leader.', 401);
        }
        $rows = db()->query("SELECT username, name, camp_role FROM program_users WHERE status = 'active' AND camp_role IN ('leader','super') ORDER BY name, username")->fetchAll();
        json_out(['people' => array_map(function ($p) {
            return ['username' => $p['username'], 'name' => $p['name'] ?: $p['username'], 'role' => $p['camp_role']];
        }, $rows)]);

    case 'planners':
        require_post();
        $user = require_planner();
        $data = body_json();
        $row = ref_trip($data['id'] ?? '');
        $id = (int) $row['id'];
        if (!is_owner($user, $row) && !is_super($user)) {
            fail('Only the trip\'s owner or a superuser can choose its co-planners.', 403);
        }
        $want = array_values(array_unique(array_map(function ($x) { return strtolower(trim((string) $x)); }, (array) ($data['planners'] ?? []))));
        $ok = [];
        if ($want) {
            $in = implode(',', array_fill(0, count($want), '?'));
            $stmt = db()->prepare("SELECT username FROM program_users WHERE status = 'active' AND camp_role IN ('leader','super') AND username IN ($in)");
            $stmt->execute($want);
            $ok = array_values(array_diff($stmt->fetchAll(PDO::FETCH_COLUMN), [$row['created_by']]));
        }
        if (strlen(implode(',', $ok)) > 500) {
            fail('Too many co-planners.');
        }
        db()->prepare('UPDATE camp_trips SET planners = ? WHERE id = ?')->execute([implode(',', $ok), $id]);
        audit($user, 'planners', 'trip', $id, ['planners' => $ok]);
        trip_reply($id, $user);

    case 'submit':
        require_post();
        $user = require_planner();
        $row = ref_trip(body_json()['id'] ?? '');
        $id = (int) $row['id'];
        if (!on_team($user, $row)) {
            fail('Only the trip\'s owner or co-planners can submit it for review.', 403);
        }
        if ($row['pub_status'] !== 'draft') {
            fail($row['pub_status'] === 'review' ? 'This trip is already waiting for review.' : 'This trip is already published.');
        }
        $round = (int) $row['review_round'] + 1;
        db()->prepare("UPDATE camp_trips SET pub_status = 'review', review_round = ? WHERE id = ?")->execute([$round, $id]);
        log_review($id, $round, $user, 'submit', (string) (body_json()['comment'] ?? ''));
        audit($user, 'submit', 'trip', $id, ['name' => $row['name']]);
        trip_reply($id, $user);

    case 'withdraw':
        require_post();
        $user = require_planner();
        $row = ref_trip(body_json()['id'] ?? '');
        $id = (int) $row['id'];
        if (!on_team($user, $row)) {
            fail('Only the trip\'s owner or co-planners can withdraw it.', 403);
        }
        if ($row['pub_status'] !== 'review') {
            fail('This trip isn\'t waiting for review.');
        }
        db()->prepare("UPDATE camp_trips SET pub_status = 'draft' WHERE id = ?")->execute([$id]);
        log_review($id, (int) $row['review_round'], $user, 'withdraw');
        audit($user, 'withdraw', 'trip', $id, ['name' => $row['name']]);
        trip_reply($id, $user);

    case 'review':
        require_post();
        $user = require_planner();
        if (!is_super($user)) {
            fail('Only superusers can review trips.', 403);
        }
        $data = body_json();
        $row = ref_trip($data['id'] ?? '');
        $id = (int) $row['id'];
        if (on_team($user, $row)) {
            fail('You can\'t review a trip you own or co-plan — another superuser needs to review it.', 403);
        }
        if ($row['pub_status'] !== 'review') {
            fail('This trip isn\'t waiting for review.');
        }
        $decision = (string) ($data['decision'] ?? '');
        $comment = trim((string) ($data['comment'] ?? ''));
        $round = (int) $row['review_round'];
        if ($decision === 'changes') {
            if ($comment === '') {
                fail('Say what needs changing.');
            }
            db()->prepare("UPDATE camp_trips SET pub_status = 'draft' WHERE id = ?")->execute([$id]);
            log_review($id, $round, $user, 'changes', $comment);
            audit($user, 'request changes', 'trip', $id, ['name' => $row['name']]);
            trip_reply($id, $user);
        }
        if ($decision !== 'approve') {
            fail('Approve, or ask for changes.');
        }
        $have = approvals_by_trip()[$id] ?? [];
        if (in_array($user['username'], $have, true)) {
            fail('You have already approved this trip.');
        }
        log_review($id, $round, $user, 'approve', $comment);
        audit($user, 'approve', 'trip', $id, ['name' => $row['name']]);
        if (count($have) + 1 >= APPROVALS_NEEDED) {
            db()->prepare("UPDATE camp_trips SET pub_status = 'published', published_at = NOW(), published_version = version WHERE id = ?")->execute([$id]);
            log_review($id, $round, $user, 'published');
            audit($user, 'publish', 'trip', $id, ['name' => $row['name']]);
        }
        trip_reply($id, $user);

    case 'unpublish':
        require_post();
        $user = require_planner();
        $data = body_json();
        $row = ref_trip($data['id'] ?? '');
        $id = (int) $row['id'];
        if (!is_owner($user, $row) && !is_super($user)) {
            fail('Only the trip\'s owner or a superuser can unpublish it.', 403);
        }
        if ($row['pub_status'] !== 'published') {
            fail('This trip isn\'t published.');
        }
        db()->prepare("UPDATE camp_trips SET pub_status = 'draft' WHERE id = ?")->execute([$id]);
        log_review($id, (int) $row['review_round'], $user, 'unpublish', trim((string) ($data['comment'] ?? '')));
        audit($user, 'unpublish', 'trip', $id, ['name' => $row['name']]);
        trip_reply($id, $user);

    default:
        fail('Unknown action.', 404);
}

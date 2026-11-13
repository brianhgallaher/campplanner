<?php
// Camp Planner phone app: the offline "field pack" of a trip, and live location sharing.
//
// Phones join a trip with its join code (no account needed, so youth-only camps work) and get a device token.
// Who sees locations: superusers, the trip's owner and its co-planners. Nobody else.
// Positions are deleted a year after they were recorded.
//
// Phones (token in the JSON body or ?token=):
//   POST ?action=join     { code, name }            -> { token, device, trip: { id, name } }
//   GET  ?action=pack&token=…                       -> { pack, updated }   the plan to keep on the phone
//   POST ?action=report   { token, points: [{ t, lat, lon, acc?, alt?, spd?, batt? }] }  (t = Unix seconds)
//   POST ?action=say      { token, status: ok|stopped|problem|contact, note?, message?, t? }   the phone's status and a one-line message
//   POST ?action=leave    { token }                 stop sharing and forget this phone
// The trip's team (signed in; POSTs need X-CSRF-Token):
//   GET  ?action=status&id=<trip>                   join code, devices, pack time, position count
//   POST ?action=code     { id, on: bool }          make a new join code / switch joining off
//   POST ?action=pack_save { id, pack }             store the field pack built by the planner
//   GET  ?action=live&id=<trip>[&since=<unix>]      devices with their latest position and recent trail
//   GET  ?action=export&id=<trip>                   every position (for GPX / review)
//   POST ?action=device   { id, device, revoke: bool | name }
//   POST ?action=clear    { id }                    delete this trip's positions
//   POST ?action=tracker_add    { id, kind: spot|garmin, label, feed, pass?, from, to }   add a satellite tracker for the event (and test it)
//   POST ?action=tracker_test   { id, tracker }     read its feed now
//   POST ?action=tracker_remove { id, tracker }

require __DIR__ . '/lib/bootstrap.php';

header('Cache-Control: no-store');

const KEEP_DAYS = 365;
const PACK_MAX = 3 * 1024 * 1024;
const POINTS_MAX = 500;        // per report
const DEVICES_MAX = 60;        // per trip

$action = (string) ($_GET['action'] ?? '');
$isPost = ($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'POST';

function need_post(): void
{
    if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
        fail('Use POST for this action.', 405);
    }
}

// ---------- the trip's team ----------

function trip_by_ref($ref): array
{
    $ref = trim((string) $ref);
    $stmt = db()->prepare('SELECT id, public_id, name, created_by, planners, join_code, UNIX_TIMESTAMP(pack_at) AS pack_ts FROM camp_trips WHERE public_id = ?');
    $stmt->execute([$ref]);
    $r = $stmt->fetch();
    if (!$r) {
        fail('That trip doesn\'t exist.', 404);
    }
    return $r;
}

// Superusers, the trip's owner and its co-planners
function require_team($ref, bool $write = false): array
{
    $u = current_user();
    if (!$u) {
        fail('Please sign in.', 401);
    }
    if ($u['mustChange']) {
        fail('Please change your temporary password first.', 403);
    }
    $t = trip_by_ref($ref);
    $planner = in_array($u['campRole'], ['leader', 'super'], true);
    $team = $planner && ($t['created_by'] === $u['username'] || in_array($u['username'], $t['planners'] === '' ? [] : explode(',', $t['planners']), true));
    if (!$team && $u['campRole'] !== 'super') {
        fail('Only this trip\'s leaders and superusers can see its live locations.', 403);
    }
    if ($write) {
        require_csrf();
    }
    return [$t, $u];
}

function new_code(): string
{
    $alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';     // no 0/O, 1/I
    $out = '';
    for ($i = 0; $i < 8; $i++) {
        $out .= $alphabet[random_int(0, strlen($alphabet) - 1)];
    }
    return $out;
}

// ---------- phones ----------

function device_by_token($token): array
{
    $token = (string) $token;
    if (strlen($token) < 20) {
        fail('This phone isn\'t joined to a trip.', 401);
    }
    $stmt = db()->prepare(
        'SELECT d.id, d.trip_id, d.name, d.revoked, t.public_id, t.name AS trip_name FROM camp_devices d JOIN camp_trips t ON t.id = d.trip_id WHERE d.token_hash = ?'
    );
    $stmt->execute([hash('sha256', $token)]);
    $d = $stmt->fetch();
    if (!$d || (int) $d['revoked'] === 1) {
        fail('This phone is no longer joined to the trip. Join again with the trip\'s code.', 401);
    }
    return $d;
}

function num_or_null($v, float $lo, float $hi)
{
    return is_numeric($v) && $v >= $lo && $v <= $hi ? $v + 0 : null;
}

function device_rows(int $tripId): array
{
    $stmt = db()->prepare(
        'SELECT d.id, d.name, d.revoked, UNIX_TIMESTAMP(d.created_at) AS joined, UNIX_TIMESTAMP(d.last_seen) AS seen,
                d.status, d.status_note, d.message, UNIX_TIMESTAMP(d.status_at) AS status_ts,
                (SELECT COUNT(*) FROM camp_positions p WHERE p.device_id = d.id) AS points
           FROM camp_devices d WHERE d.trip_id = ? ORDER BY d.name, d.id'
    );
    $stmt->execute([$tripId]);
    return array_map(function ($d) {
        return ['id' => (int) $d['id'], 'name' => $d['name'], 'revoked' => (int) $d['revoked'] === 1,
                'joined' => (int) $d['joined'], 'seen' => $d['seen'] === null ? null : (int) $d['seen'], 'points' => (int) $d['points'],
                'status' => $d['status'], 'note' => $d['status_note'], 'message' => $d['message'], 'statusAt' => $d['status_ts'] === null ? null : (int) $d['status_ts']];
    }, $stmt->fetchAll());
}

function point_out(array $p): array
{
    return ['t' => (int) $p['ts'], 'lat' => (float) $p['lat'], 'lon' => (float) $p['lon'],
            'acc' => $p['acc'] === null ? null : (int) $p['acc'], 'alt' => $p['alt'] === null ? null : (int) $p['alt'],
            'spd' => $p['spd'] === null ? null : (float) $p['spd'], 'batt' => $p['batt'] === null ? null : (int) $p['batt']];
}

// ---------- satellite trackers (SPOT, Garmin inReach) ----------
// A tracker is added to a trip for the event (feed id / MapShare name), read only inside its tracking window,
// and its positions are stored like a phone's. Feeds are read when a leader has the live map open, at most
// every 3 minutes per tracker (SPOT asks for 2.5 minutes or more between requests).

const TRACKER_EVERY = 180;

function http_get(string $url, ?string $basicPass = null): array
{
    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_FOLLOWLOCATION => true, CURLOPT_MAXREDIRS => 3, CURLOPT_TIMEOUT => 12,
            CURLOPT_CONNECTTIMEOUT => 6, CURLOPT_USERAGENT => 'GraftonScoutGroup-CampPlanner/1.0']);
        if ($basicPass !== null && $basicPass !== '') {
            curl_setopt($ch, CURLOPT_USERPWD, ':' . $basicPass);
        }
        $body = curl_exec($ch);
        $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $final = (string) curl_getinfo($ch, CURLINFO_EFFECTIVE_URL);
        curl_close($ch);
        return [$code, $body === false ? '' : (string) $body, $final];
    }
    $headers = "User-Agent: GraftonScoutGroup-CampPlanner/1.0\r\n" . ($basicPass ? 'Authorization: Basic ' . base64_encode(':' . $basicPass) . "\r\n" : '');
    $body = @file_get_contents($url, false, stream_context_create(['http' => ['timeout' => 12, 'header' => $headers, 'ignore_errors' => true]]));
    $code = 0;
    if (isset($http_response_header[0]) && preg_match('~ (\d{3}) ~', $http_response_header[0], $m)) {
        $code = (int) $m[1];
    }
    return [$code, $body === false ? '' : (string) $body, $url];
}

// -> [points: [[unix, lat, lon, alt|null, batt|null]], status text, ok]
function read_spot(array $t): array
{
    $url = 'https://api.findmespot.com/spot-main-web/consumer/rest-api/2.0/public/feed/' . rawurlencode($t['feed']) . '/message.json'
         . ($t['feed_pass'] ? '?feedPassword=' . rawurlencode($t['feed_pass']) : '');
    [$code, $body] = http_get($url);
    $j = json_decode($body, true);
    if (!is_array($j) || !isset($j['response'])) {
        return [[], 'SPOT did not answer (HTTP ' . $code . ').', false];
    }
    $err = $j['response']['errors']['error'] ?? null;
    if ($err) {
        $text = (string) ($err['text'] ?? 'error') . ' (' . ($err['code'] ?? '') . ')';
        // E-0195: the feed is fine but has no messages yet
        return [[], ($err['code'] ?? '') === 'E-0195' ? 'Feed found, no messages yet.' : 'SPOT: ' . $text, ($err['code'] ?? '') === 'E-0195'];
    }
    $msgs = $j['response']['feedMessageResponse']['messages']['message'] ?? [];
    if (isset($msgs['unixTime'])) {
        $msgs = [$msgs];      // a single message comes as an object, not a list
    }
    $pts = [];
    foreach ($msgs as $m) {
        if (isset($m['unixTime'], $m['latitude'], $m['longitude']) && abs((float) $m['latitude']) <= 90 && ((float) $m['latitude'] != 0 || (float) $m['longitude'] != 0)) {
            $pts[] = [(int) $m['unixTime'], (float) $m['latitude'], (float) $m['longitude'], isset($m['altitude']) ? (int) $m['altitude'] : null,
                      (($m['batteryState'] ?? '') === 'LOW') ? 10 : null];
        }
    }
    return [$pts, count($pts) . ' message(s) in the feed.', true];
}

function read_garmin(array $t, int $since): array
{
    $q = '?d1=' . gmdate('Y-m-d\TH:i\Z', $since);
    $hosts = ['share.garmin.com', 'explore.garmin.com', 'aur.explore.garmin.com', 'eur.explore.garmin.com'];
    $last = '';
    foreach ($hosts as $host) {
        [$code, $body, $final] = http_get('https://' . $host . '/Feed/Share/' . rawurlencode($t['feed']) . $q, $t['feed_pass']);
        if ($code === 401 || stripos($final, 'LogOn') !== false || stripos($body, '<title>Sign In') !== false) {
            return [[], 'Garmin asks for a password — check the MapShare password.', false];
        }
        if ($code === 200 && stripos($body, '<kml') !== false) {
            $pts = [];
            if (preg_match_all('~<Placemark>(.*?)</Placemark>~s', $body, $pm)) {
                foreach ($pm[1] as $block) {
                    if (preg_match('~<when>([^<]+)</when>~', $block, $w) && preg_match('~<Point>.*?<coordinates>\s*([-\d.]+),([-\d.]+)(?:,([-\d.]+))?~s', $block, $c)) {
                        $ts = strtotime($w[1]);
                        if ($ts) {
                            $pts[] = [$ts, (float) $c[2], (float) $c[1], isset($c[3]) ? (int) round((float) $c[3]) : null, null];
                        }
                    }
                }
            }
            return [$pts, count($pts) . ' point(s) from Garmin.', true];
        }
        $last = 'HTTP ' . $code;
    }
    return [[], 'Garmin MapShare not found (' . $last . ') — check the MapShare name and that MapShare is switched on.', false];
}

// Read one tracker's feed and store new positions inside its window. Returns the status text.
function poll_tracker(array $t): array
{
    $from = (int) $t['from_ts'];
    $to = (int) $t['to_ts'];
    try {
        [$pts, $status, $ok] = $t['kind'] === 'spot' ? read_spot($t) : read_garmin($t, max($from, time() - 14 * 86400));
    } catch (Throwable $e) {
        [$pts, $status, $ok] = [[], 'Could not read the feed.', false];
    }
    $ins = db()->prepare('INSERT IGNORE INTO camp_positions (trip_id, device_id, at, lat, lon, alt, batt) VALUES (?, ?, FROM_UNIXTIME(?), ?, ?, ?, ?)');
    $new = 0;
    $latest = 0;
    foreach ($pts as $p) {
        $latest = max($latest, $p[0]);
        if ($p[0] < $from || $p[0] > $to) {
            continue;                         // outside the event: not kept
        }
        $ins->execute([$t['trip_id'], $t['device_id'], $p[0], round($p[1], 6), round($p[2], 6), $p[3], $p[4]]);
        $new += $ins->rowCount();
    }
    if ($ok && $latest) {
        $status .= ' Latest ' . gmdate('j M H:i', $latest) . ' UTC' . ($latest < $from || $latest > $to ? ' (outside the tracking window)' : '') . '.';
        db()->prepare('UPDATE camp_devices SET last_seen = GREATEST(COALESCE(last_seen, FROM_UNIXTIME(0)), FROM_UNIXTIME(?)) WHERE id = ?')->execute([min($latest, time()), $t['device_id']]);
    }
    db()->prepare('UPDATE camp_trackers SET last_poll = NOW(), last_status = ? WHERE id = ?')->execute([mb_substr($status, 0, 200), $t['id']]);
    return ['ok' => $ok, 'status' => $status, 'new' => $new];
}

const TRACKER_COLS = 'k.id, k.trip_id, k.device_id, k.kind, k.label, k.feed, k.feed_pass, k.last_status, UNIX_TIMESTAMP(k.from_at) AS from_ts,
    UNIX_TIMESTAMP(k.to_at) AS to_ts, UNIX_TIMESTAMP(k.last_poll) AS poll_ts';

function tracker_rows(int $tripId): array
{
    $stmt = db()->prepare('SELECT ' . TRACKER_COLS . ' FROM camp_trackers k WHERE k.trip_id = ? ORDER BY k.id');
    $stmt->execute([$tripId]);
    return $stmt->fetchAll();
}

function tracker_out(array $k): array
{
    $now = time();
    return ['id' => (int) $k['id'], 'device' => (int) $k['device_id'], 'kind' => $k['kind'], 'label' => $k['label'],
            'feed' => strlen($k['feed']) > 10 ? substr($k['feed'], 0, 4) . '…' . substr($k['feed'], -4) : $k['feed'], 'hasPass' => $k['feed_pass'] !== null,
            'from' => (int) $k['from_ts'], 'to' => (int) $k['to_ts'], 'polled' => $k['poll_ts'] === null ? null : (int) $k['poll_ts'], 'status' => $k['last_status'],
            'active' => $now >= (int) $k['from_ts'] && $now <= (int) $k['to_ts']];
}

// Read the feeds that are due (inside their window, not read in the last 3 minutes) — a couple per request
function poll_due(int $tripId): void
{
    $done = 0;
    foreach (tracker_rows($tripId) as $k) {
        $now = time();
        if ($now < (int) $k['from_ts'] || $now > (int) $k['to_ts'] + 6 * 3600 || ($k['poll_ts'] !== null && $now - (int) $k['poll_ts'] < TRACKER_EVERY)) {
            continue;
        }
        poll_tracker($k);
        if (++$done >= 2) {
            break;
        }
    }
}

switch ($action) {

    // ---------- phones ----------

    case 'join':
        need_post();
        $data = body_json();
        $code = strtoupper(preg_replace('/[^A-Za-z0-9]/', '', (string) ($data['code'] ?? '')));
        $name = mb_substr(trim((string) ($data['name'] ?? '')), 0, 40);
        if ($name === '') {
            fail('Enter your name so the leaders know whose phone this is.');
        }
        $ip = client_ip();
        $stmt = db()->prepare("SELECT COUNT(*) FROM program_login_attempts WHERE ip = ? AND success = 0 AND username = 'join' AND at > NOW() - INTERVAL 15 MINUTE");
        $stmt->execute([$ip]);
        if ((int) $stmt->fetchColumn() >= 10) {
            fail('Too many wrong codes. Wait 15 minutes and try again.', 429);
        }
        $trip = null;
        if (strlen($code) === 8) {
            $stmt = db()->prepare('SELECT id, public_id, name FROM camp_trips WHERE join_code = ?');
            $stmt->execute([$code]);
            $trip = $stmt->fetch();
        }
        db()->prepare("INSERT INTO program_login_attempts (ip, username, success) VALUES (?, 'join', ?)")->execute([$ip, $trip ? 1 : 0]);
        if (!$trip) {
            fail('That join code isn\'t right. Ask the trip\'s leader for the current code.', 403);
        }
        $stmt = db()->prepare('SELECT COUNT(*) FROM camp_devices WHERE trip_id = ? AND revoked = 0');
        $stmt->execute([$trip['id']]);
        if ((int) $stmt->fetchColumn() >= DEVICES_MAX) {
            fail('This trip already has the maximum number of phones joined.', 403);
        }
        $token = bin2hex(random_bytes(24));
        db()->prepare('INSERT INTO camp_devices (trip_id, token_hash, name) VALUES (?, ?, ?)')->execute([$trip['id'], hash('sha256', $token), $name]);
        json_out(['token' => $token, 'device' => (int) db()->lastInsertId(), 'trip' => ['id' => $trip['public_id'], 'name' => $trip['name']]]);

    case 'pack':
        $d = device_by_token($_GET['token'] ?? '');
        $stmt = db()->prepare('SELECT field_pack, UNIX_TIMESTAMP(pack_at) AS ts FROM camp_trips WHERE id = ?');
        $stmt->execute([$d['trip_id']]);
        $r = $stmt->fetch();
        if (!$r || $r['field_pack'] === null) {
            fail('The leaders haven\'t sent this trip\'s plan to the phone app yet.', 404);
        }
        json_out(['pack' => json_decode($r['field_pack']), 'updated' => (int) $r['ts'], 'device' => $d['name']]);

    case 'report':
        need_post();
        $data = body_json();
        $d = device_by_token($data['token'] ?? '');
        $points = is_array($data['points'] ?? null) ? array_slice($data['points'], 0, POINTS_MAX) : [];
        $now = time();
        $ins = db()->prepare('INSERT IGNORE INTO camp_positions (trip_id, device_id, at, lat, lon, acc, alt, spd, batt) VALUES (?, ?, FROM_UNIXTIME(?), ?, ?, ?, ?, ?, ?)');
        $saved = 0;
        foreach ($points as $p) {
            if (!is_array($p)) {
                continue;
            }
            $t = (int) ($p['t'] ?? 0);
            $lat = num_or_null($p['lat'] ?? null, -90, 90);
            $lon = num_or_null($p['lon'] ?? null, -180, 180);
            if ($lat === null || $lon === null || $t < $now - 30 * 86400 || $t > $now + 600) {
                continue;     // rubbish, or older than the phone could sensibly have queued
            }
            $ins->execute([$d['trip_id'], $d['id'], $t, round($lat, 6), round($lon, 6),
                num_or_null($p['acc'] ?? null, 0, 65000) === null ? null : (int) round($p['acc']),
                num_or_null($p['alt'] ?? null, -500, 9000) === null ? null : (int) round($p['alt']),
                num_or_null($p['spd'] ?? null, 0, 100) === null ? null : round($p['spd'], 1),
                num_or_null($p['batt'] ?? null, 0, 100) === null ? null : (int) round($p['batt'])]);
            $saved++;
        }
        db()->prepare('UPDATE camp_devices SET last_seen = NOW() WHERE id = ?')->execute([$d['id']]);
        if (random_int(1, 200) === 1) {      // tidy up now and then
            db()->exec('DELETE FROM camp_positions WHERE at < NOW() - INTERVAL ' . KEEP_DAYS . ' DAY');
        }
        json_out(['saved' => $saved]);

    case 'say':
        need_post();
        $data = body_json();
        $d = device_by_token($data['token'] ?? '');
        $status = (string) ($data['status'] ?? '');
        if (!in_array($status, ['ok', 'stopped', 'problem', 'contact'], true)) {
            fail('Choose a status.');
        }
        $one = function ($v, int $max) {      // one line, trimmed
            $v = trim(preg_replace('/\s+/', ' ', (string) $v));
            return $v === '' ? null : mb_substr($v, 0, $max);
        };
        $t = (int) ($data['t'] ?? 0);
        $now = time();
        if ($t < $now - 30 * 86400 || $t > $now + 600) {
            $t = $now;
        }
        // an older status that was queued on the phone never replaces a newer one
        db()->prepare('UPDATE camp_devices SET status = ?, status_note = ?, message = ?, status_at = FROM_UNIXTIME(?), last_seen = NOW()
                        WHERE id = ? AND (status_at IS NULL OR status_at <= FROM_UNIXTIME(?))')
            ->execute([$status, $status === 'stopped' ? $one($data['note'] ?? '', 60) : null, $one($data['message'] ?? '', 140), $t, $d['id'], $t]);
        json_out(['saved' => true]);

    case 'leave':
        need_post();
        $d = device_by_token(body_json()['token'] ?? '');
        db()->prepare('UPDATE camp_devices SET revoked = 1 WHERE id = ?')->execute([$d['id']]);
        json_out(['left' => true]);

    // ---------- the trip's team ----------

    case 'status':
        [$t] = require_team($_GET['id'] ?? '');
        $stmt = db()->prepare('SELECT COUNT(*) AS n, UNIX_TIMESTAMP(MIN(at)) AS first, UNIX_TIMESTAMP(MAX(at)) AS last FROM camp_positions WHERE trip_id = ?');
        $stmt->execute([$t['id']]);
        $c = $stmt->fetch();
        json_out(['joinCode' => $t['join_code'], 'packAt' => $t['pack_ts'] === null ? null : (int) $t['pack_ts'], 'devices' => device_rows((int) $t['id']),
                  'points' => (int) $c['n'], 'first' => $c['first'] === null ? null : (int) $c['first'], 'last' => $c['last'] === null ? null : (int) $c['last'],
                  'keepDays' => KEEP_DAYS, 'trackers' => array_map('tracker_out', tracker_rows((int) $t['id']))]);

    case 'code':
        need_post();
        [$t, $u] = require_team(body_json()['id'] ?? '', true);
        $code = !empty(body_json()['on']) ? new_code() : null;
        db()->prepare('UPDATE camp_trips SET join_code = ?, updated_at = updated_at WHERE id = ?')->execute([$code, $t['id']]);
        audit($u, $code ? 'join code' : 'join off', 'trip', (int) $t['id']);
        json_out(['joinCode' => $code]);

    case 'pack_save':
        need_post();
        $raw = file_get_contents('php://input') ?: '';
        if (strlen($raw) > PACK_MAX) {
            fail('The plan is too big for the phone app (over 3 MB).', 413);
        }
        $body = json_decode($raw);
        if (!($body instanceof stdClass) || !isset($body->pack) || !($body->pack instanceof stdClass)) {
            fail('That is not a plan for the phone app.');
        }
        [$t, $u] = require_team($body->id ?? '', true);
        db()->prepare('UPDATE camp_trips SET field_pack = ?, pack_at = NOW(), updated_at = updated_at WHERE id = ?')
            ->execute([json_encode($body->pack, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), $t['id']]);
        json_out(['packAt' => time()]);

    case 'live':
        [$t] = require_team($_GET['id'] ?? '');
        poll_due((int) $t['id']);                                            // read any satellite tracker feeds that are due
        $since = max((int) ($_GET['since'] ?? 0), time() - 12 * 3600);       // trails: the last 12 hours at most
        $devices = device_rows((int) $t['id']);
        $latest = db()->prepare('SELECT UNIX_TIMESTAMP(at) AS ts, lat, lon, acc, alt, spd, batt FROM camp_positions WHERE device_id = ? ORDER BY at DESC LIMIT 1');
        $trail = db()->prepare('SELECT UNIX_TIMESTAMP(at) AS ts, lat, lon FROM camp_positions WHERE device_id = ? AND at > FROM_UNIXTIME(?) ORDER BY at DESC LIMIT 400');
        $out = [];
        foreach ($devices as $d) {
            if ($d['revoked'] && !$d['points']) {
                continue;
            }
            $latest->execute([$d['id']]);
            $p = $latest->fetch();
            $trail->execute([$d['id'], $since]);
            $d['last'] = $p ? point_out($p) : null;
            $d['trail'] = array_reverse(array_map(function ($q) { return [(float) $q['lat'], (float) $q['lon'], (int) $q['ts']]; }, $trail->fetchAll()));
            $out[] = $d;
        }
        json_out(['devices' => $out, 'now' => time()]);

    case 'export':
        [$t] = require_team($_GET['id'] ?? '');
        $stmt = db()->prepare(
            'SELECT p.device_id, UNIX_TIMESTAMP(p.at) AS ts, p.lat, p.lon, p.acc, p.alt, p.spd, p.batt FROM camp_positions p WHERE p.trip_id = ? ORDER BY p.device_id, p.at'
        );
        $stmt->execute([$t['id']]);
        $tracks = [];
        foreach ($stmt as $p) {
            $tracks[(int) $p['device_id']][] = point_out($p);
        }
        $names = [];
        foreach (device_rows((int) $t['id']) as $d) {
            $names[$d['id']] = $d['name'];
        }
        $out = [];
        foreach ($tracks as $id => $pts) {
            $out[] = ['device' => $id, 'name' => $names[$id] ?? ('Phone ' . $id), 'points' => $pts];
        }
        json_out(['trip' => $t['name'], 'exported' => time(), 'tracks' => $out]);

    case 'device':
        need_post();
        $data = body_json();
        [$t, $u] = require_team($data['id'] ?? '', true);
        $dev = (int) ($data['device'] ?? 0);
        if (isset($data['name'])) {
            $name = mb_substr(trim((string) $data['name']), 0, 40);
            if ($name === '') {
                fail('Enter a name.');
            }
            db()->prepare('UPDATE camp_devices SET name = ? WHERE id = ? AND trip_id = ?')->execute([$name, $dev, $t['id']]);
        } else {
            db()->prepare('UPDATE camp_devices SET revoked = ? WHERE id = ? AND trip_id = ?')->execute([!empty($data['revoke']) ? 1 : 0, $dev, $t['id']]);
        }
        json_out(['devices' => device_rows((int) $t['id'])]);

    case 'tracker_add':
        need_post();
        $data = body_json();
        [$t, $u] = require_team($data['id'] ?? '', true);
        $kind = (string) ($data['kind'] ?? '');
        if (!in_array($kind, ['spot', 'garmin'], true)) {
            fail('Choose SPOT or Garmin.');
        }
        $label = mb_substr(trim((string) ($data['label'] ?? '')), 0, 36);
        if ($label === '') {
            fail('Give the tracker a name, e.g. who carries it.');
        }
        // accept a pasted link: keep the last part
        $feed = trim((string) ($data['feed'] ?? ''));
        if (preg_match('~/feed/([0-9A-Za-z]+)/~', $feed, $m) || preg_match('~[?&]glId=([0-9A-Za-z]+)~', $feed, $m)) {
            $feed = $m[1];
        } elseif (strpos($feed, '/') !== false) {
            $feed = basename(parse_url($feed, PHP_URL_PATH) ?: $feed);
        }
        if (!preg_match($kind === 'spot' ? '/^[0-9A-Za-z]{20,45}$/' : '/^[A-Za-z0-9_.\-]{2,60}$/', $feed)) {
            fail($kind === 'spot' ? 'That doesn\'t look like a SPOT feed ID (about 32 letters and numbers — SPOT account → XML Feed → View Details).'
                                  : 'That doesn\'t look like a Garmin MapShare name (the last part of your share.garmin.com link).');
        }
        $from = (int) ($data['from'] ?? 0);
        $to = (int) ($data['to'] ?? 0);
        if ($from < 946684800 || $to <= $from || $to - $from > 60 * 86400) {
            fail('Set when tracking starts and ends (up to 60 days).');
        }
        if (count(tracker_rows((int) $t['id'])) >= 10) {
            fail('A trip can have up to 10 trackers.');
        }
        $pass = trim((string) ($data['pass'] ?? ''));
        db()->prepare('INSERT INTO camp_devices (trip_id, token_hash, name) VALUES (?, ?, ?)')
            ->execute([$t['id'], hash('sha256', bin2hex(random_bytes(24))), '🛰 ' . $label]);
        $dev = (int) db()->lastInsertId();
        db()->prepare('INSERT INTO camp_trackers (trip_id, device_id, kind, label, feed, feed_pass, from_at, to_at, created_by) VALUES (?, ?, ?, ?, ?, ?, FROM_UNIXTIME(?), FROM_UNIXTIME(?), ?)')
            ->execute([$t['id'], $dev, $kind, $label, $feed, $pass === '' ? null : mb_substr($pass, 0, 100), $from, $to, $u['username']]);
        $id = (int) db()->lastInsertId();
        audit($u, 'tracker add', 'trip', (int) $t['id'], ['kind' => $kind, 'label' => $label]);
        $row = array_values(array_filter(tracker_rows((int) $t['id']), function ($k) use ($id) { return (int) $k['id'] === $id; }))[0];
        $test = poll_tracker($row);
        json_out(['test' => $test, 'trackers' => array_map('tracker_out', tracker_rows((int) $t['id']))]);

    case 'tracker_test':
        need_post();
        $data = body_json();
        [$t, $u] = require_team($data['id'] ?? '', true);
        $row = array_values(array_filter(tracker_rows((int) $t['id']), function ($k) use ($data) { return (int) $k['id'] === (int) ($data['tracker'] ?? 0); }))[0] ?? null;
        if (!$row) {
            fail('That tracker is no longer on this trip.', 404);
        }
        if ($row['poll_ts'] !== null && time() - (int) $row['poll_ts'] < 150) {
            json_out(['test' => ['ok' => true, 'status' => $row['last_status'] . ' (checked ' . (time() - (int) $row['poll_ts']) . ' s ago — feeds can be read every 2.5 minutes)', 'new' => 0],
                      'trackers' => array_map('tracker_out', tracker_rows((int) $t['id']))]);
        }
        $test = poll_tracker($row);
        json_out(['test' => $test, 'trackers' => array_map('tracker_out', tracker_rows((int) $t['id']))]);

    case 'tracker_remove':
        need_post();
        $data = body_json();
        [$t, $u] = require_team($data['id'] ?? '', true);
        $stmt = db()->prepare('SELECT device_id FROM camp_trackers WHERE id = ? AND trip_id = ?');
        $stmt->execute([(int) ($data['tracker'] ?? 0), $t['id']]);
        $dev = $stmt->fetchColumn();
        if ($dev !== false) {
            db()->prepare('DELETE FROM camp_trackers WHERE id = ?')->execute([(int) $data['tracker']]);
            db()->prepare('UPDATE camp_devices SET revoked = 1 WHERE id = ?')->execute([$dev]);     // its recorded positions stay for export
            audit($u, 'tracker remove', 'trip', (int) $t['id']);
        }
        json_out(['trackers' => array_map('tracker_out', tracker_rows((int) $t['id']))]);

    case 'clear':
        need_post();
        [$t, $u] = require_team(body_json()['id'] ?? '', true);
        $stmt = db()->prepare('DELETE FROM camp_positions WHERE trip_id = ?');
        $stmt->execute([$t['id']]);
        audit($u, 'clear positions', 'trip', (int) $t['id'], ['deleted' => $stmt->rowCount()]);
        json_out(['deleted' => $stmt->rowCount()]);

    default:
        fail('Unknown action.', 404);
}

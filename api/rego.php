<?php
// Camp Planner — registrations, groups, cars and check-in.
//
// Phases of an activity: plan the route -> approved (published) -> expressions of interest (reg 'interest': a name
// and a contact is enough) -> logistics and coordination (reg 'open': people complete their details, consent, groups,
// cars and gear; then 'closed' when the numbers are final) -> briefing and feedback -> go / no-go -> executing
// (check-in at the start, then the live dashboard). This file looks after everything from "interest" on.
//
// What is stored about a participant: name, youth/adult, mobile, an emergency contact, dietary needs, a
// "has medical notes" flag (the notes themselves stay on the leader's paper form), consent, and gear ticks.
// Everything here is deleted 30 days after the trip ends.
//
// Capacity and waiting lists. The trip can have a maximum number of people (reg_info.max): once it is reached, new
// people go on the trip's waiting list (wait_trip) and move up automatically, oldest first, when a place opens.
// A group's capacity is the number of seats in its cars: members beyond the seats are on the group's waiting list
// (wait_group) until the group adds a car. A group with no cars yet has no limit. See reg_rebalance().
//
// Anyone with the trip's registration link (?r=<reg token>):
//   GET  ?action=info&r=…                       trip summary, gear requirements, meals, the groups to join
//   POST ?action=register  { r, person: {…}, group: { id } | { name } | null }   -> { p, g? }  personal link (and group link for a new group)
// A participant (?p=<their token>):
//   GET  ?action=me&p=…                         their registration, group, car, QR code
//   POST ?action=me_save   { p, person: {…}, gear: [ids], gearNote }
//   POST ?action=me_cancel { p }
//   POST ?action=me_brief  { p, ack: bool, feedback }   "I've read the briefing", and a question or comment for the organisers
// A group leader (?g=<group token>):
//   GET  ?action=group&g=…                      the group, its members and cars
//   POST ?action=group_save   { g, name?, note?, cars: [{ id?, label, driver, seats, start?: { name, lat, lon } }], seats: { <person id>: <car id>|0 } }
//                             (start = where the car leaves from; it feeds the planner's travel plan)
//   POST ?action=group_person { g, person: {…} | id + person | id + remove:true }
//   POST ?action=group_gear   { g, id, gear: [ids] }   tick off a member's gear for them
//   POST ?action=group_add    { g, recipe?: { name, slot, g, kcal, ing[] }, gear?: { name, w, k } }   add to the trip's shared lists (reg_info.extra)
//   POST ?action=group_plan   { g, plan }      the group's own plan: meals per day, overnight accommodation, public transport (with costs)
// The trip's team (signed in; POSTs need X-CSRF-Token):
//   GET  ?action=admin&id=<trip>                everything, with the links
//   POST ?action=stage     { id, reg: off|interest|open|closed, closes? }      (opening needs an approved trip)
//   POST ?action=info_save { id, info }         what the registration page shows (built by the planner)
//   POST ?action=checkin_link { id, on: bool }  make / remove the check-in app's link
//   POST ?action=capacity  { id, info, promote: [person ids], demote: [person ids] }   change the trip's capacity: let chosen people off
//                          the waiting list, or move chosen people onto it
//   POST ?action=admin_person { id, person, pid?, group?, remove?, admit? }   add, change, move or remove someone; admit = give a place off the waiting list
//   POST ?action=admin_group  { id, gid?, name?, leader?, remove?, newLink? }
//   POST ?action=admin_extra  { id, recipe? | gear? }   add to the trip's shared lists (as group_add does)
//   POST ?action=admin_plan   { id, gid, plan }   change a group's plan: remove something from it, or flag something for the group leader
// The check-in phone app (?k=<check-in token>):
//   GET  ?action=roster&k=…                     groups, cars and people to keep on the phone
//   POST ?action=checkin   { k, events: [{ t, car?, person?, attend?, gearOk?, by? }] }

require __DIR__ . '/lib/bootstrap.php';

header('Cache-Control: no-store');

// REG_KEEP_DAYS (30 days after the trip ends) and reg_purge() are in lib/bootstrap.php: api/camp.php runs the clean-up too
const REG_PEOPLE_MAX = 400;     // per trip
const REG_GROUP_MAX = 40;       // people per group
const REG_CARS_MAX = 12;        // per group
const REG_INFO_MAX = 60000;
const REG_PLAN_MAX = 60000;     // a group's plan (meals, accommodation, transport)
const REG_EMERGENCY = ['plb', 'contact', 'returnBy', 'hospital', 'reception', 'ranger', 'police', 'evac', 'firstAider'];   // reg_info.emergency (from the Risk tab)

$action = (string) ($_GET['action'] ?? '');

function need_post(): void
{
    if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
        fail('Use POST for this action.', 405);
    }
}

function reg_token(): string
{
    return rtrim(strtr(base64_encode(random_bytes(18)), '+/', '-_'), '=');
}

// 8 characters for a QR code, no look-alikes
function reg_code(string $table): string
{
    $alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    do {
        $code = '';
        for ($i = 0; $i < 8; $i++) {
            $code .= $alphabet[random_int(0, strlen($alphabet) - 1)];
        }
        $stmt = db()->prepare("SELECT 1 FROM $table WHERE code = ?");
        $stmt->execute([$code]);
    } while ($stmt->fetch());
    return $code;
}

// The trip's activity log: a row in program_audit (entity 'trip'), shown on the Trip tab (api/camp.php?action=activity).
// $who is the signed-in user, or a label for people without an account: "group: <group name>", "participant", "check-in".
// Nothing personal goes in $detail: group names and counts only, so the log can outlive the registrations.
// The same entry (who, what, detail) repeated within $quiet minutes is skipped; $quiet = 0 always records.
function reg_log($who, string $action, int $tripId, array $detail = [], int $quiet = 10): void
{
    try {
        $name = mb_substr(is_array($who) ? (string) $who['username'] : (string) $who, 0, 40);
        $json = $detail ? json_encode($detail, JSON_UNESCAPED_UNICODE) : null;
        if ($quiet > 0) {
            $q = db()->prepare("SELECT 1 FROM program_audit WHERE entity = 'trip' AND entity_id = ? AND username = ? AND action = ? AND detail <=> ?
                                   AND at > NOW() - INTERVAL " . (int) $quiet . ' MINUTE LIMIT 1');
            $q->execute([$tripId, $name, $action, $json]);
            if ($q->fetch()) {
                return;
            }
        }
        db()->prepare("INSERT INTO program_audit (username, action, entity, entity_id, detail) VALUES (?, ?, 'trip', ?, ?)")->execute([$name, $action, $tripId, $json]);
    } catch (Throwable $e) {
        // the log must never stop the action itself
    }
}

function reg_group_name(?int $gid): ?string
{
    if (!$gid) {
        return null;
    }
    $q = db()->prepare('SELECT name FROM camp_reg_groups WHERE id = ?');
    $q->execute([$gid]);
    $n = $q->fetchColumn();
    return $n === false ? null : (string) $n;
}

// Work out who has a place: the trip's waiting list, then each group's seats. Run after anything that changes numbers.
function reg_rebalance(int $tripId): void
{
    $t = db()->prepare('SELECT reg_info FROM camp_trips WHERE id = ?');
    $t->execute([$tripId]);
    $info = json_decode((string) $t->fetchColumn(), true);
    $max = is_array($info) && is_numeric($info['max'] ?? null) && $info['max'] > 0 ? (int) $info['max'] : 0;
    $rows = db()->prepare("SELECT id, group_id, car_id, wait_trip, wait_group FROM camp_reg_people WHERE trip_id = ? AND status = 'registered' ORDER BY id");
    $rows->execute([$tripId]);
    $people = $rows->fetchAll();
    // the trip: people only ever move up the list (lowering the maximum doesn't take a place away)
    $in = count(array_filter($people, function ($p) { return (int) $p['wait_trip'] === 0; }));
    foreach ($people as &$p) {
        if ((int) $p['wait_trip'] === 1 && ($max === 0 || $in < $max)) {
            db()->prepare('UPDATE camp_reg_people SET wait_trip = 0 WHERE id = ?')->execute([(int) $p['id']]);
            $p['wait_trip'] = 0;
            $in++;
        }
    }
    unset($p);
    // each group: seats go to the leader, then people with a place on the trip, in the order they joined
    $groups = db()->prepare('SELECT g.id, g.leader_id, (SELECT COALESCE(SUM(c.seats), 0) FROM camp_reg_cars c WHERE c.group_id = g.id) AS seats,
                                    (SELECT COUNT(*) FROM camp_reg_cars c WHERE c.group_id = g.id) AS cars FROM camp_reg_groups g WHERE g.trip_id = ?');
    $groups->execute([$tripId]);
    foreach ($groups->fetchAll() as $g) {
        $members = array_values(array_filter($people, function ($p) use ($g) { return (int) $p['group_id'] === (int) $g['id']; }));
        usort($members, function ($a, $b) use ($g) {
            $ka = [(int) $a['id'] === (int) $g['leader_id'] ? 0 : 1, (int) $a['wait_trip'], (int) $a['id']];
            $kb = [(int) $b['id'] === (int) $g['leader_id'] ? 0 : 1, (int) $b['wait_trip'], (int) $b['id']];
            return $ka <=> $kb;
        });
        foreach ($members as $i => $m) {
            $wait = ((int) $g['cars'] > 0 && $i >= (int) $g['seats']) || (int) $m['wait_trip'] === 1 ? 1 : 0;
            if ($wait !== (int) $m['wait_group'] || ($wait && $m['car_id'] !== null)) {
                db()->prepare('UPDATE camp_reg_people SET wait_group = ?, car_id = IF(?, NULL, car_id) WHERE id = ?')->execute([$wait, $wait, (int) $m['id']]);
            }
        }
    }
    db()->prepare("UPDATE camp_reg_people SET wait_group = 0 WHERE trip_id = ? AND group_id IS NULL AND wait_group = 1")->execute([$tripId]);
}

// What groups have added to the trip's lists lives in reg_info.extra; the organisers' saves of reg_info must not drop it
function keep_extra(array $t, $info): string
{
    $new = is_array($info) ? $info : [];
    $old = json_decode((string) $t['reg_info'], true);
    if (is_array($old) && !empty($old['extra']) && empty($new['extra'])) {
        $new['extra'] = $old['extra'];
    }
    // the trip's emergency numbers (members and group leaders see them) and the phone number printed on bag tags
    if (array_key_exists('emergency', $new)) {
        $em = [];
        foreach (REG_EMERGENCY as $k) {
            $v = is_array($new['emergency']) && is_scalar($new['emergency'][$k] ?? null) ? mb_substr(trim((string) $new['emergency'][$k]), 0, 200) : '';
            if ($v !== '') {
                $em[$k] = $v;
            }
        }
        $new['emergency'] = $em;
        if (!$em) {
            unset($new['emergency']);
        }
    }
    if (array_key_exists('tagPhone', $new)) {
        $new['tagPhone'] = is_scalar($new['tagPhone']) ? mb_substr(trim((string) $new['tagPhone']), 0, 30) : '';
        if ($new['tagPhone'] === '') {
            unset($new['tagPhone']);
        }
    }
    $json = json_encode($new ?: new stdClass(), JSON_UNESCAPED_UNICODE);
    if ($json === false || strlen($json) > REG_INFO_MAX) {
        fail('The registration details are too long.');
    }
    return $json;
}

// Add a recipe or a gear item to the trip's shared lists (reg_info.extra), once each by name. Returns the lists.
function reg_extra_add(array $t, array $in, string $by): array
{
    $info = json_decode((string) $t['reg_info'], true);
    $info = is_array($info) ? $info : [];
    $extra = is_array($info['extra'] ?? null) ? $info['extra'] : [];
    $extra += ['recipes' => [], 'gear' => []];
    $has = function (array $list, string $name) { foreach ($list as $x) { if (mb_strtolower(trim((string) ($x['name'] ?? ''))) === mb_strtolower($name)) { return true; } } return false; };
    $clean = function ($v, int $max) { return mb_substr(trim(preg_replace('/\s+/', ' ', (string) $v)), 0, $max); };
    if (is_array($in['recipe'] ?? null)) {
        $name = $clean($in['recipe']['name'] ?? '', 80);
        $master = is_array($info['recipes'] ?? null) ? $info['recipes'] : [];
        if (mb_strlen($name) >= 2 && !$has($extra['recipes'], $name) && !$has($master, $name) && count($extra['recipes']) < 80) {
            $slot = in_array($in['recipe']['slot'] ?? '', ['breakfast', 'lunch', 'dinner', 'snacks'], true) ? $in['recipe']['slot'] : '';
            $ing = array_slice(array_values(array_filter(array_map(function ($x) use ($clean) { return $clean($x, 40); }, is_array($in['recipe']['ing'] ?? null) ? $in['recipe']['ing'] : []))), 0, 25);
            $extra['recipes'][] = ['name' => $name, 'slot' => $slot, 'g' => max(0, min(5000, (int) ($in['recipe']['g'] ?? 0))), 'kcal' => max(0, min(9000, (int) ($in['recipe']['kcal'] ?? 0))),
                                   'ing' => $ing, 'lib' => empty($in['recipe']['lib']) ? 0 : 1, 'by' => $by];
        }
    }
    if (is_array($in['gear'] ?? null)) {
        $name = $clean($in['gear']['name'] ?? '', 80);
        if (mb_strlen($name) >= 2 && !$has($extra['gear'], $name) && count($extra['gear']) < 200) {
            $extra['gear'][] = ['name' => $name, 'w' => max(0, min(60000, (int) ($in['gear']['w'] ?? 0))), 'k' => $clean($in['gear']['k'] ?? 'Other', 24), 'by' => $by];
        }
    }
    $info['extra'] = $extra;
    $json = json_encode($info, JSON_UNESCAPED_UNICODE);
    if ($json === false || strlen($json) > REG_INFO_MAX) {
        fail('The trip\'s shared lists are full. Ask the organiser to tidy them up.');
    }
    db()->prepare('UPDATE camp_trips SET reg_info = ?, updated_at = updated_at WHERE id = ?')->execute([$json, (int) $t['id']]);
    return $extra;
}

// How full the trip is, for the registration page
function reg_counts(array $t): array
{
    $info = json_decode((string) $t['reg_info'], true);
    $max = is_array($info) && is_numeric($info['max'] ?? null) && $info['max'] > 0 ? (int) $info['max'] : 0;
    $c = db()->prepare("SELECT SUM(wait_trip = 0), SUM(wait_trip = 1) FROM camp_reg_people WHERE trip_id = ? AND status = 'registered'");
    $c->execute([(int) $t['id']]);
    [$in, $waiting] = $c->fetch(PDO::FETCH_NUM);
    return ['max' => $max, 'in' => (int) $in, 'waiting' => (int) $waiting, 'full' => $max > 0 && (int) $in >= $max];
}

const REG_TRIP = 'SELECT id, public_id, name, start_date, end_date, created_by, planners, pub_status, reg_status, reg_token, reg_closes, reg_info, checkin_token FROM camp_trips';

function trip_where(string $where, $value): array
{
    $value = trim((string) $value);
    if ($value === '') {
        fail('That link isn\'t right. Ask the organiser for a new one.', 404);
    }
    $stmt = db()->prepare(REG_TRIP . " WHERE $where = ?");
    $stmt->execute([$value]);
    $t = $stmt->fetch();
    if (!$t) {
        fail('That link is no longer active. Ask the organiser for a new one.', 404);
    }
    // registration closes by itself at the end of the closing date
    if (in_array($t['reg_status'], ['interest', 'open'], true) && $t['reg_closes'] !== null && $t['reg_closes'] < date('Y-m-d')) {
        db()->prepare("UPDATE camp_trips SET reg_status = 'closed' WHERE id = ?")->execute([(int) $t['id']]);
        $t['reg_status'] = 'closed';
    }
    return $t;
}

function trip_by_id(int $id): array
{
    return trip_where('id', (string) $id);
}

// Superusers, the trip's owner and its co-planners
function reg_team($ref, bool $write = false): array
{
    $u = current_user();
    if (!$u) {
        fail('Please sign in.', 401);
    }
    if ($u['mustChange']) {
        fail('Please change your temporary password first.', 403);
    }
    $t = trip_where('public_id', $ref);
    $planner = in_array($u['campRole'], ['leader', 'super'], true);
    $team = $planner && ($t['created_by'] === $u['username'] || in_array($u['username'], $t['planners'] === '' ? [] : explode(',', $t['planners']), true));
    if (!$team && $u['campRole'] !== 'super') {
        fail('Only this trip\'s leaders and superusers can see its registrations.', 403);
    }
    if ($write) {
        need_post();
        require_csrf();
    }
    return [$t, $u];
}

function trip_public(array $t, bool $member = true): array
{
    $info = json_decode((string) $t['reg_info'], true);
    if (!$member && is_array($info)) {      // the registration link alone: no emergency numbers or bag-tag phone until they are part of the trip
        unset($info['emergency'], $info['tagPhone']);
    }
    return ['name' => $t['name'], 'start' => $t['start_date'], 'end' => $t['end_date'], 'reg' => $t['reg_status'],
            'closes' => $t['reg_closes'], 'info' => is_array($info) ? $info : new stdClass()];
}

// ---------- people ----------

// $light: an expression of interest — a name is enough; the emergency contact and consent come later
function person_fields(array $in, bool $needConsent, bool $light = false): array
{
    $name = str_field($in, 'name', 80);
    if (mb_strlen($name) < 2) {
        fail('Please enter the participant\'s name.');
    }
    $kind = ($in['kind'] ?? '') === 'adult' ? 'adult' : 'youth';
    $f = [
        'name' => $name, 'kind' => $kind,
        'mobile' => str_field($in, 'mobile', 30),
        'em_name' => str_field($in, 'emName', 80), 'em_phone' => str_field($in, 'emPhone', 30),
        'dietary' => str_field($in, 'dietary', 200),
        'med_flag' => empty($in['medFlag']) ? 0 : 1,
        'consent' => empty($in['consent']) ? 0 : 1,
        'consent_by' => str_field($in, 'consentBy', 80),
    ];
    foreach (['mobile', 'em_phone'] as $k) {
        if ($f[$k] !== '' && !preg_match('/^[0-9 +()\-]{6,30}$/', $f[$k])) {
            fail('Please check the phone numbers (digits, spaces and + only).');
        }
    }
    if ($light) {
        if ($f['mobile'] === '' && $f['em_phone'] === '') {
            fail('Please give a phone number we can reach you on.');
        }
        return $f;
    }
    if ($f['em_name'] === '' || $f['em_phone'] === '') {
        fail('Please give an emergency contact name and phone number.');
    }
    if ($needConsent) {
        if (!$f['consent']) {
            fail('Please tick the consent box to register.');
        }
        if ($f['consent_by'] === '') {
            fail($kind === 'youth' ? 'Please enter the name of the parent or carer giving consent.' : 'Please type your name to confirm.');
        }
    }
    return $f;
}

function person_insert(int $tripId, ?int $groupId, array $f): array
{
    $n = db()->prepare("SELECT COUNT(*) FROM camp_reg_people WHERE trip_id = ? AND status = 'registered'");
    $n->execute([$tripId]);
    if ((int) $n->fetchColumn() >= REG_PEOPLE_MAX) {
        fail('This activity is full. Please contact the organiser.');
    }
    if ($groupId !== null) {
        $n = db()->prepare("SELECT COUNT(*) FROM camp_reg_people WHERE group_id = ? AND status = 'registered'");
        $n->execute([$groupId]);
        if ((int) $n->fetchColumn() >= REG_GROUP_MAX) {
            fail('That group is full.');
        }
    }
    $token = reg_token();
    $full = reg_counts(trip_by_id($tripId))['full'] ? 1 : 0;       // no place left: they start on the trip's waiting list
    db()->prepare(
        'INSERT INTO camp_reg_people (trip_id, group_id, code, token, wait_trip, name, kind, mobile, em_name, em_phone, dietary, med_flag, consent, consent_by, consent_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    )->execute([$tripId, $groupId, reg_code('camp_reg_people'), $token, $full, $f['name'], $f['kind'], $f['mobile'], $f['em_name'], $f['em_phone'],
                $f['dietary'], $f['med_flag'], $f['consent'], $f['consent_by'], $f['consent'] ? date('Y-m-d H:i:s') : null]);
    return [(int) db()->lastInsertId(), $token];
}

function person_update(int $id, array $f, bool $touchConsent): void
{
    $sql = 'UPDATE camp_reg_people SET name = ?, kind = ?, mobile = ?, em_name = ?, em_phone = ?, dietary = ?, med_flag = ?';
    $args = [$f['name'], $f['kind'], $f['mobile'], $f['em_name'], $f['em_phone'], $f['dietary'], $f['med_flag']];
    if ($touchConsent) {
        $sql .= ', consent = ?, consent_by = ?, consent_at = IF(?, COALESCE(consent_at, NOW()), NULL)';
        array_push($args, $f['consent'], $f['consent_by'], $f['consent']);
    }
    $args[] = $id;
    db()->prepare($sql . ' WHERE id = ?')->execute($args);
}

// $level: 'full' (organisers, check-in, the person themself) or 'group' (group leader: no emergency contact)
function person_out(array $p, string $level, bool $withToken = false): array
{
    $gear = json_decode((string) $p['gear'], true);
    $out = ['id' => (int) $p['id'], 'code' => $p['code'], 'name' => $p['name'], 'kind' => $p['kind'], 'group' => $p['group_id'] === null ? null : (int) $p['group_id'],
            'car' => $p['car_id'] === null ? null : (int) $p['car_id'], 'mobile' => $p['mobile'], 'dietary' => $p['dietary'], 'medFlag' => (int) $p['med_flag'] === 1,
            'consent' => (int) $p['consent'] === 1, 'gear' => is_array($gear['ids'] ?? null) ? $gear['ids'] : [], 'gearNote' => (string) ($gear['note'] ?? ''),
            'attend' => $p['attend'], 'attendAt' => $p['attend_ts'] === null ? null : (int) $p['attend_ts'],
            'wait' => (int) $p['wait_trip'] === 1, 'waitGroup' => (int) $p['wait_group'] === 1 && (int) $p['wait_trip'] === 0,   // on the trip's waiting list / waiting for a seat in their group
            'complete' => $p['em_name'] !== '' && $p['em_phone'] !== '' && (int) $p['consent'] === 1,   // registration finished (not just interest)
            'briefAt' => $p['brief_ts'] === null ? null : (int) $p['brief_ts'], 'feedback' => (string) $p['feedback']];
    if ($level === 'full') {
        $out += ['emName' => $p['em_name'], 'emPhone' => $p['em_phone'], 'consentBy' => $p['consent_by'],
                 'consentAt' => $p['consent_ts'] === null ? null : (int) $p['consent_ts'], 'registered' => (int) $p['created_ts']];
    }
    if ($withToken) {
        $out['token'] = $p['token'];
    }
    return $out;
}

const PEOPLE_SELECT = 'SELECT p.*, UNIX_TIMESTAMP(p.brief_at) AS brief_ts, UNIX_TIMESTAMP(p.attend_at) AS attend_ts, UNIX_TIMESTAMP(p.consent_at) AS consent_ts, UNIX_TIMESTAMP(p.created_at) AS created_ts FROM camp_reg_people p';

function people_rows(string $where, array $args): array
{
    $stmt = db()->prepare(PEOPLE_SELECT . " WHERE $where AND p.status = 'registered' ORDER BY p.name, p.id");
    $stmt->execute($args);
    return $stmt->fetchAll();
}

function person_by_token($token): array
{
    $token = (string) $token;
    if (strlen($token) < 20) {
        fail('That link isn\'t right.', 404);
    }
    $stmt = db()->prepare(PEOPLE_SELECT . " WHERE p.token = ? AND p.status = 'registered'");
    $stmt->execute([$token]);
    $p = $stmt->fetch();
    if (!$p) {
        fail('This registration was cancelled or has been removed. Ask the organiser if that\'s a surprise.', 404);
    }
    return $p;
}

// ---------- groups and cars ----------

function group_rows(int $tripId): array
{
    $stmt = db()->prepare('SELECT * FROM camp_reg_groups WHERE trip_id = ? ORDER BY name, id');
    $stmt->execute([$tripId]);
    return $stmt->fetchAll();
}

function group_by_token($token): array
{
    $token = (string) $token;
    if (strlen($token) < 20) {
        fail('That link isn\'t right.', 404);
    }
    $stmt = db()->prepare('SELECT * FROM camp_reg_groups WHERE token = ?');
    $stmt->execute([$token]);
    $g = $stmt->fetch();
    if (!$g) {
        fail('That group link is no longer active. Ask the organiser for a new one.', 404);
    }
    return $g;
}

function group_out(array $g, bool $withToken = false): array
{
    $plan = json_decode((string) ($g['plan'] ?? ''), true);
    $out = ['id' => (int) $g['id'], 'name' => $g['name'], 'leader' => $g['leader_id'] === null ? null : (int) $g['leader_id'], 'note' => $g['note'],
            'plan' => is_array($plan) && $plan ? $plan : new stdClass()];
    if ($withToken) {
        $out['token'] = $g['token'];
    }
    return $out;
}

/** A car's vehicle details from its group's Cars screen, cleaned up for storing as JSON (null when nothing was given). */
function car_spec($in): ?string
{
    if (!is_array($in)) {
        return null;
    }
    $o = [];
    foreach (['model' => 60, 'rego' => 12, 'tRego' => 12, 'tDesc' => 60] as $k => $n) {
        $v = mb_substr(trim((string) ($in[$k] ?? '')), 0, $n);
        if ($v !== '') {
            $o[$k] = $v;
        }
    }
    foreach (['regoExp', 'tRegoExp'] as $k) {
        $v = (string) ($in[$k] ?? '');
        if (preg_match('/^\d{4}-\d{2}-\d{2}$/', $v)) {
            $o[$k] = $v;
        }
    }
    if (in_array($in['fuel'] ?? '', ['ulp91', 'e10', 'pulp95', 'pulp98', 'diesel', 'lpg', 'ev'], true)) {
        $o['fuel'] = $in['fuel'];
    }
    if (in_array($in['tBrakes'] ?? '', ['none', 'override', 'electric'], true)) {
        $o['tBrakes'] = $in['tBrakes'];
    }
    $limits = ['economy' => 60, 'tank' => 400, 'payload' => 5000, 'towMax' => 10000, 'gcm' => 20000, 'tTare' => 5000, 'tAtm' => 10000, 'tLoad' => 10000];
    foreach ($limits as $k => $max) {
        if (is_numeric($in[$k] ?? null) && $in[$k] > 0 && $in[$k] <= $max) {
            $o[$k] = round((float) $in[$k], 1);
        }
    }
    if (!empty($in['trailer'])) {
        $o['trailer'] = true;
    }
    if (isset($in['insured']) && $in['insured'] === true) {      // "the driver says the car is insured": only a tick, stored only when ticked
        $o['insured'] = true;
    }
    return $o ? json_encode($o, JSON_UNESCAPED_UNICODE) : null;
}

function car_rows(string $where, array $args): array
{
    $stmt = db()->prepare("SELECT c.*, UNIX_TIMESTAMP(c.arrived_at) AS arrived_ts FROM camp_reg_cars c WHERE $where ORDER BY c.group_id, c.id");
    $stmt->execute($args);
    return array_map(function ($c) {
        return ['id' => (int) $c['id'], 'group' => (int) $c['group_id'], 'code' => $c['code'], 'label' => $c['label'], 'driver' => $c['driver'], 'seats' => (int) $c['seats'],
                'start' => $c['start_lat'] === null ? null : ['name' => $c['start_name'], 'lat' => (float) $c['start_lat'], 'lon' => (float) $c['start_lon']],
                'arrivedAt' => $c['arrived_ts'] === null ? null : (int) $c['arrived_ts'], 'arrivedBy' => $c['arrived_by'],
                'gearOk' => $c['gear_ok'] === null ? null : (int) $c['gear_ok'] === 1,
                'spec' => empty($c['spec']) ? null : (json_decode($c['spec'], true) ?: null)];
    }, $stmt->fetchAll());
}

function group_create(int $tripId, string $name): array
{
    $name = trim($name);
    if (mb_strlen($name) < 2 || mb_strlen($name) > 60) {
        fail('Please give the group a name (2 to 60 characters).');
    }
    $dupe = db()->prepare('SELECT 1 FROM camp_reg_groups WHERE trip_id = ? AND LOWER(name) = LOWER(?)');
    $dupe->execute([$tripId, $name]);
    if ($dupe->fetch()) {
        fail('There is already a group with that name. Join it, or choose another name.');
    }
    $n = db()->prepare('SELECT COUNT(*) FROM camp_reg_groups WHERE trip_id = ?');
    $n->execute([$tripId]);
    if ((int) $n->fetchColumn() >= 80) {
        fail('This activity has too many groups. Please contact the organiser.');
    }
    $token = reg_token();
    db()->prepare('INSERT INTO camp_reg_groups (trip_id, name, token) VALUES (?, ?, ?)')->execute([$tripId, $name, $token]);
    return [(int) db()->lastInsertId(), $token];
}

function group_view(array $g, array $t): array
{
    return ['trip' => trip_public($t), 'group' => group_out($g),
            'people' => array_map(function ($p) { return person_out($p, 'group'); }, people_rows('p.group_id = ?', [(int) $g['id']])),
            'cars' => car_rows('c.group_id = ?', [(int) $g['id']])];
}

function admin_view(array $t): array
{
    $id = (int) $t['id'];
    return ['trip' => trip_public($t) + ['approved' => $t['pub_status'] === 'published', 'regToken' => $t['reg_token'], 'checkinToken' => $t['checkin_token'],
                                         'keepDays' => REG_KEEP_DAYS],
            'groups' => array_map(function ($g) { return group_out($g, true); }, group_rows($id)),
            'people' => array_map(function ($p) { return person_out($p, 'full', true); }, people_rows('p.trip_id = ?', [$id])),
            'cars' => car_rows('c.trip_id = ?', [$id])];
}

// ---------- actions ----------

reg_purge();

switch ($action) {
    case 'info':
        $t = trip_where('reg_token', $_GET['r'] ?? '');
        $counts = [];
        foreach (people_rows('p.trip_id = ?', [(int) $t['id']]) as $p) {
            $counts[(int) $p['group_id']] = ($counts[(int) $p['group_id']] ?? 0) + 1;
        }
        $seats = [];
        foreach (car_rows('c.trip_id = ?', [(int) $t['id']]) as $c) {
            $seats[$c['group']] = ($seats[$c['group']] ?? 0) + $c['seats'];
        }
        json_out(['trip' => trip_public($t, false) + ['places' => reg_counts($t)], 'groups' => array_map(function ($g) use ($counts, $seats) {
            // seats: null until the group has added a car (no limit yet)
            return ['id' => (int) $g['id'], 'name' => $g['name'], 'people' => $counts[(int) $g['id']] ?? 0, 'seats' => $seats[(int) $g['id']] ?? null];
        }, group_rows((int) $t['id']))]);
        break;

    case 'register':
        need_post();
        $in = body_json();
        $t = trip_where('reg_token', $in['r'] ?? '');
        if (!in_array($t['reg_status'], ['interest', 'open'], true)) {
            fail('Registration for this activity is closed. Please contact the organiser.', 403);
        }
        if (!empty($in['website'])) {       // hidden box that only robots fill in
            fail('Could not register.', 400);
        }
        $light = $t['reg_status'] === 'interest';
        $f = person_fields(is_array($in['person'] ?? null) ? $in['person'] : [], !$light, $light);
        $grp = is_array($in['group'] ?? null) ? $in['group'] : [];
        $gid = null;
        $gtoken = null;
        db()->beginTransaction();
        if (!empty($grp['name'])) {
            [$gid, $gtoken] = group_create((int) $t['id'], (string) $grp['name']);
        } elseif (!empty($grp['id'])) {
            $chk = db()->prepare('SELECT id FROM camp_reg_groups WHERE id = ? AND trip_id = ?');
            $chk->execute([(int) $grp['id'], (int) $t['id']]);
            $gid = $chk->fetchColumn();
            if ($gid === false) {
                fail('That group no longer exists. Please choose again.');
            }
            $gid = (int) $gid;
        }
        [$pid, $ptoken] = person_insert((int) $t['id'], $gid, $f);
        if ($gtoken !== null) {
            db()->prepare('UPDATE camp_reg_groups SET leader_id = ? WHERE id = ?')->execute([$pid, $gid]);
        }
        db()->commit();
        reg_log('participant', 'reg_register', (int) $t['id'], array_filter(['group' => reg_group_name($gid), 'newGroup' => $gtoken !== null]), 0);
        reg_rebalance((int) $t['id']);
        $w = db()->prepare('SELECT wait_trip, wait_group FROM camp_reg_people WHERE id = ?');
        $w->execute([$pid]);
        $w = $w->fetch();
        json_out(['p' => $ptoken, 'g' => $gtoken, 'wait' => (int) $w['wait_trip'] === 1, 'waitGroup' => (int) $w['wait_group'] === 1 && (int) $w['wait_trip'] === 0]);
        break;

    case 'me':
        $p = person_by_token($_GET['p'] ?? '');
        $t = trip_by_id((int) $p['trip_id']);
        $out = ['trip' => trip_public($t), 'me' => person_out($p, 'full'), 'group' => null, 'car' => null, 'leader' => null];
        if ((int) $p['wait_trip'] === 1) {          // their position on the trip's waiting list
            $pos = db()->prepare("SELECT COUNT(*) FROM camp_reg_people WHERE trip_id = ? AND status = 'registered' AND wait_trip = 1 AND id <= ?");
            $pos->execute([(int) $p['trip_id'], (int) $p['id']]);
            $out['waitPos'] = (int) $pos->fetchColumn();
        }
        if ($p['group_id'] !== null) {
            $g = db()->prepare('SELECT * FROM camp_reg_groups WHERE id = ?');
            $g->execute([(int) $p['group_id']]);
            $g = $g->fetch();
            if ($g) {
                $out['group'] = group_out($g);
                $out['isLeader'] = (int) $g['leader_id'] === (int) $p['id'];
                if ($out['isLeader']) {
                    $out['groupToken'] = $g['token'];
                }
                if ($g['leader_id'] !== null) {
                    $l = db()->prepare("SELECT name, mobile FROM camp_reg_people WHERE id = ? AND status = 'registered'");
                    $l->execute([(int) $g['leader_id']]);
                    $out['leader'] = $l->fetch() ?: null;
                }
            }
        }
        if ($p['car_id'] !== null) {
            $out['car'] = car_rows('c.id = ?', [(int) $p['car_id']])[0] ?? null;
        }
        json_out($out);
        break;

    case 'me_save':
        need_post();
        $in = body_json();
        $p = person_by_token($in['p'] ?? '');
        if (is_array($in['person'] ?? null)) {
            $light = trip_by_id((int) $p['trip_id'])['reg_status'] === 'interest' && empty($in['person']['consent']);
            person_update((int) $p['id'], person_fields($in['person'], !$light, $light), true);
        }
        if (array_key_exists('gear', $in)) {
            $ids = array_values(array_unique(array_filter(array_map('strval', is_array($in['gear']) ? $in['gear'] : []), function ($x) { return preg_match('/^[A-Za-z0-9_\-]{1,16}$/', $x); })));
            db()->prepare('UPDATE camp_reg_people SET gear = ? WHERE id = ?')
                ->execute([json_encode(['ids' => array_slice($ids, 0, 200), 'note' => mb_substr(trim((string) ($in['gearNote'] ?? '')), 0, 300)], JSON_UNESCAPED_UNICODE), (int) $p['id']]);
        }
        json_out(['ok' => true]);
        break;

    case 'me_brief':
        need_post();
        $in = body_json();
        $p = person_by_token($in['p'] ?? '');
        db()->prepare('UPDATE camp_reg_people SET brief_at = IF(?, COALESCE(brief_at, NOW()), brief_at), feedback = ? WHERE id = ?')
            ->execute([empty($in['ack']) ? 0 : 1, mb_substr(trim((string) ($in['feedback'] ?? '')), 0, 500), (int) $p['id']]);
        json_out(['ok' => true]);
        break;

    case 'me_cancel':
        need_post();
        $in = body_json();
        $p = person_by_token($in['p'] ?? '');
        db()->prepare("UPDATE camp_reg_people SET status = 'cancelled', car_id = NULL WHERE id = ?")->execute([(int) $p['id']]);
        db()->prepare('UPDATE camp_reg_groups SET leader_id = NULL WHERE leader_id = ?')->execute([(int) $p['id']]);
        reg_log('participant', 'reg_cancel', (int) $p['trip_id'], array_filter(['group' => reg_group_name((int) ($p['group_id'] ?? 0))]), 0);
        reg_rebalance((int) $p['trip_id']);
        json_out(['ok' => true]);
        break;

    case 'group':
        $g = group_by_token($_GET['g'] ?? '');
        json_out(group_view($g, trip_by_id((int) $g['trip_id'])));
        break;

    case 'group_save':
        need_post();
        $in = body_json();
        $g = group_by_token($in['g'] ?? '');
        $gid = (int) $g['id'];
        $t = trip_by_id((int) $g['trip_id']);
        $open = in_array($t['reg_status'], ['interest', 'open'], true);
        db()->beginTransaction();
        if (isset($in['note'])) {
            db()->prepare('UPDATE camp_reg_groups SET note = ? WHERE id = ?')->execute([str_field($in, 'note', 300), $gid]);
        }
        if (is_array($in['cars'] ?? null)) {
            $have = array_column(car_rows('c.group_id = ?', [$gid]), null, 'id');
            $keep = [];
            foreach (array_slice($in['cars'], 0, REG_CARS_MAX) as $i => $c) {
                if (!is_array($c)) {
                    continue;
                }
                $label = mb_substr(trim((string) ($c['label'] ?? '')), 0, 60) ?: 'Car ' . ($i + 1);
                $driver = mb_substr(trim((string) ($c['driver'] ?? '')), 0, 80);
                $seats = max(1, min(60, (int) ($c['seats'] ?? 5)));
                // where the car leaves from: a place name with its position (Australia and nearby only)
                $st = is_array($c['start'] ?? null) ? $c['start'] : [];
                $ok = is_numeric($st['lat'] ?? null) && is_numeric($st['lon'] ?? null) && $st['lat'] >= -45 && $st['lat'] <= -9 && $st['lon'] >= 110 && $st['lon'] <= 156;
                $sName = $ok ? mb_substr(trim((string) ($st['name'] ?? '')), 0, 120) : '';
                $sLat = $ok ? round((float) $st['lat'], 5) : null;
                $sLon = $ok ? round((float) $st['lon'], 5) : null;
                $cid = (int) ($c['id'] ?? 0);
                if ($cid && isset($have[$cid])) {
                    db()->prepare('UPDATE camp_reg_cars SET label = ?, driver = ?, seats = ?, start_name = ?, start_lat = ?, start_lon = ? WHERE id = ?')->execute([$label, $driver, $seats, $sName, $sLat, $sLon, $cid]);
                    if (array_key_exists('spec', $c)) {      // an older copy of the page doesn't send the vehicle details: leave them alone
                        db()->prepare('UPDATE camp_reg_cars SET spec = ? WHERE id = ?')->execute([car_spec($c['spec']), $cid]);
                    }
                    $keep[] = $cid;
                } elseif ($open) {      // the number of cars is fixed once registration closes (the travel plan is built on it)
                    db()->prepare('INSERT INTO camp_reg_cars (trip_id, group_id, code, label, driver, seats, start_name, start_lat, start_lon, spec) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
                        ->execute([(int) $g['trip_id'], $gid, reg_code('camp_reg_cars'), $label, $driver, $seats, $sName, $sLat, $sLon, car_spec($c['spec'] ?? null)]);
                    $keep[] = (int) db()->lastInsertId();
                }
            }
            if ($open) {
                foreach (array_diff(array_keys($have), $keep) as $gone) {
                    db()->prepare('UPDATE camp_reg_people SET car_id = NULL WHERE car_id = ?')->execute([$gone]);
                    db()->prepare('DELETE FROM camp_reg_cars WHERE id = ?')->execute([$gone]);
                }
            }
        }
        if (is_array($in['seats'] ?? null)) {
            $cars = array_column(car_rows('c.group_id = ?', [$gid]), 'id');
            foreach ($in['seats'] as $pid => $cid) {
                $cid = (int) $cid;
                db()->prepare('UPDATE camp_reg_people SET car_id = ? WHERE id = ? AND group_id = ?')->execute([in_array($cid, $cars, true) ? $cid : null, (int) $pid, $gid]);
            }
        }
        db()->commit();
        if (is_array($in['cars'] ?? null)) {        // one line for the whole save; saving the same thing again within 10 minutes isn't repeated
            $now = car_rows('c.group_id = ?', [$gid]);
            reg_log('group: ' . $g['name'], 'grp_cars', (int) $g['trip_id'], ['group' => $g['name'], 'cars' => count($now), 'was' => count($have),
                'seats' => array_sum(array_column($now, 'seats')), 'details' => count(array_filter(array_column($now, 'spec')))]);
        }
        reg_rebalance((int) $g['trip_id']);
        json_out(group_view($g, $t));
        break;

    case 'group_add':
        need_post();
        $in = body_json();
        $g = group_by_token($in['g'] ?? '');
        json_out(['extra' => reg_extra_add(trip_by_id((int) $g['trip_id']), $in, (string) $g['name'])]);
        break;

    case 'admin_extra':
        $in = body_json();
        [$t, $u] = reg_team($in['id'] ?? '', true);
        json_out(['extra' => reg_extra_add($t, $in, 'Organisers')]);
        break;

    case 'group_gear':
        need_post();
        $in = body_json();
        $g = group_by_token($in['g'] ?? '');
        $own = db()->prepare("SELECT id, gear FROM camp_reg_people WHERE id = ? AND group_id = ? AND status = 'registered'");
        $own->execute([(int) ($in['id'] ?? 0), (int) $g['id']]);
        $row = $own->fetch();
        if (!$row) {
            fail('That person isn\'t in this group.', 404);
        }
        $old = json_decode((string) $row['gear'], true);
        $ids = array_values(array_unique(array_filter(array_map('strval', is_array($in['gear'] ?? null) ? $in['gear'] : []), function ($x) { return preg_match('/^[A-Za-z0-9_\-]{1,16}$/', $x); })));
        db()->prepare('UPDATE camp_reg_people SET gear = ? WHERE id = ?')
            ->execute([json_encode(['ids' => array_slice($ids, 0, 200), 'note' => (string) ($old['note'] ?? '')], JSON_UNESCAPED_UNICODE), (int) $row['id']]);
        json_out(group_view($g, trip_by_id((int) $g['trip_id'])));
        break;

    case 'group_plan':
        need_post();
        $in = body_json();
        $g = group_by_token($in['g'] ?? '');
        if (!is_array($in['plan'] ?? null)) {
            fail('Nothing to save.');
        }
        $json = json_encode($in['plan'], JSON_UNESCAPED_UNICODE);
        if ($json === false || strlen($json) > REG_PLAN_MAX) {
            fail('The group plan is too long. Shorten the notes a little.');
        }
        // flags are put there by the organisers: a group leader's save can't drop them
        $old = json_decode((string) ($g['plan'] ?? ''), true);
        if (is_array($old) && !empty($old['flags'])) {
            $in['plan']['flags'] = $old['flags'];
            $json = json_encode($in['plan'], JSON_UNESCAPED_UNICODE);
        } else {
            unset($in['plan']['flags']);
            $json = json_encode($in['plan'], JSON_UNESCAPED_UNICODE);
        }
        db()->prepare('UPDATE camp_reg_groups SET plan = ? WHERE id = ?')->execute([$json, (int) $g['id']]);
        reg_log('group: ' . $g['name'], 'grp_plan', (int) $g['trip_id'], ['group' => $g['name']]);
        $g['plan'] = $json;
        json_out(group_view($g, trip_by_id((int) $g['trip_id'])));
        break;

    case 'group_person':
        need_post();
        $in = body_json();
        $g = group_by_token($in['g'] ?? '');
        $gid = (int) $g['id'];
        $t = trip_by_id((int) $g['trip_id']);
        $pid = (int) ($in['id'] ?? 0);
        if ($pid) {
            $own = db()->prepare("SELECT id FROM camp_reg_people WHERE id = ? AND group_id = ? AND status = 'registered'");
            $own->execute([$pid, $gid]);
            if (!$own->fetch()) {
                fail('That person isn\'t in this group.', 404);
            }
        }
        if (!empty($in['remove'])) {
            if (!in_array($t['reg_status'], ['interest', 'open'], true)) {
                fail('Registration has closed. Ask the organiser to remove people, or mark them absent at check-in.', 403);
            }
            db()->prepare("UPDATE camp_reg_people SET status = 'cancelled', car_id = NULL WHERE id = ?")->execute([$pid]);
            db()->prepare('UPDATE camp_reg_groups SET leader_id = NULL WHERE id = ? AND leader_id = ?')->execute([$gid, $pid]);
            reg_log('group: ' . $g['name'], 'grp_person_remove', (int) $g['trip_id'], ['group' => $g['name']], 0);
        } elseif ($pid) {
            // a group leader can fix names and details, but consent stays as the family gave it
            person_update($pid, person_fields(is_array($in['person'] ?? null) ? $in['person'] : [], false, true), false);
            reg_log('group: ' . $g['name'], 'grp_person_edit', (int) $g['trip_id'], ['group' => $g['name']]);
        } else {
            if (!in_array($t['reg_status'], ['interest', 'open'], true)) {
                fail('Registration has closed. Please contact the organiser.', 403);
            }
            $light = $t['reg_status'] === 'interest';
            person_insert((int) $g['trip_id'], $gid, person_fields(is_array($in['person'] ?? null) ? $in['person'] : [], !$light, $light));
            reg_log('group: ' . $g['name'], 'grp_person_add', (int) $g['trip_id'], ['group' => $g['name']], 0);
        }
        reg_rebalance((int) $g['trip_id']);
        json_out(group_view($g, $t));
        break;

    // ----- the trip's team -----

    case 'admin':
        [$t] = reg_team($_GET['id'] ?? '');
        reg_rebalance((int) $t['id']);
        json_out(admin_view($t) + ['csrf' => csrf_token()]);
        break;

    case 'stage':
        $in = body_json();
        [$t, $u] = reg_team($in['id'] ?? '', true);
        $reg = (string) ($in['reg'] ?? '');
        if (!in_array($reg, ['off', 'interest', 'open', 'closed'], true)) {
            fail('Unknown stage.');
        }
        if (in_array($reg, ['interest', 'open'], true) && $t['pub_status'] !== 'published') {
            fail('The plan has to be approved (published) before registration can open.', 403);
        }
        $closes = iso_date($in['closes'] ?? '', 'The closing date', false);
        if (in_array($reg, ['interest', 'open'], true) && $closes !== null && $closes < date('Y-m-d')) {
            fail('The closing date has already passed.');
        }
        db()->prepare('UPDATE camp_trips SET reg_status = ?, reg_closes = ?, reg_token = COALESCE(reg_token, ?), updated_at = updated_at WHERE id = ?')
            ->execute([$reg, $closes, reg_token(), (int) $t['id']]);
        reg_log($u, 'reg_' . $reg, (int) $t['id'], array_filter(['closes' => $closes]), 0);
        json_out(admin_view(trip_by_id((int) $t['id'])));
        break;

    case 'info_save':
        $in = body_json();
        [$t, $u] = reg_team($in['id'] ?? '', true);
        $json = keep_extra($t, $in['info'] ?? []);
        db()->prepare('UPDATE camp_trips SET reg_info = ?, updated_at = updated_at WHERE id = ?')->execute([$json, (int) $t['id']]);
        // the log: the briefing going out or being withdrawn, and the go / no-go decision
        $was = json_decode((string) $t['reg_info'], true);
        $now = json_decode($json, true);
        $brief = function ($i) { return is_array($i) && is_string($i['briefing'] ?? null) ? trim($i['briefing']) : ''; };
        $go = function ($i) { return is_array($i) && is_array($i['decision'] ?? null) && is_bool($i['decision']['go'] ?? null) ? $i['decision']['go'] : null; };
        if ($brief($was) !== $brief($now)) {
            reg_log($u, $brief($now) === '' ? 'reg_brief_off' : ($brief($was) === '' ? 'reg_brief_on' : 'reg_brief_edit'), (int) $t['id'], [], $brief($was) !== '' && $brief($now) !== '' ? 10 : 0);
        }
        if ($go($was) !== $go($now)) {
            reg_log($u, $go($now) === null ? 'reg_decision_clear' : ($go($now) ? 'reg_go' : 'reg_nogo'), (int) $t['id'], [], 0);
        }
        reg_rebalance((int) $t['id']);          // a bigger maximum lets people off the waiting list
        json_out(['ok' => true]);
        break;

    case 'capacity':
        $in = body_json();
        [$t, $u] = reg_team($in['id'] ?? '', true);
        $tid = (int) $t['id'];
        $json = keep_extra($t, $in['info'] ?? []);
        $ids = function ($list) { return array_values(array_unique(array_filter(array_map('intval', is_array($list) ? $list : [])))); };
        db()->beginTransaction();
        db()->prepare('UPDATE camp_trips SET reg_info = ?, updated_at = updated_at WHERE id = ?')->execute([$json, $tid]);
        foreach ($ids($in['demote'] ?? []) as $pid) {       // lose their place: back onto the waiting list (and out of their car seat)
            db()->prepare("UPDATE camp_reg_people SET wait_trip = 1, car_id = NULL WHERE id = ? AND trip_id = ? AND status = 'registered'")->execute([$pid, $tid]);
        }
        foreach ($ids($in['promote'] ?? []) as $pid) {      // the chosen people get a place first; any places left over fill in list order
            db()->prepare("UPDATE camp_reg_people SET wait_trip = 0 WHERE id = ? AND trip_id = ? AND status = 'registered'")->execute([$pid, $tid]);
        }
        db()->commit();
        reg_log($u, 'reg_capacity', $tid, ['max' => is_numeric($in['info']['max'] ?? null) ? (int) $in['info']['max'] : 0, 'promote' => count($ids($in['promote'] ?? [])), 'demote' => count($ids($in['demote'] ?? []))], 0);
        reg_rebalance($tid);
        json_out(admin_view(trip_by_id($tid)));
        break;

    case 'checkin_link':
        $in = body_json();
        [$t, $u] = reg_team($in['id'] ?? '', true);
        db()->prepare('UPDATE camp_trips SET checkin_token = ?, updated_at = updated_at WHERE id = ?')->execute([empty($in['on']) ? null : reg_token(), (int) $t['id']]);
        reg_log($u, empty($in['on']) ? 'checkin_link_off' : 'checkin_link_new', (int) $t['id'], [], 0);
        json_out(admin_view(trip_by_id((int) $t['id'])));
        break;

    case 'admin_person':
        $in = body_json();
        [$t, $u] = reg_team($in['id'] ?? '', true);
        $tid = (int) $t['id'];
        $pid = (int) ($in['pid'] ?? 0);
        $gid = null;
        if (!empty($in['group'])) {
            $chk = db()->prepare('SELECT id FROM camp_reg_groups WHERE id = ? AND trip_id = ?');
            $chk->execute([(int) $in['group'], $tid]);
            if (!$chk->fetch()) {
                fail('That group doesn\'t exist.');
            }
            $gid = (int) $in['group'];
        }
        if ($pid) {
            $own = db()->prepare("SELECT group_id FROM camp_reg_people WHERE id = ? AND trip_id = ? AND status = 'registered'");
            $own->execute([$pid, $tid]);
            $cur = $own->fetch();
            if (!$cur) {
                fail('That person isn\'t registered for this trip.', 404);
            }
            if (!empty($in['remove'])) {
                db()->prepare("UPDATE camp_reg_people SET status = 'cancelled', car_id = NULL WHERE id = ?")->execute([$pid]);
                db()->prepare('UPDATE camp_reg_groups SET leader_id = NULL WHERE leader_id = ?')->execute([$pid]);
                reg_log($u, 'reg_person_remove', $tid, array_filter(['group' => reg_group_name((int) $cur['group_id'])]), 0);
            } else {
                if (is_array($in['person'] ?? null)) {
                    person_update($pid, person_fields($in['person'], false, true), true);
                }
                if (array_key_exists('group', $in) && (int) $cur['group_id'] !== (int) $gid) {
                    db()->prepare('UPDATE camp_reg_people SET group_id = ?, car_id = NULL WHERE id = ?')->execute([$gid, $pid]);
                    db()->prepare('UPDATE camp_reg_groups SET leader_id = NULL WHERE leader_id = ? AND id <> ?')->execute([$pid, (int) $gid]);
                }
                if (isset($in['attend']) && in_array($in['attend'], ['expected', 'present', 'noshow'], true)) {
                    db()->prepare('UPDATE camp_reg_people SET attend = ?, attend_at = NOW() WHERE id = ?')->execute([$in['attend'], $pid]);
                }
                reg_log($u, array_key_exists('group', $in) && (int) $cur['group_id'] !== (int) $gid ? 'reg_person_move' : 'reg_person_edit', $tid, array_filter(['group' => reg_group_name($gid ?: (int) $cur['group_id'])]));
            }
        } else {
            person_insert($tid, $gid, person_fields(is_array($in['person'] ?? null) ? $in['person'] : [], false, true));
            reg_log($u, 'reg_person_add', $tid, array_filter(['group' => reg_group_name($gid)]), 0);
        }
        if ($pid && !empty($in['admit'])) {          // the organiser gives them a place regardless of the maximum
            db()->prepare('UPDATE camp_reg_people SET wait_trip = 0 WHERE id = ? AND trip_id = ?')->execute([$pid, $tid]);
            reg_log($u, 'reg_admit', $tid, [], 0);
        }
        reg_rebalance($tid);
        json_out(admin_view($t));
        break;

    case 'admin_group':
        $in = body_json();
        [$t, $u] = reg_team($in['id'] ?? '', true);
        $tid = (int) $t['id'];
        $gid = (int) ($in['gid'] ?? 0);
        if (!$gid) {
            group_create($tid, (string) ($in['name'] ?? ''));
            reg_log($u, 'reg_group_add', $tid, ['group' => mb_substr(trim((string) ($in['name'] ?? '')), 0, 60)], 0);
        } else {
            $chk = db()->prepare('SELECT id FROM camp_reg_groups WHERE id = ? AND trip_id = ?');
            $chk->execute([$gid, $tid]);
            if (!$chk->fetch()) {
                fail('That group doesn\'t exist.', 404);
            }
            $gname = reg_group_name($gid);
            if (!empty($in['remove'])) {
                db()->prepare('UPDATE camp_reg_people SET group_id = NULL, car_id = NULL WHERE group_id = ?')->execute([$gid]);
                db()->prepare('DELETE FROM camp_reg_cars WHERE group_id = ?')->execute([$gid]);
                db()->prepare('DELETE FROM camp_reg_groups WHERE id = ?')->execute([$gid]);
                reg_log($u, 'reg_group_remove', $tid, ['group' => $gname], 0);
            } else {
                if (isset($in['name']) && trim((string) $in['name']) !== '') {
                    db()->prepare('UPDATE camp_reg_groups SET name = ? WHERE id = ?')->execute([str_field($in, 'name', 60), $gid]);
                }
                if (array_key_exists('leader', $in)) {
                    $lead = (int) $in['leader'];
                    $ok = db()->prepare("SELECT id FROM camp_reg_people WHERE id = ? AND group_id = ? AND status = 'registered'");
                    $ok->execute([$lead, $gid]);
                    db()->prepare('UPDATE camp_reg_groups SET leader_id = ? WHERE id = ?')->execute([$ok->fetch() ? $lead : null, $gid]);
                }
                if (!empty($in['newLink'])) {
                    db()->prepare('UPDATE camp_reg_groups SET token = ? WHERE id = ?')->execute([reg_token(), $gid]);
                }
                reg_log($u, !empty($in['newLink']) ? 'reg_group_link' : 'reg_group_edit', $tid, ['group' => reg_group_name($gid)], !empty($in['newLink']) ? 0 : 10);
            }
        }
        reg_rebalance($tid);
        json_out(admin_view($t));
        break;

    case 'admin_plan':
        $in = body_json();
        [$t, $u] = reg_team($in['id'] ?? '', true);
        $gid = (int) ($in['gid'] ?? 0);
        if (!is_array($in['plan'] ?? null)) {
            fail('Nothing to save.');
        }
        $json = json_encode($in['plan'], JSON_UNESCAPED_UNICODE);
        if ($json === false || strlen($json) > REG_PLAN_MAX) {
            fail('The group plan is too long.');
        }
        $upd = db()->prepare('UPDATE camp_reg_groups SET plan = ? WHERE id = ? AND trip_id = ?');
        $upd->execute([$json, $gid, (int) $t['id']]);
        if ($upd->rowCount()) {
            reg_log($u, 'reg_group_plan', (int) $t['id'], array_filter(['group' => reg_group_name($gid)]));
        }
        json_out(admin_view($t));
        break;

    // ----- the check-in phone app -----

    case 'roster':
        $t = trip_where('checkin_token', $_GET['k'] ?? '');
        $id = (int) $t['id'];
        json_out(['trip' => trip_public($t), 'at' => time(),
                  'groups' => array_map('group_out', group_rows($id)),
                  'people' => array_map(function ($p) { return person_out($p, 'full'); }, people_rows('p.trip_id = ? AND p.wait_trip = 0', [$id])),
                  'cars' => car_rows('c.trip_id = ?', [$id])]);
        break;

    case 'checkin':
        need_post();
        $in = body_json();
        $t = trip_where('checkin_token', $in['k'] ?? '');
        $id = (int) $t['id'];
        $done = 0;
        $undone = 0;
        foreach (array_slice(is_array($in['events'] ?? null) ? $in['events'] : [], 0, 500) as $e) {
            if (!is_array($e)) {
                continue;
            }
            $ts = is_numeric($e['t'] ?? null) ? max(time() - 14 * 86400, min(time() + 300, (int) $e['t'])) : time();
            $by = mb_substr(trim((string) ($e['by'] ?? '')), 0, 40);
            if (!empty($e['car'])) {
                $gear = array_key_exists('gearOk', $e) && $e['gearOk'] !== null ? (empty($e['gearOk']) ? 0 : 1) : null;
                // "undo": arrived false clears the arrival
                if (array_key_exists('arrived', $e) && empty($e['arrived'])) {
                    $stmt = db()->prepare('UPDATE camp_reg_cars SET arrived_at = NULL, arrived_by = \'\', gear_ok = NULL WHERE id = ? AND trip_id = ?');
                    $stmt->execute([(int) $e['car'], $id]);
                    $undone++;
                } else {
                    $stmt = db()->prepare('UPDATE camp_reg_cars SET arrived_at = FROM_UNIXTIME(?), arrived_by = ?, gear_ok = ? WHERE id = ? AND trip_id = ?');
                    $stmt->execute([$ts, $by, $gear, (int) $e['car'], $id]);
                }
                $done++;
            } elseif (!empty($e['person']) && in_array($e['attend'] ?? '', ['expected', 'present', 'noshow'], true)) {
                db()->prepare('UPDATE camp_reg_people SET attend = ?, attend_at = FROM_UNIXTIME(?) WHERE id = ? AND trip_id = ?')
                    ->execute([$e['attend'], $ts, (int) $e['person'], $id]);
                $done++;
                $undone += $e['attend'] === 'expected' ? 1 : 0;
            }
        }
        if ($done > $undone) {          // at most one line each 10 minutes: "check-in recorded", and another when arrivals are undone
            reg_log('check-in', 'checkin', $id);
        }
        if ($undone) {
            reg_log('check-in', 'checkin_undo', $id);
        }
        json_out(['ok' => true, 'applied' => $done]);
        break;

    default:
        fail('Unknown action.', 404);
}

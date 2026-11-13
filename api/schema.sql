-- Camp Planner database tables (MySQL 5.7+ / MariaDB 10.3+).
-- Sign-in uses the program_users / program_login_attempts / program_audit tables,
-- shared with the Grafton Scout Group program editor.

CREATE TABLE IF NOT EXISTS program_users (
    id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    username        VARCHAR(40) NOT NULL,           -- lower-case, used to sign in
    name            VARCHAR(120) NOT NULL DEFAULT '',
    email           VARCHAR(190) NULL,              -- optional contact address
    password_hash   VARCHAR(255) NOT NULL,          -- PHP password_hash() (bcrypt)
    temp_password   VARCHAR(40) NULL,               -- a temporary password, kept only until the leader chooses their own (shown to superusers)
    group_name      VARCHAR(80) NULL,               -- Scout group (e.g. from the member import), for the Users page
    must_change     TINYINT(1) NOT NULL DEFAULT 1,  -- forced password change at next sign-in
    sections        SET('cubs','scouts','venturers') NOT NULL DEFAULT '',
    is_admin        TINYINT(1) NOT NULL DEFAULT 0,
    camp_editor     TINYINT(1) NOT NULL DEFAULT 0,       -- legacy: 1 when camp_role is leader/super
    camp_role       ENUM('none','leader','super') NOT NULL DEFAULT 'none',  -- Camp Planner: plan trips / superuser (sees all, reviews)
    camp_admin      TINYINT(1) NOT NULL DEFAULT 0,       -- manages Camp Planner access (campplanner/users.html)
    status          ENUM('active','revoked') NOT NULL DEFAULT 'active',
    session_version INT UNSIGNED NOT NULL DEFAULT 0, -- bumped to sign the leader out everywhere
    failed_logins   INT UNSIGNED NOT NULL DEFAULT 0,
    locked_until    DATETIME NULL,
    last_login      DATETIME NULL,
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_by      VARCHAR(40) NOT NULL DEFAULT '',
    UNIQUE KEY uq_username (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS program_login_attempts (
    id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ip          VARCHAR(45) NOT NULL,
    username    VARCHAR(40) NOT NULL DEFAULT '',
    success     TINYINT(1) NOT NULL DEFAULT 0,
    KEY ix_attempt_ip (ip, at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS program_audit (
    id           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    username     VARCHAR(40) NOT NULL,
    action       VARCHAR(40) NOT NULL,
    entity       VARCHAR(40) NOT NULL,
    entity_id    INT UNSIGNED NULL,
    detail       TEXT NULL,
    KEY ix_audit_at (at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- Camp Planner ----------
-- One row per trip. `state` is the planner's whole plan as JSON; `meta` is the
-- small summary shown in the trip list. `version` goes up on every save so two
-- editors can't silently overwrite each other.
CREATE TABLE IF NOT EXISTS camp_trips (
    id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    public_id   VARCHAR(16) NOT NULL,                       -- random id used in links and the API (never the number)
    name        VARCHAR(200) NOT NULL DEFAULT '',
    status      ENUM('planning','ready','completed','archived') NOT NULL DEFAULT 'planning',
    start_date  DATE NULL,
    end_date    DATE NULL,
    is_example  TINYINT(1) NOT NULL DEFAULT 0,
    meta        TEXT NOT NULL,
    state       MEDIUMTEXT NOT NULL,
    version     INT UNSIGNED NOT NULL DEFAULT 1,
    created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by  VARCHAR(40) NOT NULL DEFAULT '',
    updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    updated_by  VARCHAR(40) NOT NULL DEFAULT '',            -- created_by is the trip's owner
    planners    VARCHAR(500) NOT NULL DEFAULT '',           -- co-planners' usernames, comma separated
    pub_status  ENUM('draft','review','published') NOT NULL DEFAULT 'draft',
    visibility  ENUM('public','private','secret') NOT NULL DEFAULT 'public',   -- once published: listed / link only / link + lock code
    share_token VARCHAR(32) NULL,                           -- the private/secret link
    lock_hash   VARCHAR(255) NULL,                          -- password_hash() of a secret trip's lock code
    review_round INT UNSIGNED NOT NULL DEFAULT 0,           -- goes up each time the trip is submitted for review
    published_at DATETIME NULL,
    published_version INT UNSIGNED NULL,                    -- version that was approved (later edits are flagged)
    KEY ix_camp_start (start_date),
    join_code   VARCHAR(12) NULL,                           -- phones join the trip with this (phone app)
    field_pack  MEDIUMTEXT NULL,                            -- the plan as the phone app shows it (built by the planner)
    pack_at     DATETIME NULL,
    UNIQUE KEY uq_camp_join (join_code),
    UNIQUE KEY uq_camp_token (share_token),
    UNIQUE KEY uq_camp_public (public_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Review history: submissions, approvals (the author's submission + 1 superuser publishes a trip), change requests, unpublishing
CREATE TABLE IF NOT EXISTS camp_reviews (
    id        INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    trip_id   INT UNSIGNED NOT NULL,
    round     INT UNSIGNED NOT NULL,
    username  VARCHAR(40) NOT NULL,
    decision  ENUM('submit','approve','changes','withdraw','unpublish','published') NOT NULL,
    comment   VARCHAR(1000) NOT NULL DEFAULT '',
    at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY ix_review_trip (trip_id, round)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Phone app: phones joined to a trip, and the positions they report (kept for a year)
CREATE TABLE IF NOT EXISTS camp_devices (
    id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    trip_id     INT UNSIGNED NOT NULL,
    token_hash  CHAR(64) NOT NULL,                          -- sha256 of the phone's token
    name        VARCHAR(40) NOT NULL,
    revoked     TINYINT(1) NOT NULL DEFAULT 0,
    created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_seen   DATETIME NULL,
    status      VARCHAR(12) NULL,                           -- ok | stopped | problem | contact (set on the phone)
    status_note VARCHAR(60) NULL,                           -- "stopped for ..."
    message     VARCHAR(140) NULL,                          -- one-line message
    status_at   DATETIME NULL,
    UNIQUE KEY uq_device_token (token_hash),
    KEY ix_device_trip (trip_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS camp_positions (
    id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    trip_id     INT UNSIGNED NOT NULL,
    device_id   INT UNSIGNED NOT NULL,
    at          DATETIME NOT NULL,                          -- when the phone took the position (server time zone)
    lat         DECIMAL(9,6) NOT NULL,
    lon         DECIMAL(9,6) NOT NULL,
    acc         SMALLINT UNSIGNED NULL,                     -- accuracy, metres
    alt         SMALLINT NULL,
    spd         DECIMAL(4,1) NULL,                          -- m/s
    batt        TINYINT UNSIGNED NULL,                      -- battery %
    UNIQUE KEY uq_pos (device_id, at),
    KEY ix_pos_trip (trip_id, at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Satellite trackers (SPOT / Garmin inReach) added to a trip for the event; their positions go into camp_positions
CREATE TABLE IF NOT EXISTS camp_trackers (
    id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    trip_id     INT UNSIGNED NOT NULL,
    device_id   INT UNSIGNED NOT NULL,                      -- its row in camp_devices
    kind        ENUM('spot','garmin') NOT NULL,
    label       VARCHAR(40) NOT NULL,
    feed        VARCHAR(100) NOT NULL,                      -- SPOT feed id / Garmin MapShare name
    feed_pass   VARCHAR(100) NULL,                          -- feed password (needed to read the feed, so not hashed)
    from_at     DATETIME NOT NULL,                          -- only positions inside this window are kept
    to_at       DATETIME NOT NULL,
    last_poll   DATETIME NULL,
    last_status VARCHAR(200) NOT NULL DEFAULT '',
    created_by  VARCHAR(40) NOT NULL DEFAULT '',
    created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY ix_tracker_trip (trip_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

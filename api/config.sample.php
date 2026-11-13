<?php
// Copy this file to config.php (same folder) and fill in the values.
// config.php holds secrets: it is in .gitignore and must never be committed.

return [
    // MySQL - on the web server the database is on the same machine
    'db_host' => 'localhost',
    'db_name' => 'camp_planner',
    'db_user' => 'camp_planner_user',
    'db_pass' => 'CHANGE-ME',

    // Graphic uploads
    'upload_max_bytes' => 3 * 1024 * 1024,
];

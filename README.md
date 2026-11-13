# Camp Planner

A web app for planning Scout hikes and camps, built for Grafton Scout Group (Scouts Australia, NSW).
It runs as plain HTML/JavaScript pages with a small PHP + MySQL API for sign-in, saving trips and live tracking.

## What it does

- **Trips** – create a trip, set dates, start time, people and vehicles; save it to the server and share it with co-planners.
- **Map and traverse** – draw the route on a topographic map, import/export Avenza Maps files (KML/KMZ/GPX/CSV), and split a traverse into days using campsites and water sources.
- **Travel** – driving routes with alternatives (fastest vs. most fuel-efficient), fuel use that allows for hills, turn-by-turn directions, road profile, staggered departures so all cars arrive together, and suggested rest/fuel stops in towns.
- **Meals, gear, pack weight, risks, weather, budget** – a recipe library, a gear catalogue with search, per-person pack weights, a risk register and forecasts.
- **Report** – a printable plan, with one page per car.
- **Publishing** – trips go draft → review → published (the author plus one superuser). Visibility can be public, private (link only) or secret (link plus lock code). Trip IDs are random.
- **Phone app** (`campplanner/go.html`) – an installable web app for people on the trip. It holds the plan offline, shares location when there's service, sends a simple status message, shows the weather forecast, and has a drag-to-call 000 control. Phones join with a code, so they don't need an account.
- **Live map** – leaders see phones and SPOT / Garmin inReach satellite trackers on the map, with status, speed and direction of travel. Positions are deleted after a year.

## Layout

```
campplanner/     the pages, scripts, styles, images and data files
  data/          gear-catalog.json, recipe-library.json, stops.json (built by tools/)
api/             PHP API: auth.php, camp.php, camp_users.php, track.php, lib/bootstrap.php
  schema.sql     the database tables
tools/           Python scripts that rebuild the data files
```

The `campplanner/` and `api/` folders sit side by side in the web root. The pages call the API at `../api/`.

## Requirements

- Apache with PHP 7.4 or later (PDO MySQL) and `mod_headers`
- MySQL 5.7+ or MariaDB 10.3+
- Python 3 to rebuild the data files (optional)

## Setting up

1. Copy `campplanner/` and `api/` to the web server.
2. Create a MySQL database and user, then run `api/schema.sql` in it.
3. Copy `api/config.sample.php` to `api/config.php` and fill in the database details, including `db_pass`. **`config.php` holds secrets and is ignored by git. Never commit it.**
4. Create the first superuser. Make a password hash with
   `php -r "echo password_hash('a-temporary-password', PASSWORD_DEFAULT);"`, then:
   ```sql
   INSERT INTO program_users (username, name, password_hash, must_change, camp_role, camp_admin, status)
   VALUES ('first.leader', 'First Leader', '<hash>', 1, 'super', 1, 'active');
   ```
   After that, add other leaders from the Camp Planner's **Users** page.

## Things that come from the Grafton Scout Group website

The Camp Planner was built as part of the group's website. These parts still point at it:

- **Sign-in** is shared with the group's program editor (the `program_users` table).
- **Choosing a new password:** the API supports it (`auth.php?action=change_password`), but the page leaders use for it is the website's Leaders page (`../leaders/program.html`), which isn't included here. A standalone install needs its own page for this.
- The header logo and "home" link go to the group's website (`../index.html`).

## Rebuilding the data files

```
python tools/stops_build.py                         # towns, fuel and rest areas from OpenStreetMap (10-15 min)
python tools/gear_catalog_build.py <scrape folder>  # gear catalogue from per-store JSON files
python tools/recipe_library_build.py <recipes.json> # recipe library
```

## Data sources and credits

- Maps, places and stops: © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors (ODbL). `stops.json` is derived from OpenStreetMap and stays under the ODbL.
- Driving routes and elevation: [Valhalla](https://valhalla1.openstreetmap.de/) and OSRM public servers.
- Weather: [Open-Meteo](https://open-meteo.com/).
- Gear catalogue: product names, prices and links from Australian outdoor retailers' public websites. Each item links back to the store.
- Recipes: adapted per serving for hiking, each with a link to its original source.

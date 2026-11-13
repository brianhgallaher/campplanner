/* Camp Planner — help and how-to guide.
   One set of content, shown two ways:
     • the slide-out Help panel in the planner (❓ Help, F1 or ?), which opens at the tab you're on;
     • help.html, the full printable guide.
   Small ? buttons are added next to headings in the planner (see `match`) and jump to the matching section.
   Both views are searchable. */

const HELP = [
  {
    id: 'start', icon: '👋', title: 'Getting started', tab: null,
    sections: [
      {
        id: 'start-what', title: 'What the Camp Planner does',
        keywords: 'about overview introduction purpose',
        body: `
          <p>The Camp Planner is the Grafton Scout Group's tool for planning camps, hikes and expeditions. Each <b>trip</b> brings together everything leaders need:</p>
          <ul>
            <li>a topographic <b>map</b> with MGA grid references, trails, campsites and hazards;</li>
            <li>a <b>route card</b> with distances, climbs, bearings and walking times, split into days;</li>
            <li><b>travel</b> (driving distances, cars, fuel and car shuffles), <b>meals</b>, <b>gear</b> and <b>pack weights</b>;</li>
            <li>a <b>risk assessment</b> and emergency plan, the <b>weather and tides</b>, and a <b>budget</b>;</li>
            <li>a printable <b>trip report</b> that puts the whole plan into one document.</li>
          </ul>
          <p>Work through the tabs from left to right: set up the trip, draw the route on the map, then fill in travel, meals, gear and risks. The Report tab pulls it all together.</p>`
      },
      {
        id: 'start-view', title: 'Viewing and printing (no sign-in needed)',
        keywords: 'visitor parent view only read print public anyone',
        body: `
          <p>Anyone can open the Camp Planner, look at its <b>published</b> trips and print them — parents, youth members and leaders alike. You don't need an account. Start on the <a href="#lp-home" data-help-link>home page and trip map</a>; private and secret trips open from the link their leaders give you.</p>
          <ul>
            <li>Pick a trip from the <b>switcher</b> at the top, or open the <b>🗂️ Trips</b> tab to see them all.</li>
            <li>Use <b>🖨 Print this page</b> to print the tab you're looking at, or the <b>📄 Report</b> tab for the whole plan (see <a href="#report-print" data-help-link>Printing and saving as PDF</a>).</li>
            <li>A blue <b>View only</b> strip under the tabs reminds you that you're viewing. You can still try things out — change a date, move the map — but <b>nothing you change is saved</b>.</li>
          </ul>
          <p class="help-tip">💡 Some details are kept private and don't appear unless you're signed in as a trip editor — see <a href="#start-privacy" data-help-link>Privacy</a>.</p>`
      },
      {
        id: 'start-signin', title: 'Signing in to edit trips',
        keywords: 'login log in account username password leader access editor permission',
        match: ['leader sign in'],
        body: `
          <p>Leaders who have been given <b>Camp Planner access</b> can plan trips: they create their own trips (drafts until reviewed — see <a href="#publish-review" data-help-link>Publishing</a>) and edit the ones they own or co-plan. Superusers can see and edit every trip.</p>
          <ol>
            <li>Click <b>🔑 Leader sign in</b> at the top right (or <b>sign in</b> in the blue strip).</li>
            <li>Enter your leader <b>username and password</b> — the same ones you use for the section program editor.</li>
            <li>The page reloads with your name at the top. The View only strip disappears and the editing buttons appear.</li>
          </ol>
          <p>If you've just been given an account with a <b>temporary password</b>, first sign in on the <a href="../leaders/program.html">Leaders page</a> and choose your own password, then come back.</p>
          <p>If you're signed in but still see <i>View only</i>, either the trip is someone else's (only its leaders and superusers can change it — you can <b>make your own copy</b>), or your account doesn't have Camp Planner access yet — ask a Camp Planner admin (see <a href="#users" data-help-link>Camp Planner users</a>).</p>
          <p>Click your name at the top right to <b>sign out</b>. You're signed out automatically after 8 hours.</p>`
      },
      {
        id: 'start-saving', title: 'Saving, and editing with other leaders',
        keywords: 'autosave save saved unsaved conflict someone else changed overwrite version retry not saved',
        body: `
          <p>When you're signed in, every change <b>saves automatically</b> to the website a second or two after you make it. The top bar shows:</p>
          <table class="help-table">
            <tr><td><b>Unsaved changes…</b> / <b>Saving…</b></td><td>your change is on its way</td></tr>
            <tr><td><b>✓ Saved</b></td><td>everyone now sees your change</td></tr>
            <tr><td><b>⚠ Not saved — retrying</b></td><td>the website couldn't be reached; it tries again every 15 seconds. Don't close the page until it says Saved (the browser will warn you).</td></tr>
          </table>
          <p><b>Two leaders on the same trip.</b> If someone else saved the trip after you opened it, you'll see a red strip saying who changed it. Your latest change has <i>not</i> been saved yet. Choose:</p>
          <ul>
            <li><b>Load their version</b> — reloads the trip with their changes (yours since then are lost);</li>
            <li><b>Keep mine (replace theirs)</b> — saves your copy over theirs.</li>
          </ul>
          <p class="help-tip">💡 Moving the map, viewing the weather and similar actions also save the trip, so it's best if one leader works on a trip at a time. Agree who's editing which tab.</p>`
      },
      {
        id: 'start-navigate', title: 'Finding your way around',
        keywords: 'tabs switcher navigation keyboard shortcuts help search question mark f1',
        body: `
          <ul>
            <li><b>Tabs</b> across the top hold each part of the plan. The address bar keeps the trip and tab, so you can copy the link and send it to someone.</li>
            <li>The <b>trip switcher</b> (drop-down at the top) jumps between active trips; <i>All trips…</i> opens the Trips tab.</li>
            <li>Small <span class="help-i help-i--demo">?</span> buttons next to headings open this guide at the matching section.</li>
            <li>Open help any time with <b>❓ Help</b>, <kbd>F1</kbd>, or <kbd>?</kbd> (when you're not typing in a box). It opens at the tab you're on. Type in the search box to find any topic.</li>
            <li>The <a href="help.html" target="_blank" rel="noopener">full guide</a> opens on its own page, ready to print.</li>
          </ul>`
      },
      {
        id: 'start-privacy', title: 'Privacy — what visitors can and can\'t see',
        keywords: 'private personal hidden redacted address home medical emergency contact names youth child safe',
        body: `
          <p>Trips are public so families can see the plan. To protect people's privacy, anyone who isn't signed in as a trip editor <b>does not see</b>:</p>
          <ul>
            <li>home locations (the trip's and each car's) and the driving routes from them;</li>
            <li>the <b>emergency contact</b> and <b>medical notes</b> in the emergency information.</li>
          </ul>
          <p>Everything else in a trip can be seen by anyone. So:</p>
          <ul>
            <li>use first names or roles (e.g. <i>"Akela"</i>, <i>"Patrol 1"</i>) in <b>People</b> rather than youth members' full names;</li>
            <li>keep individual medical and contact details in Scouts Terrain / the activity forms, not in trip notes.</li>
          </ul>`
      }
    ]
  },

  {
    id: 'trips', icon: '🗂️', title: 'Trips tab — all the group\'s trips', tab: 'trips',
    sections: [
      {
        id: 'trips-list', title: 'Finding and opening a trip',
        keywords: 'list cards filter sort active planning ready completed archived open switch',
        match: ['group trips'],
        body: `
          <p>Each card shows a trip's status, dates, location, people and kilometres of trail. The trip you have open is marked <b>Open now</b>.</p>
          <ul>
            <li>Filter with the buttons: <b>Active</b> (planning + ready), each status, or <b>All</b>.</li>
            <li>Sort by trip date, last edited, or name.</li>
            <li>Click <b>Open</b> on a card to switch to that trip.</li>
            <li><b>⬇</b> downloads a copy of the trip as a file.</li>
          </ul>`
      },
      {
        id: 'trips-new', title: 'Starting a new trip',
        keywords: 'new create template copy gear people recipes cars example larapinta sample',
        body: `
          <p><i>Editors only.</i> At the top of the Trips tab:</p>
          <ul>
            <li><b>+ New trip</b> — a blank plan with the starter recipes.</li>
            <li><b>+ New trip using my gear &amp; people</b> — copies the <b>people, gear list, recipes, cars, home and emergency contacts</b> from the trip you have open, but not its map, meals or dates. Great for a series of similar camps.</li>
            <li><b>+ Add an example trip…</b> — adds a complete worked example (the Larapinta Trail end-to-end) to look at or copy from.</li>
          </ul>
          <p>Then go to the <a href="#trip-basics" data-help-link>Trip tab</a> to name it and set the dates.</p>`
      },
      {
        id: 'trips-manage', title: 'Status, duplicating and deleting',
        keywords: 'status planning ready to go completed archived duplicate copy delete remove',
        body: `
          <p><i>Editors only.</i> On each card:</p>
          <ul>
            <li><b>Status</b> — <i>Planning</i>, <i>Ready to go</i>, <i>Completed</i> or <i>Archived</i>. Completed and archived trips drop out of the Active list and the switcher but are kept for next time.</li>
            <li><b>⧉ Duplicate</b> — an exact copy (status reset to Planning), e.g. to run the same hike again next year.</li>
            <li><b>🗑 Delete</b> — removes the trip for everyone. This can't be undone, so download it first (⬇) if you might want it back.</li>
          </ul>`
      },
      {
        id: 'trips-backup', title: 'Exporting, backing up and importing',
        keywords: 'export import backup file json download offline share',
        match: ['backup & share'],
        body: `
          <ul>
            <li><b>⬇ Export all trips</b> downloads every trip in one file — a handy backup.</li>
            <li><b>⬆ Import trips</b> (<i>editors only</i>) adds trips from a file exported here or from the offline Camp Planner. Imported trips are always <b>added</b>; nothing is overwritten.</li>
          </ul>
          <p>Visitors' exports leave out the private details listed under <a href="#start-privacy" data-help-link>Privacy</a>.</p>`
      }
    ]
  },

  {
    id: 'trip', icon: '🧭', title: 'Trip tab — details, location and people', tab: 'trip',
    sections: [
      {
        id: 'trip-basics', title: 'Name, dates, status and notes',
        keywords: 'name title start end date nights days status notes intentions',
        match: ['trip details', 'basics'],
        body: `
          <ul>
            <li><b>Trip name</b> and <b>Status</b> appear on the Trips list and every printout.</li>
            <li><b>Start / End date</b> set the number of days. Days are numbered <i>Day 1, Day 2…</i>, so changing the dates later keeps your meal plan in place.</li>
            <li><b>Notes / trip intentions</b> — the route, planned campsites and return time. This goes on the report cover and emergency plan.</li>
          </ul>`
      },
      {
        id: 'trip-location', title: 'Camp location, grid reference and park',
        keywords: 'location search camp pick on map latitude longitude grid reference park state declination coastal tides',
        match: ['camp location'],
        body: `
          <ol>
            <li>Type a place, park, campground or town in <b>Search</b> and pick a result, <b>or</b> click <b>⛺ Pick on map</b> and click the camp on the map.</li>
            <li>The planner fills in the <b>grid reference</b> (6-figure MGA, as on a topo map), the <b>state</b>, the <b>national park</b> it's in, and the <b>magnetic declination</b>.</li>
            <li>Tick <b>Coastal camp</b> to show tides on the Weather tab.</li>
          </ol>
          <p>The camp location is used for the weather forecast, nearest hospital and police, and the map's starting view.</p>`
      },
      {
        id: 'trip-home', title: 'Home location',
        keywords: 'home address start drive travel my location suburb',
        match: ['home location'],
        body: `
          <p>Where the group drives from — usually the Scout hall. It's used on the Travel tab for driving distances, fuel and the timetable.</p>
          <ul>
            <li>Search an address, suburb or town, or click <b>📍 Use my location</b>.</li>
            <li>Each car can leave from a different place (Travel tab → <b>Other…</b>).</li>
          </ul>
          <p class="help-tip">🔒 Home locations are only shown to signed-in trip editors.</p>`
      },
      {
        id: 'trip-people', title: 'People',
        keywords: 'people party members add remove body weight water carried names',
        match: ['people', 'party'],
        body: `
          <ul>
            <li><b>+ Add person</b> for everyone going. Names are used to share out gear and costs.</li>
            <li><b>Body weight</b> is used to check pack weight (aim for no more than 20% of body weight).</li>
            <li><b>Water carried</b> is how much each person starts the day with.</li>
            <li>Removing a person makes their gear shared group gear.</li>
          </ul>
          <p class="help-tip">💡 Trips can be seen by the public — use first names or roles for youth members (see <a href="#start-privacy" data-help-link>Privacy</a>).</p>`
      },
      {
        id: 'trip-overview', title: 'Trip overview tiles',
        keywords: 'summary overview tiles totals',
        match: ['trip overview'],
        body: `<p>A quick summary of the plan — distance, meals, gear, pack weights, risks and cost. Click a tile to go to that tab.</p>`
      },
      {
        id: 'trip-backup', title: 'Save & backup: export, import and clear',
        keywords: 'export import clear reset blank backup file',
        match: ['save & backup'],
        body: `
          <ul>
            <li><b>⬇ Export this trip</b> downloads the plan as a file (to share, or to open in the offline Camp Planner).</li>
            <li><b>⬆ Import a trip</b> (<i>editors</i>) adds a trip from a file as a new trip.</li>
            <li><b>Clear this trip</b> (<i>editors</i>) resets this trip's map, meals, gear and risks back to a blank plan. Other trips aren't affected. Export first if you might want it back.</li>
          </ul>`
      }
    ]
  },

  {
    id: 'map', icon: '🗺️', title: 'Map tab — topo maps, trails and campsites', tab: 'map',
    sections: [
      {
        id: 'map-search', title: 'Moving around and searching',
        keywords: 'search place park campground zoom pan go',
        body: `
          <p>Drag to move the map and scroll (or pinch) to zoom. Type in <b>Search a place, park or campground</b> and click <b>Go</b> to fly there.</p>
          <p>The box at the bottom of the map shows the <b>grid reference under the mouse</b>.</p>`
      },
      {
        id: 'map-tools', title: 'Drawing: landmarks, trails, areas and the camp',
        keywords: 'tools draw landmark trail area camp select pin marker line polygon keyboard enter backspace escape double click',
        match: ['tools'],
        body: `
          <p>Choose a tool in <b>Tools</b>, then click on the map:</p>
          <table class="help-table">
            <tr><td><b>✋ Select</b></td><td>pan the map; click a feature to edit it</td></tr>
            <tr><td><b>📍 Landmark</b></td><td>click to drop a point (campsite, water, lookout, hazard, car park…). Pick its type first.</td></tr>
            <tr><td><b>〰️ Trail</b></td><td>click along the route — it follows the tracks. <kbd>Shift</kbd>-click for a straight leg, <kbd>S</kbd> to switch between tracks and straight lines. <kbd>Double-click</kbd> or <kbd>Enter</kbd> to finish, <kbd>Backspace</kbd> to undo the last point, <kbd>Esc</kbd> to cancel.</td></tr>
            <tr><td><b>⬠ Area</b></td><td>click around an area (e.g. a no-go zone); finish the same way</td></tr>
            <tr><td><b>⛺ Camp</b></td><td>click to set the main camp location</td></tr>
          </table>
          <p class="help-tip">💡 Mark hazards (river crossings, cliffs) as landmarks — the Risks tab can turn them into risks with grid references.</p>`
      },
      {
        id: 'map-snap', title: 'Following tracks, and straight (off-track) legs',
        keywords: 'snap tracks follow routing osm openstreetmap nsw official fire trails straight line off track cross country bearing leg shift brouter',
        body: `
          <p>Trails <b>always follow the walking tracks by default</b>: each click on the Trail tool joins on along the tracks from your previous point.</p>
          <p><b>Follow tracks using</b> chooses the track data:</p>
          <ul>
            <li><b>OpenStreetMap tracks</b> — all of Australia, with surface types;</li>
            <li><b>NSW official tracks &amp; fire trails</b> — NSW Spatial Services data with official track names (points within about 70 km).</li>
          </ul>
          <p>If one source can't find a track, the next is tried, and as a last resort the points are joined with a straight line (you'll see a message).</p>
          <h4>Straight-line legs (off-track, on a bearing)</h4>
          <p>For a cross-country section — a ridge with no track, a creek crossing, a beach — make just that leg a straight line:</p>
          <ul>
            <li><b>While drawing a trail:</b> hold <kbd>Shift</kbd> as you click to make that one leg straight; or press <kbd>S</kbd> (or <b>📏 Straight line</b> under the drawing buttons) to keep drawing straight legs, and <kbd>S</kbd> / <b>〰️ Follow tracks</b> again to go back.</li>
            <li><b>Route between places:</b> under each stop choose <b>〰️ Follow tracks</b> or <b>📏 Straight line (off-track)</b> for the leg to the next stop — see <a href="#map-route" data-help-link>Route between places</a>.</li>
            <li><b>A trail you've already mapped:</b> open it under <b>Features</b> and change a leg under <b>Legs</b> — see <a href="#map-features" data-help-link>Editing features</a>.</li>
          </ul>
          <p>Straight legs show on the map as a <b>dashed white line</b> along the trail, count as <b>Off-track</b> on the route card (slower walking speed), and still get grid and magnetic bearings.</p>`
      },
      {
        id: 'map-dayplan', title: 'Plan days — split a trail into days',
        keywords: 'plan days split trail nights campsites huts water sources creek crossing bush camp walking hours per day itinerary overnight swap pin',
        match: ['plan days'],
        body: `
          <p>Open a trail under <b>Features</b> (or on the Traverse tab) and click <b>🗓 Plan days</b>. The planner:</p>
          <ol>
            <li>works out the walking time along the trail, using the same speeds and climb allowance as the route card;</li>
            <li>searches OpenStreetMap, plus the campsites and water already on your map, for <b>campsites, huts and shelters</b> and <b>water</b> near the trail. Water includes taps, tanks, springs and creek or river crossings. Seasonal creeks are marked <i>may be dry</i>;</li>
            <li>suggests where to stop each night, so each day is close to your <b>walking hours a day</b>, no day is longer than your <b>longest day</b>, and camps with water are preferred.</li>
          </ol>
          <ul>
            <li>Choose <b>Days</b> to fit the walk into a set number of days, or leave it on <i>Best fit</i>.</li>
            <li><b>Search within</b> sets how far from the trail to look. Camps off the trail include the extra walk in and out.</li>
            <li>Tick <b>Allow bush camps</b> to fill long gaps with a spot on the trail. Check that bush camping is allowed there.</li>
            <li>If the trail already has campsites, they're kept as nights unless you untick <b>Keep the campsites already on the route</b>.</li>
            <li>Change a night with <b>Swap this night for…</b>, or click a ⛺ on the map and choose <b>📌 Stop here for a night</b>. <b>Undo swaps and pins</b> starts again.</li>
            <li>Each day shows its distance, time, climb, the water you pass, and whether there's water at camp. The longest stretch without known water is flagged so you can plan water carries or drops.</li>
          </ul>
          <p><b>✔ Use this plan</b> adds the chosen camps (and, if ticked, the water sources) to the map as the trail's overnight stops. The route card, <a href="#map-days" data-help-link>Zoom to day</a>, drops and the report then split into those days.</p>
          <p>If the plan has a different number of days from the trip's dates, the planner offers to <b>change the trip's end date</b> to match. That box is ticked when the walk is longer than the trip, and unticked when it's shorter, in case the extra days are for travel or rest. The meal plan, weather and other day-by-day tabs then use the new length. Set the start date on the Trip tab first.</p>
          <p class="muted">OpenStreetMap is mapped by volunteers, so campsites can be missing or closed and water sources can be dry. Check with the park office and current notes before you rely on them.</p>`
      },
      {
        id: 'map-days', title: 'Zooming to one day of the walk',
        keywords: 'zoom day days daily section leg frame highlight print day map',
        body: `
          <p>Use the <b>📅 Zoom to day</b> drop-down just above the map. Pick a day to fit the map to that day's walk. The day is highlighted in yellow, with its start (green) and end (red) marked. <i>Whole route</i> shows the entire trail.</p>
          <p>Each trail under <b>Features</b> also has <b>Day 1, Day 2…</b> buttons that do the same thing.</p>
          <p>Days are split the same way as the route card: a new day starts after each <b>campsite</b> on the trail. If a trail shows only <i>Whole route</i>, add campsite landmarks along it, or use <a href="#map-route" data-help-link>Route between places</a>.</p>
          <p class="help-tip">💡 To print a map of one day, zoom to that day, then use <b>🖨 Print map…</b>. The Report tab can also print a map for every day.</p>`
      },
      {
        id: 'map-route', title: 'Route between places',
        keywords: 'route between campsites stops order map trail along tracks itinerary',
        match: ['route between places'],
        body: `
          <p>The quickest way to build a multi-day route:</p>
          <ol>
            <li>Drop landmarks for the start, each campsite and the finish.</li>
            <li>In <b>Route between places</b>, add them as stops in walking order (<b>+ add a stop…</b>, or <b>All campsites</b>). Use ↑ to reorder.</li>
            <li>Every leg follows the tracks. For any leg that should be a straight, off-track line, change the drop-down under that stop to <b>📏 Straight line (off-track)</b>.</li>
            <li>Click <b>〰️ Map trail along tracks</b>. The planner draws the trail and marks the stops, so the route card splits into days at each campsite.</li>
          </ol>`
      },
      {
        id: 'map-data', title: 'Parks, official tracks and campgrounds',
        keywords: 'national parks capad reserves official walking tracks fire trails campgrounds huts lookouts water overlay data',
        match: ['parks & track data'],
        body: `
          <ul>
            <li><b>National parks &amp; reserves</b> — park boundaries for all of Australia.</li>
            <li><b>Official walking tracks &amp; fire trails</b> — NSW tracks (dotted pink = walking track, brown = vehicle / fire trail).</li>
            <li><b>Campgrounds, huts, lookouts &amp; water</b> — click one to add it to your plan as a landmark.</li>
          </ul>
          <p>Zoom in if a layer says there's too much to show.</p>`
      },
      {
        id: 'map-base', title: 'Base maps and the grid',
        keywords: 'base map topo nsw tasmania satellite streets hillshade labels grid mga latitude longitude contours',
        match: ['base map'],
        body: `
          <ul>
            <li><b>Base map</b> — OpenTopoMap contours, <b>NSW official topo</b>, Tasmania topo, Esri topo, satellite or streets. The NSW topo matches the printed NSW maps.</li>
            <li><b>Hillshade</b> adds terrain shading; <b>Show labels</b> names your landmarks on the map.</li>
            <li><b>Grid</b> — the <b>MGA grid</b> (1 km squares, like a topo map), latitude/longitude, or none.</li>
          </ul>`
      },
      {
        id: 'map-features', title: 'Editing features',
        keywords: 'features list edit rename colour points reverse elevation delete undo landmarks trails areas',
        match: ['features', 'landmarks', 'trails', 'areas'],
        body: `
          <p>Everything you've drawn is listed under <b>Features</b>. Open one to change its name, type, colour, line style and notes. For trails:</p>
          <ul>
            <li><b>✏️ Edit points</b> — drag points on the map; <b>➕ Add points</b> to extend it;</li>
            <li><b>⇄ Reverse</b> — walk it the other way; <b>⛰ Elevation</b> — show its height profile;</li>
            <li><b>🥾 Traverse</b> — open its route card; <b>🔍 Zoom</b> to it; <b>🗑 Delete</b>.</li>
          </ul>
          <p><b>Legs</b> (trails made with <i>Route between places</i>): switch any leg between <b>〰️ Tracks</b> and <b>📏 Straight</b>. The trail is re-mapped straight away, using where each stop's landmark is now. Points you've moved by hand on that trail are replaced, so you'll be asked first.</p>`
      },
      {
        id: 'map-show', title: 'Hiding objects on the map',
        keywords: 'hide show hidden objects landmarks egress clutter tidy visibility toggle eye',
        match: ['show on map'],
        body: `
          <p>Too much on the map? Use <b>Show on map</b> to untick a whole group: trails, areas, the camp location, or a landmark type such as <i>Emergency / evacuation point</i>, <i>Water source</i> or <i>Car park</i>. The count shows how many of each there are. <b>👁 Show all</b> and <b>🙈 Hide all</b> do everything at once.</p>
          <p>To hide one item, open it under <b>Features</b> and click <b>🙈 Hide on map</b> (it's greyed out in the list and marked <i>hidden</i>; click <b>👁 Show on map</b> to bring it back).</p>
          <p>Hidden items are saved with the trip and are also left off the <b>printed map</b>, its legend and the <b>report's maps</b>. They're still part of the plan — the route card, risks, egress list and map key still include them.</p>`
      },
      {
        id: 'map-gpx', title: 'GPS files and Avenza Maps',
        keywords: 'gpx gps export import garmin phone app track waypoint avenza maps kml kmz csv placemark layer geopdf recorded track',
        match: ['gps files & avenza maps', 'gps files'],
        body: `
          <p><b>⬇ Export GPX</b> saves your trails and landmarks for a GPS or phone app.</p>
          <p><b>Avenza Maps — sending the plan out:</b></p>
          <ol>
            <li>Click <b>⬇ Export for Avenza (KML)</b>. The file holds the landmarks (with their type, notes and grid reference), trails in their colours, and areas.</li>
            <li>Get the file onto the phone (email, AirDrop, cloud drive).</li>
            <li>In Avenza Maps open the map you'll use, tap <b>Map Features</b> (the layers button), then <b>Import</b>, and choose the file. The features appear on that map.</li>
          </ol>
          <p><b>Bringing things back in:</b> in Avenza open <b>Map Features</b>, choose the layer, tap <b>Export</b> and pick KML, KMZ, GPX or CSV. Back in the planner click <b>⬆ Import KML / KMZ / GPX / CSV</b>. Placemarks become landmarks (the type is guessed from the name, such as “camp” or “water”), recorded tracks and lines become trails, and areas become areas. Anything already on the map with the same name in the same place is skipped, so a layer can go out and come back without doubling up. Photos attached to placemarks are not imported.</p>
          <p class="muted">The base map itself doesn't come from the planner: Avenza uses its own georeferenced maps. The NSW Spatial Services topographic maps are free in the Avenza Map Store.</p>`
      },
      {
        id: 'map-print', title: 'Printing the map',
        keywords: 'print map a4 landscape portrait legend frame scale',
        body: `
          <ol>
            <li>Click <b>🖨 Print map…</b> (or <b>Print this page</b> on the Map tab).</li>
            <li>Pan and zoom to frame the area, set the title and paper (A4 landscape or portrait), and choose whether to add a <b>legend page</b> listing every location's grid reference.</li>
            <li>Click <b>🖨 Print</b>.</li>
          </ol>
          <p>The printout shows the MGA grid, zone and grid magnetic angle. For a whole-trip map set, use the <a href="#report-sections" data-help-link>Report tab</a>.</p>`
      },
      {
        id: 'map-gridref', title: 'About grid references',
        keywords: 'grid reference gr mga2020 easting northing zone six figure declination magnetic compass gma',
        body: `
          <ul>
            <li>Locations are given as six-figure <b>MGA2020</b> grid references, e.g. <b>GR 525092</b>: three easting digits then three northing digits, to 100 m — the same as on Australian topo maps.</li>
            <li>The full MGA coordinates (zone, easting, northing) are shown as well.</li>
            <li>Magnetic declination is an estimate (about ±1°). For compass work use the grid magnetic angle printed on your topo map.</li>
          </ul>`
      }
    ]
  },

  {
    id: 'traverse', icon: '🥾', title: 'Traverse tab — route card, egress and drops', tab: 'traverse',
    sections: [
      {
        id: 'traverse-profile', title: 'Terrain profile',
        keywords: 'profile elevation climb descent gradient steep track type high low',
        match: ['traverse', 'terrain profile', 'gradient', 'track type'],
        body: `
          <p>Choose a trail at the top. The <b>terrain profile</b> shows height along the route, shaded by steepness, with the type of track underneath (walking track, fire trail, road or off-track).</p>
          <p>Below it: total distance, climb and descent, estimated walking time, the high and low points, the parks crossed, and breakdowns by gradient and by track type.</p>
          <p class="help-tip">Heights come from a 90 m terrain model, so small cliffs and steps won't show.</p>`
      },
      {
        id: 'traverse-card', title: 'Route card',
        keywords: 'route card legs bearing grid magnetic time distance cumulative days split hazards',
        match: ['route card'],
        body: `
          <p>One row (<b>leg</b>) per stop, split into <b>days</b> at each campsite. Each leg gives:</p>
          <ul>
            <li>start and end grid references, distance, climb and descent, and the steepest grade;</li>
            <li><b>grid and magnetic bearings</b> and the estimated <b>time</b>, plus running totals;</li>
            <li>the terrain on the leg — track types, named tracks, each significant climb or descent, and hazards you've marked.</li>
          </ul>
          <p>Add or reorder stops on the Map tab (<a href="#map-route" data-help-link>Route between places</a>) to change the legs.</p>`
      },
      {
        id: 'traverse-egress', title: 'Egress points and vehicle access',
        keywords: 'egress exit evacuation vehicle access road 2wd 4wd awd fire trail gated emergency',
        match: ['egress points & vehicle access', 'vehicle access points'],
        body: `
          <p>Lists every place the route meets a road or vehicle track, with km along the route, grid reference and what can reach it: <b>2WD</b>, <b>high-clearance / AWD</b>, <b>4WD only</b>, <b>fire trail (may be gated)</b> or <b>authorised vehicles only</b>.</p>
          <p>It also shows the longest stretch with no vehicle access and the furthest you'd be from a track.</p>
          <ul>
            <li><b>📍 Add to map</b> marks an egress point on the map;</li>
            <li><b>📋 Copy to emergency plan</b> adds the list to the emergency information;</li>
            <li><b>↻ Recheck</b> if the road data service was busy.</li>
          </ul>`
      },
      {
        id: 'traverse-drops', title: 'Food and water drops',
        keywords: 'food drop water cache resupply placed pick up suggest drops',
        match: ['food & water drops', 'drops', 'packing list for each drop'],
        body: `
          <p>Plan caches of food, water and gear placed along the route before the walk.</p>
          <ol>
            <li>Click <b>+ Add drop</b> (or <b>✨ Suggest drops</b> to place one at each overnight camp).</li>
            <li>Choose where it is (a campsite, egress point or water source, or a km along the trail).</li>
            <li>Choose the <b>food for days</b> it holds, the <b>water</b> left there, and any gear moved out of packs. Add who places it and when.</li>
          </ol>
          <p>Each drop shows its grid reference, vehicle access and pick-up day, and warns if the food would be needed before you reach it.</p>`
      },
      {
        id: 'traverse-weight', title: 'Pack weight along the route',
        keywords: 'pack weight chart along route with without drops',
        match: ['pack weight along the route'],
        body: `<p>A chart of each person's pack weight along the walk, with and without the drops (dashed = without). The Pack Weight tab's start-of-day weights include the drops.</p>`
      },
      {
        id: 'traverse-water', title: 'Water plan',
        keywords: 'water plan refill tank dry camp carry litres per hour reserve',
        match: ['water plan'],
        body: `
          <p>Works out how much water to carry between refill points, including dry camps. Set:</p>
          <ul>
            <li><b>Drinking on the move</b> (litres per hour);</li>
            <li><b>Dry camp — cooking &amp; overnight</b> (litres);</li>
            <li><b>Reserve on arrival</b> (litres you want left when you get there).</li>
          </ul>
          <p>Mark water sources as landmarks on the map so the plan knows where you can refill. Always check water sources are flowing before you rely on them.</p>`
      }
    ]
  },

  {
    id: 'travel', icon: '🚗', title: 'Travel tab — driving, cars and car shuffles', tab: 'travel',
    sections: [
      {
        id: 'travel-distances', title: 'Distances and the walk start and finish',
        keywords: 'distance drive driving time walk start finish recalculate routes',
        match: ['travel plan', 'distances'],
        body: `
          <p>Uses the <a href="#trip-home" data-help-link>home location</a> from the Trip tab. Choose the <b>🟢 Walk start</b> and <b>🏁 Walk finish</b> (landmarks on the map). The planner shows driving distance and time for home → start, start ↔ finish and finish → home, with a route map.</p>
          <p>Click <b>↻ Recalculate routes</b> after changing places.</p>`
      },
      {
        id: 'travel-cars', title: 'Cars and fuel',
        keywords: 'car vehicle driver seats fuel type economy litres 100km tank electric diesel cost',
        match: ['cars', 'where does'],
        body: `
          <p><b>+ Add car</b> for each vehicle: driver, seats, <b>fuel type</b> (91, E10, 95, 98, diesel, LPG or electric), <b>average economy</b>, load allowance and tank size. The planner works out each car's fuel and <b>cost</b>, and warns if a tank won't cover the distance.</p>
          <p>A car can leave from somewhere other than the group home — click <b>Other…</b> next to it.</p>
          <p><b>Hills:</b> the fuel figure allows for the climbs and descents on the actual roads. Climbing uses extra fuel for the car's <b>loaded weight</b> (car, people and gear — set it in <i>Loaded kg</i>), and going downhill saves some, more for electric cars because they recover energy when braking. The small grey line under each car's fuel shows the hill effect, for example <i>hills +6%</i>. Enter economy as your flat-road figure.</p>`
      },
      {
        id: 'travel-routes', title: 'Route options: fastest, least fuel or a balance',
        keywords: 'route options alternative fastest shortest least fuel balance time value hills climb descent unsealed gravel dirt road 2wd towing caravan',
        match: ['route options'],
        body: `
          <p>For each drive the planner finds the <b>fastest route</b>, up to two <b>alternatives</b> and the <b>shortest route</b>, with the distance, time, total climb and descent, and the fuel and fuel cost for the first car.</p>
          <ul>
            <li><b>Choose routes for</b> sets the goal: <i>Fastest</i>, <i>Least fuel</i>, or <i>Balance time and fuel</i>, which counts each hour of driving as worth the dollar figure you enter (default $25) and picks the cheapest overall.</li>
            <li>The chosen route is marked <b>best</b>. Click another route to use it instead, and <b>Go back to the best route</b> to undo.</li>
            <li>Tick <b>Avoid unsealed roads</b> for 2WD cars, caravans and trailers. Shorter country routes often use gravel roads.</li>
            <li>Each direction is planned separately, because the climbs and turns are different on the way home.</li>
            <li>The other routes show as grey dotted lines on the travel map.</li>
          </ul>`
      },
      {
        id: 'travel-stops', title: 'Rest and fuel stops',
        keywords: 'rest stop fuel stop refuel petrol station roadhouse town break driver reviver tank range charging electric stop revive survive',
        match: ['rest & fuel stops'],
        body: `
          <p><b>⛽ Rest &amp; fuel stops</b> plans each car's stops along its chosen road:</p>
          <ul>
            <li>Every car <b>starts with a full tank</b>. Fuel use (including hills) is tracked from the car's <b>tank size</b> and economy, and carried over to the trip home.</li>
            <li>Drives over 3 hours get a <b>rest stop about every 2 hours</b>, anywhere from 1 h 45 m to 2 h 15 m, so it can land in a town.</li>
            <li>Cars <b>refuel before 20% is left</b>, and the planner combines refuelling with a rest stop where it can. A car heading to the walk that would arrive under half full tops up in the last town before the trailhead.</li>
            <li><b>Towns come first</b> (bigger towns, and places with fuel and toilets), then service stations and roadhouses, then rest areas. A stop on the open road is only used when there's nothing else.</li>
            <li>Stops take 15 minutes (rest or fuel) or 20 minutes (both). They're added to the drive time, so the staggered departures still bring every car in together, and they show in the timetable and on the travel map.</li>
          </ul>
          <p class="muted">Towns, fuel stations and rest areas come from OpenStreetMap. On long country runs, especially at night, check that fuel is open. Electric cars stop at towns with a charger.</p>`
      },
      {
        id: 'travel-directions', title: 'Turn-by-turn directions and road profile',
        keywords: 'directions turn by turn navigation instructions road profile elevation steep grade hill climb descent print',
        match: ['directions & road profile'],
        body: `
          <p><b>🧭 Directions &amp; road profile</b> shows each drive's turn-by-turn directions, with the distance to the next turn and the running kilometre count. Pick the drive from the list (home to the start, back home, the shuffle drive and so on).</p>
          <p>The <b>road profile</b> shows the height of the road along the route. Stretches steeper than 8% are shaded orange and steeper than 12% red, and the steepest kilometre is labelled. Use a low gear on long descents, and take extra care when towing.</p>
          <p>Both print in the <b>Report</b> under <i>Driving directions</i>. Directions come from OpenStreetMap, so check road conditions and closures before you go.</p>`
      },
      {
        id: 'travel-prices', title: 'Fuel prices',
        keywords: 'fuel price petrol diesel per litre kwh local',
        match: ['fuel prices'],
        body: `<p>Set local prices per litre (or per kWh) so fuel costs are realistic. Links are given to fuel price websites.</p>`
      },
      {
        id: 'travel-shuffle', title: 'Car shuffle for through-walks',
        keywords: 'car shuffle through walk shuttle taxi start finish leave cars mode',
        match: ['car shuffle', 'getting between finish and start'],
        body: `
          <p>When a walk finishes somewhere other than it starts, choose <b>Getting between finish and start</b>:</p>
          <ul>
            <li><b>Car shuffle</b> — choose which cars wait at the start and which are left at the finish. You get step-by-step instructions and seat checks.</li>
            <li><b>Shuttle / taxi</b> — enter the shuttle cost instead.</li>
          </ul>`
      },
      {
        id: 'travel-timetable', title: 'Timetable and checks',
        keywords: 'timetable leave home time arrive breaks rest checks warnings getting there getting home',
        match: ['timetable', 'getting there', 'getting home', 'checks'],
        body: `
          <p>Set <b>Start walking at</b> on the <b>Trip</b> tab and the planner works backwards: when the cars must meet (allowing time to park, and for a car shuffle or shuttle drive) and when each car must leave home. Without a start time, set <b>Leave home at</b> instead. Set <b>Finish walking at (last day)</b> for the trip home. The timetable for the first and last days includes a 15-minute rest stop every 2 hours on drives over 3 hours.</p>
          <p>With more than one car, departures are <b>staggered</b> so every car arrives at the trail start (or the finish, for a car shuffle) at the same time: the car with the longest drive leaves at <b>First car leaves home at</b>, and each other car's leaving time shows in the Cars table and the timetable.</p>
          <p><b>Checks</b> lists anything that needs attention — not enough seats, a missing home, a car that won't make it on one tank.</p>`
      }
    ]
  },

  {
    id: 'meals', icon: '🍳', title: 'Meals tab — meal plan, recipes and shopping', tab: 'meals',
    sections: [
      {
        id: 'meals-plan', title: 'Building the meal plan',
        keywords: 'meal plan breakfast lunch dinner snacks servings copy day add recipe',
        match: ['meal planner', 'meal plan'],
        body: `
          <ol>
            <li>Each row is a day of the trip; columns are <b>Breakfast</b>, <b>Lunch</b>, <b>Dinner</b> and <b>Snacks &amp; drinks</b>.</li>
            <li>Add a recipe to a meal. <b>Servings</b> default to the number of people — change them if needed.</li>
            <li><b>⧉ copy ↓</b> copies a day's meals to the next day.</li>
          </ol>
          <p>The right-hand column shows each day's food weight and energy per person.</p>`
      },
      {
        id: 'meals-recipes', title: 'Recipes',
        keywords: 'recipe library new edit duplicate ingredients weight kcal cost equipment water method',
        match: ["this trip's recipes", 'recipes'],
        body: `
          <p>Click <b>+ New recipe</b>, or <b>Edit</b> / <b>Duplicate</b> one in the library. For each recipe enter:</p>
          <ul>
            <li>the usual meal, and <b>ingredients per serving</b> — quantity, weight, kcal and cost (<b>+ Ingredient</b> to add more);</li>
            <li>the <b>equipment</b> needed to cook it (checked against your gear list);</li>
            <li><b>water needed to cook</b> (ml per serving) and the method.</li>
          </ul>
          <p>Each recipe shows its <b>$ per serving</b>. Starter recipes come already priced.</p>`
      },
      {
        id: 'meals-library', title: 'Recipe library — find hiking & camping recipes',
        keywords: 'recipe library find search browse add dehydrated vegetarian no-cook dessert drink kcal per gram lightest backpacking chef slower hiking bushwalkers source',
        match: ['recipe library'],
        body: `
          <p>Click <b>📚 Recipe library</b> on the Meals tab to browse hiking and camping recipes collected from Australian and overseas hiking sites. Each recipe is already in the planner's format: ingredients per serve with packed weight, kcal and an estimated cost.</p>
          <ul>
            <li><b>Search</b> by recipe name or ingredient, for example <i>couscous</i>, <i>curry</i> or <i>peanut butter</i>.</li>
            <li><b>Filter</b> by meal, by type (dehydrated, vegetarian, no-cook, dessert, drink and so on), by source and by maximum weight per serve. Click a tag on a recipe to filter by it.</li>
            <li><b>Sort</b> by lightest, most energy, most kcal per gram (best for long walks), cheapest or quickest at camp.</li>
            <li>Click a recipe's name to see its ingredients and a short method. <b>+ Add to trip</b> copies it into this trip's recipes, and you can then pick it in the meal plan and edit it like any other recipe.</li>
          </ul>
          <p class="muted">Weights, energy and costs are estimates, so adjust them for the brands you buy. Each recipe links to its original page, which has the full method, and printed recipes credit the source.</p>`
      },
      {
        id: 'meals-shopping', title: 'Shopping list',
        keywords: 'shopping list ingredients buy cost priced tick',
        match: ['ingredients & shopping list', 'shopping list'],
        body: `<p>Every ingredient for the whole trip, added up and priced, with tick-boxes. Items without a price are flagged so you can add one to the recipe.</p>`
      },
      {
        id: 'meals-equipment', title: 'Cooking equipment',
        keywords: 'cooking equipment stove pot missing add to gear',
        match: ['cooking equipment', 'equipment needed to cook'],
        body: `<p>Lists the equipment your recipes need and checks it against the gear list. Use <b>+ Add to gear</b> (or add all the missing items at once) so nothing's forgotten.</p>`
      },
      {
        id: 'meals-weight', title: 'Food weight and energy',
        keywords: 'food weight energy kcal per person per day calories',
        match: ['food weight & energy'],
        body: `<p>Total food weight for the group, food per person per day, <b>kcal per person per day</b> and water needed for cooking. Active hiking usually needs around 2,500–3,500 kcal per person per day.</p>`
      }
    ]
  },

  {
    id: 'gear', icon: '🎒', title: 'Gear tab — packing list', tab: 'gear',
    sections: [
      {
        id: 'gear-list', title: 'Building the gear list',
        keywords: 'gear list starter add item category weight quantity type base worn consumable carrier who carries packed tick untick',
        match: ['gear list'],
        body: `
          <ol>
            <li>Click <b>Load starter list</b> for a typical overnight hike list, or <b>+ Add</b> items.</li>
            <li>For each item set its category, <b>weight</b> (grams), quantity and <b>type</b>: <i>base</i> (in the pack), <i>worn / carried</i>, or <i>consumable</i>.</li>
            <li>Choose <b>who carries it</b> — a person or <i>Group</i>.</li>
            <li>Tick items as they're <b>packed</b>; <b>Untick all</b> resets for the next trip.</li>
          </ol>`
      },
      {
        id: 'gear-costs', title: 'Own, hire, buy or borrow',
        keywords: 'hire buy borrow own cost per day per trip budget paid by',
        body: `<p>Mark each item as <b>own</b>, <b>hire</b>, <b>buy</b> or <b>borrow</b>, with a cost (hire per trip or per day). Hire and purchase costs go straight into the <a href="#budget-costs" data-help-link>Budget</a>.</p>`
      },
      {
        id: 'gear-catalog', title: 'Gear catalogue — real products, weights and prices',
        keywords: 'catalogue catalog search product brand store shop snowys bcf anaconda tentworld drifta alton zenbivy price weight lightest cheapest compare find replace buy',
        match: ['gear catalogue'],
        body: `
          <p>Click <b>🔎 Gear catalogue</b> on the Gear tab to search thousands of products from Australian outdoor stores, with the weight and price each store publishes.</p>
          <ul>
            <li><b>Search</b> with any words, such as <i>sleeping bag -5</i>, <i>2 person tent</i> or <i>Sea to Summit mat</i>. Every word must match the name, brand, store category or specs.</li>
            <li><b>Filter</b> by category, brand, store, maximum weight (g) and maximum price. Tick <b>Has weight</b> to hide products without a published weight. The brand and store lists only show choices that still have matches, with counts. Click a brand chip on a result to filter by that brand.</li>
            <li><b>Sort</b> by best match, lightest, cheapest, dearest, brand or name. <i>Lightest first</i> plus a category is a quick way to compare.</li>
            <li><b>+ Add</b> puts the product on the gear list as an item you own. <b>+ To buy</b> adds it as a purchase, so its price goes into the Budget. Click a product's name to open the store's page.</li>
            <li>On the gear list, the <b>🔎</b> next to an item finds products like it. Click <b>Use this</b> to copy that product's name, weight and link onto the item. It keeps its quantity, carrier and type. This is how to swap the starter list's average weights for your real gear.</li>
          </ul>
          <p class="muted">Prices and weights are a snapshot from when the catalogue was built (shown at the bottom of the window), so always check the store before buying. Some stores don't publish weights for every product.</p>`
      }
    ]
  },

  {
    id: 'weight', icon: '⚖️', title: 'Pack Weight tab', tab: 'weight',
    sections: [
      {
        id: 'weight-packs', title: 'Pack weights and what to aim for',
        keywords: 'pack weight percent body weight 20% skin out base food water heaviest by day',
        match: ['pack weight', 'pack weight by day', 'heaviest items', 'group total'],
        body: `
          <p>For each person: base gear, food, water and other consumables, the <b>total skin-out weight</b>, and the pack as a <b>% of body weight</b>.</p>
          <ul>
            <li>Aim for packs no more than about <b>20% of body weight</b> (less for younger members).</li>
            <li><b>Pack weight by day</b> shows packs getting lighter as food is eaten, and heavier after a food drop.</li>
            <li><b>Heaviest items</b> shows where weight can be saved, or shared out differently.</li>
          </ul>
          <p>Body weights are set on the <a href="#trip-people" data-help-link>Trip tab</a>; who carries what is set on the Gear tab.</p>`
      }
    ]
  },

  {
    id: 'risk', icon: '⚠️', title: 'Risks tab — risk assessment and emergency plan', tab: 'risk',
    sections: [
      {
        id: 'risk-matrix', title: 'The risk matrix',
        keywords: 'risk matrix likelihood consequence rating low medium high extreme residual 5x5',
        match: ['risk assessment', 'risk matrix'],
        body: `
          <p>Each risk is rated for <b>likelihood</b> (1 rare – 5 almost certain) and <b>consequence</b> (1 insignificant – 5 catastrophic), first <b>before</b> and then <b>after</b> your controls (the residual risk). The 5×5 matrix colours each rating <span class="risk low">Low</span> <span class="risk med">Medium</span> <span class="risk high">High</span> <span class="risk ext">Extreme</span>.</p>
          <p>Follow the Scouts Australia risk management requirements for your activity — this tab helps you prepare it, it doesn't replace the approval process.</p>`
      },
      {
        id: 'risk-hazards', title: 'Adding hazards and controls',
        keywords: 'hazard preset add blank risk controls owner location from map hazards',
        match: ['hazards & controls'],
        body: `
          <ul>
            <li>Choose a <b>hazard preset</b> (heat, hypothermia, getting lost, slips, snakes, bushfire, water…) — it fills in typical causes and controls to adapt.</li>
            <li><b>+ Blank risk</b> to write your own.</li>
            <li><b>⚠️ From map hazards</b> lists the landmarks on your map so you can tick which become risks, each with its grid reference. <b>Hazard</b> and <b>River / creek crossing</b> landmarks are ticked already, and so are landmarks whose name or notes suggest a hazard (e.g. a <i>Waypoint</i> called "Water Crossing"). A suitable preset is filled in where one fits — flooding for a crossing, falls for a cliff — and the landmark can be switched to a ⚠️ / 🌊 icon on the map. Landmarks already in the risk assessment are greyed out.</li>
            <li>Weather risks can be added from the <a href="#weather-risks" data-help-link>Weather tab</a>.</li>
          </ul>`
      },
      {
        id: 'risk-emergency', title: 'Emergency information',
        keywords: 'emergency 000 112 hospital police ranger reception plb evacuation contact medical first aider return by nearest',
        match: ['emergency information', 'in an emergency', 'where we plan to be each night'],
        body: `
          <ul>
            <li>Lists <b>Australian emergency numbers</b> and gives the camp's grid reference to read out to 000.</li>
            <li><b>🔍 Find nearest hospital</b> and <b>🔍 Find nearest police station</b> fill those in from the camp location.</li>
            <li>Fill in mobile reception, the PLB carrier, evacuation routes, first aider and <b>return-by</b> time.</li>
          </ul>
          <p class="help-tip">🔒 The emergency <b>contact</b> and <b>medical</b> notes are only shown to signed-in trip editors.</p>`
      },
      {
        id: 'risk-signoff', title: 'Sign-off',
        keywords: 'sign off assessed by reviewed by date approval',
        match: ['sign-off'],
        body: `<p>Record who assessed the risks, the date, and who reviewed them. These print on the risk assessment page of the report.</p>`
      }
    ]
  },

  {
    id: 'weather', icon: '🌦️', title: 'Weather & Tides tab', tab: 'weather',
    sections: [
      {
        id: 'weather-forecast', title: 'Forecast',
        keywords: 'weather forecast 16 day hourly temperature rain wind refresh',
        match: ['weather & tides', '16-day forecast', 'next 7 days'],
        body: `
          <p>A <b>16-day forecast</b> for the camp location, with the trip days highlighted, and an hourly chart for the next 7 days. Click <b>↻ Refresh</b> for the latest. Forecasts more than a few days out are only a guide.</p>
          <p>No forecast? Set the camp location on the <a href="#trip-location" data-help-link>Trip tab</a>.</p>`
      },
      {
        id: 'weather-risks', title: 'Weather risks',
        keywords: 'weather risks heat cold wind storm rain add to risks',
        match: ['weather risks'],
        body: `<p>Flags heat, cold, strong wind, storms and heavy rain on the trip days. <b>+ Add to risks</b> copies one into the risk assessment.</p>`
      },
      {
        id: 'weather-tides', title: 'Tides',
        keywords: 'tides high low coastal beach crossing',
        match: ['tides', 'tides next 8 days'],
        body: `<p>Shown when <b>Coastal camp</b> is ticked on the Trip tab. Tide times are model estimates — use official tide tables for beach walks and creek-mouth crossings.</p>`
      },
      {
        id: 'weather-official', title: 'Official sources — always check',
        keywords: 'bom bureau fire danger rating park alerts closures official',
        match: ['official sources'],
        body: `<p>Links to the Bureau of Meteorology, the state's <b>fire danger ratings</b> and <b>park alerts</b>. Always check these before you go, and again on the day.</p>`
      }
    ]
  },

  {
    id: 'budget', icon: '💰', title: 'Budget tab — costs and settling up', tab: 'budget',
    sections: [
      {
        id: 'budget-costs', title: 'What goes into the budget',
        keywords: 'budget cost fuel transport shuttle food gear hire camp fees other costs total per person target',
        match: ['budget', 'fuel & transport', 'food', 'gear hire & purchases', 'other costs'],
        body: `
          <p>The budget fills itself in from the other tabs:</p>
          <ul>
            <li><b>Fuel &amp; transport</b> — from the Travel tab (paid by each driver), plus the shuttle cost;</li>
            <li><b>Food</b> — the priced shopping list from the Meals tab;</li>
            <li><b>Gear hire &amp; purchases</b> — from the Gear tab;</li>
            <li><b>Other costs</b> — anything else (<b>+ Add cost</b>).</li>
          </ul>
          <p>Set an optional <b>budget per person</b> to compare against the cost per person.</p>`
      },
      {
        id: 'budget-fees', title: 'Camp fees',
        keywords: 'camp fees campsite per adult night site vehicle park entry flat',
        match: ['camp fees'],
        body: `
          <p>Add fees as <b>per adult per night</b>, <b>per site per night</b>, <b>per vehicle per day</b> (park entry), <b>per vehicle per night</b> or a <b>flat</b> amount. Counts and nights default from the trip.</p>
          <p><b>⛺ Add campsites from the map</b> and <b>🚗 Add park vehicle entry</b> start the list for you.</p>`
      },
      {
        id: 'budget-settle', title: 'Settle up',
        keywords: 'settle up who owes paid by share equally split',
        match: ['settle up'],
        body: `<p>Set <b>who paid</b> for each cost. <b>Settle up</b> then shows who owes whom so the costs are shared equally.</p>`
      }
    ]
  },

  {
    id: 'report', icon: '📄', title: 'Report tab — printing the whole plan', tab: 'report',
    sections: [
      {
        id: 'report-sections', title: 'Choosing what goes in the report',
        keywords: 'report sections cover itinerary overview map daily maps route card emergency plan budget choose untick',
        match: ['trip report', 'in this report'],
        body: `
          <p>The report puts every part of the plan into one document: cover and summary, day-by-day itinerary, overview map, map key with grid references, a map for each day, the route card, egress, drops, travel, meals, shopping list, gear checklist, pack weights, risk assessment, <b>emergency plan</b>, weather and budget.</p>
          <ul>
            <li>Untick sections you don't need.</li>
            <li>Change any section's page: <b>A4 or A3</b>, <b>portrait or landscape</b>.</li>
            <li><b>All A4</b> switches A3 pages to A4 (for printers without A3); <b>Mixed A4 + A3</b> restores the defaults.</li>
          </ul>
          <p><b>Daily section maps</b> are laid out to show each day in as much detail as possible (tick-box <i>Day maps: turn each page to suit the direction of travel…</i>, on by default):</p>
          <ul>
            <li>a day walking mostly <b>north–south</b> prints on a <b>portrait</b> page, with the profile and leg table under a tall map; an <b>east–west</b> day prints <b>landscape</b>. The paper size (A4 or A3) is the one chosen for the section;</li>
            <li>a <b>diagonal</b> day that would print smaller than <b>1:50,000</b> is <b>split over 2 pages</b>, at a stop near the middle where there is one — marked <i>Day 5 (1 of 2)</i>, with the distance, climb and time for each part. Any day that would be smaller than 1:100,000 is split too.</li>
          </ul>
          <p>Each map shows its actual scale underneath. Untick the option to print every day on the section's page setting.</p>
          <p class="help-tip">💡 Print the <b>Emergency plan</b> section on its own and leave it with your emergency contact.</p>`
      },
      {
        id: 'report-maps', title: 'Framing the maps',
        keywords: 'frame map drag zoom refit scale preview',
        body: `<p>Maps in the preview are drawn at their true printed size and show their scale at 100%. Drag or zoom a map to frame it; <b>↺ Re-fit maps</b> resets them all.</p>`
      },
      {
        id: 'report-print', title: 'Printing and saving as PDF',
        keywords: 'print pdf save as pdf scale 100% headers footers page numbers chrome edge',
        body: `
          <ol>
            <li>Click <b>🖨 Print / Save as PDF</b>. It waits for the map tiles to load first.</li>
            <li>To keep mixed page sizes in one file, choose <b>Save as PDF</b> as the printer.</li>
            <li>Keep the scale at <b>100% / Default</b>, and turn <b>off</b> the browser's own headers and footers — each page then shows the trip name and "Page <i>n</i> of <i>N</i>" (Chrome / Edge).</li>
          </ol>
          <p>If a section says something hasn't loaded yet (for example the forecast while offline), wait a moment and print again.</p>
          <p>On any other tab, <b>🖨 Print this page</b> prints just that tab (wide tables print landscape).</p>`
      }
    ]
  },

  {
    id: 'publish', icon: '📣', title: 'Home page, publishing and sharing', tab: null,
    sections: [
      {
        id: 'lp-home', title: 'The Camp Planner home page and trip map',
        keywords: 'home landing page map pins hover published trips my trips list front page',
        body: `
          <p>The Camp Planner home page shows a <b>map with a pin for each trip you can see</b>. Hover over a pin, or over a trip card below the map, to see the trip's dates, location, length and size. Click to open it.</p>
          <ul>
            <li><b>Everyone</b> sees published public trips. Past trips are greyed on the map and listed under <i>Past trips</i>.</li>
            <li><b>Leaders</b> who are signed in also see <b>My trips</b>: the trips they own or co-plan, including drafts.</li>
            <li><b>Superusers</b> also see the <b>Waiting for review</b> list and a table of <b>all trips</b>.</li>
          </ul>
          <p>The map starts on <b>all of Australia</b>. Use <b>🔍 Zoom to</b> above the map to jump to a state or territory (the number in brackets is how many trips it has), or <b>Fit all trips on the map</b>. Your choice is remembered on this device.</p>
          <p>Pin colours: navy = published, grey = past, orange = in review, light grey = draft. A trip's pin sits at its camp location, or at the start of its first trail.</p>`
      },
      {
        id: 'publish-review', title: 'Publishing a trip: drafts and review',
        keywords: 'publish draft submit review approve approval superuser two reviewers changes request withdraw unpublish published',
        match: ['publishing & sharing'],
        body: `
          <p>Every new trip starts as a <b>📝 draft</b> that only its leaders and the superusers can see. To publish it:</p>
          <ol>
            <li>On the <b>Trip</b> tab, under <b>📣 Publishing &amp; sharing</b>, click <b>📤 Submit for review</b>. You can add a note for the reviewers.</li>
            <li>Superusers see it in their <i>Waiting for review</i> list. Each one opens it, checks the plan, then clicks <b>✅ Approve</b>, or <b>✏️ Ask for changes</b> with a comment.</li>
            <li>Submitting is the author's sign-off. Once <b>one superuser</b> has approved it, the trip is <b>✅ published</b>. A superuser can't approve a trip they own or co-plan, so another superuser reviews it.</li>
          </ol>
          <ul>
            <li><b>Ask for changes</b> sends the trip back to draft. Its leaders see the comment under <i>Review history</i>, fix things, and submit it again. Each new review needs a fresh approval.</li>
            <li><b>↩ Withdraw</b> takes a trip out of review.</li>
            <li><b>⏸ Unpublish</b> (owner or superuser) takes a published trip back to draft.</li>
            <li>Leaders can keep improving a published trip. It stays published, but is marked <b>✎ changed</b> so superusers can see it was edited after approval and send it back for review if needed.</li>
          </ul>`
      },
      {
        id: 'publish-sharing', title: 'Who can see a trip: public, private and secret',
        keywords: 'visibility public private secret link share lock code password hidden unlisted copy link new link',
        body: `
          <p>Choose under <b>📣 Publishing &amp; sharing</b> on the Trip tab. The choice applies once the trip is published.</p>
          <table class="help-table">
            <tr><td><b>🌏 Public</b></td><td>listed on the home page and trip map; anyone can view and print it</td></tr>
            <tr><td><b>🔗 Private</b></td><td>not listed; anyone you give the <b>link</b> to can view it</td></tr>
            <tr><td><b>🔒 Secret</b></td><td>not listed; people need the link <b>and the lock code</b></td></tr>
          </table>
          <ul>
            <li><b>📋 Copy link</b> copies the trip's link. Private and secret trips have a long, unguessable link.</li>
            <li><b>↻ New link</b> makes a new one, and the old link stops working. Use it if a link was shared too widely.</li>
            <li>For a secret trip, tell people the <b>lock code</b> separately from the link. After a few wrong codes, that browser has to wait 15 minutes.</li>
            <li>Personal details (home addresses, emergency contacts, medical notes) are only shown to the trip's leaders and superusers, whatever the visibility.</li>
          </ul>`
      },
      {
        id: 'publish-team', title: 'Co-planners',
        keywords: 'co-planner coplanner team share editing owner leaders together collaborate copy',
        body: `
          <p>The leader who creates a trip is its <b>owner</b>. Under <b>📣 Publishing &amp; sharing</b>, the owner (or a superuser) can click <b>👥 Co-planners…</b> to let other Camp Planner leaders edit it too. Co-planners see the trip in their <i>My trips</i> list and can submit it for review.</p>
          <p>Opening someone else's published trip is view-only. Click <b>⧉ Make my own copy</b> in the blue strip to start your own draft from it. Personal details aren't copied.</p>`
      },
      {
        id: 'phone-app', title: 'Phone app and live locations',
        keywords: 'phone app mobile offline install home screen join code live location tracking share position gps export gpx track youth',
        match: ['phone app & live locations'],
        body: `
          <p><b>Camp Planner Go</b> is the phone app for people on a camp. It keeps the plan, map and emergency details on the phone so they work without service, and it can share the phone's location with the trip's leaders.</p>
          <p><b>Leaders</b> set it up on the Map tab, under <b>📱 Phone app &amp; live locations</b>:</p>
          <ol>
            <li><b>Send plan to phones</b> stores a phone copy of the plan: days and legs, camps, meals, recipes, gear, risks, the emergency plan and the map. Send it again after changing the plan. Medical notes are not included.</li>
            <li><b>Make a join code</b> and give it (or the join link) to the people going. They don't need an account, so it works for youth-only camps.</li>
            <li>Tick <b>Show live locations on the map</b> to see each phone's latest position and recent trail. It refreshes every 10 seconds.</li>
          </ol>
          <p><b>On each phone:</b> open the join link, enter the code and a name, then choose <b>Add to Home Screen</b>. Tap <b>Save map for offline</b> on the Map screen before leaving. Location sharing is off until the person switches it on.</p>
          <ul>
            <li>The phone sends its position about every 30 seconds while moving, and every 2 minutes when stopped, <b>while the app is open</b>. Positions taken without service are saved and sent when service returns.</li>
            <li><b>Status:</b> on the phone's Status screen, people choose <i>OK — on the move</i>, <i>Stopped — for…</i>, <i>Sorting out a minor problem</i> or <i>Trying to contact home base</i>, and can add a one-line message. It shows on the live map next to their marker and in the table in this panel, with how long ago it was sent. Problem and contact statuses are highlighted. It is not an emergency alert.</li>
            <li><b>Weather:</b> the phone's Plan screen shows a 7-day forecast for the trip area, with the trip's days highlighted. It downloads when the phone has service and stays on the phone for when it doesn't, with a note of how old it is.</li>
            <li><b>Calling 000:</b> on the Emergency screen, tap <b>Call 000…</b> and then drag the phone symbol from the top of the screen to the bottom. Letting go early does nothing, so it can't be dialled by accident.</li>
            <li><b>Speed and direction:</b> when a phone or tracker is moving, an arrow points from its marker in the direction of travel (longer when faster), and its speed and compass direction show on the label, in the pop-up and in the table. It is worked out from the last few minutes of positions, and disappears when they stop or haven't been heard from for 5 minutes.</li>
            <li>Only the trip's owner, its co-planners and superusers can see locations.</li>
            <li><b>Export tracks (GPX)</b> downloads everything recorded, for review later. Positions are deleted from the website after one year.</li>
            <li>Remove a phone with ✕, or make a new join code if the old one got around.</li>
          </ul>
          <p><b>Satellite trackers (SPOT, Garmin inReach):</b> when a tracker is switched on for an event, click <b>＋ Add a tracker</b>, choose the type, name it, and paste its <b>SPOT feed ID</b> or <b>Garmin MapShare name</b> (with the feed password if it has one). The planner tests the feed straight away and tells you what it found. Set <b>Track from / until</b> (it starts as the trip dates): positions outside that window are never kept. Tracker positions show on the same live map and in the same export. Feeds are read while a leader has live locations showing, at most every 3 minutes. Remove the tracker after the event.</p>`
      },
      {
        id: 'users', title: 'Camp Planner users and roles (admins)',
        keywords: 'users admin access permission role leader superuser camp admin grant account create reset password manage',
        body: `
          <p>Leaders use the <b>same username and password</b> as the program editor. Their Camp Planner access is set separately, by <b>Camp Planner admins</b>, on the <b>👥 Users</b> page. That button appears at the top of the Camp Planner for admins only.</p>
          <table class="help-table">
            <tr><td><b>No access</b></td><td>views published trips like anyone else</td></tr>
            <tr><td><b>Leader</b></td><td>plans trips; sees published trips plus the ones they own or co-plan</td></tr>
            <tr><td><b>Superuser</b></td><td>sees and can edit every trip, and reviews trips for publishing</td></tr>
            <tr><td><b>Camp admin</b></td><td>an extra tick: can open the Users page and change everyone's Camp Planner access</td></tr>
          </table>
          <ul>
            <li>To give an existing leader access, choose their role in the list and click <b>Save</b>.</li>
            <li><b>Add a Camp-Planner-only leader</b> creates an account with no program sections, for example a parent helper. You'll get a temporary password to give them. They choose their own password on the <a href="../leaders/program.html">Leaders page</a> the first time.</li>
            <li>You can reset the password of a Camp-Planner-only account. Accounts that also use the program editor are reset by a program admin.</li>
            <li>Program sections and program admin are managed on the Leaders page, not here.</li>
            <li>Keep at least <b>two superusers</b> so that a trip planned by a superuser can still be reviewed by someone else.</li>
          </ul>`
      }
    ]
  },

  {
    id: 'trouble', icon: '🛠️', title: 'Troubleshooting and questions', tab: null,
    sections: [
      {
        id: 'trouble-signin', title: 'I can\'t sign in, or I can\'t edit',
        keywords: 'cannot sign in wrong password locked too many attempts view only no access forgot',
        body: `
          <ul>
            <li><b>Wrong password / locked:</b> after 5 wrong passwords the account is locked for 15 minutes. Ask an admin to reset your password if you've forgotten it.</li>
            <li><b>Still "View only" after signing in:</b> your account doesn't have Camp Planner access yet — ask an admin.</li>
            <li><b>"Change your temporary password":</b> set your own password on the <a href="../leaders/program.html">Leaders page</a> first.</li>
          </ul>`
      },
      {
        id: 'trouble-saving', title: 'My changes aren\'t saving',
        keywords: 'not saved retrying offline connection lost changes signed out session expired',
        body: `
          <ul>
            <li><b>⚠ Not saved — retrying</b>: the website can't be reached. Check your internet; it keeps trying. Don't close the page until it says ✓ Saved.</li>
            <li><b>Red strip "…changed this trip"</b>: another leader saved first — see <a href="#start-saving" data-help-link>Saving, and editing with other leaders</a>.</li>
            <li><b>Red strip about signing in</b>: your session ended (after 8 hours, or a password change). Sign in again, then repeat your last change.</li>
          </ul>`
      },
      {
        id: 'trouble-map', title: 'The map, routes or weather won\'t load',
        keywords: 'map blank tiles not loading routing failed service busy internet weather data',
        body: `
          <p>Maps, track routing, parks data, elevation, weather and tides come from outside services and need internet access. If one is busy:</p>
          <ul>
            <li>wait a moment and try again (↻ buttons, or switch tabs and back);</li>
            <li>try another base map, or another <b>Follow tracks using</b> source;</li>
            <li>zoom in further for parks and track layers.</li>
          </ul>`
      },
      {
        id: 'trouble-sources', title: 'Where the data comes from',
        keywords: 'data sources accuracy openstreetmap nsw spatial services capad open-meteo osrm nominatim brouter attribution',
        body: `
          <ul>
            <li><b>National parks:</b> CAPAD (DCCEEW). <b>NSW tracks, fire trails, campgrounds, hospitals, police and topo map:</b> NSW Spatial Services. <b>Tasmania topo:</b> theLIST / TASMAP.</li>
            <li><b>Other maps:</b> OpenTopoMap, OpenStreetMap, Esri. <b>Walking routes:</b> BRouter. <b>Driving routes:</b> OSRM. <b>Place search:</b> Nominatim.</li>
            <li><b>Weather, elevation and tides:</b> Open-Meteo.</li>
          </ul>
          <p>Treat everything as a planning guide. Check official sources — BOM, fire danger ratings, park alerts — and the ground itself before relying on it.</p>`
      },
      {
        id: 'trouble-offline', title: 'Is there an offline version?',
        keywords: 'offline local computer version start camp planner bat export',
        body: `<p>Yes — the original Camp Planner can run on a computer (it saves trips in that browser only). Export a trip here and import it there, or the other way round, to move plans between them.</p>`
      }
    ]
  }
];

const Help = (() => {
  const escH = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  /* ---------- lookups ---------- */
  const SECTIONS = HELP.flatMap(ch => ch.sections.map(s => ({ ...s, chapter: ch })));
  const byId = id => SECTIONS.find(s => s.id === id) || null;
  const chapterById = id => HELP.find(c => c.id === id) || null;
  const norm = t => String(t).toLowerCase().replace(/&amp;/g, '&').replace(/[^a-z0-9&\- ]+/g, ' ').replace(/\s+/g, ' ').trim();
  /* UI heading text -> section id (longest phrase wins) */
  const MATCH = SECTIONS.flatMap(s => (s.match || []).map(m => [norm(m), s.id])).sort((a, b) => b[0].length - a[0].length);
  function sectionForHeading(text) {
    const t = norm(String(text).split(' — ')[0]);
    if (!t) return null;
    const hit = MATCH.find(([m]) => t === m || t.startsWith(m + ' '));
    return hit ? hit[1] : null;
  }

  /* ---------- rendering (shared by the panel and help.html) ---------- */
  function guideHtml() {
    return `
      <nav class="help-toc" aria-label="Help contents">
        ${HELP.map(ch => `<div class="help-toc-ch">
          <a href="#${ch.id}" data-help-link><span>${ch.icon}</span> ${ch.title}</a>
          <ul>${ch.sections.map(s => `<li><a href="#${s.id}" data-help-link>${s.title}</a></li>`).join('')}</ul>
        </div>`).join('')}
      </nav>
      <div class="help-body">
        ${HELP.map(ch => `<section class="help-ch" id="${ch.id}" data-help-ch>
          <h2>${ch.icon} ${ch.title}</h2>
          ${ch.sections.map(s => `<article class="help-sec" id="${s.id}" data-help-sec data-keywords="${s.keywords || ''}">
            <h3>${s.title}</h3>${s.body}
          </article>`).join('')}
        </section>`).join('')}
        <p class="help-none" hidden>No help matches that search. Try fewer or different words — e.g. <i>print</i>, <i>grid reference</i>, <i>water</i>.</p>
      </div>`;
  }

  /* Wire up search and in-guide links inside a container that holds guideHtml(). */
  function wire(root, { scroller, onJump } = {}) {
    const input = root.querySelector('[data-help-search]');
    const count = root.querySelector('[data-help-count]');
    const sc = scroller || root;
    const originals = new Map();
    root.querySelectorAll('[data-help-sec]').forEach(el => originals.set(el, el.innerHTML));

    function clearMarks() { originals.forEach((html, el) => { if (el.querySelector('mark')) el.innerHTML = html; }); }

    function highlight(el, terms) {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      const nodes = [];
      while (walker.nextNode()) nodes.push(walker.currentNode);
      const re = new RegExp('(' + terms.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')', 'gi');
      nodes.forEach(n => {
        if (!re.test(n.nodeValue)) return;
        re.lastIndex = 0;
        const span = document.createElement('span');
        span.innerHTML = escH(n.nodeValue).replace(re, '<mark>$1</mark>');
        n.replaceWith(...span.childNodes);
      });
    }

    function search(q) {
      clearMarks();
      const terms = norm(q).split(' ').filter(t => t.length > 1);
      let shown = 0;
      root.querySelectorAll('[data-help-sec]').forEach(el => {
        const hay = norm(el.textContent + ' ' + el.dataset.keywords + ' ' + el.closest('[data-help-ch]').querySelector('h2').textContent);
        const hit = !terms.length || terms.every(t => hay.includes(t));
        el.hidden = !hit;
        if (hit) { shown++; if (terms.length) highlight(el, terms); }
      });
      root.querySelectorAll('[data-help-ch]').forEach(ch => { ch.hidden = !ch.querySelector('[data-help-sec]:not([hidden])'); });
      root.querySelector('.help-toc').hidden = !!terms.length;
      root.querySelector('.help-none').hidden = shown > 0;
      if (count) count.textContent = terms.length ? `${shown} section${shown === 1 ? '' : 's'} found` : '';
      if (terms.length) sc.scrollTop = 0;
    }

    function jump(id, { flash = true } = {}) {
      if (input && input.value) { input.value = ''; search(''); }
      const el = root.querySelector('#' + CSS.escape(id));
      if (!el) return false;
      el.scrollIntoView({ block: 'start' });
      if (flash) { el.classList.remove('help-flash'); void el.offsetWidth; el.classList.add('help-flash'); }
      if (onJump) onJump(id);
      return true;
    }

    input && input.addEventListener('input', () => search(input.value));
    input && input.addEventListener('keydown', e => {
      if (e.key === 'Enter') { const first = root.querySelector('[data-help-sec]:not([hidden])'); if (first) first.scrollIntoView({ block: 'start' }); }
    });
    root.addEventListener('click', e => {
      const a = e.target.closest('a[data-help-link]');
      if (!a) return;
      e.preventDefault();
      jump(a.getAttribute('href').slice(1));
    });
    return { search, jump };
  }

  /* ---------- the slide-out panel inside the planner ---------- */
  let panel = null, api = null, lastFocus = null;

  function build() {
    panel = document.createElement('aside');
    panel.id = 'helpPanel';
    panel.className = 'help-panel no-print';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Camp Planner help');
    panel.hidden = true;
    panel.innerHTML = `
      <div class="help-panel-head">
        <div class="help-panel-title"><b>❓ Help &amp; how-to</b>
          <span class="help-panel-links">
            <button class="linkish" data-help-contents>Contents</button> ·
            <a href="help.html" target="_blank" rel="noopener" data-help-full>Full guide ↗</a>
          </span>
          <button class="icon-btn help-close" data-help-close title="Close help (Esc)" aria-label="Close help">✕</button>
        </div>
        <input type="search" data-help-search placeholder="Search help — e.g. print, grid reference, car shuffle" aria-label="Search help">
        <small class="muted" data-help-count></small>
      </div>
      <div class="help-panel-scroll">${guideHtml()}</div>`;
    document.body.appendChild(panel);
    const scroller = panel.querySelector('.help-panel-scroll');
    api = wire(panel, {
      scroller,
      onJump: id => { panel.querySelector('[data-help-full]').href = 'help.html#' + id; }
    });
    panel.querySelector('[data-help-close]').addEventListener('click', close);
    panel.querySelector('[data-help-contents]').addEventListener('click', () => {
      const s = panel.querySelector('[data-help-search]');
      if (s.value) { s.value = ''; api.search(''); }
      scroller.scrollTop = 0;
    });
  }

  /* Open at a section/chapter id, or at the help for the tab that's showing. */
  function open(id) {
    if (!panel) build();
    lastFocus = document.activeElement;
    const target = id || (typeof App !== 'undefined' && App.current && HELP.find(c => c.tab === App.current)?.id) || 'start';
    panel.hidden = false;
    document.body.classList.add('help-open');
    // scrollIntoView forces layout, so the jump works straight after un-hiding the panel
    api.jump(target, { flash: !!id });
    panel.querySelector('[data-help-search]').focus({ preventScroll: true });
  }

  function close() {
    if (!panel || panel.hidden) return;
    panel.hidden = true;
    document.body.classList.remove('help-open');
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  const typing = el => el && (el.isContentEditable || /^(input|textarea|select)$/i.test(el.tagName));

  /* Add a small ? button to each planner heading that has a matching help section. */
  function decorate() {
    document.querySelectorAll('main h2, main h3').forEach(h => {
      if (h.dataset.helpDone) return;
      h.dataset.helpDone = '1';
      if (h.closest('.rpt-sheet, #printSheet, .print-sheet')) return;   // keep printouts clean
      const id = sectionForHeading(h.textContent);
      if (!id) return;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'help-i no-print';
      b.dataset.help = id;
      b.title = 'Help: ' + byId(id).title;
      b.setAttribute('aria-label', b.title);
      b.textContent = '?';
      h.appendChild(b);
    });
  }

  function init() {
    const btn = document.getElementById('btnHelp');
    if (btn) btn.addEventListener('click', () => (panel && !panel.hidden ? close() : open()));
    document.addEventListener('click', e => {
      const b = e.target.closest('[data-help]');
      if (b) { e.preventDefault(); e.stopPropagation(); open(b.dataset.help); }
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && panel && !panel.hidden) { close(); return; }
      if (e.key === 'F1' || (e.key === '?' && !typing(e.target) && !e.ctrlKey && !e.metaKey)) { e.preventDefault(); open(); }
    });
    const main = document.querySelector('main');
    if (main) {
      let t = null;
      new MutationObserver(() => { clearTimeout(t); t = setTimeout(decorate, 120); }).observe(main, { childList: true, subtree: true });
      decorate();
    }
  }

  return { init, open, close, guideHtml, wire, sectionForHeading, chapterById, byId, HELP };
})();

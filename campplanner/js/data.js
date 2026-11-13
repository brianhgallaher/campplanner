/* Camp Planner — starter data: recipes, gear templates and common hazards */

const GEAR_CATEGORIES = [
  'Shelter', 'Sleep', 'Pack', 'Kitchen', 'Water', 'Clothing', 'Footwear',
  'Navigation', 'Safety & First Aid', 'Hygiene', 'Electronics', 'Tools', 'Fishing & Leisure', 'Other'
];

/* Ingredient quantities and weights are PER SERVING. weightG = packed weight carried. */
const SAMPLE_RECIPES = [
  {
    name: 'Porridge with berries', slot: 'breakfast', waterMl: 300,
    ingredients: [
      { name: 'Rolled oats', qty: 80, unit: 'g', weightG: 80, kcal: 300 },
      { name: 'Powdered milk', qty: 25, unit: 'g', weightG: 25, kcal: 125 },
      { name: 'Dried berries', qty: 20, unit: 'g', weightG: 20, kcal: 65 },
      { name: 'Brown sugar', qty: 15, unit: 'g', weightG: 15, kcal: 58 }
    ],
    equipment: ['Stove', 'Cooking pot', 'Mug', 'Spork'],
    notes: 'Bring water to boil, stir in oats and milk powder, simmer 3 min. Top with berries and sugar.'
  },
  {
    name: 'Pancakes with maple syrup', slot: 'breakfast', waterMl: 150,
    ingredients: [
      { name: 'Shake-and-pour pancake mix', qty: 70, unit: 'g', weightG: 70, kcal: 260 },
      { name: 'Olive oil', qty: 10, unit: 'ml', weightG: 9, kcal: 80 },
      { name: 'Maple syrup', qty: 25, unit: 'ml', weightG: 33, kcal: 85 }
    ],
    equipment: ['Stove', 'Frying pan', 'Spatula'],
    notes: 'Add water to the mix bottle, shake, fry in oiled pan.'
  },
  {
    name: 'Tuna & cheese wraps', slot: 'lunch', waterMl: 0,
    ingredients: [
      { name: 'Tortilla wraps', qty: 2, unit: 'pcs', weightG: 90, kcal: 280 },
      { name: 'Tuna pouch', qty: 1, unit: 'pouch', weightG: 85, kcal: 110 },
      { name: 'Mayonnaise sachet', qty: 1, unit: 'sachet', weightG: 15, kcal: 100 },
      { name: 'Hard cheese', qty: 30, unit: 'g', weightG: 30, kcal: 120 }
    ],
    equipment: ['Knife'],
    notes: ''
  },
  {
    name: 'Salami, crackers & cheese', slot: 'lunch', waterMl: 0,
    ingredients: [
      { name: 'Salami', qty: 50, unit: 'g', weightG: 50, kcal: 200 },
      { name: 'Crackers', qty: 50, unit: 'g', weightG: 50, kcal: 240 },
      { name: 'Hard cheese', qty: 40, unit: 'g', weightG: 40, kcal: 160 }
    ],
    equipment: ['Knife'],
    notes: ''
  },
  {
    name: 'Pasta bolognese (dehydrated)', slot: 'dinner', waterMl: 450,
    ingredients: [
      { name: 'Pasta (quick cook)', qty: 110, unit: 'g', weightG: 110, kcal: 390 },
      { name: 'Dehydrated bolognese sauce', qty: 45, unit: 'g', weightG: 45, kcal: 180 },
      { name: 'Parmesan', qty: 15, unit: 'g', weightG: 15, kcal: 60 }
    ],
    equipment: ['Stove', 'Cooking pot', 'Spork', 'Bowl'],
    notes: 'Rehydrate sauce in 150 ml water for 10 min. Boil pasta, drain, combine.'
  },
  {
    name: 'Couscous with chorizo', slot: 'dinner', waterMl: 200,
    ingredients: [
      { name: 'Couscous', qty: 90, unit: 'g', weightG: 90, kcal: 330 },
      { name: 'Chorizo', qty: 60, unit: 'g', weightG: 60, kcal: 270 },
      { name: 'Stock cube', qty: 1, unit: 'cube', weightG: 5, kcal: 10 },
      { name: 'Olive oil', qty: 10, unit: 'ml', weightG: 9, kcal: 80 }
    ],
    equipment: ['Stove', 'Cooking pot', 'Knife', 'Bowl'],
    notes: 'Fry sliced chorizo, add water and stock, boil, stir in couscous, cover 5 min.'
  },
  {
    name: 'Freeze-dried meal pouch', slot: 'dinner', waterMl: 400,
    ingredients: [
      { name: 'Freeze-dried meal', qty: 1, unit: 'pouch', weightG: 150, kcal: 650 }
    ],
    equipment: ['Stove', 'Cooking pot', 'Long spoon'],
    notes: 'Add boiling water to the pouch, seal and wait 10 min.'
  },
  {
    name: 'Scroggin (trail mix)', slot: 'snacks', waterMl: 0,
    ingredients: [
      { name: 'Mixed nuts', qty: 50, unit: 'g', weightG: 50, kcal: 310 },
      { name: 'Dried fruit', qty: 30, unit: 'g', weightG: 30, kcal: 95 },
      { name: 'Chocolate drops', qty: 20, unit: 'g', weightG: 20, kcal: 105 }
    ],
    equipment: [],
    notes: ''
  },
  {
    name: 'Muesli bars', slot: 'snacks', waterMl: 0,
    ingredients: [{ name: 'Muesli bar', qty: 2, unit: 'pcs', weightG: 70, kcal: 300 }],
    equipment: [],
    notes: ''
  },
  {
    name: 'Coffee & hot chocolate', slot: 'snacks', waterMl: 500,
    ingredients: [
      { name: 'Instant coffee', qty: 2, unit: 'sachet', weightG: 6, kcal: 5 },
      { name: 'Hot chocolate powder', qty: 30, unit: 'g', weightG: 30, kcal: 120 },
      { name: 'Sugar', qty: 2, unit: 'sachet', weightG: 8, kcal: 32 }
    ],
    equipment: ['Stove', 'Cooking pot', 'Mug'],
    notes: ''
  }
];

/* per: 'person' = one per person; 'group' = shared item, weight split across the group */
const GEAR_STARTER = [
  { name: 'Tent (2 person)', category: 'Shelter', weightG: 1800, type: 'base', per: 'group' },
  { name: 'Tent footprint', category: 'Shelter', weightG: 200, type: 'base', per: 'group' },
  { name: 'Sleeping bag', category: 'Sleep', weightG: 1100, type: 'base', per: 'person' },
  { name: 'Sleeping mat', category: 'Sleep', weightG: 500, type: 'base', per: 'person' },
  { name: 'Inflatable pillow', category: 'Sleep', weightG: 80, type: 'base', per: 'person' },
  { name: 'Backpack (60 L)', category: 'Pack', weightG: 1600, type: 'base', per: 'person' },
  { name: 'Pack liner', category: 'Pack', weightG: 60, type: 'base', per: 'person' },
  { name: 'Stove', category: 'Kitchen', weightG: 90, type: 'base', per: 'group' },
  { name: 'Gas canister (230 g)', category: 'Kitchen', weightG: 360, type: 'consumable', per: 'group' },
  { name: 'Cooking pot', category: 'Kitchen', weightG: 200, type: 'base', per: 'group' },
  { name: 'Frying pan', category: 'Kitchen', weightG: 250, type: 'base', per: 'group' },
  { name: 'Lighter', category: 'Kitchen', weightG: 20, type: 'base', per: 'group' },
  { name: 'Spork', category: 'Kitchen', weightG: 15, type: 'base', per: 'person' },
  { name: 'Mug', category: 'Kitchen', weightG: 60, type: 'base', per: 'person' },
  { name: 'Bowl', category: 'Kitchen', weightG: 50, type: 'base', per: 'person' },
  { name: 'Knife', category: 'Tools', weightG: 60, type: 'base', per: 'group' },
  { name: 'Water bottle (1 L)', category: 'Water', weightG: 30, type: 'base', per: 'person' },
  { name: 'Water filter', category: 'Water', weightG: 85, type: 'base', per: 'group' },
  { name: 'Rain jacket', category: 'Clothing', weightG: 350, type: 'base', per: 'person' },
  { name: 'Fleece / warm layer', category: 'Clothing', weightG: 300, type: 'base', per: 'person' },
  { name: 'Thermal top & bottoms', category: 'Clothing', weightG: 350, type: 'base', per: 'person' },
  { name: 'Spare socks', category: 'Clothing', weightG: 70, type: 'base', per: 'person' },
  { name: 'Hiking clothes (worn)', category: 'Clothing', weightG: 600, type: 'worn', per: 'person' },
  { name: 'Hat', category: 'Clothing', weightG: 80, type: 'worn', per: 'person' },
  { name: 'Hiking boots', category: 'Footwear', weightG: 1200, type: 'worn', per: 'person' },
  { name: 'Camp shoes', category: 'Footwear', weightG: 250, type: 'base', per: 'person' },
  { name: 'Topographic map & compass', category: 'Navigation', weightG: 100, type: 'base', per: 'group' },
  { name: 'Head torch', category: 'Navigation', weightG: 90, type: 'base', per: 'person' },
  { name: 'PLB (personal locator beacon)', category: 'Safety & First Aid', weightG: 150, type: 'base', per: 'group' },
  { name: 'First aid kit (incl. snake bandages)', category: 'Safety & First Aid', weightG: 350, type: 'base', per: 'group' },
  { name: 'Whistle', category: 'Safety & First Aid', weightG: 10, type: 'worn', per: 'person' },
  { name: 'Sunscreen & insect repellent', category: 'Hygiene', weightG: 150, type: 'consumable', per: 'group' },
  { name: 'Toilet trowel & paper', category: 'Hygiene', weightG: 100, type: 'base', per: 'group' },
  { name: 'Toothbrush & toiletries', category: 'Hygiene', weightG: 120, type: 'base', per: 'person' },
  { name: 'Phone', category: 'Electronics', weightG: 200, type: 'worn', per: 'person' },
  { name: 'Power bank', category: 'Electronics', weightG: 200, type: 'base', per: 'group' },
  { name: 'Trekking poles', category: 'Tools', weightG: 500, type: 'worn', per: 'person' }
];

/* l/c = likelihood/consequence before controls; rl/rc = residual after controls (1–5) */
const HAZARD_PRESETS = [
  { hazard: 'Bushfire', cause: 'Hot, dry, windy conditions; nearby fires', l: 2, c: 5, rl: 1, rc: 5,
    controls: 'Check fire danger rating & total fire bans before leaving and daily. Do not go on Extreme/Catastrophic days. Know escape routes and safer areas. Carry radio/phone for alerts. Obey fire bans.' },
  { hazard: 'Flash flooding / river crossing', cause: 'Heavy rain upstream, swollen creeks', l: 3, c: 4, rl: 1, rc: 4,
    controls: 'Check rainfall forecast & river levels. Never cross fast-flowing water above knee depth. Unclip pack hip belt when crossing. Camp well above flood level. Wait it out — water usually drops within hours.' },
  { hazard: 'Tidal cut-off at headland / rock platform', cause: 'Rising tide, large swell', l: 3, c: 4, rl: 1, rc: 4,
    controls: 'Check tide times and swell forecast. Only round headlands within 2 h of low tide. Never turn your back on the ocean. Have an inland alternative route.' },
  { hazard: 'Rips / surf / king waves', cause: 'Swimming or fishing at unpatrolled beaches & rocks', l: 3, c: 5, rl: 1, rc: 5,
    controls: 'Swim only at patrolled beaches between flags. Wear lifejacket when rock fishing. Check swell height. Stay off rocks in big seas.' },
  { hazard: 'Snake bite', cause: 'Snakes active in warm weather, long grass', l: 2, c: 5, rl: 1, rc: 4,
    controls: 'Wear boots & gaiters, stay on track, watch where you step. Carry 2+ compression bandages. Know pressure immobilisation first aid. PLB for evacuation.' },
  { hazard: 'Slips, trips and falls', cause: 'Uneven, wet or steep terrain', l: 4, c: 3, rl: 2, rc: 2,
    controls: 'Good footwear, trekking poles, walk to the slowest member. Avoid walking in the dark. Take extra care on wet rock and descents.' },
  { hazard: 'Falls from height / cliffs', cause: 'Lookouts, cliff edges, scrambling', l: 2, c: 5, rl: 1, rc: 5,
    controls: 'Stay behind barriers and well back from edges. No scrambling in wet or windy conditions. Supervise children closely.' },
  { hazard: 'Hypothermia / cold exposure', cause: 'Cold, wet and windy weather, inadequate gear', l: 3, c: 4, rl: 1, rc: 3,
    controls: 'Pack thermals, warm layer, rain jacket, beanie & gloves. Rated sleeping bag. Keep a dry set of clothes for camp. Eat and drink regularly. Know the signs (shivering, confusion).' },
  { hazard: 'Heat illness / dehydration', cause: 'Hot weather, exertion, limited water', l: 3, c: 4, rl: 2, rc: 3,
    controls: 'Start early, rest in shade in the heat of the day. Carry enough water + electrolytes. Know water sources and treat water. Wear hat & light clothing.' },
  { hazard: 'Getting lost / navigation error', cause: 'Poorly marked tracks, poor visibility', l: 3, c: 4, rl: 1, rc: 3,
    controls: 'Carry printed map, compass & GPS. Leave trip intentions with a contact. Carry PLB. Stop, stay together and reassess if unsure.' },
  { hazard: 'Falling trees / branches', cause: 'Wind, eucalypts drop limbs without warning', l: 3, c: 5, rl: 1, rc: 5,
    controls: 'Look up before pitching — never camp under dead trees or large overhanging limbs. Move camp if strong winds are forecast.' },
  { hazard: 'Lightning / thunderstorms', cause: 'Afternoon storms, exposed ridgelines', l: 2, c: 5, rl: 1, rc: 4,
    controls: 'Check storm forecast. Get off ridges and summits early. Avoid tall isolated trees and open water during storms.' },
  { hazard: 'Contaminated drinking water', cause: 'Untreated creek / tank water', l: 3, c: 3, rl: 1, rc: 2,
    controls: 'Treat all water (filter, boil or tablets). Collect upstream of camp. Carry spare treatment.' },
  { hazard: 'Ticks, leeches & insect bites', cause: 'Bush, long grass, humid weather', l: 4, c: 2, rl: 3, rc: 1,
    controls: 'Repellent, long sleeves & pants, check for ticks daily. Carry antihistamine. Know anaphylaxis action plan for allergic members.' },
  { hazard: 'Burns from stove / campfire', cause: 'Cooking, fuel handling', l: 3, c: 3, rl: 1, rc: 2,
    controls: 'Cook on stable ground away from tents. Never refuel near flame. Keep water handy. Burns first aid: 20 min cool running water.' },
  { hazard: 'Wildlife raiding food', cause: 'Possums, rodents, birds, dingoes', l: 4, c: 2, rl: 2, rc: 1,
    controls: 'Store food in sealed bags or hang it. Never feed wildlife. Keep a clean camp.' },
  { hazard: 'Vehicle access / road conditions', cause: 'Unsealed roads, closures after rain', l: 2, c: 3, rl: 1, rc: 3,
    controls: 'Check park alerts and road closures. Carry recovery gear, spare tyre and extra water in the vehicle.' }
];

/* Typical Australian supermarket cost per serving (AUD), keyed by ingredient name — used to price the sample recipes. */
const INGREDIENT_PRICES = {
  'rolled oats': 0.30, 'powdered milk': 0.40, 'dried berries': 0.80, 'brown sugar': 0.05,
  'shake-and-pour pancake mix': 0.90, 'olive oil': 0.15, 'maple syrup': 0.90,
  'tortilla wraps': 0.80, 'tuna pouch': 2.20, 'mayonnaise sachet': 0.30, 'hard cheese': 0.50,
  'salami': 1.50, 'crackers': 0.60, 'pasta (quick cook)': 0.35, 'dehydrated bolognese sauce': 3.50, 'parmesan': 0.60,
  'couscous': 0.40, 'chorizo': 2.00, 'stock cube': 0.15, 'freeze-dried meal': 14.00,
  'mixed nuts': 1.50, 'dried fruit': 0.60, 'chocolate drops': 0.40, 'muesli bar': 1.20,
  'instant coffee': 0.60, 'hot chocolate powder': 0.70, 'sugar': 0.05
};
SAMPLE_RECIPES.forEach(r => r.ingredients.forEach(i => { i.cost = INGREDIENT_PRICES[i.name.toLowerCase()] ?? 0; }));

/* Fuel types: unit, typical Australian price (AUD, late 2026 — set your local price), typical economy per 100 km. */
const FUEL_TYPES = {
  ulp91: { label: 'Unleaded 91', unit: 'L', price: 1.95, economy: 8.5 },
  e10: { label: 'E10', unit: 'L', price: 1.92, economy: 8.8 },
  pulp95: { label: 'Premium 95', unit: 'L', price: 2.12, economy: 8.5 },
  pulp98: { label: 'Premium 98', unit: 'L', price: 2.22, economy: 8.5 },
  diesel: { label: 'Diesel', unit: 'L', price: 2.02, economy: 9.5 },
  lpg: { label: 'LPG', unit: 'L', price: 1.05, economy: 12 },
  ev: { label: 'Electric', unit: 'kWh', price: 0.45, economy: 17 }
};

/* Camp fee charging bases. qty() gives the default count; nights/days come from the trip dates. */
const FEE_TYPES = {
  pppn: { label: 'per adult per night', unit: 'person-nights' },
  site: { label: 'per site per night', unit: 'site-nights' },
  vpd: { label: 'per vehicle per day (park entry)', unit: 'vehicle-days' },
  vpn: { label: 'per vehicle per night', unit: 'vehicle-nights' },
  flat: { label: 'flat fee', unit: '' }
};

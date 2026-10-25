# Grouped weather outlook

The home page organises work by primary support action and postcode before showing individual cases. The existing case queue, workflow permissions and risk model remain in place.

## Group membership and attention

`shared/src/supportGroups.ts` assigns one of six primary groups using weather sensitivity and the full recorded account/transcript signal summary. Precedence: interrupted supply/low prepay credit, health, other supply needs, concession checks, payment support, energy coaching, then monitoring. Concession checks include a lapsed concession or a reported card without an active account concession; active concession alone is not a payment-support need. Coaching includes reported bill increases, with cause verification required. Secondary needs remain available in `supportNeeds`. This is a transparent work-allocation rule, not a diagnosis or eligibility decision.

The API retains the existing `customers` priority list and funnel totals. It adds `groupCustomers` for all forecast-covered customers, with their primary group, approximate postcode location, current case status and daily outlook. The UI can show customers outside forecast hazard areas; its exposure filter makes that scope explicit.

Circle size represents count, with a readable minimum and maximum. Purple, blue, teal, magenta, cyan and slate identify the six primary actions. Within each hue, shade represents the highest attention tier in the postcode group. Filters are independent toggles. Regional aggregation keeps groups separate, and translucent fills reveal overlaps.

The Solutions tab stacks a coloured solution card for each selected group. The latest selected group expands; others remain compact. Selecting a circle scopes every card to that postcode, retained while toggling groups. Identical solution IDs are shown once in a shared section with group badges and unique customer counts; different purposes are not merged merely because both involve a callback. Secondary needs contribute solutions even when their group is not the customer's primary placement.

The Actions tab creates persistent SQLite group tasks for the selected group and area. Staff choose a supported solution, worker and due date. Managers can assign workers; workers can assign themselves. The server rechecks recorded needs and open cases, excludes existing customer/solution assignments for the same forecast calendar week, and inserts the new task atomically. Completed assignments remain deduplicated that week; cancellation releases them. The forecast week's key is the Monday of the first displayed forecast date, independent of selected day or postcode. New weeks can create new follow-up tasks.

Saved tasks show their scope, assignee, due date and completed/total progress. Detail pages load 50 members at a time, link to actual cases, and support individual completion, page completion and cancellation. Only managers or the assigned worker may update progress; optimistic task versions prevent stale writes. Task work is separate from case resolution. Creation does not send messages or change utility accounts. Task endpoints accept up to 50,000 customer IDs with a separate 6 MB request cap; no individual account payload is loaded. This limit is not a production-scale performance guarantee.

## Geographic weather layer

The overlay uses the Bureau of Meteorology's public forecast districts, product **IDM00001**, downloaded from `ftp://ftp.bom.gov.au/anon/home/adfd/spatial/IDM00001.zip` on 25 October 2026. The archive's shapefile is dated 23 November 2016. Only its 14 WA districts are retained, simplified at 0.005 degrees for overview display. GDA94 coordinates are used for this broad overview, not address location or precise exposure intersection.

Regenerate `web/src/data/forecastDistricts.json` with:

```sh
node scripts/convert-forecast-districts.mjs <directory containing IDM00001.shp and IDM00001.dbf>
```

The district polygons are used only as a land mask. The displayed heat surface uses the existing town forecast maximums: one selected date, or each town's peak across the week. Colours use a fixed 28–44°C scale with mild areas clear. Between towns, inverse-distance weighting uses up to four towns within 120 km, fading in the outer 30 km. Missing forecast gaps remain blank. Town labels show original values. Interpolation does not resolve local terrain or urban heat effects. Peak days can differ by town; the UI states that a specific date is needed for a simultaneous comparison. Sample mode uses the existing fictional town values; live mode uses Bureau town forecasts. Emergency WA remains a separate layer. Customer attention continues to use the existing hazard rules, not interpolated pixels.

This is **not** a gridded heatwave-severity product or a new forecast model. The Bureau's detailed GIS2Web heatwave product requires registered access. Before public redistribution, confirm the relevant Bureau data-use permissions; attribution does not itself grant redistribution rights. Public product terms: https://www.bom.gov.au/catalogue/anon-ftp.shtml

## Verification

```sh
npm run typecheck
npm run build
npm run test -w shared -- src/supportGroups.test.ts src/outlook.test.ts
npm run test -w web -- src/domain/supportGroups.test.ts
npm run test -w web -- src/domain/forecastHeat.test.ts
npm run test -w api -- test/outlook.test.ts
npm run test:groups
```

The grouped-map browser suite starts its own API and Vite servers, uses isolated SQLite/flow files, and unpacks the committed full dataset into ignored `e2e/.runtime/`. AI and external emergency-feed calls are disabled there. Use `PW_BROWSER_CHANNEL=chrome` for an installed Chrome, or `PW_CHROMIUM_PATH` for a browser executable; otherwise use Playwright's installed Chromium.

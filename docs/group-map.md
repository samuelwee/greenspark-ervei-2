# Grouped weather outlook

The home page organises work by primary support action and postcode before showing individual cases. The existing case queue, workflow permissions and risk model remain in place.

## Group membership and attention

`shared/src/supportGroups.ts` assigns one of five primary groups from the customer's full recorded account/transcript signal summary. Precedence: a disconnected supply first, then low prepaid credit, medical needs, financial hardship, and unusual usage or billing trends. A lapsed concession (or a reported card not recorded as active) is treated as a billing concern in the unusual-trend group; an active concession alone is not a payment-support need. Customers with no recorded risk signal are not shown on this view — their needs are reviewed in the case queue. Secondary needs remain available in `supportNeeds`. This is a transparent work-allocation rule, not a diagnosis or eligibility decision.

The API retains the existing `customers` priority list and funnel totals. It adds `groupCustomers` for forecast-covered customers whose signals support a specific action (customers with no recorded risk signal are counted in `totals.unassigned` and left to the queue), with their primary group, approximate postcode location, current case status and daily outlook. The UI can show customers outside forecast hazard areas; its exposure filter makes that scope explicit.

Circle size represents count, with a readable minimum and maximum. Red, purple, blue, teal and cyan identify the five primary actions. Within each hue, shade represents the highest attention tier in the postcode group. Filters are independent toggles. Regional aggregation keeps groups separate, and translucent fills reveal overlaps.

The Solutions tab stacks a coloured solution card for each selected group. The latest selected group expands; others remain compact. Selecting a circle scopes every card to that postcode, retained while toggling groups. Identical solution IDs are shown once in a shared section with group badges and unique customer counts; different purposes are not merged merely because both involve a callback. Secondary needs contribute solutions even when their group is not the customer's primary placement.

The Actions tab creates persistent SQLite group tasks. Staff choose a supported solution, worker and due date for one selected group, or for all selected groups at once; the server rechecks recorded needs and open cases per customer, keeps a customer eligible when any selected group is their primary placement, excludes existing customer/solution assignments for the same forecast calendar week, and inserts the new task atomically. Completed assignments remain deduplicated that week; cancellation releases them. The forecast week's key is the Monday of the first displayed forecast date, independent of selected day or postcode. New weeks can create new follow-up tasks.

An **area directive** (the disconnection moratorium) is a second task kind that covers whole postcode areas for the forecast week instead of individual customers. It is offered as a task option in every task form (each group's form and the all-groups form), alongside the solutions; the staff member thinks in customer selections, and the area scope is inferred from the postcode areas of the selected customers in the current view (region, area and group filters included). Its scope is stored as the inferred postcode areas, and each scoped area gets a checklist row that can be marked complete with the same permissions, 50-rows-per-page paging and optimistic versioning as customer members (total/completed count areas). Overlapping areas are deduplicated against other active moratoria for the same week, and cancelling releases them. Checklist completion only records that the area was confirmed; coverage of an active moratorium does not depend on checklist completion. It is shown as a saved task and detailed with its per-postcode checklist.

The group-task list reports coverage for the forecast week: members of active solution tasks, and postcode areas under an active moratorium. The outlook page's **Hide customers with a scheduled action this week** filter removes those customers from the map, counts and customer table.

Saved tasks show their scope, assignee, due date and completed/total progress. Detail pages load 50 members at a time, link to actual cases, and support individual completion, page completion and cancellation. Moratorium detail pages load 50 postcode areas at a time, each shown as its postcode with the area's suburb name (no case links), and support the same individual and page completion through a separate area-progress endpoint. Only managers or the assigned worker may update progress; optimistic task versions prevent stale writes. Task work is separate from case resolution. Creation does not send messages or change utility accounts. Task endpoints accept up to 50,000 customer IDs (or 5,000 postcode areas for a directive) with a separate 6 MB request cap; no individual account payload is loaded. This limit is not a production-scale performance guarantee.

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

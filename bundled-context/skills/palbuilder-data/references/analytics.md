# Analytic Filters — Aggregates, Grouping, and Derived Columns

The standard filter (`createFilter()`) selects and returns rows. An **analytic filter**
(`createAnalyticFilter()`) does the SQL-analytic work: aggregates (sum, avg, count, min,
max), `GROUP BY`, `HAVING`, distinct counts, standard deviation, date-part extraction, and
date/time differences — all pushed down to the storage engine instead of computed in
workflow code.

**Available on both DataSets and DataViews:**
- `dataSet.createAnalyticFilter()`
- `dataView.createAnalyticFilter()`

Same class either way (`AnalyticDataViewFilter`, which extends the regular
`DataViewFilter`), so **every ordinary filter method still works** — `addEqual`,
`addGreaterThan`, `addBetween`, `sortAscending`, paging, etc. The analytic filter just adds
the aggregate/grouping layer on top.

**Official API:** https://secure.cloudpiston.com/cpal/cp-api/web/AnalyticDataViewFilter.html

Companion:
- `datasets.md` — base filter API and column selection (all still valid here)
- `dataviews.md` — analytic filters over joined views (the common analytics case)
- `../SKILL.md` — when to compute in-query vs. in-workflow

---

## When to reach for it

Use an analytic filter when you want the **database to compute an answer**, not hand you rows
to reduce yourself:

- Totals and averages ("sum of order totals per customer")
- Counts and distinct counts ("how many distinct users placed an order this month")
- Min/max/stddev over groups
- Bucketing by date part ("orders per month", "signups per weekday")
- Post-aggregate filtering ("only customers whose order total exceeds 1000") — a `HAVING`

If you'd otherwise pull every row and loop to accumulate a number, that's the signal to move
the work into an analytic filter. It's faster, and it doesn't blow the page-size limit on
large tables.

---

## Aggregates → result aliases

Every aggregate takes the source column and a **result alias** — the name the computed value
appears under in the result rows.

```js
var analytic = ordersView.createAnalyticFilter();

analytic.groupByColumn("customerId");
analytic.sum("orderTotal", "totalSpent");        // SUM(orderTotal) AS totalSpent
analytic.count("orderId", "orderCount");         // COUNT(orderId)  AS orderCount
analytic.avg("orderTotal", "avgOrder");          // AVG(orderTotal) AS avgOrder

var rows = ordersView.getRecords(analytic, "customerTotals");

// Read the derived columns by their aliases
for (var i = 0; i < rows.getRecordCount(); i++) {
    var rec = rows.getRecord(i);
    var total = rec.get("totalSpent");
    var count = rec.getInt("orderCount");
}
```

Available aggregates: `sum`, `avg`, `count`, `countDistinct`, `min`, `max`,
`standardDeviation` — each `(column, resultAlias)`.

For string aggregation, `concat(column)` returns a `GroupConcat` object (joins a column's
values across a group, default max 1024 chars).

---

## Grouping

```js
analytic.groupByColumn("customerId");                       // single column
analytic.groupByColumns(["region", "productLine"]);         // multiple
```

Group by the columns you're aggregating over. Any non-aggregated column in the result should
appear in a `groupBy` — same rule as SQL.

---

## HAVING — filtering on aggregated values

`WHERE`-style conditions (`addEqual`, `addGreaterThan`, …) filter **rows before**
aggregation. To filter **on an aggregate result**, use the `having*` methods, which operate
on the derived alias:

```js
var analytic = ordersView.createAnalyticFilter();
analytic.groupByColumn("customerId");
analytic.sum("orderTotal", "totalSpent");

analytic.addGreaterThan("orderTotal", "0");                 // pre-aggregate: ignore zero-value rows
analytic.havingGreaterThan("totalSpent", 1000);             // post-aggregate: only big spenders

var bigSpenders = ordersView.getRecords(analytic, "bigSpenders");
```

Having methods: `havingEqual`, `havingGreaterThan`, `havingLessThan`, `havingBetween`, plus
`havingAnd` / `havingOr` and `havingBeginGroup` / `havingEndGroup` for compound having
clauses. Having values are `Object` (pass a number or string as appropriate).

**Pre-aggregate vs post-aggregate is the key distinction:** `addGreaterThan` filters raw
rows; `havingGreaterThan` filters computed groups. Mixing them up is the most common analytic
filter bug.

---

## Date-part extraction

Extract a component of a date column into a derived alias — the basis for time-bucketed
reports:

```js
var analytic = ordersView.createAnalyticFilter();
analytic.year("orderDate", "yr");
analytic.month("orderDate", "mo");
analytic.count("orderId", "orders");
analytic.groupByColumns(["yr", "mo"]);                      // orders per year+month

var monthly = ordersView.getRecords(analytic, "monthlyOrders");
```

Extractors, each `(column, resultAlias)`: `year`, `quarter`, `month`, `week`, `weekOfYear`,
`day`, `dayOfYear`, `dayOfWeek` (1–7, Sun=1), `weekday` (0–6, Mon=0), `hour`, `minute`,
`second`.

Note the two weekday functions differ in numbering — `dayOfWeek` is 1–7 Sunday-first;
`weekday` is 0–6 Monday-first. Pick the one matching your display logic.

---

## Date / time differences

Compute the gap between two date columns, or between a column and a reference date:

```js
// Days between two columns
analytic.dateDiff("createdDate", "closedDate", "daysOpen");

// Days between a column and now (null compareDate = current date)
analytic.dateDiffCompare("dueDate", "daysUntilDue", null);

// Difference in a chosen unit between two datetime columns
analytic.timeDiff("startTime", "endTime", "elapsedMinutes", "minute");

// Difference in a unit vs. a reference datetime (null = now)
analytic.timeDiffCompare("lastSeen", "minutesSinceSeen", null, "minute");
```

`timeDiff` / `timeDiffCompare` units: `second`, `minute`, `hour`, `day`, `week`, `month`,
`quarter`, `year`.

---

## Index control

The analytic filter (like any filter) can inspect and influence index usage:

```js
analytic.explain(true);                    // dev-only — logs chosen indexes to the debug panel
analytic.useIndex("byCustomer");           // hint: use this index
analytic.forceIndex("byCustomer");         // stronger: force this index
```

Use `explain(true)` first to see what the planner picks; reach for `useIndex` / `forceIndex`
only when it picks poorly. See the Indexes section in `datasets.md` for how indexes are
defined.

---

## Paging analytic results

Aggregated result sets can still be large (many groups). The same paging methods apply:

```js
analytic.enableFastPaging(0, 100);         // prefer fast paging on large group sets
// or analytic.enablePaging(0, 100);       // full count — costlier on big tables
```

`enableFastPaging` avoids the full-count scan that `enablePaging` forces — prefer it when you
don't need an exact total. See `datasets.md` for the paging discussion.

---

## Common gotchas

- **`addX` filters rows; `havingX` filters groups.** Pre-aggregate vs post-aggregate. The
  single most common mistake with analytic filters.
- **Every non-aggregated result column needs a `groupBy`.** Same rule as SQL — a bare column
  alongside an aggregate without grouping is an error.
- **Result aliases must be unique** across the whole field list (aggregates, extractions,
  group-bys). A collision silently clobbers.
- **Read derived values by their alias**, not the source column name — `rec.get("totalSpent")`,
  not `rec.get("orderTotal")`.
- **`countDistinct` is a separate method** from `count` — `count("col","a")` counts rows;
  `countDistinct("col","a")` counts distinct values.
- **Aggregates push work to the DB.** That's the point — don't pull all rows and reduce in a
  workflow loop when an analytic filter can do it in one query. But do respect the query
  timeout (`setQueryTimeout` / default 10s) on heavy aggregations over huge tables.

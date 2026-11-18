import test from "node:test";
import assert from "node:assert/strict";
import { normalizePreferences } from "../../packages/i18n/index.js";
import {
  shiftWorkDay,
  workTaskOnDay,
  workTaskHour,
  workDateTimeValue,
  workDateTimeCandidates,
  workDateTimeFromForm,
} from "../../web/src/features/work/calendar.js";
test("Work calendar follows account civil days and hours across midnight and DST", () => {
  const la = normalizePreferences({
      locale: "en-US",
      timeZone: "America/Los_Angeles",
    }),
    tokyo = normalizePreferences({ locale: "ja-JP", timeZone: "Asia/Tokyo" }),
    task = { startsAt: "2026-03-08T07:30:00Z", endsAt: null };
  assert.equal(workTaskOnDay(task, "2026-03-07", la), true);
  assert.equal(workTaskOnDay(task, "2026-03-08", la), false);
  assert.equal(workTaskHour(task, "2026-03-07", la), 23);
  assert.equal(workTaskOnDay(task, "2026-03-08", tokyo), true);
  assert.equal(workTaskHour(task, "2026-03-08", tokyo), 16);
  const span = {
    startsAt: "2026-03-08T09:30:00Z",
    endsAt: "2026-03-09T08:00:00Z",
  };
  assert.equal(workTaskHour(span, "2026-03-08", la), 1);
  assert.equal(workTaskOnDay(span, "2026-03-09", la), true);
  assert.equal(workTaskHour(span, "2026-03-09", la), 0);
  assert.equal(
    workTaskHour(
      { startsAt: "2026-03-08T10:30:00Z", endsAt: null },
      "2026-03-08",
      la,
    ),
    3,
  );
  assert.equal(shiftWorkDay("2026-03-08", 1), "2026-03-09");
  assert.equal(shiftWorkDay("2026-01-01", -1), "2025-12-31");
  assert.equal(
    workTaskOnDay({ startsAt: null, endsAt: null }, "2026-03-08", la),
    false,
  );
});
test("Work date forms resolve account-zone offsets, reject DST gaps and require overlap selection while preserving unchanged microseconds", () => {
  const la = normalizePreferences({ timeZone: "America/Los_Angeles" }),
    nepal = normalizePreferences({ timeZone: "Asia/Kathmandu" }),
    howe = normalizePreferences({ timeZone: "Australia/Lord_Howe" });
  assert.equal(
    workDateTimeValue("2026-10-19T00:00:00Z", nepal),
    "2026-10-19T05:45",
  );
  assert.deepEqual(workDateTimeCandidates("2026-10-19T05:45", nepal), [
    "2026-10-19T00:00:00.000Z",
  ]);
  assert.deepEqual(workDateTimeCandidates("2026-03-08T02:30", la), []);
  assert.deepEqual(workDateTimeCandidates("2026-11-01T01:30", la), [
    "2026-11-01T08:30:00.000Z",
    "2026-11-01T09:30:00.000Z",
  ]);
  assert.deepEqual(workDateTimeCandidates("2026-04-05T01:45", howe), [
    "2026-04-04T14:45:00.000Z",
    "2026-04-04T15:15:00.000Z",
  ]);
  assert.deepEqual(
    workDateTimeCandidates(
      "2011-12-30T12:00",
      normalizePreferences({ timeZone: "Pacific/Apia" }),
    ),
    [],
  );
  for (const invalid of [
    "2026-02-30T12:00",
    "2026-10-19T24:00",
    "2026-10-19T12:60",
    "not a date",
  ])
    assert.deepEqual(workDateTimeCandidates(invalid, la), []);
  const form = new FormData();
  form.set("startsAt", "2026-11-01T01:30");
  assert.throws(
    () => workDateTimeFromForm(form, "startsAt", la),
    /WORK_AMBIGUOUS_LOCAL_TIME/,
  );
  form.set("startsAtChoice", "2026-11-01T09:30:00.000Z");
  assert.equal(
    workDateTimeFromForm(form, "startsAt", la),
    "2026-11-01T09:30:00.000Z",
  );
  form.set("startsAtOriginal", "2026-11-01T09:30:42.123456Z");
  form.set("startsAtChoice", "2026-11-01T09:30:42.123Z");
  assert.equal(
    workDateTimeFromForm(form, "startsAt", la),
    "2026-11-01T09:30:42.123456Z",
  );
  form.set("startsAtChoice", "2026-11-01T09:30:00.000Z");
  assert.equal(
    workDateTimeFromForm(form, "startsAt", la),
    "2026-11-01T09:30:42.123456Z",
  );
  form.set("startsAt", "2026-03-08T02:30");
  assert.throws(
    () => workDateTimeFromForm(form, "startsAt", la),
    /WORK_INVALID_LOCAL_TIME/,
  );
  form.set("startsAt", "");
  assert.equal(workDateTimeFromForm(form, "startsAt", la), null);
});

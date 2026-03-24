import test from "node:test";
import assert from "node:assert/strict";

import {
  buildClosedScheduleCandidates,
  buildScheduleUpdateRows,
  createBaselineState,
  pickScheduleSubset,
} from "./build-hybrid-bridge.mjs";

test("buildScheduleUpdateRows keeps reopen date_finished clears", () => {
  const baseline = createBaselineState();
  baseline.schedule.rows.set("347691", pickScheduleSubset({
    serial: 2275,
    isongoing: 0,
    date_finished: "2026-03-24 08:58:00",
    closedby: 0,
    phone_number: "714-9285",
    meter_reading: 0,
    tl_status: 0,
    tl_remarks: "",
    customer_request: "",
    collocutor: "Melissa",
    dev_remarks: "",
  }));

  const scheduleDocs = new Map([
    ["347691", {
      id: 347691,
      serial: 2275,
      isongoing: 0,
      date_finished: "0000-00-00 00:00:00",
      closedby: 0,
      phone_number: "714-9285",
      meter_reading: 0,
      tl_status: 0,
      tl_remarks: "",
      customer_request: "",
      collocutor: "Melissa",
      dev_remarks: "",
    }],
  ]);

  assert.deepEqual(buildScheduleUpdateRows(scheduleDocs, baseline), [
    {
      id: 347691,
      changes: { date_finished: "0000-00-00 00:00:00" },
      firebaseDocId: "347691",
    },
  ]);
});

test("buildScheduleUpdateRows ignores absent schedule fields", () => {
  const baseline = createBaselineState();
  baseline.schedule.rows.set("347691", pickScheduleSubset({
    serial: 2275,
    isongoing: 0,
    date_finished: "2026-03-24 08:58:00",
    closedby: 0,
    phone_number: "714-9285",
    meter_reading: 0,
    tl_status: 0,
    tl_remarks: "",
    customer_request: "",
    collocutor: "Melissa",
    dev_remarks: "",
  }));

  const scheduleDocs = new Map([
    ["347691", {
      id: 347691,
      serial: 2275,
      phone_number: "714-9285",
    }],
  ]);

  assert.deepEqual(buildScheduleUpdateRows(scheduleDocs, baseline), []);
});

test("buildClosedScheduleCandidates ignores legacy empty reopen dates", () => {
  const baseline = createBaselineState();
  const scheduleDocs = new Map([
    ["347691", {
      id: 347691,
      date_finished: "undefined 00:00:00",
    }],
  ]);

  const candidates = buildClosedScheduleCandidates([
    { id: 347691, changes: { date_finished: "undefined 00:00:00" }, firebaseDocId: "347691" },
  ], scheduleDocs, baseline);

  assert.deepEqual(candidates, []);
});

test("buildScheduleUpdateRows normalizes mysql zero-date variants", () => {
  const baseline = createBaselineState();
  baseline.schedule.rows.set("347691", pickScheduleSubset({
    serial: 2275,
    isongoing: 0,
    date_finished: "0000-00-00 00:00:00",
    closedby: 0,
    phone_number: "714-9285",
    meter_reading: 0,
    tl_status: 0,
    tl_remarks: "",
    customer_request: "",
    collocutor: "Melissa",
    dev_remarks: "",
  }));

  const scheduleDocs = new Map([
    ["347691", {
      id: 347691,
      date_finished: "undefined 00:00:00",
    }],
  ]);

  assert.deepEqual(buildScheduleUpdateRows(scheduleDocs, baseline), []);
});

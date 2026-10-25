// Where each signal's data comes from, for the Data sources column of the flowchart. Account signals list the
// dataset files their detection rule reads (shared/src/accountSignals.ts); self-report signals come from the
// survey or what customers said in transcripts (shared/src/caseFlow.ts); weather signals from the Bureau.
import { SURVEY_SIGNALS, TRANSCRIPT_SIGNALS } from "@greenspark/shared";

export interface DataSource { id: string; name: string; detail: string; signals: string[] }
export interface DataSourceGroup { id: string; label: string; items: DataSource[] }

const unique = (ids: string[]) => [...new Set(ids)];

export const DATA_SOURCE_GROUPS: DataSourceGroup[] = [
  {
    id: "dataset", label: "Synthetic utility dataset",
    items: [
      { id: "bills", name: "Bills", detail: "bills.csv", signals: ["acct_missed_payment", "acct_repeated_late", "acct_seasonal_peak", "acct_bill_up_flat_usage", "acct_no_hardship_offer", "acct_usage_drop"] },
      { id: "payments", name: "Payments", detail: "payments.csv", signals: ["acct_dishonour", "acct_partial_payments", "acct_payday_aligned", "acct_cash_only"] },
      { id: "arrangements", name: "Payment plans and extensions", detail: "payment_arrangements.csv", signals: ["acct_broken_plan", "acct_many_extensions"] },
      { id: "month_panel", name: "Month-end balances", detail: "customer_month_panel.csv", signals: ["acct_rising_arrears", "acct_concession_lapsed", "acct_missed_payment"] },
      { id: "usage", name: "Daily meter reads", detail: "consumption_daily.csv.gz", signals: ["acct_usage_spike", "acct_usage_drop", "acct_solar_export_zero"] },
      { id: "prepay", name: "Prepay self-disconnections", detail: "prepay_self_disconnections.csv", signals: ["acct_prepay_low_credit"] },
      { id: "customers", name: "Customer records", detail: "customers.csv", signals: ["acct_concession_on_file", "acct_concession_lapsed", "acct_life_support", "acct_move", "ask_temperature_need"] },
      { id: "preferences", name: "Contact preferences", detail: "contact_preferences.csv", signals: ["acct_interpreter", "acct_third_party_authority", "acct_digital_disengaged"] },
      { id: "postcodes", name: "Postcode context", detail: "postcode_context.csv", signals: ["acct_remote_area"] },
      { id: "contacts", name: "Contacts", detail: "contacts.csv", signals: ["acct_repeat_contact", "acct_complaint", "acct_unanswered_outreach", "acct_no_hardship_offer"] },
      { id: "comms", name: "Messages sent", detail: "communications_log.csv.gz", signals: ["acct_returned_mail", "acct_digital_disengaged"] },
      { id: "collections", name: "Collection notices", detail: "collection_events.csv", signals: ["acct_disconnection_warning", "acct_collections"] },
      { id: "disconnections", name: "Disconnections", detail: "disconnections.csv", signals: ["acct_disconnected"] },
      { id: "hardship", name: "Hardship programs", detail: "hardship_programs.csv", signals: ["acct_hardship_exit", "acct_no_hardship_offer"] },
      { id: "outages", name: "Outages", detail: "outage_customer_impacts.csv", signals: ["acct_outage_history"] },
    ],
  },
  {
    id: "customer", label: "What the customer told us",
    items: [
      { id: "survey", name: "Survey answers", detail: "case queue survey", signals: unique(SURVEY_SIGNALS.map((m) => m.signalId)) },
      { id: "transcripts", name: "Contact transcripts", detail: "contact_transcripts.jsonl", signals: unique(TRANSCRIPT_SIGNALS.map((m) => m.signalId)) },
    ],
  },
  {
    id: "bom", label: "Bureau of Meteorology",
    items: [
      { id: "bom_towns", name: "Town forecasts", detail: "IDW14199, 7 days", signals: ["wx_extreme_heat"] },
      { id: "bom_districts", name: "Fire danger ratings", detail: "IDW13010", signals: ["wx_fire_danger"] },
      { id: "bom_warnings", name: "Warnings", detail: "IDW2xxxx, while active", signals: ["wx_warning"] },
    ],
  },
  {
    id: "abs", label: "Australian Bureau of Statistics",
    items: [
      { id: "seifa", name: "Area disadvantage", detail: "SEIFA 2021, IRSD by postcode", signals: ["area_disadvantage"] },
    ],
  },
];

export const sourceKey = (id: string) => `source:${id}`;
export const sourceLinkKey = (source: string, signal: string) => `d>s:${source}>${signal}`;

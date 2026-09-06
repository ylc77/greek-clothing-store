import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's strip-only test runner requires the explicit .ts extension.
import { BoxNowUnavailableError, cancelBoxNowParcel, createBoxNowShipment, fetchBoxNowLabel, fetchBoxNowParcelState, verifyBoxNowConnection, type BoxNowConfig } from "../lib/boxnow.ts";

const config: BoxNowConfig = { apiBaseUrl: "https://api.example.test", clientId: "id", clientSecret: "secret", originId: "origin-1", partnerId: "partner-1" };
const input = {
  orderNumber: "WEB-1001", totalCents: 4250, customer: { name: "Ada", email: "ada@example.test", phone: "+306900000000" },
  lockerId: "locker-9", origin: { name: "Athens Store", email: "store@example.test", phone: "+302100000000" },
  items: [{ id: "WEB-1001-1", name: "Order WEB-1001", valueCents: 4250, weightGrams: 0 }],
};

test("BOX NOW creates one prepaid parcel and never requests COD", async () => {
  const calls: Array<{ url: string; body: Record<string, unknown>; headers: Record<string, string> }> = [];
  const fetcher = async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : {}, headers: init?.headers as Record<string, string> || {} });
    return calls.length === 1
      ? new Response(JSON.stringify({ access_token: "token" }), { status: 200 })
      : new Response(JSON.stringify({ referenceNumber: "ref-1", parcels: [{ id: "parcel-1" }] }), { status: 200 });
  };
  assert.deepEqual(await createBoxNowShipment(input, { config, fetcher: fetcher as typeof fetch }), { referenceNumber: "ref-1", parcelId: "parcel-1" });
  assert.equal(calls[1].body.paymentMode, "prepaid");
  assert.equal(calls[1].body.amountToBeCollected, "0.00");
  assert.equal(calls[1].body.invoiceValue, "42.50");
  assert.equal(calls[1].headers["X-PartnerID"], config.partnerId);
});

test("BOX NOW unknown outcomes remain retryable and do not fabricate shipment IDs", async () => {
  const fetcher = async () => { throw new Error("timeout"); };
  await assert.rejects(() => createBoxNowShipment(input, { config, fetcher: fetcher as typeof fetch }), (error: unknown) => error instanceof BoxNowUnavailableError && error.code === "BOXNOW_REQUEST_UNKNOWN" && error.retryable);
});

test("BOX NOW labels require a bounded valid PDF", async () => {
  let call = 0;
  const fetcher = async () => {
    call += 1;
    return call === 1
      ? new Response(JSON.stringify({ access_token: "token" }), { status: 200 })
      : new Response(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]), { status: 200, headers: { "content-type": "application/pdf" } });
  };
  assert.equal((await fetchBoxNowLabel("parcel-1", { config, fetcher: fetcher as typeof fetch })).byteLength, 5);
});

test("BOX NOW cancellation uses the confirmed parcel endpoint and partner header", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return calls.length === 1
      ? new Response(JSON.stringify({ access_token: "token" }), { status: 200 })
      : new Response(null, { status: 204 });
  }) as typeof fetch;
  await cancelBoxNowParcel("parcel/unsafe", { config, fetcher });
  assert.equal(calls[1].url, "https://api.example.test/api/v1/parcels/parcel%2Funsafe:cancel");
  assert.equal(calls[1].init?.method, "POST");
  assert.equal((calls[1].init?.headers as Record<string, string>)["X-PartnerID"], "partner-1");
});

test("BOX NOW refresh reads only the requested parcel and normalizes documented state spelling", async () => {
  const calls: string[] = [];
  const fetcher = (async (url: string | URL | Request) => {
    calls.push(String(url));
    return calls.length === 1
      ? new Response(JSON.stringify({ access_token: "token" }), { status: 200 })
      : Response.json({ data: [{ id: "other", state: "delivered" }, { id: "parcel-1", state: "intransit" }] });
  }) as typeof fetch;
  assert.equal(await fetchBoxNowParcelState("parcel-1", { config, fetcher }), "in-transit");
  assert.match(calls[1], /parcelId=parcel-1/);
  assert.match(calls[1], /limit=1/);
});

test("BOX NOW connection verification authenticates without creating a shipment", async () => {
  const calls: string[] = [];
  const fetcher = (async (input: string | URL | Request) => {
    calls.push(String(input));
    return new Response(JSON.stringify({ access_token: "token" }), { status: 200 });
  }) as typeof fetch;
  assert.deepEqual(await verifyBoxNowConnection({ config, fetcher }), { ok: true });
  assert.deepEqual(calls, ["https://api.example.test/api/v1/auth-sessions"]);
});

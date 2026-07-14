import { NextRequest, NextResponse } from "next/server";
import { adminRequestHasPermissionAsync } from "@/lib/admin-auth";
import { featureDisabledResponse, isFeatureEnabled } from "@/lib/features";
import { getSupabaseAdminClient } from "@/lib/supabase";

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

function unavailable() {
  return NextResponse.json({ error: "Admin Supabase is not configured." }, { status: 500 });
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function supplierPayload(value: Record<string, unknown>) {
  return {
    code: text(value.code).toUpperCase(),
    name: text(value.name),
    vat_number: text(value.vat_number) || null,
    contact_name: text(value.contact_name) || null,
    phone: text(value.phone) || null,
    email: text(value.email) || null,
    address: text(value.address) || null,
    country: text(value.country) || null,
    notes: text(value.notes) || null,
    active: value.active !== false,
  };
}

async function allowed(request: NextRequest, write = false) {
  const permission = write ? "products:write" : "products:read";
  return adminRequestHasPermissionAsync(request, permission);
}

export async function GET(request: NextRequest) {
  if (!(await allowed(request))) return unauthorized();
  if (!(await isFeatureEnabled("product_management"))) return featureDisabledResponse("product_management");
  const supabase = getSupabaseAdminClient();
  if (!supabase) return unavailable();
  const { data, error } = await (supabase as any)
    .from("suppliers")
    .select("*")
    .order("active", { ascending: false })
    .order("name", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ suppliers: data || [] });
}

export async function POST(request: NextRequest) {
  if (!(await allowed(request, true))) return unauthorized();
  if (!(await isFeatureEnabled("product_management"))) return featureDisabledResponse("product_management");
  const supabase = getSupabaseAdminClient();
  if (!supabase) return unavailable();
  const body = (await request.json()) as Record<string, unknown>;
  const payload = supplierPayload(body);
  if (!payload.code || !payload.name) {
    return NextResponse.json({ error: "供货商编号和名称必填。" }, { status: 400 });
  }
  const { data, error } = await (supabase as any).from("suppliers").insert(payload).select("*").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ supplier: data }, { status: 201 });
}

export async function PUT(request: NextRequest) {
  if (!(await allowed(request, true))) return unauthorized();
  if (!(await isFeatureEnabled("product_management"))) return featureDisabledResponse("product_management");
  const supabase = getSupabaseAdminClient();
  if (!supabase) return unavailable();
  const body = (await request.json()) as Record<string, unknown>;
  const id = text(body.id);
  const payload = supplierPayload(body);
  if (!id || !payload.code || !payload.name) {
    return NextResponse.json({ error: "供货商 ID、编号和名称必填。" }, { status: 400 });
  }
  const { data, error } = await (supabase as any)
    .from("suppliers")
    .update(payload)
    .eq("id", id)
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ supplier: data });
}

export async function DELETE(request: NextRequest) {
  if (!(await allowed(request, true))) return unauthorized();
  if (!(await isFeatureEnabled("product_management"))) return featureDisabledResponse("product_management");
  const supabase = getSupabaseAdminClient();
  if (!supabase) return unavailable();
  const body = (await request.json()) as Record<string, unknown>;
  const id = text(body.id);
  if (!id) return NextResponse.json({ error: "供货商 ID 必填。" }, { status: 400 });
  const { error } = await (supabase as any).from("suppliers").update({ active: false }).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

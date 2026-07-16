import { NextRequest } from "next/server";
import {
  adminHasPermission,
  getAdminAuthContextFromRequest,
  type AdminPermission,
} from "@/lib/admin-auth";
import { shapeSupplierForRole, shapeSuppliersForRole } from "@/lib/admin-data-boundary";
import { adminPrivateJson, applyAdminPrivateCache } from "@/lib/admin-response";
import { featureDisabledResponse, isFeatureEnabled } from "@/lib/features";
import { getSupabaseAdminClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const SUPPLIER_PRIVATE_SELECT = [
  "id",
  "code",
  "name",
  "vat_number",
  "contact_name",
  "phone",
  "email",
  "address",
  "country",
  "notes",
  "active",
  "created_at",
  "updated_at",
].join(",");

function unavailable() {
  return adminPrivateJson(
    { error: "Supplier data is temporarily unavailable.", code: "SUPPLIER_DATA_UNAVAILABLE" },
    { status: 503 },
  );
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

async function authorize(request: NextRequest, permission: AdminPermission) {
  const context = await getAdminAuthContextFromRequest(request);
  if (!context) {
    return { response: adminPrivateJson({ error: "Unauthorized", code: "UNAUTHORIZED" }, { status: 401 }) };
  }
  if (!adminHasPermission(context, permission)) {
    return { response: adminPrivateJson({ error: "Forbidden", code: "FORBIDDEN" }, { status: 403 }) };
  }
  return { context };
}

async function requireFeature() {
  if (await isFeatureEnabled("product_management")) return null;
  return applyAdminPrivateCache(featureDisabledResponse("product_management"));
}

export async function GET(request: NextRequest) {
  const authorized = await authorize(request, "procurement:read");
  if (authorized.response) return authorized.response;
  const disabled = await requireFeature();
  if (disabled) return disabled;

  const supabase = getSupabaseAdminClient();
  if (!supabase) return unavailable();
  const { data, error } = await (supabase as any)
    .from("suppliers")
    .select(SUPPLIER_PRIVATE_SELECT)
    .order("active", { ascending: false })
    .order("name", { ascending: true });
  if (error) return unavailable();
  return adminPrivateJson({
    suppliers: shapeSuppliersForRole(data || [], authorized.context!.role),
  });
}

export async function POST(request: NextRequest) {
  const authorized = await authorize(request, "procurement:write");
  if (authorized.response) return authorized.response;
  const disabled = await requireFeature();
  if (disabled) return disabled;

  const supabase = getSupabaseAdminClient();
  if (!supabase) return unavailable();
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const payload = supplierPayload(body);
  if (!payload.code || !payload.name) {
    return adminPrivateJson({ error: "供货商编号和名称必填。", code: "INVALID_ARGUMENT" }, { status: 400 });
  }
  const { data, error } = await (supabase as any)
    .from("suppliers")
    .insert(payload)
    .select(SUPPLIER_PRIVATE_SELECT)
    .single();
  if (error) return unavailable();
  return adminPrivateJson({ supplier: shapeSupplierForRole(data, authorized.context!.role) }, { status: 201 });
}

export async function PUT(request: NextRequest) {
  const authorized = await authorize(request, "procurement:write");
  if (authorized.response) return authorized.response;
  const disabled = await requireFeature();
  if (disabled) return disabled;

  const supabase = getSupabaseAdminClient();
  if (!supabase) return unavailable();
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const id = text(body.id);
  const payload = supplierPayload(body);
  if (!id || !payload.code || !payload.name) {
    return adminPrivateJson(
      { error: "供货商 ID、编号和名称必填。", code: "INVALID_ARGUMENT" },
      { status: 400 },
    );
  }
  const { data, error } = await (supabase as any)
    .from("suppliers")
    .update(payload)
    .eq("id", id)
    .select(SUPPLIER_PRIVATE_SELECT)
    .single();
  if (error) return unavailable();
  return adminPrivateJson({ supplier: shapeSupplierForRole(data, authorized.context!.role) });
}

export async function DELETE(request: NextRequest) {
  const authorized = await authorize(request, "procurement:write");
  if (authorized.response) return authorized.response;
  const disabled = await requireFeature();
  if (disabled) return disabled;

  const supabase = getSupabaseAdminClient();
  if (!supabase) return unavailable();
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const id = text(body.id);
  if (!id) return adminPrivateJson({ error: "供货商 ID 必填。", code: "INVALID_ARGUMENT" }, { status: 400 });
  const { error } = await (supabase as any).from("suppliers").update({ active: false }).eq("id", id);
  if (error) return unavailable();
  return adminPrivateJson({ ok: true });
}

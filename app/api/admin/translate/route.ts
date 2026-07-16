import { NextRequest, NextResponse } from "next/server";
import { authorizeAdminRequest } from "@/lib/admin-auth";
import { adminAuthorizationFailure } from "@/lib/admin-response";
import { featureDisabledResponse, isFeatureEnabled } from "@/lib/features";
import { translateProductContent } from "@/lib/translate";

export async function POST(request: NextRequest) {
  const authorization = await authorizeAdminRequest(request, "ai:write");
  if (!authorization.allowed) return adminAuthorizationFailure(authorization);
  if (!(await isFeatureEnabled("ai_tools"))) return featureDisabledResponse("ai_tools");

  const payload = (await request.json()) as {
    name_cn?: unknown;
    description_cn?: unknown;
  };

  const nameCn = typeof payload.name_cn === "string" ? payload.name_cn.trim() : "";
  const descriptionCn = typeof payload.description_cn === "string" ? payload.description_cn.trim() : "";

  if (!nameCn && !descriptionCn) {
    return NextResponse.json(
      { error: "请先填写中文名称或中文描述。" },
      { status: 400 },
    );
  }

  const result = await translateProductContent({
    name_cn: nameCn,
    description_cn: descriptionCn,
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: 502 },
    );
  }

  return NextResponse.json(result.translations);
}
